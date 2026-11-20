"""Transforma uma mensagem do Telethon no payload enviado ao n8n.

O listener so extrai o que e estrutural da mensagem (links, codigos, botoes).
Toda regra de negocio (qual produto, preco, cupom final) fica no n8n.
"""

from telethon.tl.types import (
    KeyboardButtonUrl,
    MessageEntityCode,
    MessageEntityPre,
    MessageEntityTextUrl,
    MessageEntityUrl,
    ReplyInlineMarkup,
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

    buttons = []
    if isinstance(message.reply_markup, ReplyInlineMarkup):
        for row in message.reply_markup.rows:
            for button in row.buttons:
                if isinstance(button, KeyboardButtonUrl):
                    buttons.append({"text": button.text, "url": button.url})
                    urls.append(button.url)

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
