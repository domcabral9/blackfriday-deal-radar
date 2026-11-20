// Gera n8n/workflows/deal-radar.json a partir dos arquivos em n8n/code/.
// O código dos Code nodes vive só nos .js (testados por n8n/tests/run.mjs);
// o JSON do workflow é artefato gerado.
//
//   node n8n/build-workflow.mjs
//
// Placeholders substituídos no deploy (valores reais nunca vão para o git):
//   <TELEGRAM_CHAT_ID>, <TELEGRAM_CRED_ID>, <TELEGRAM_CRED_NAME>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const code = (f) => readFileSync(join(here, 'code', f), 'utf8');

const CRED_WEBHOOK = { id: 'dealRadarHook001', name: 'Deal Radar: token do webhook' };
const CRED_TELEGRAM = { id: '<TELEGRAM_CRED_ID>', name: '<TELEGRAM_CRED_NAME>' };

const node = (name, type, typeVersion, x, parameters, extra = {}) => ({
  id: name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-'),
  name, type, typeVersion, position: [x, 300], parameters, ...extra,
});

const nodes = [
  node('Webhook', 'n8n-nodes-base.webhook', 2, 0, {
    httpMethod: 'POST',
    path: 'deal-radar/ingest',
    authentication: 'headerAuth',
    options: {},
  }, { webhookId: 'deal-radar-ingest', credentials: { httpHeaderAuth: CRED_WEBHOOK } }),
  node('Catálogo de produtos', 'n8n-nodes-base.code', 2, 220, { jsCode: code('catalog.js') }),
  node('Analisar oferta', 'n8n-nodes-base.code', 2, 440, { jsCode: code('analyze-offer.js') }),
  node('É alerta?', 'n8n-nodes-base.if', 2, 660, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [{
        id: 'status-alerta',
        leftValue: '={{ $json.status }}',
        rightValue: 'alerta',
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  }),
  node('Deduplicar', 'n8n-nodes-base.code', 2, 880, { jsCode: code('dedup.js') }),
  node('Formatar alerta', 'n8n-nodes-base.code', 2, 1100, { jsCode: code('format-message.js') }),
  node('Enviar no Telegram', 'n8n-nodes-base.telegram', 1.2, 1320, {
    chatId: '<TELEGRAM_CHAT_ID>',
    text: '={{ $json.text }}',
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [{
        row: {
          buttons: [
            { text: '🔗 Abrir oferta', additionalFields: { url: '={{ $json.offerUrl }}' } },
            { text: '💬 Post original', additionalFields: { url: '={{ $json.postUrl }}' } },
          ],
        },
      }],
    },
    additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true },
  }, { credentials: { telegramApi: CRED_TELEGRAM } }),
];

const chain = ['Webhook', 'Catálogo de produtos', 'Analisar oferta', 'É alerta?', 'Deduplicar', 'Formatar alerta', 'Enviar no Telegram'];
const connections = {};
chain.slice(0, -1).forEach((from, i) => {
  connections[from] = { main: [[{ node: chain[i + 1], type: 'main', index: 0 }]] };
});

const workflow = {
  id: 'dealRadarMain001',
  name: 'Deal Radar: alertas de oferta',
  active: false,
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'all' },
  tags: [],
};

const out = join(here, 'workflows', 'deal-radar.json');
writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`gerado: ${out}`);
