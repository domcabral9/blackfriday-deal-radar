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
  // QLED de qualquer marca (28/11). Regra montada com 206 TVs QLED/Mini LED
  // vistas nos canais: o texto precisa dizer "QLED" (pega Hi-QLED da Hisense e
  // Neo QLED da Samsung) e "TV"; monitores TCL "Qled Mini Led" ficam de fora.
  // QNED da LG não bate ("qned" != "qled") e tem entrada própria.
  {
    id: 'tv-qled-55-65',
    label: 'Smart TV QLED 55" ou 65"',
    model: 'qled',
    requireAll: ['(?<![a-z])tv(?![a-z])|televis'],
    excludeAny: ['monitor'],
    size: [55, 65],
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
  // Compras planejadas (21/11): highlight marca o alerta e refPrice é a faixa
  // de preço pesquisada fora dos canais, usada para dizer se a oferta é boa.
  {
    id: 'galaxy-a17-256',
    label: 'Samsung Galaxy A17 256 GB',
    model: 'a\\s?17',
    requireAll: ['galaxy|samsung', '\\b256\\s?(gb|g)\\b'],
    // A versão de 256 GB é 5G; post que diga 4G é outro aparelho
    excludeAny: ['(?<![a-z0-9])4g(?![a-z0-9])'],
    // Post que cita outra RAM é descartado; sem citação, alerta com aviso
    ram: 8,
    minPrice: 900,
    maxPrice: 1600,
    refPrice: [1300, 1600],
    highlight: true,
  },
  {
    id: 'galaxy-a07-128',
    label: 'Samsung Galaxy A07 128 GB',
    model: 'a\\s?07',
    requireAll: ['galaxy|samsung', '\\b128\\s?(gb|g)\\b'],
    minPrice: 400,
    maxPrice: 800,
    refPrice: [600, 800],
    highlight: true,
  },
  // Logitech MX Master (22/11). O 4 é o preferido e tem entrada própria;
  // a segunda pega 3S, 3 e 2S e exclui o 4 para não alertar em dobro.
  // Tetos: lançamento do 4 no Brasil a R$ 799 (já visto a R$ 679,90);
  // 3S em promoção costuma ficar entre R$ 420 e R$ 650.
  {
    id: 'mx-master-4',
    label: 'Logitech MX Master 4',
    model: 'mx\\s?master\\s?4',
    minPrice: 200,
    maxPrice: 800,
  },
  {
    id: 'mx-master',
    label: 'Logitech MX Master (3S e anteriores)',
    model: 'mx\\s?master',
    excludeAfter: ['4'],
    minPrice: 200,
    maxPrice: 550,
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
