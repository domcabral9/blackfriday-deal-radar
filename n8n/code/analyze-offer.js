// Code node "Analisar oferta".
//
// Entrada: o post enviado pelo listener (corpo do Webhook) e o catálogo.
// Saída: zero itens (post sem interesse) ou um item com a oferta já
// estruturada: produtos que bateram, preço, cupom, link e descrição.
//
// O arquivo roda igual dentro do n8n e no harness de teste local
// (n8n/tests/run.mjs): as funções puras ficam no topo e a "cola" com o n8n
// só executa quando $input existe.

const NON_OFFER_HOSTS = /^https?:\/\/(t\.me|telegram\.me|chat\.whatsapp\.com|wa\.me|instagram\.com)\b/i;
const COUPON_STOPWORDS = new Set([
  'DE', 'DO', 'NO', 'NA', 'OFF', 'APLICADO', 'CARRINHO', 'SITE', 'APP', 'PIX',
  'DESCONTO', 'CUPOM', 'CUPONS', 'ATIVO', 'ATIVE', 'RESGATE', 'AQUI', 'USE',
]);

// Alguns canais inserem caracteres invisíveis no meio das palavras
// ("Mon⁠itor") para dificultar cópia e busca. Sem remover, "iphone"
// vira "iph one" depois da normalização e nada bate.
function stripInvisible(text) {
  return String(text || '').replace(/[­​-‏⁠-⁯﻿]/g, '');
}

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBRL(raw) {
  // "4.299,00" -> 4299 ; "4299" -> 4299 ; "4.299" -> 4299
  const clean = raw.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const value = parseFloat(clean);
  return Number.isFinite(value) ? value : null;
}

function extractPrices(text) {
  const t = text.replace(/ /g, ' ');
  const cash = [];
  const installments = [];
  const re = /r\$\s*([\d.]+(?:,\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const value = parseBRL(m[1]);
    if (value === null) continue;
    const before = t.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 20).toLowerCase();

    // Valores de desconto/cupom/cashback, que não são preço do produto
    if (/^\s*(off|de desconto|em cupom|de cashback)/.test(after)) continue;
    if (/(cupom|desconto|cashback|economi[zs]e|economia|off)\s*(de)?\s*$/.test(before)) continue;

    const inst = before.match(/(\d{1,2})\s*x\s*(sem juros\s*)?(de)?\s*$/);
    if (inst) {
      const times = parseInt(inst[1], 10);
      installments.push({ times, each: value, total: +(value * times).toFixed(2) });
      continue;
    }
    // Preço antigo riscado: "de R$ 6.999 por R$ 4.999"
    if (/(^|\s)de\s*$/.test(before) && /por\s*r\$/i.test(t)) continue;
    cash.push(value);
  }

  // Preço escrito sem "R$": "saindo a 5273", "💰 5.273 no pix"
  const bare = /(?:saindo a|saindo por|sai por|sai a|por apenas|💰)\s*([\d][\d.]*(?:,\d{1,2})?)(?!\s*x)/gi;
  while ((m = bare.exec(t)) !== null) {
    const value = parseBRL(m[1]);
    if (value !== null && value >= 10) cash.push(value);
  }
  return { cash, installments };
}

function extractCoupon(post) {
  const valid = (c) => /^[A-Z0-9][A-Z0-9_-]{3,24}$/i.test(c) && /\d|[A-Z]{4,}/.test(c) && !COUPON_STOPWORDS.has(c.toUpperCase());

  // 1) Cupom formatado como `código` no Telegram (toque para copiar)
  const fromEntities = (post.codes || []).map((c) => c.trim()).filter((c) => valid(c) && !/^\d+$/.test(c));
  if (fromEntities.length) return fromEntities[0];

  // 2) "Cupom: XPTO10", "cupom XPTO10", "use o cupom XPTO10"
  const re = /cupom\s*(?:de\s+r\$\s*[\d.,]+\s*(?:off)?)?\s*[:\-–]?\s*["“'`]?([A-Za-z0-9_-]{4,25})/gi;
  let m;
  while ((m = re.exec(post.text || '')) !== null) {
    const code = m[1];
    if (valid(code) && code === code.toUpperCase()) return code;
  }
  return null;
}

// Linhas com link que não é o produto: cadastro no Prime, grupos, canais
const NON_OFFER_LINE = /prime|cadastr|teste por|gr[aá]tis por|grupo|whatsapp|canal|instagram|sigam?/i;
const OFFER_LINE = /compr[ea]|link|aqui|site|🛒/i;

function pickOfferUrl(post) {
  const text = post.text || '';
  const lines = text.split('\n');
  const lineOf = (url) => lines.find((l) => l.includes(url)) || '';
  const inText = text.match(/https?:\/\/[^\s)]+/g) || [];
  const all = [...(post.urls || []), ...inText]
    .filter((u, i, arr) => /^https?:\/\//i.test(u) && !NON_OFFER_HOSTS.test(u) && arr.indexOf(u) === i);

  const usable = all.filter((u) => !NON_OFFER_LINE.test(lineOf(u)) || OFFER_LINE.test(lineOf(u)) && !/prime/i.test(lineOf(u)));
  const preferred = usable.find((u) => OFFER_LINE.test(lineOf(u)));
  return preferred || usable[0] || all[0] || null;
}

function extractTitle(text, product) {
  const lines = (text || '')
    .split('\n')
    .map((l) => l
      .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
      // "Produto X | De R$ 2.119 Por R$ 1.719": mantém só o produto
      .replace(/\s*\|?\s*(de\s*)?r\$.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((l) => l.length > 3 && !/^https?:\/\//i.test(l));
  // A primeira linha costuma ser comentário ("Baixouuuu!!"); a linha com o
  // modelo do produto é o título de verdade
  if (product) {
    const model = buildMatcher(product).model;
    const withModel = lines.find((l) => model.test(normalize(l)));
    if (withModel) return withModel;
  }
  return lines[0] || '';
}

function buildMatcher(product) {
  const variants = (product.excludeAfter || []).map((v) => (/\w$/.test(v) ? `${v}\\b` : v));
  // Modelo terminado em número não pode emendar outro dígito (s26 != s260)
  let lookahead = /\d$/.test(product.model) ? '(?!\\d)' : '';
  if (variants.length) lookahead += `(?!\\s?(?:${variants.join('|')}))`;
  return {
    // Não precedido de letra: aceita modelo colado no tamanho ("55mrgb85")
    model: new RegExp(`(?<![a-z])(?:${product.model})${lookahead}`),
    requireAll: (product.requireAll || []).map((r) => new RegExp(r)),
    excludeAny: (product.excludeAny || []).map((r) => new RegExp(r)),
    size: product.size ? new RegExp(`\\b${product.size}(?!\\d)`) : null,
  };
}

function matchProducts(post, catalog) {
  const textNoPrices = (post.text || '').replace(/r\$\s*[\d.,]+/gi, ' ');
  const norm = normalize(textNoPrices);
  return catalog.filter((p) => {
    if (p.active === false) return false;
    const m = buildMatcher(p);
    if (!m.model.test(norm)) return false;
    if (!m.requireAll.every((r) => r.test(norm))) return false;
    if (m.excludeAny.some((r) => r.test(norm))) return false;
    if (m.size && !m.size.test(norm)) return false;
    return true;
  });
}

function ageMinutes(post, now) {
  const posted = Date.parse(post.posted_at);
  return Number.isFinite(posted) ? (now - posted) / 60000 : 0;
}

function analyze(rawPost, catalog, settings = {}, now = Date.now()) {
  const post = { ...rawPost, text: stripInvisible(rawPost.text), codes: (rawPost.codes || []).map(stripInvisible) };
  const maxAge = settings.maxAgeMinutes ?? Infinity;
  const age = ageMinutes(post, now);
  if (age > maxAge) return { status: 'antigo', ageMinutes: Math.round(age) };

  const matched = matchProducts(post, catalog);
  if (!matched.length) return { status: 'sem_produto' };

  const { cash, installments } = extractPrices(post.text || '');
  const primary = matched[0];
  const plausibleCash = cash.filter((v) => v >= primary.minPrice);
  const plausibleInst = installments.filter((i) => i.total >= primary.minPrice);

  // Só valores abaixo do piso apareceram: é acessório (capa, película...)
  if ((cash.length || installments.length) && !plausibleCash.length && !plausibleInst.length) {
    return { status: 'acessorio', matched: matched.map((p) => p.id) };
  }

  const candidates = [...plausibleCash, ...plausibleInst.map((i) => i.total)];
  const price = candidates.length ? Math.min(...candidates) : null;
  const installment = plausibleInst.sort((a, b) => a.total - b.total)[0] || null;

  if (price !== null && price > primary.maxPrice) {
    return { status: 'acima_do_teto', matched: matched.map((p) => p.id), price };
  }

  return {
    status: 'alerta',
    products: matched.map((p) => ({ id: p.id, label: p.label })),
    price,
    installment,
    coupon: extractCoupon(post),
    offerUrl: pickOfferUrl(post),
    title: extractTitle(post.text, primary),
    source: post.source,
    postUrl: post.post_url,
    postedAt: post.posted_at,
    messageId: post.message_id,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { stripInvisible, normalize,parseBRL, extractPrices, extractCoupon, pickOfferUrl, extractTitle, matchProducts, analyze };
}

if (typeof $input !== 'undefined') {
  const { catalog, settings } = $('Catálogo de produtos').first().json;
  const post = $('Webhook').first().json.body;
  const result = analyze(post, catalog, settings);
  return [{ json: result }];
}
