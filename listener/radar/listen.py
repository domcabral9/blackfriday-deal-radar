"""Servico principal: escuta os canais e repassa cada post para o webhook do n8n.

Cada mensagem tambem vai para /data/messages.jsonl, que serve de trilha de
auditoria e de massa de teste. Se o n8n estiver fora, a mensagem vai para
/data/failed.jsonl depois das tentativas, para reprocessar depois.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from telethon import TelegramClient, events

from . import config
from .extract import build_payload

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
log = logging.getLogger("radar")
logging.getLogger("telethon").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

RETRY_DELAYS = (2, 10, 30)


def append_jsonl(name: str, payload: dict) -> None:
    with open(os.path.join(config.DATA_DIR, name), "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


async def forward(http: httpx.AsyncClient, payload: dict) -> None:
    headers = {"X-Radar-Token": config.WEBHOOK_TOKEN}
    for attempt, delay in enumerate((0, *RETRY_DELAYS)):
        if delay:
            await asyncio.sleep(delay)
        try:
            resp = await http.post(config.WEBHOOK_URL, json=payload, headers=headers)
            if resp.status_code < 300:
                return
            log.warning("n8n respondeu %s (tentativa %d)", resp.status_code, attempt + 1)
        except httpx.HTTPError as exc:
            log.warning("falha ao enviar ao n8n: %s (tentativa %d)", exc, attempt + 1)
    append_jsonl("failed.jsonl", payload)
    log.error("mensagem %s salva em failed.jsonl", payload["post_url"])


STATE = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "last_message_at": None,
    "messages_since_start": 0,
}


async def heartbeat_loop(client: TelegramClient, http: httpx.AsyncClient) -> None:
    """Avisa o n8n que o listener esta vivo. A ausencia de batimento e o alarme."""
    headers = {"X-Radar-Token": config.WEBHOOK_TOKEN}
    while True:
        beat = {**STATE, "connected": client.is_connected(), "channels": len(config.CHANNEL_IDS)}
        delay = config.HEARTBEAT_SECONDS
        try:
            resp = await http.post(config.HEARTBEAT_URL, json=beat, headers=headers)
            if resp.status_code >= 300:
                log.warning("heartbeat: n8n respondeu %s", resp.status_code)
                delay = 30
        except httpx.HTTPError as exc:
            # Comum logo apos um boot, com o n8n ainda subindo
            log.warning("heartbeat falhou: %s", exc)
            delay = 30
        await asyncio.sleep(delay)


async def main() -> None:
    if not config.CHANNEL_IDS:
        raise SystemExit("TG_CHANNELS vazio: rode radar.login e preencha o .env")

    # catch_up recupera mensagens publicadas enquanto o listener estava fora
    client = TelegramClient(
        config.SESSION_PATH, config.API_ID, config.API_HASH, catch_up=True
    )
    http = httpx.AsyncClient(timeout=15)

    @client.on(events.NewMessage(chats=config.CHANNEL_IDS))
    async def on_message(event):
        if not event.message.message:
            return
        chat = await event.get_chat()
        payload = build_payload(event.message, chat)
        STATE["last_message_at"] = datetime.now(timezone.utc).isoformat()
        STATE["messages_since_start"] += 1
        append_jsonl("messages.jsonl", payload)
        log.info("[%s] %s", payload["source"]["title"], payload["text"][:80].replace("\n", " "))
        await forward(http, payload)

    await client.start()
    log.info("escutando %d canais", len(config.CHANNEL_IDS))
    beat_task = asyncio.create_task(heartbeat_loop(client, http))
    # Se a sessao cair de vez, run_until_disconnected retorna, o processo sai
    # e o restart do compose sobe outro; o heartbeat para e o n8n percebe.
    await client.run_until_disconnected()
    beat_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
