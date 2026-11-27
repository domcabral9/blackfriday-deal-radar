// Code nodes "Registrar batimento" e "Avaliar saúde" (workflow de saúde).
//
// O build injeta `const MODE = 'beat'` ou `const MODE = 'check'` no topo,
// e o mesmo arquivo serve aos dois nós. O estado fica no static data do
// workflow, compartilhado entre o gatilho do webhook e o agendado.
//
// Sinais:
//   batimento ausente há mais de STALE_MINUTES  -> listener caiu (vermelho)
//   sem posts há QUIET_HOURS, dentro do horário -> canais em silêncio (amarelo)
//   listener reiniciado ou de volta              -> online (verde)

const STALE_MINUTES = 15;
// Batimento chegando não prova que o listener lê posts: em 27/11 ele ficou
// 8 h vivo com a conexão do Telegram travada. Este limite vale a qualquer hora.
const TELEGRAM_STALE_MINUTES = 15;
const QUIET_HOURS = 3;
const ACTIVE_HOURS = [9, 23]; // fora disso, silêncio nos canais é normal
const TZ = 'America/Sao_Paulo';

function hourInTz(now) {
  return parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now), 10);
}

function hhmm(ms) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ms);
}

function onBeat(store, beat, now = Date.now()) {
  const messages = [];
  const firstEver = !store.startedAt;
  const restarted = !firstEver && beat.started_at !== store.startedAt;

  if (store.downAlerted) {
    messages.push(`🟢 <b>Radar de volta</b>\nListener respondendo de novo desde ${hhmm(now)}.`);
  } else if (firstEver || restarted) {
    messages.push(`🟢 <b>Radar online</b>\nOuvindo ${beat.channels} canais desde ${hhmm(Date.parse(beat.started_at))}.`);
  }

  const lastMsg = beat.last_message_at ? Date.parse(beat.last_message_at) : null;
  if (store.quietAlerted && lastMsg && lastMsg > store.quietAlertedAt) {
    messages.push('🟢 <b>Posts voltaram a chegar</b> dos canais.');
    store.quietAlerted = false;
  }

  const tgOk = beat.last_telegram_ok ? Date.parse(beat.last_telegram_ok) : null;
  if (tgOk) {
    if (store.tgAlerted && now - tgOk < TELEGRAM_STALE_MINUTES * 60000) {
      messages.push('🟢 <b>Conexão com o Telegram normalizada</b>\nPosts perdidos no intervalo chegam como retroativos.');
      store.tgAlerted = false;
    }
    store.lastTelegramOk = tgOk;
  }

  store.lastBeatAt = now;
  store.startedAt = beat.started_at;
  store.lastMessageAt = lastMsg ?? store.lastMessageAt ?? Date.parse(beat.started_at);
  store.connected = beat.connected;
  store.downAlerted = false;
  return messages;
}

function evaluate(store, now = Date.now()) {
  const messages = [];
  const previousCheck = store.lastCheckAt;
  store.lastCheckAt = now;

  if (!store.lastBeatAt) return messages;

  // n8n também esteve fora (VM desligada, reboot): recomeça a contagem em vez
  // de acusar o listener por um intervalo em que ninguém estava olhando
  if (!previousCheck || now - previousCheck > 20 * 60000) {
    store.lastBeatAt = Math.max(store.lastBeatAt, now);
    store.lastMessageAt = Math.max(store.lastMessageAt || 0, now);
    if (store.lastTelegramOk) store.lastTelegramOk = Math.max(store.lastTelegramOk, now);
    return messages;
  }

  const staleMin = (now - store.lastBeatAt) / 60000;
  if (staleMin > STALE_MINUTES && !store.downAlerted) {
    store.downAlerted = true;
    messages.push(
      `🔴 <b>Listener sem sinal há ${Math.round(staleMin)} min</b>\n` +
      'Nenhuma oferta está sendo lida. Verificar: <code>docker logs deal-radar-listener</code>'
    );
    return messages;
  }

  const tgStaleMin = store.lastTelegramOk ? (now - store.lastTelegramOk) / 60000 : 0;
  if (tgStaleMin > TELEGRAM_STALE_MINUTES && !store.tgAlerted) {
    store.tgAlerted = true;
    messages.push(
      `🔴 <b>Telegram sem resposta há ${Math.round(tgStaleMin)} min</b>\n` +
      'O listener está vivo, mas não consegue ler os canais e não se recuperou sozinho. ' +
      'Verificar: <code>docker restart deal-radar-listener</code>'
    );
    return messages;
  }

  const hour = hourInTz(now);
  const quietH = (now - (store.lastMessageAt || now)) / 3600000;
  if (!store.downAlerted && !store.quietAlerted && hour >= ACTIVE_HOURS[0] && hour < ACTIVE_HOURS[1] && quietH > QUIET_HOURS) {
    store.quietAlerted = true;
    store.quietAlertedAt = now;
    messages.push(
      `🟡 <b>Nenhum post há ${Math.floor(quietH)}h</b>\n` +
      'O listener está vivo, mas os canais não mandaram nada. Pode ser sessão revogada ou canal parado.'
    );
  }
  return messages;
}

if (typeof module !== 'undefined') module.exports = { onBeat, evaluate, hourInTz };

if (typeof $input !== 'undefined') {
  const store = $getWorkflowStaticData('global');
  const texts = MODE === 'beat' ? onBeat(store, $input.first().json.body) : evaluate(store);
  return texts.map((text) => ({ json: { text } }));
}
