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

function formatAlert(offer, now = new Date()) {
  const [main, ...others] = offer.products;
  const lines = [`🎯 <b>${esc(main.label)}</b>`];
  if (others.length) lines.push(`<i>também: ${esc(others.map((p) => p.label).join(', '))}</i>`);
  if (offer.title) lines.push(esc(offer.title));
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

if (typeof module !== 'undefined') module.exports = { formatAlert, esc, brl, stamp };

if (typeof $input !== 'undefined') {
  return $input.all().map((item) => ({ json: { ...item.json, ...formatAlert(item.json) } }));
}
