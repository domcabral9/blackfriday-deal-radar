// Harness local dos Code nodes. Executa o mesmo arquivo que vai colado no n8n.
//
//   node n8n/tests/run.mjs              # casos de fixtures.json
//   node n8n/tests/run.mjs corpus.jsonl # roda posts reais e imprime o que alertaria

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const codeDir = join(here, '..', 'code');

const catalog = new Function(readFileSync(join(codeDir, 'catalog.js'), 'utf8'))()[0].json.catalog;
const mod = { exports: {} };
new Function('module', readFileSync(join(codeDir, 'analyze-offer.js'), 'utf8'))(mod);
const { analyze } = mod.exports;

function load(file) {
  const m = { exports: {} };
  new Function('module', readFileSync(join(codeDir, file), 'utf8'))(m);
  return m.exports;
}
const { isDuplicate } = load('dedup.js');
const { formatAlert } = load('format-message.js');

const corpusPath = process.argv[2];

if (corpusPath === '--preview') {
  const cases = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
  for (const c of cases) {
    const r = analyze({ codes: [], urls: [], source: { title: 'Canal de exemplo' }, post_url: 'https://t.me/c/1/1', ...c.post }, catalog);
    if (r.status !== 'alerta') continue;
    const msg = formatAlert(r);
    console.log(`----- ${c.name}\n${msg.text}\n[Abrir oferta] ${msg.offerUrl}   [Post original] ${msg.postUrl}\n`);
  }
} else if (corpusPath) {
  const posts = readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tally = {};
  for (const post of posts) {
    const r = analyze(post, catalog);
    tally[r.status] = (tally[r.status] || 0) + 1;
    if (r.status !== 'sem_produto') {
      const price = r.price ?? '?';
      console.log(`[${r.status}] ${(r.products || r.matched).map((p) => p.id || p).join(',')} | R$ ${price} | ${r.coupon || ''}`);
      console.log(`   ${post.text.split('\n')[0].slice(0, 100)}`);
    }
  }
  console.log('\nResumo:', tally, `(${posts.length} posts)`);
} else {
  const cases = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
  let failed = 0;
  for (const c of cases) {
    const post = { codes: [], urls: [], ...c.post };
    const r = analyze(post, catalog, c.settings, c.now ? Date.parse(c.now) : undefined);
    const errors = [];
    for (const [key, expected] of Object.entries(c.expect)) {
      const actual = key === 'product' ? r.products?.[0]?.id ?? null : r[key] ?? null;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(`${key}: esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
      }
    }
    if (errors.length) {
      failed++;
      console.log(`FALHOU  ${c.name}\n        ${errors.join('\n        ')}`);
    } else {
      console.log(`ok      ${c.name}`);
    }
  }
  // Dedup: mesma oferta vinda do outro canal com outro link
  const store = {};
  const base = { products: [{ id: 'galaxy-s26' }], price: 4299, offerUrl: 'https://a' };
  const t0 = Date.UTC(2026, 10, 27, 12);
  const dedupChecks = [
    ['primeira ocorrência passa', isDuplicate(store, base, t0) === false],
    ['mesma oferta, outro link, é duplicata', isDuplicate(store, { ...base, offerUrl: 'https://b' }, t0 + 60e3) === true],
    ['preço diferente passa', isDuplicate(store, { ...base, price: 3999 }, t0 + 120e3) === false],
    ['depois de 12h passa de novo', isDuplicate(store, base, t0 + 13 * 3600e3) === false],
  ];
  for (const [name, ok] of dedupChecks) {
    if (!ok) failed++;
    console.log(`${ok ? 'ok     ' : 'FALHOU '} dedup: ${name}`);
  }
  // Saúde: linha do tempo simulada (horários em UTC; BRT = UTC-3)
  const { onBeat, evaluate } = load('health.js');
  const h = {};
  const at = (hhmmUtc) => Date.parse(`2026-11-27T${hhmmUtc}:00Z`);
  const beat = (startedAt, lastMsg) => ({ started_at: startedAt, last_message_at: lastMsg, connected: true, channels: 2 });
  const S1 = '2026-11-27T12:00:00Z';
  const healthChecks = [
    ['primeiro batimento avisa online', /Radar online/.test(onBeat(h, beat(S1, null), at('12:00')).join())],
    ['primeira avaliação só calibra', evaluate(h, at('12:01')).length === 0],
    ['batimento recente, nada a avisar', onBeat(h, beat(S1, '2026-11-27T12:04:00Z'), at('12:05')).length === 0 && evaluate(h, at('12:06')).length === 0],
    ['14 min sem batimento ainda ok', evaluate(h, at('12:19')).length === 0],
    ['16+ min sem batimento avisa queda', /sem sinal/.test(evaluate(h, at('12:22')).join())],
    ['queda avisada uma vez só', evaluate(h, at('12:27')).length === 0],
    ['volta do listener avisa', /de volta/.test(onBeat(h, beat('2026-11-27T12:30:00Z', '2026-11-27T12:30:00Z'), at('12:30')).join())],
    ['3h sem posts às 15h30 BRT avisa silêncio', (() => {
      for (let m = 35; m <= 60 * 3 + 35; m += 5) {
        const t = at('12:30') + (m - 30) * 60000;
        onBeat(h, beat('2026-11-27T12:30:00Z', '2026-11-27T12:30:00Z'), t);
        const out = evaluate(h, t + 1000);
        if (out.length) return /Nenhum post/.test(out.join());
      }
      return false;
    })()],
    ['post novo encerra o silêncio', /voltaram/.test(onBeat(h, beat('2026-11-27T12:30:00Z', '2026-11-27T15:50:00Z'), at('15:50')).join())],
    ['VM fora por horas não acusa queda na volta', (() => {
      const out = evaluate(h, at('23:50'));
      return out.length === 0;
    })()],
  ];
  for (const [name, ok] of healthChecks) {
    if (!ok) failed++;
    console.log(`${ok ? 'ok     ' : 'FALHOU '} saúde: ${name}`);
  }

  // Comandos do bot: comando -> catálogo recalculado -> post analisado
  const { handleCommand } = load('commands.js');
  const botStore = {};
  const catalogSrc = readFileSync(join(codeDir, 'catalog.js'), 'utf8');
  const currentCatalog = () => new Function('$getWorkflowStaticData', catalogSrc)(() => botStore)[0].json.catalog;
  const cmd = (text) => handleCommand(text, botStore, { catalog: currentCatalog(), listener: { started_at: '2026-11-27T12:00:00Z', last_message_at: new Date().toISOString(), messages_since_start: 42 } });
  const statusOf = (text) => analyze({ text, urls: [], codes: [] }, currentCatalog()).status;
  const firstProduct = (text) => analyze({ text, urls: [], codes: [] }, currentCatalog()).products?.[0]?.id;
  const botChecks = [
    ['/pausar iphone-16e responde', /Pausado/.test(cmd('/pausar iphone-16e'))],
    ['produto pausado não alerta', statusOf('iPhone 16e 128GB R$ 3.199') === 'sem_produto'],
    ['/produtos mostra pausado', /⏸ <code>iphone-16e/.test(cmd('/produtos'))],
    ['/ativar volta a alertar', /Ativado/.test(cmd('/ativar iphone-16e')) && statusOf('iPhone 16e 128GB R$ 3.199') === 'alerta'],
    ['/teto sobe o limite', /R\$\s?6\.000/.test(cmd('/teto iphone-17 6000')) && statusOf('Apple iPhone 17 256GB\nR$ 5.273') === 'alerta'],
    ['/add cria produto novo', /Monitorando/.test(cmd('/add Galaxy S25 FE -ultra teto=2600'))],
    ['produto do /add bate', firstProduct('📱 Celular Samsung Galaxy S25 FE 5G, 128GB\n\n💰 R$ 2.582,10') === 'galaxy-s25-fe'],
    ['exclusão do /add funciona', statusOf('Galaxy S25 FE Ultra Edition R$ 2.400') === 'sem_produto'],
    ['teto do /add funciona', statusOf('Galaxy S25 FE 256GB R$ 2.899') === 'acima_do_teto'],
    ['/add duplicado é recusado', /Já existe/.test(cmd('/add galaxy s25 fe'))],
    ['/remover de base é recusado', /não são removidos/.test(cmd('/remover iphone-17'))],
    ['/remover do /add funciona', /Removido/.test(cmd('/remover galaxy-s25-fe')) && statusOf('Galaxy S25 FE R$ 2.400') === 'sem_produto'],
    ['/teto com valor inválido explica uso', /Uso:/.test(cmd('/teto iphone-17 abc'))],
    ['/minimo baixa o piso', /Mínimo de Kindle: R\$\s?150/.test(cmd('/minimo kindle 150'))],
    ['com piso menor, Kindle barato vira alerta', statusOf('Kindle 16GB oferta relâmpago\nR$ 199') === 'alerta'],
    ['/produtos mostra a faixa com o mínimo', /kindle<\/code> Kindle · R\$\s?150 a R\$\s?800/.test(cmd('/produtos'))],
    ['/minimo maior que o teto é recusado', /menor que o teto/.test(cmd('/minimo kindle 900'))],
    ['/teto menor que o mínimo é recusado', /maior que o mínimo/.test(cmd('/teto kindle 100'))],
    ['/minimo com valor inválido explica uso', /Uso:/.test(cmd('/minimo kindle abc'))],
    ['id desconhecido sugere /produtos', /não encontrado/.test(cmd('/pausar xpto'))],
    ['/status mostra posts', /Posts desde o início: 42/.test(cmd('/status'))],
  ];
  for (const [name, ok] of botChecks) {
    if (!ok) failed++;
    console.log(`${ok ? 'ok     ' : 'FALHOU '} bot: ${name}`);
  }

  const total = cases.length + dedupChecks.length + healthChecks.length + botChecks.length;
  console.log(`\n${total - failed}/${total} casos passaram`);
  process.exit(failed ? 1 : 0);
}
