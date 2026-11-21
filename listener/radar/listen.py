"""Servico principal: escuta os canais e repassa cada post para o webhook do n8n.

Dois caminhos levam um post ao n8n, e os dois passam por process():
  - ao vivo: evento NewMessage do Telegram;
  - reconciliacao: a cada RECONCILE_SECONDS, o listener pede ao Telegram os
    posts com ID acima do cursor salvo. Cobre PC desligado a noite, VM
    restaurada de "saved", queda de rede e restart. Esses posts vao marcados
    com replay=True, e o n8n decide se ainda valem como alerta retroativo.

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

from . import config, cursor as cursor_store
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


async def wait_for_n8n(http: httpx.AsyncClient, max_seconds: int = 600) -> None:
    """Segura a conexao com o Telegram ate o n8n responder.

    Num reboot da VM, o Docker sobe os containers pela politica de restart e
    ignora o depends_on do Compose. Sem esta espera, os posts recuperados pelo
    catch_up chegam antes do n8n estar no ar.
    """
    health = config.WEBHOOK_URL.split("/webhook/")[0] + "/healthz"
    waited = 0
    while waited < max_seconds:
        try:
            if (await http.get(health)).status_code == 200:
                if waited:
                    log.info("n8n pronto depois de %ds", waited)
                return
        except httpx.HTTPError:
            pass
        await asyncio.sleep(5)
        waited += 5
    log.warning("n8n nao respondeu em %ds; seguindo mesmo assim", max_seconds)


async def main() -> None:
    if not config.CHANNEL_IDS:
        raise SystemExit("TG_CHANNELS vazio: rode radar.login e preencha o .env")

    # Sem catch_up do Telethon: a recuperacao fica toda na reconciliacao, que
    # tem cursor proprio e marca o que chegou atrasado
    client = TelegramClient(config.SESSION_PATH, config.API_ID, config.API_HASH)
    http = httpx.AsyncClient(timeout=15)
    cursor = cursor_store.Cursor()
    lock = asyncio.Lock()

    async def process(message, chat, replay: bool) -> None:
        if not message.message:
            return
        async with lock:
            # Ao vivo e reconciliacao podem ver o mesmo post
            if cursor.is_seen(chat.id, message.id):
                return
            cursor.mark_seen(chat.id, message.id)
            cursor.save()
        payload = build_payload(message, chat)
        payload["replay"] = replay
        STATE["last_message_at"] = datetime.now(timezone.utc).isoformat()
        STATE["messages_since_start"] += 1
        append_jsonl("messages.jsonl", payload)
        tag = "recuperado " if replay else ""
        log.info("%s[%s] %s", tag, payload["source"]["title"], payload["text"][:80].replace("\n", " "))
        await forward(http, payload)

    @client.on(events.NewMessage(chats=config.CHANNEL_IDS))
    async def on_message(event):
        await process(event.message, await event.get_chat(), replay=False)

    async def reconcile() -> None:
        for channel_id in config.CHANNEL_IDS:
            chat = await client.get_entity(channel_id)
            last = cursor.watermark.get(chat.id)
            if last is None:
                # Primeira execucao: marca a posicao atual sem inundar o bot
                latest = await client.get_messages(chat, limit=1)
                async with lock:
                    cursor.watermark[chat.id] = latest[0].id if latest else 0
                    cursor.save()
                log.info("cursor iniciado em %s: %s", chat.title, cursor.watermark[chat.id])
                continue
            fetched = [m async for m in client.iter_messages(
                chat, min_id=last, reverse=True, limit=config.RECONCILE_LIMIT)]
            missed = [m for m in fetched if m.message and not cursor.is_seen(chat.id, m.id)]
            if missed:
                log.info("reconciliacao: %d post(s) perdido(s) em %s", len(missed), chat.title)
            for message in missed:
                await process(message, chat, replay=True)
            if fetched:
                async with lock:
                    cursor.watermark[chat.id] = max(m.id for m in fetched)
                    cursor.save()

    async def reconcile_loop() -> None:
        while True:
            try:
                await reconcile()
            except Exception as exc:  # rede instavel nao pode matar o loop
                log.warning("reconciliacao falhou: %s", exc)
            await asyncio.sleep(config.RECONCILE_SECONDS)

    await wait_for_n8n(http)
    await client.start()
    log.info("escutando %d canais", len(config.CHANNEL_IDS))
    beat_task = asyncio.create_task(heartbeat_loop(client, http))
    reconcile_task = asyncio.create_task(reconcile_loop())

    waiters = [asyncio.create_task(client.run_until_disconnected())]
    bot = await start_bot(http)
    if bot:
        waiters.append(asyncio.create_task(bot.run_until_disconnected()))

    # Se qualquer sessao cair de vez, o processo sai e o restart do compose
    # sobe outro; o heartbeat para no meio tempo e o n8n percebe.
    await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
    beat_task.cancel()
    reconcile_task.cancel()


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
