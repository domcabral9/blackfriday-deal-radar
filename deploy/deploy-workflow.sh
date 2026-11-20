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
ssh "$HOST" 'mkdir -p ~/deal-radar/workflows && rm -f ~/deal-radar/workflows/*.json'
scp -q "$ROOT"/n8n/workflows/*.json "$HOST:deal-radar/workflows/"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/deal-radar
CHAT_ID=$(grep '^TELEGRAM_CHAT_ID=' deploy/.env | cut -d= -f2 || true)
if [ -z "$CHAT_ID" ]; then echo "TELEGRAM_CHAT_ID ausente em deploy/.env"; exit 1; fi
# Credencial do bot: achada pelo tipo, para nao depender do nome dado no editor
docker exec deal-radar-n8n sh -c 'n8n export:credentials --all --output=/tmp/c.json >/dev/null 2>&1'
CRED=$(docker exec deal-radar-n8n node -e 'const t=require("/tmp/c.json").find(c=>c.type==="telegramApi"); if(t) console.log(t.id+"\t"+t.name)')
docker exec deal-radar-n8n rm -f /tmp/c.json
if [ -z "$CRED" ]; then echo "credencial Telegram API nao encontrada no n8n"; exit 1; fi
CRED_ID=$(printf '%s' "$CRED" | cut -f1); CRED_NAME=$(printf '%s' "$CRED" | cut -f2)
for f in workflows/*.json; do
  WF_ID=$(grep -m1 '"id": "dealRadar' "$f" | sed 's/.*"id": "\([^"]*\)".*/\1/')
  sed -e "s/<TELEGRAM_CHAT_ID>/$CHAT_ID/" -e "s/<TELEGRAM_CRED_ID>/$CRED_ID/" -e "s|<TELEGRAM_CRED_NAME>|$CRED_NAME|" "$f" > /tmp/wf.json
  docker cp /tmp/wf.json deal-radar-n8n:/tmp/wf.json && rm /tmp/wf.json
  # Preserva o static data da versao em producao (dedup, ajustes do bot,
  # estado do healthcheck). O JSON novo nao tem esse campo e o import o zeraria.
  docker exec deal-radar-n8n sh -c "n8n export:workflow --id=$WF_ID --output=/tmp/old.json >/dev/null 2>&1 || true"
  docker exec deal-radar-n8n node -e '
    const fs = require("fs");
    const wf = JSON.parse(fs.readFileSync("/tmp/wf.json", "utf8"));
    let kept = "nenhum";
    try {
      const old = [].concat(JSON.parse(fs.readFileSync("/tmp/old.json", "utf8")))[0];
      if (old && old.staticData) { wf.staticData = old.staticData; kept = Object.keys(old.staticData.global || {}).join(",") || "vazio"; }
    } catch (e) {}
    fs.writeFileSync("/tmp/wf.json", JSON.stringify(wf));
    console.log("static data preservado: " + kept);'
  docker exec deal-radar-n8n rm -f /tmp/old.json
  docker exec deal-radar-n8n sh -c "n8n import:workflow --input=/tmp/wf.json && n8n publish:workflow --id=$WF_ID; rm /tmp/wf.json" 2>&1 | grep -vE 'Error tracking|deprecated|Note:|Please restart'
done
docker restart deal-radar-n8n > /dev/null
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:5680/healthz && break; sleep 2; done
docker exec deal-radar-n8n n8n list:workflow --active=true 2>&1 | grep -v 'Error tracking'
REMOTE
echo "deploy concluido"
