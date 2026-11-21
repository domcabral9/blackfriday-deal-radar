// Code node "Catálogo de produtos".
//
// Para cadastrar um produto novo, adicione um objeto nesta lista e salve o
// workflow. A ordem importa: quando um post bate com mais de um item, o
// primeiro da lista vira o título do alerta.
//
// Campos:
//   id         identificador curto e único
//   label      nome exibido no alerta
//   model      regex do modelo (texto já normalizado: minúsculo, sem acento)
//   excludeAfter  variantes descartadas quando aparecem logo depois do modelo
//   requireAll lista de regex que também precisam aparecer no texto
//   size       polegadas exigidas (TVs)
//   minPrice   abaixo disso é acessório (capa, película, suporte) e é ignorado
//   maxPrice   teto de preço; parcelado conta pelo total
//   active     false pausa o produto sem apagar

const PHONE = { minPrice: 900, maxPrice: 5000 };
const TV = { minPrice: 1200, maxPrice: 5000 };

const catalog = [
  { id: 'iphone-16e', label: 'iPhone 16e', model: 'iphone\\s?16\\s?e', ...PHONE },
  {
    id: 'iphone-17',
    label: 'iPhone 17',
    model: 'iphone\\s?17',
    excludeAfter: ['e', 'pro', 'air', 'plus', 'max'],
    ...PHONE,
  },
  {
    id: 'galaxy-s26',
    label: 'Samsung Galaxy S26',
    model: 's\\s?26',
    excludeAfter: ['fe', '\\+', 'plus', 'ultra', 'edge'],
    requireAll: ['galaxy|samsung'],
    ...PHONE,
  },
  {
    id: 'tv-lg-mrgb85',
    label: 'Smart TV LG 55" MRGB85',
    model: 'mrgb\\s?85',
    requireAll: ['\\blg\\b'],
    size: 55,
    ...TV,
  },
  {
    id: 'tv-lg-qned',
    label: 'Smart TV LG 55" QNED',
    model: 'qned',
    requireAll: ['\\blg\\b'],
    size: 55,
    ...TV,
  },
  {
    id: 'moto-edge-70',
    label: 'Motorola Edge 70',
    model: 'edge\\s?70',
    excludeAfter: ['fusion', 'pro'],
    requireAll: ['motorola|\\bmoto\\b'],
    ...PHONE,
  },
  {
    id: 'galaxy-a57-256',
    label: 'Samsung Galaxy A57 256 GB',
    model: 'a\\s?57',
    requireAll: ['galaxy|samsung', '\\b256\\s?(gb|g)\\b'],
    ...PHONE,
  },
  // Lote de 21/11. Tetos calibrados pelos preços vistos nos canais em
  // novembro; minPrice separa o produto de capas, suportes e acessórios.
  {
    id: 'galaxy-a17-5g',
    label: 'Samsung Galaxy A17 5G',
    model: 'a\\s?17',
    requireAll: ['galaxy|samsung', '(?<![a-z0-9])5g(?![a-z0-9])'],
    minPrice: 500,
    maxPrice: 1300,
  },
  {
    id: 'echo-dot',
    label: 'Echo Dot (5ª geração ou mais recente)',
    model: 'echo\\s?dot',
    excludeAfter: ['max'],
    // Muitos posts não citam a geração; exclui só as antigas quando citadas
    excludeAny: ['(?<![a-z0-9])[1-4]\\s?a?\\s?geracao'],
    minPrice: 150,
    maxPrice: 300,
  },
  {
    id: 'kindle',
    label: 'Kindle',
    model: 'kindle',
    minPrice: 300,
    maxPrice: 800,
  },
  {
    id: 'airfryer',
    label: 'Air Fryer',
    model: 'air\\s?fryer|fritadeira\\s(?:eletrica|sem oleo)',
    // Air fryer pequena sai por ~R$ 116; papel e forma custam R$ 30 a 40
    minPrice: 80,
    maxPrice: 450,
  },
  {
    id: 'mochila',
    label: 'Mochila',
    model: 'mochila',
    minPrice: 50,
    maxPrice: 300,
  },
].map((p) => ({ active: true, ...p }));

const settings = {
  // Posts publicados há mais tempo que isso são ignorados. Evita alerta de
  // oferta velha quando o listener volta de uma queda e recupera o atraso.
  maxAgeMinutes: 60,
  // Posts recuperados pela reconciliação do listener (PC desligado à noite,
  // VM restaurada) passam do corte acima até este limite e chegam marcados
  // como retroativos.
  maxReplayHours: 16,
};

// Alterações feitas pelo bot (/pausar, /teto, /add) ficam no static data
// do workflow e são aplicadas por cima da lista acima a cada execução.
// A lista deste arquivo continua sendo a base: editar aqui e publicar
// não apaga o que foi ajustado pelo bot.
function applyOverrides(base, store) {
  const overrides = store.overrides || {};
  const merged = [...base, ...(store.custom || []).map((p) => ({ ...p, custom: true }))];
  return merged.map((p) => ({ ...p, ...(overrides[p.id] || {}) }));
}

const store = typeof $getWorkflowStaticData === 'function' ? $getWorkflowStaticData('global') : {};

return [{ json: { catalog: applyOverrides(catalog, store), baseIds: catalog.map((p) => p.id), settings } }];
