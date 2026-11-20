// Code node "Deduplicar".
//
// A mesma oferta costuma aparecer nos dois canais, ou ser repostada no mesmo
// canal com outro link de afiliado. A chave é produto + preço arredondado:
// links mudam entre canais, preço e produto não. Sem preço, a chave cai para
// o link da oferta.
//
// O estado vive no static data do workflow, que o n8n só persiste em
// execuções de produção (workflow ativo). Em teste manual, nada é lembrado.

const WINDOW_HOURS = 12;

function dedupKey(offer) {
  const product = offer.products[0].id;
  const anchor = offer.price !== null ? `R$${Math.round(offer.price)}` : offer.offerUrl || offer.postUrl;
  return `${product}|${anchor}`;
}

function isDuplicate(store, offer, now = Date.now()) {
  store.seen = store.seen || {};
  const cutoff = now - WINDOW_HOURS * 3600 * 1000;
  for (const [k, ts] of Object.entries(store.seen)) {
    if (ts < cutoff) delete store.seen[k];
  }
  const key = dedupKey(offer);
  if (store.seen[key]) return true;
  store.seen[key] = now;
  return false;
}

if (typeof module !== 'undefined') module.exports = { dedupKey, isDuplicate };

if (typeof $input !== 'undefined') {
  const store = $getWorkflowStaticData('global');
  return $input.all().filter((item) => !isDuplicate(store, item.json));
}
