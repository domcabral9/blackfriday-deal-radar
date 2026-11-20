#!/usr/bin/env bash
# Publica o workflow do Deal Radar na instancia dedicada da VM.
#
#   bash deploy/deploy-workflow.sh
#
# Etapas: roda os testes, gera o JSON, envia para a VM, troca os placeholders
# pelos valores do .env da VM, importa, publica e reinicia SO o container
# deal-radar-n8n. A outra instancia n8n da VM nao e tocada.
#
# Importar sempre desativa o workflow, e publicar so vale depois de restart
# (ver docs/DEVELOPMENT.md). Por isso o restart e parte fixa do fluxo.

set -euo pipefail
HOST="${DEAL_RADAR_HOST:-n8n-poc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node "$ROOT/n8n/tests/run.mjs" > /dev/null || { echo "testes falharam, deploy abortado"; exit 1; }
node "$ROOT/n8n/build-workflow.mjs"
scp -q "$ROOT/n8n/workflows/deal-radar.json" "$HOST:deal-radar/deal-radar.json"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/deal-radar
CHAT_ID=$(grep '^TELEGRAM_CHAT_ID=' deploy/.env | cut -d= -f2 || true)
if [ -z "$CHAT_ID" ]; then echo "TELEGRAM_CHAT_ID ausente em deploy/.env"; exit 1; fi
sed "s/<TELEGRAM_CHAT_ID>/$CHAT_ID/" deal-radar.json > /tmp/wf.json
docker cp /tmp/wf.json deal-radar-n8n:/tmp/wf.json && rm /tmp/wf.json
docker exec deal-radar-n8n sh -c 'n8n import:workflow --input=/tmp/wf.json && n8n publish:workflow --id=dealRadarMain001; rm /tmp/wf.json' 2>&1 | grep -v 'Error tracking'
docker restart deal-radar-n8n > /dev/null
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:5680/healthz && break; sleep 2; done
docker exec deal-radar-n8n n8n list:workflow --active=true 2>&1 | grep -v 'Error tracking'
REMOTE
echo "deploy concluido"
