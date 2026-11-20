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
    const r = analyze(post, catalog);
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
  const total = cases.length + dedupChecks.length;
  console.log(`\n${total - failed}/${total} casos passaram`);
  process.exit(failed ? 1 : 0);
}
