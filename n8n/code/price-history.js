// Code node "Registrar preço".
//
// Guarda no static data do workflow o preço de todo post que bateu com um
// produto do catálogo, virando alerta ou passando do teto. É a base do
// botão "📈 Histórico" e do comando /historico.
//
// Posts enviados com history_only (carga do histórico a partir do arquivo do
// listener) são registrados e param aqui, sem gerar alerta.

const KEEP_PER_PRODUCT = 300;
const KEEP_DAYS = 45;

function recordPrice(store, result, post, now = Date.now()) {
  const ids = result.products ? result.products.map((p) => p.id) : result.matched;
  if (!ids || !ids.length) return false;
  if (!['alerta', 'acima_do_teto'].includes(result.status)) return false;
  if (typeof result.price !== 'number') return false;

  store.history = store.history || {};
  const id = ids[0];
  const list = (store.history[id] = store.history[id] || []);
  const key = `${post.source?.channel_id}:${post.message_id}`;
  if (list.some((e) => e.k === key)) return false;

  list.push({
    k: key,
    t: Date.parse(post.posted_at) || now,
    p: result.price,
    s: post.source?.title || '',
  });
  list.sort((a, b) => a.t - b.t);
  const cutoff = now - KEEP_DAYS * 86400000;
  store.history[id] = list.filter((e) => e.t >= cutoff).slice(-KEEP_PER_PRODUCT);
  return true;
}

if (typeof module !== 'undefined') module.exports = { recordPrice };

if (typeof $input !== 'undefined') {
  const store = $getWorkflowStaticData('global');
  const post = $('Webhook').first().json.body;
  const items = $input.all();
  for (const item of items) recordPrice(store, item.json, post);
  return post.history_only ? [] : items;
}
