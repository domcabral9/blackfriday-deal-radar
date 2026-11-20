"""Transforma uma mensagem do Telethon no payload enviado ao n8n.

O listener so extrai o que e estrutural da mensagem (links, codigos, botoes).
Toda regra de negocio (qual produto, preco, cupom final) fica no n8n.
"""

from telethon.tl.types import (
    MessageEntityCode,
    MessageEntityPre,
    MessageEntityTextUrl,
    MessageEntityUrl,
)


def _post_link(chat, msg_id: int) -> str:
    username = getattr(chat, "username", None)
    if username:
        return f"https://t.me/{username}/{msg_id}"
    return f"https://t.me/c/{chat.id}/{msg_id}"


def build_payload(message, chat) -> dict:
    urls: list[str] = []
    codes: list[str] = []

    # Links escondidos atras de texto (MessageEntityTextUrl) sao o caso mais
    # comum em canais de oferta: "COMPRAR AQUI" apontando pro link afiliado.
    for entity, text in message.get_entities_text():
        if isinstance(entity, MessageEntityTextUrl):
            urls.append(entity.url)
        elif isinstance(entity, MessageEntityUrl):
            urls.append(text)
        elif isinstance(entity, (MessageEntityCode, MessageEntityPre)):
            codes.append(text.strip())

    # Botoes lidos por atributo: os nomes das classes de botao mudam entre
    # camadas da API do Telegram (KeyboardButtonUrl sumiu no Telethon 1.46)
    buttons = []
    for row in getattr(message.reply_markup, "rows", None) or []:
        for button in getattr(row, "buttons", None) or []:
            url = getattr(button, "url", None)
            if isinstance(url, str) and url:
                buttons.append({"text": getattr(button, "text", ""), "url": url})
                urls.append(url)

    return {
        "source": {
            "channel_id": chat.id,
            "title": getattr(chat, "title", ""),
            "username": getattr(chat, "username", None),
        },
        "message_id": message.id,
        "post_url": _post_link(chat, message.id),
        "posted_at": message.date.isoformat(),
        "edited": message.edit_date is not None,
        "text": message.message or "",
        "urls": list(dict.fromkeys(urls)),
        "codes": list(dict.fromkeys(c for c in codes if c)),
        "buttons": buttons,
        "has_photo": message.photo is not None,
    }
