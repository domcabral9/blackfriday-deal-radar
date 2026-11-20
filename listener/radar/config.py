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

DATA_DIR = os.environ.get("DATA_DIR", "/data")
