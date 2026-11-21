// Code node "Formatar alerta".
//
// Monta a mensagem no subset de HTML aceito pela Bot API (b, i, a, code) e os
// dois botões: link da oferta e post original no canal.

const TZ = 'America/Sao_Paulo';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function stamp(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date).replace(',', '');
}

// Compara com a faixa pesquisada fora dos canais: diz se é oferta de verdade
function refPriceLine(price, refPrice) {
  if (!Array.isArray(refPrice) || refPrice.length !== 2) return null;
  const [low, high] = refPrice;
  const range = `${brl(low).replace(/,00$/, '')} a ${brl(high).replace(/,00$/, '')}`;
  if (price < low) {
    const pct = Math.round((1 - price / low) * 100);
    return `📊 <b>${pct}% abaixo</b> da sua faixa (${range}) 🔥`;
  }
  return `📊 Dentro da sua faixa (${range})`;
}

function formatAlert(offer, now = new Date()) {
  const [main, ...others] = offer.products;
  const lines = [];
  if (offer.highlight) lines.push('⭐⭐ <b>COMPRA PLANEJADA</b> ⭐⭐');
  if (offer.retro && offer.postedAt) {
    lines.push(`⏪ <i>Retroativo: postado em ${stamp(Date.parse(offer.postedAt))}, pode ter esgotado</i>`);
  }
  lines.push(`🎯 <b>${esc(main.label)}</b>`);
  if (others.length) lines.push(`<i>também: ${esc(others.map((p) => p.label).join(', '))}</i>`);
  if (offer.title) lines.push(esc(offer.title));
  if (offer.ramWarning) lines.push(`⚠️ <i>${esc(offer.ramWarning)}</i>`);
  lines.push('');

  if (offer.price !== null) {
    let priceLine = `💰 <b>${brl(offer.price)}</b>`;
    const inst = offer.installment;
    if (inst && Math.abs(inst.total - offer.price) > 0.01) {
      priceLine += ` ou ${inst.times}x de ${brl(inst.each)}`;
    } else if (inst) {
      priceLine += ` em ${inst.times}x de ${brl(inst.each)}`;
    }
    lines.push(priceLine);
    const ref = refPriceLine(offer.price, offer.refPrice);
    if (ref) lines.push(ref);
  } else {
    lines.push('💰 <i>preço não identificado no post</i>');
  }

  lines.push(offer.coupon ? `🎟 Cupom: <code>${esc(offer.coupon)}</code>` : '🎟 Sem cupom');
  lines.push(`📣 Fonte: <b>${esc(offer.source?.title)}</b>`);
  lines.push(`🕒 ${stamp(now)}`);

  const offerUrl = offer.offerUrl || offer.postUrl;
  return {
    text: lines.join('\n'),
    offerUrl,
    postUrl: offer.postUrl,
  };
}

if (typeof module !== 'undefined') module.exports = { formatAlert, refPriceLine, esc, brl, stamp };

if (typeof $input !== 'undefined') {
  return $input.all().map((item) => ({ json: { ...item.json, ...formatAlert(item.json) } }));
}
