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
    // Responde só ao fim da execução. O listener espera a resposta antes do
    // próximo post, então as execuções ficam em fila. Respondendo na chegada,
    // rajadas (reconciliação depois de uma queda) rodavam em paralelo e uma
    // execução sobrescrevia o static data da outra (dedup e histórico).
    responseMode: 'lastNode',
    responseData: 'noData',
    options: {},
  }, { webhookId: 'deal-radar-ingest', credentials: { httpHeaderAuth: CRED_WEBHOOK } }),
  node('Catálogo de produtos', 'n8n-nodes-base.code', 2, 220, { jsCode: code('catalog.js') }),
  node('Analisar oferta', 'n8n-nodes-base.code', 2, 660, { jsCode: code('analyze-offer.js') }),
  node('É alerta?', 'n8n-nodes-base.if', 2, 880, {
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
  node('Deduplicar', 'n8n-nodes-base.code', 2, 1100, { jsCode: code('dedup.js') }),
  node('Formatar alerta', 'n8n-nodes-base.code', 2, 1320, { jsCode: code('format-message.js') }),
  { ...node('Registrar preço', 'n8n-nodes-base.code', 2, 0, { jsCode: code('price-history.js') }), position: [770, 160] },
  node('Enviar no Telegram', 'n8n-nodes-base.telegram', 1.2, 1540, {
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
      }, {
        row: {
          // callback lido pelo listener (bot via MTProto) e virado em /historico
          buttons: [
            { text: '📈 Histórico de preço', additionalFields: { callback_data: '={{ "hist:" + $json.products[0].id }}' } },
          ],
        },
      }],
    },
    additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true },
  }, { credentials: { telegramApi: CRED_TELEGRAM } }),
];

// Comandos do bot: segundo gatilho que passa pelo mesmo catálogo
const place = (n, x, y) => ({ ...n, position: [x, y] });
nodes.push(
  place(node('Comando do bot', 'n8n-nodes-base.webhook', 2, 0, {
    httpMethod: 'POST',
    path: 'deal-radar/command',
    authentication: 'headerAuth',
    // Mesmo motivo do webhook de posts: comandos alteram o static data
    responseMode: 'lastNode',
    responseData: 'noData',
    options: {},
  }, { webhookId: 'deal-radar-command', credentials: { httpHeaderAuth: CRED_WEBHOOK } }), 0, 520),
  place(node('É comando?', 'n8n-nodes-base.if', 2, 0, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
      conditions: [{
        id: 'veio-do-bot',
        leftValue: "={{ $('Comando do bot').isExecuted }}",
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  }), 440, 400),
  place(node('Processar comando', 'n8n-nodes-base.code', 2, 0, { jsCode: code('commands.js') }), 660, 520),
  place(node('Responder comando', 'n8n-nodes-base.telegram', 1.2, 0, {
    chatId: '<TELEGRAM_CHAT_ID>',
    text: '={{ $json.text }}',
    additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true },
  }, { credentials: { telegramApi: CRED_TELEGRAM } }), 880, 520),
);
nodes[0] = place(nodes[0], 0, 300);
nodes[1] = place(nodes[1], 220, 400);

const to = (...targets) => ({ main: targets.map((t) => (t ? [{ node: t, type: 'main', index: 0 }] : [])) });
const connections = {
  'Webhook': to('Catálogo de produtos'),
  'Comando do bot': to('Catálogo de produtos'),
  'Catálogo de produtos': to('É comando?'),
  'É comando?': to('Processar comando', 'Analisar oferta'), // saída 0 = verdadeiro
  'Processar comando': to('Responder comando'),
  'Analisar oferta': to('Registrar preço'),
  'Registrar preço': to('É alerta?'),
  'É alerta?': to('Deduplicar'),
  'Deduplicar': to('Formatar alerta'),
  'Formatar alerta': to('Enviar no Telegram'),
};

const workflow = {
  id: 'dealRadarMain001',
  name: 'Deal Radar: alertas de oferta',
  active: false,
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'all' },
  tags: [],
};

// Workflow de saúde: dois gatilhos (batimento do listener e relógio)
// alimentando o mesmo static data, e um único nó de envio.
const healthCode = (mode) => `const MODE = '${mode}';\n\n${code('health.js')}`;
const at = (n, y) => ({ ...n, position: [n.position[0], y] });

const healthNodes = [
  at(node('Batimento do listener', 'n8n-nodes-base.webhook', 2, 0, {
    httpMethod: 'POST',
    path: 'deal-radar/heartbeat',
    authentication: 'headerAuth',
    options: {},
  }, { webhookId: 'deal-radar-heartbeat', credentials: { httpHeaderAuth: CRED_WEBHOOK } }), 200),
  at(node('Registrar batimento', 'n8n-nodes-base.code', 2, 240, { jsCode: healthCode('beat') }), 200),
  at(node('A cada 5 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, 0, {
    rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
  }), 420),
  at(node('Avaliar saúde', 'n8n-nodes-base.code', 2, 240, { jsCode: healthCode('check') }), 420),
  at(node('Enviar aviso', 'n8n-nodes-base.telegram', 1.2, 500, {
    chatId: '<TELEGRAM_CHAT_ID>',
    text: '={{ $json.text }}',
    additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
  }, { credentials: { telegramApi: CRED_TELEGRAM } }), 310),
];

const link = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
const health = {
  id: 'dealRadarHealth1',
  name: 'Deal Radar: saúde',
  active: false,
  nodes: healthNodes,
  connections: {
    'Batimento do listener': link('Registrar batimento'),
    'Registrar batimento': link('Enviar aviso'),
    'A cada 5 minutos': link('Avaliar saúde'),
    'Avaliar saúde': link('Enviar aviso'),
  },
  // ~600 execuções por dia sem nada a avisar: guardar só as que falharem
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none' },
  tags: [],
};

for (const [file, wf] of [['deal-radar.json', workflow], ['deal-radar-health.json', health]]) {
  const out = join(here, 'workflows', file);
  writeFileSync(out, JSON.stringify(wf, null, 2) + '\n');
  console.log(`gerado: ${out}`);
}
