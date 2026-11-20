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

    waiters = [asyncio.create_task(client.run_until_disconnected())]
    bot = await start_bot(http)
    if bot:
        waiters.append(asyncio.create_task(bot.run_until_disconnected()))

    # Se qualquer sessao cair de vez, o processo sai e o restart do compose
    # sobe outro; o heartbeat para no meio tempo e o n8n percebe.
    await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
    beat_task.cancel()


async def start_bot(http: httpx.AsyncClient):
    if not (config.BOT_TOKEN and config.OWNER_ID):
        log.info("bot de comandos desativado (sem TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)")
        return None

    bot = TelegramClient(config.BOT_SESSION_PATH, config.API_ID, config.API_HASH)

    @bot.on(events.NewMessage(incoming=True, pattern=r"^/"))
    async def on_command(event):
        # Bot e publico por natureza: qualquer um pode achar e mandar mensagem.
        # Quem nao e o dono e ignorado em silencio.
        if event.sender_id != config.OWNER_ID:
            log.info("comando ignorado de remetente desconhecido %s", event.sender_id)
            return
        body = {"chat_id": event.chat_id, "text": event.raw_text, "listener": STATE}
        try:
            await http.post(config.COMMAND_URL, json=body, headers={"X-Radar-Token": config.WEBHOOK_TOKEN})
        except httpx.HTTPError as exc:
            log.warning("comando nao chegou ao n8n: %s", exc)
            await event.reply("O n8n não respondeu. Tente de novo em instantes.")

    await bot.start(bot_token=config.BOT_TOKEN)
    log.info("bot de comandos ativo")
    return bot


if __name__ == "__main__":
    asyncio.run(main())
