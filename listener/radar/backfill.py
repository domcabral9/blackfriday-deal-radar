"""Baixa o historico recente dos canais para montar a massa de teste do matching.

Uso (na VM):
    docker compose run --rm listener python -m radar.backfill 300

Grava em /data/backfill.jsonl, uma mensagem por linha. Nao envia nada ao n8n.
"""

import asyncio
import json
import os
import sys

from telethon import TelegramClient

from . import config
from .extract import build_payload


async def main(limit: int) -> None:
    client = TelegramClient(config.SESSION_PATH, config.API_ID, config.API_HASH)
    await client.start()
    out_path = os.path.join(config.DATA_DIR, "backfill.jsonl")
    total = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for channel_id in config.CHANNEL_IDS:
            chat = await client.get_entity(channel_id)
            count = 0
            async for message in client.iter_messages(chat, limit=limit):
                if not message.message:
                    continue
                out.write(json.dumps(build_payload(message, chat), ensure_ascii=False) + "\n")
                count += 1
            print(f"{chat.title}: {count} mensagens")
            total += count
    print(f"Total: {total} mensagens em {out_path}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 300))
