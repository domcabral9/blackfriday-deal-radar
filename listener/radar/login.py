"""Login unico e interativo da conta pessoal. Gera o arquivo de sessao.

Uso (na VM):
    docker compose run --rm listener python -m radar.login

Pede telefone, codigo recebido no app do Telegram e a senha de 2 etapas
(se existir). Ao final lista os canais da conta com o ID numerico, para
preencher TG_CHANNELS no .env.
"""

import asyncio

from telethon import TelegramClient
from telethon.tl.types import Channel

from . import config


async def main() -> None:
    client = TelegramClient(config.SESSION_PATH, config.API_ID, config.API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"\nSessao criada para: {me.first_name} (id {me.id})\n")

    print("Canais de transmissao desta conta:")
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if isinstance(entity, Channel) and entity.broadcast:
            print(f"  {entity.id:>14}  {entity.title}")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
