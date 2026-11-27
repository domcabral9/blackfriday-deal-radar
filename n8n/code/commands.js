// Code node "Processar comando".
//
// Recebe um comando do bot (repassado pelo listener) e altera o catálogo
// guardado no static data do workflow. Devolve o texto de resposta.
//
//   /produtos                         lista com status e teto
//   /pausar <id>   /ativar <id>       liga e desliga um produto
//   /teto <id> <valor>                muda o teto de preço
//   /minimo <id> <valor>              muda o preço mínimo (abaixo é acessório)
//   /add <termos> [-excluir] [teto=N] [min=N]   cria um produto
//   /remover <id>                     apaga um produto criado por /add
//   /status                           saúde do listener
//   /ajuda

const DEFAULT_MAX = 5000;
const DEFAULT_MIN = 300;
const TZ = 'America/Sao_Paulo';

const HELP = [
  '<b>Comandos do radar</b>',
  '/produtos: lista produtos, status e teto',
  '/pausar <code>id</code> e /ativar <code>id</code>',
  '/teto <code>id</code> <code>valor</code>: ex. <code>/teto iphone-17 4500</code>',
  '/minimo <code>id</code> <code>valor</code>: ex. <code>/minimo controle 200</code>',
  '/historico <code>id</code> [dias]: preços vistos e variação, ex. <code>/historico iphone-16e 3</code>',
  '/add <code>termos</code>: ex. <code>/add galaxy s25 fe -ultra teto=2500</code>',
  '   termos com "-" excluem; teto e min em reais',
  '/remover <code>id</code>: só produtos criados por /add',
  '/status: saúde do listener',
].join('\n');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalize(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function brl(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
}

function parseMoney(s) {
  const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function ago(iso, now) {
  if (!iso) return 'nunca';
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function buildCustomProduct(args) {
  const positives = [];
  const negatives = [];
  let maxPrice = DEFAULT_MAX;
  let minPrice = DEFAULT_MIN;
  for (const raw of args) {
    const kv = raw.match(/^(teto|min)=(.+)$/i);
    if (kv) {
      const v = parseMoney(kv[2]);
      if (v === null) return { error: `Valor inválido em <code>${esc(raw)}</code>.` };
      if (kv[1].toLowerCase() === 'teto') maxPrice = v; else minPrice = v;
    } else if (raw.startsWith('-') && raw.length > 1) {
      negatives.push(normalize(raw.slice(1)));
    } else {
      positives.push(raw);
    }
  }
  const terms = positives.map(normalize).filter(Boolean);
  if (!terms.length) return { error: 'Informe ao menos um termo. Ex.: <code>/add galaxy s25 fe</code>' };

  const word = (t) => `(?<![a-z0-9])${reEscape(t).replace(/ /g, '\\s?')}(?![a-z0-9])`;
  // O termo com número costuma ser o mais específico (s25, 16e, a57)
  const modelIdx = Math.max(0, terms.findIndex((t) => /\d/.test(t)));
  return {
    product: {
      id: terms.join('-').replace(/[^a-z0-9-]/g, ''),
      label: positives.join(' '),
      model: reEscape(terms[modelIdx]).replace(/ /g, '\\s?'),
      requireAll: terms.filter((_, i) => i !== modelIdx).map(word),
      excludeAny: negatives.filter(Boolean).map(word),
      minPrice,
      maxPrice,
      active: true,
    },
  };
}

function dayHour(ms) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(ms).replace(',', '');
}

function pct(from, to) {
  return ((to - from) / from) * 100;
}

function trendLine(label, from, to) {
  const v = pct(from, to);
  if (Math.abs(v) < 0.5) return `➖ ${label}: estável`;
  const arrow = v < 0 ? '🔻' : '🔺';
  const word = v < 0 ? 'queda' : 'alta';
  return `${arrow} ${label}: <b>${Math.abs(v).toFixed(1).replace('.', ',')}% de ${word}</b>`;
}

// Resume os preços vistos de um produto numa janela de dias
function summarizeHistory(product, entries, days, now = Date.now()) {
  const from = now - days * 86400000;
  const win = (entries || []).filter((e) => e.t >= from).sort((a, b) => a.t - b.t);
  const head = `📈 <b>Histórico: ${esc(product.label)}</b> (últimos ${days} dia${days > 1 ? 's' : ''})`;
  if (!win.length) {
    return `${head}\nNenhuma oferta vista nesse período. Tente mais dias: <code>/historico ${esc(product.id)} 15</code>`;
  }
  const first = win[0];
  const last = win[win.length - 1];
  const min = win.reduce((a, b) => (b.p < a.p ? b : a));
  const max = win.reduce((a, b) => (b.p > a.p ? b : a));
  const lines = [
    head,
    `Ofertas vistas: ${win.length}`,
    `Mais recente: <b>${brl2(last.p)}</b> (${dayHour(last.t)})`,
    `Menor: ${brl2(min.p)} (${dayHour(min.t)})`,
    `Maior: ${brl2(max.p)} (${dayHour(max.t)})`,
  ];
  if (win.length > 1) {
    lines.push('');
    lines.push(trendLine(`Desde a primeira (${brl2(first.p)} em ${dayHour(first.t)})`, first.p, last.p));
    lines.push(trendLine('Em relação ao maior preço', max.p, last.p));
    lines.push(last.p <= min.p ? '🏆 O preço mais recente é o menor do período' : `Ainda ${brl2(last.p - min.p)} acima do menor`);
  }
  lines.push('');
  lines.push('<i>Últimas ofertas:</i>');
  for (const e of win.slice(-6).reverse()) lines.push(`${dayHour(e.t)} · ${brl2(e.p)} · ${esc(e.s.split(' ')[0])}`);
  return lines.join('\n');
}

function brl2(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function handleCommand(text, store, ctx, now = Date.now()) {
  store.overrides = store.overrides || {};
  store.custom = store.custom || [];
  const [rawCmd, ...args] = String(text || '').trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');
  const catalog = ctx.catalog || [];
  const find = (id) => catalog.find((p) => p.id === (id || '').toLowerCase());
  const unknown = (id) => `Produto <code>${esc(id || '?')}</code> não encontrado. Veja /produtos.`;

  switch (cmd) {
    case '/start':
    case '/ajuda':
    case '/help':
      return HELP;

    case '/produtos': {
      if (!catalog.length) return 'Catálogo vazio.';
      const lines = catalog.map((p) =>
        `${p.active === false ? '⏸' : '🟢'} <code>${esc(p.id)}</code> ${esc(p.label)} · ${brl(p.minPrice || 0)} a ${brl(p.maxPrice)}${p.custom ? ' · <i>via /add</i>' : ''}`);
      return `<b>Produtos monitorados</b>\n${lines.join('\n')}`;
    }

    case '/pausar':
    case '/ativar': {
      const p = find(args[0]);
      if (!p) return unknown(args[0]);
      const active = cmd === '/ativar';
      store.overrides[p.id] = { ...store.overrides[p.id], active };
      return `${active ? '🟢 Ativado' : '⏸ Pausado'}: ${esc(p.label)}`;
    }

    case '/teto': {
      const p = find(args[0]);
      if (!p) return unknown(args[0]);
      const v = parseMoney(args[1]);
      if (v === null) return 'Uso: <code>/teto id valor</code>, ex. <code>/teto iphone-17 4500</code>';
      if (v <= (p.minPrice || 0)) return `O teto precisa ser maior que o mínimo atual (${brl(p.minPrice)}). Ajuste com /minimo.`;
      store.overrides[p.id] = { ...store.overrides[p.id], maxPrice: v };
      return `💰 Teto de ${esc(p.label)}: ${brl(v)}`;
    }

    case '/historico': {
      const p = find(args[0]);
      if (!p) return args[0] ? unknown(args[0]) : 'Uso: <code>/historico id [dias]</code>, ex. <code>/historico iphone-16e 3</code>';
      const days = Math.min(45, Math.max(1, parseInt(args[1], 10) || 7));
      return summarizeHistory(p, (store.history || {})[p.id], days, now);
    }

    case '/minimo': {
      // O mínimo separa o produto de capas e acessórios; baixar demais faz
      // acessório virar alerta, por isso a resposta lembra o efeito
      const p = find(args[0]);
      if (!p) return unknown(args[0]);
      const raw = args[1] === '0' ? 0 : parseMoney(args[1]);
      if (raw === null || raw === undefined) return 'Uso: <code>/minimo id valor</code>, ex. <code>/minimo controle 200</code>';
      if (raw >= p.maxPrice) return `O mínimo precisa ser menor que o teto atual (${brl(p.maxPrice)}). Ajuste com /teto.`;
      store.overrides[p.id] = { ...store.overrides[p.id], minPrice: raw };
      return `🔻 Mínimo de ${esc(p.label)}: ${brl(raw)}\n<i>Abaixo disso o post é tratado como acessório (capa, película, peça).</i>`;
    }

    case '/add': {
      const { product, error } = buildCustomProduct(args);
      if (error) return error;
      if (find(product.id)) return `Já existe <code>${esc(product.id)}</code>. Use /teto ou /ativar.`;
      store.custom.push(product);
      const ex = args.filter((a) => a.startsWith('-')).join(' ');
      return `➕ Monitorando <b>${esc(product.label)}</b> (<code>${esc(product.id)}</code>)\n` +
        `Teto ${brl(product.maxPrice)}, mínimo ${brl(product.minPrice)}${ex ? `, excluindo ${esc(ex)}` : ''}`;
    }

    case '/remover': {
      const id = (args[0] || '').toLowerCase();
      if (!store.custom.some((p) => p.id === id)) {
        return find(id) ? 'Produtos do catálogo-base não são removidos pelo bot. Use /pausar.' : unknown(id);
      }
      store.custom = store.custom.filter((p) => p.id !== id);
      delete store.overrides[id];
      return `🗑 Removido: <code>${esc(id)}</code>`;
    }

    case '/status': {
      const l = ctx.listener || {};
      const active = catalog.filter((p) => p.active !== false).length;
      return [
        '<b>Status do radar</b>',
        `Listener no ar desde ${l.started_at ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(Date.parse(l.started_at)) : '?'}`,
        `Último post recebido: ${ago(l.last_message_at, now)}`,
        `Posts desde o início: ${l.messages_since_start ?? '?'}`,
        `Produtos ativos: ${active} de ${catalog.length}`,
      ].join('\n');
    }

    default:
      return `Comando não reconhecido.\n\n${HELP}`;
  }
}

if (typeof module !== 'undefined') module.exports = { handleCommand, buildCustomProduct, summarizeHistory };

if (typeof $input !== 'undefined') {
  const store = $getWorkflowStaticData('global');
  const { catalog } = $('Catálogo de produtos').first().json;
  const body = $('Comando do bot').first().json.body;
  return [{ json: { text: handleCommand(body.text, store, { catalog, listener: body.listener }) } }];
}
