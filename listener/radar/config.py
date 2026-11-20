"""Configuracao lida das variaveis de ambiente (preenchidas pelo .env do compose)."""

import os

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]

# Caminho sem extensao: o Telethon cria "<SESSION_PATH>.session"
SESSION_PATH = os.environ.get("TG_SESSION_PATH", "/sessions/radar")

# IDs numericos dos canais, separados por virgula (descobertos com radar.login)
CHANNEL_IDS = [int(c) for c in os.environ.get("TG_CHANNELS", "").split(",") if c.strip()]

WEBHOOK_URL = os.environ.get("N8N_WEBHOOK_URL", "http://n8n:5678/webhook/deal-radar/ingest")
WEBHOOK_TOKEN = os.environ.get("N8N_WEBHOOK_TOKEN", "")
HEARTBEAT_URL = os.environ.get("N8N_HEARTBEAT_URL", "http://n8n:5678/webhook/deal-radar/heartbeat")
HEARTBEAT_SECONDS = int(os.environ.get("HEARTBEAT_SECONDS", "300"))

# Bot de comandos (opcional). Recebe /comandos via MTProto, sem precisar de
# URL publica, e repassa ao n8n. So mensagens do dono sao aceitas.
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
BOT_SESSION_PATH = os.environ.get("BOT_SESSION_PATH", "/sessions/bot")
OWNER_ID = int(os.environ.get("TELEGRAM_CHAT_ID", "0") or 0)
COMMAND_URL = os.environ.get("N8N_COMMAND_URL", "http://n8n:5678/webhook/deal-radar/command")

DATA_DIR = os.environ.get("DATA_DIR", "/data")
