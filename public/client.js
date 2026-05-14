const socket = io({ reconnectionAttempts: Infinity, timeout: 12000 });

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const STORAGE = {
  name: 'lastcall.name',
  code: 'lastcall.code',
  token: 'lastcall.playerToken',
  settings: 'lastcall.settings',
};

const DEFAULT_SETTINGS = {
  sound: true,
  music: true,
  reducedMotion: false,
  fullscreen: false,
  actionLog: true,
  cinematicDark: true,
};

const SETTING_META = [
  ['sound', 'Sound effects', 'Subtle table feedback and challenge cues.'],
  ['music', 'Music', 'Ambient room tone. Browser autoplay rules may keep this silent until interaction.'],
  ['reducedMotion', 'Reduced motion', 'Minimizes smoke, reveals, and hover movement.'],
  ['fullscreen', 'Fullscreen mode', 'Expands Last Call when supported by your browser.'],
  ['actionLog', 'Action log visibility', 'Shows or hides the live table feed.'],
  ['cinematicDark', 'Cinematic dark mode', 'Deepens shadows and warm amber contrast.'],
];

let state = null;
let selected = new Set();
let settings = loadSettings();
let audioCtx = null;
let musicNodes = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE.settings) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  save(STORAGE.settings, JSON.stringify(settings));
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function beep(kind = 'tap') {
  if (!settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const map = { tap: 220, challenge: 94, truth: 330, lie: 140 };
    osc.frequency.value = map[kind] || 220;
    osc.type = kind === 'challenge' ? 'sawtooth' : 'triangle';
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, audioCtx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch {}
}

function ensureAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function startMusic() {
  if (!settings.music || musicNodes) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const low = ctx.createOscillator();
  const fifth = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  low.type = 'sine';
  fifth.type = 'triangle';
  low.frequency.value = 55;
  fifth.frequency.value = 82.41;
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  gain.gain.value = 0.018;
  low.connect(filter);
  fifth.connect(filter);
  filter.connect(gain).connect(ctx.destination);
  low.start();
  fifth.start();
  musicNodes = { low, fifth, gain };
}

function stopMusic() {
  if (!musicNodes) return;
  try {
    musicNodes.gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    musicNodes.low.stop(audioCtx.currentTime + 0.1);
    musicNodes.fifth.stop(audioCtx.currentTime + 0.1);
  } catch {}
  musicNodes = null;
}

function showScreen(name) {
  $$('.screen').forEach((screen) => screen.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

function cardLabel(card) {
  return card?.wild ? 'Ember' : card?.rank || '?';
}

function renderCard(card, index = null) {
  const button = document.createElement(index === null ? 'div' : 'button');
  button.className = `playing-card ${card?.wild ? 'wild' : `rank-${String(card?.rank || '').toLowerCase()}`} ${selected.has(index) ? 'selected' : ''}`;
  button.innerHTML = `
    <span>${escapeHtml(cardLabel(card))}</span>
    <strong>${card?.wild ? '*' : card?.rank?.charAt(0) || '?'}</strong>
    <small>${card?.wild ? 'wild' : 'Last Call'}</small>
  `;
  if (index !== null) {
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!isMyTurn()) return;
      if (selected.has(index)) selected.delete(index);
      else if (selected.size < 3) selected.add(index);
      else return toast('You can play at most three cards.');
      renderHand();
      beep('tap');
    });
  }
  return button;
}

function isMyTurn() {
  const me = state?.players.find((p) => p.id === state.you);
  return Boolean(state && state.state === 'playing' && !state.resolving && me?.alive && state.currentTurnId === state.you);
}

function currentPlayer() {
  return state?.players.find((p) => p.id === state.currentTurnId);
}

function applySettings() {
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.body.classList.toggle('soft-dark', !settings.cinematicDark);
  $('action-log-panel')?.classList.toggle('hidden', !settings.actionLog);
  if (settings.music) startMusic();
  else stopMusic();
  persistSettings();
  renderSettings();
  if (settings.fullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {
      settings.fullscreen = false;
      persistSettings();
      renderSettings();
    });
  } else if (!settings.fullscreen && document.fullscreenElement) {
    document.exitFullscreen?.();
  }
}

function renderSettings() {
  const list = $('settings-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [key, title, desc] of SETTING_META) {
    const row = document.createElement('label');
    row.className = 'setting-row';
    row.innerHTML = `
      <span>
        <strong>${title}</strong>
        <small>${desc}</small>
      </span>
      <input class="switch-input" type="checkbox" ${settings[key] ? 'checked' : ''} aria-label="${title}">
      <i class="switch" aria-hidden="true"></i>
    `;
    const input = row.querySelector('input');
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      ensureAudio();
      applySettings();
    });
    list.appendChild(row);
  }
}

function renderLobby() {
  showScreen('lobby');
  $('lobby-code').textContent = state.code;
  $('player-count').textContent = `${state.players.length} / ${state.settings.maxPlayers}`;
  const me = state.players.find((p) => p.id === state.you);
  const allReady = state.players.length >= state.settings.minPlayers && state.players.every((p) => p.ready || p.id === state.hostId);
  $('lobby-status').textContent = state.you === state.hostId
    ? allReady ? 'The room is ready. Start whenever the tension feels right.' : 'Waiting for every guest to ready up.'
    : 'Ready up, then wait for the host to start.';
  $('ready-toggle').textContent = me?.ready ? 'Unready' : 'Ready';
  $('ready-toggle').classList.toggle('is-ready', Boolean(me?.ready));
  $('start-game').hidden = state.you !== state.hostId;
  $('start-game').disabled = !allReady;

  const list = $('lobby-players');
  list.innerHTML = '';
  state.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = `lobby-player ${player.ready ? 'ready' : ''} ${!player.connected ? 'offline' : ''}`;
    row.innerHTML = `
      <div class="avatar">${escapeHtml(player.name.charAt(0).toUpperCase())}</div>
      <div>
        <strong>${escapeHtml(player.name)}${player.id === state.you ? ' (you)' : ''}</strong>
        <span>${player.host ? 'Host' : player.ready ? 'Ready' : 'Not ready'}${player.connected ? '' : ' · reconnecting'}</span>
      </div>
    `;
    list.appendChild(row);
  });
}

function renderPlayers() {
  const root = $('players');
  root.innerHTML = '';
  state.players.forEach((player) => {
    const item = document.createElement('article');
    item.className = `seat ${player.id === state.you ? 'me' : ''} ${player.id === state.currentTurnId ? 'turn' : ''} ${!player.alive ? 'out' : ''} ${!player.connected ? 'offline' : ''}`;
    const lives = Array.from({ length: state.settings.startingLives }, (_, i) => `<span class="${i < player.lives ? 'live' : ''}"></span>`).join('');
    item.innerHTML = `
      <div class="avatar">${escapeHtml(player.name.charAt(0).toUpperCase())}</div>
      <strong>${escapeHtml(player.name)}</strong>
      <small>${player.alive ? `${player.handCount} cards` : 'Spectating'}${player.connected ? '' : ' · offline'}</small>
      <div class="lives" aria-label="${player.lives} lives">${lives}</div>
    `;
    root.appendChild(item);
  });
}

function renderHand() {
  const hand = $('hand');
  const panel = $('hand-panel');
  const myTurn = isMyTurn();
  const me = state.players.find((p) => p.id === state.you);
  panel.classList.toggle('disabled-panel', !myTurn);
  hand.innerHTML = '';
  if (!me?.alive) {
    hand.innerHTML = '<p class="muted">You are spectating. Keep reading the room.</p>';
  } else if (!state.hand.length) {
    hand.innerHTML = '<p class="muted">Your hand is empty. You must call bluff when your turn arrives.</p>';
  } else {
    state.hand.forEach((card, index) => hand.appendChild(renderCard(card, index)));
  }
  $('play-selected').disabled = !myTurn || selected.size < 1 || selected.size > 3;
  $('call-bluff').disabled = !myTurn || !state.lastClaim;
}

function renderGame() {
  showScreen('game');
  $('round-number').textContent = state.round;
  $('claim-rank').textContent = state.claimRank || '?';
  const turn = currentPlayer();
  $('turn-player').textContent = turn ? turn.name : 'Waiting';
  $('turn-hint').textContent = isMyTurn() ? 'Your move. Sell it clean or call it cold.' : turn ? `Waiting on ${turn.name}.` : '';
  $('last-claim').textContent = state.lastClaim ? `${state.lastClaim.name}: ${state.lastClaim.count} as ${state.lastClaim.rank}` : 'No claim yet';
  renderPlayers();
  renderHand();
  renderLog();
  $('action-log-panel').classList.toggle('hidden', !settings.actionLog);
}

function renderFinished() {
  showScreen('finished');
  const winner = state.players.find((p) => p.id === state.winnerId);
  $('winner-text').textContent = winner ? `${winner.name} wins Last Call.` : 'No one made it to closing time.';
  $('play-again').hidden = state.you !== state.hostId;
  renderLog();
}

function renderLog() {
  const root = $('action-log');
  if (!root) return;
  root.innerHTML = '';
  for (const entry of state.log.slice(-36)) {
    const row = document.createElement('p');
    row.className = `log-entry ${entry.type}`;
    row.textContent = entry.text;
    root.appendChild(row);
  }
  root.scrollTop = root.scrollHeight;
}

function render() {
  if (!state) return;
  selected = new Set([...selected].filter((index) => index < state.hand.length));
  if (state.state === 'lobby') renderLobby();
  if (state.state === 'playing') renderGame();
  if (state.state === 'finished') renderFinished();
}

function showReveal(data) {
  const overlay = $('reveal');
  $('reveal-kicker').textContent = `${playerName(data.callerId)} challenged ${playerName(data.accusedId)}`;
  $('reveal-title').textContent = data.truthful ? 'The claim was true' : 'The bluff was caught';
  $('reveal-cards').innerHTML = '';
  data.cards.forEach((card) => $('reveal-cards').appendChild(renderCard(card)));
  $('reveal-result').textContent = `${playerName(data.loserId)} loses a life.`;
  overlay.classList.remove('hidden');
  beep(data.truthful ? 'truth' : 'lie');
  clearTimeout(showReveal.timer);
  showReveal.timer = setTimeout(() => overlay.classList.add('hidden'), 3000);
}

function playerName(id) {
  return state?.players.find((p) => p.id === id)?.name || 'Someone';
}

function username() {
  const name = $('username').value.trim() || 'The Regular';
  save(STORAGE.name, name);
  return name;
}

function normalizeCodeInput() {
  $('game-code').value = $('game-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function restoreButton() {
  const code = read(STORAGE.code);
  const token = read(STORAGE.token);
  $('restore-game').classList.toggle('hidden', !(code && token));
}

function bindEvents() {
  document.addEventListener('pointerdown', () => {
    ensureAudio();
    if (settings.music) startMusic();
  }, { once: true });
  $('username').value = read(STORAGE.name) || '';
  $('game-code').addEventListener('input', normalizeCodeInput);
  $('create-game').addEventListener('click', () => socket.emit('createGame', { username: username() }));
  $('join-game').addEventListener('click', () => {
    normalizeCodeInput();
    const code = $('game-code').value;
    if (!code) return toast('Enter a game code.');
    socket.emit('joinGame', { code, username: username(), playerToken: read(STORAGE.token) });
  });
  $('restore-game').addEventListener('click', () => socket.emit('rejoinGame', { code: read(STORAGE.code), playerToken: read(STORAGE.token) }));
  $('copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      toast('Code copied.');
    } catch {
      toast(`Code: ${state.code}`);
    }
  });
  $('ready-toggle').addEventListener('click', () => {
    const me = state.players.find((p) => p.id === state.you);
    socket.emit('setReady', { ready: !me?.ready });
  });
  $('start-game').addEventListener('click', () => socket.emit('startGame'));
  $('leave-lobby').addEventListener('click', leave);
  $('leave-game').addEventListener('click', leave);
  $('leave-finished').addEventListener('click', leave);
  $('play-again').addEventListener('click', () => socket.emit('returnToLobby'));
  $('play-selected').addEventListener('click', () => {
    socket.emit('playCards', { indices: [...selected] });
    selected.clear();
  });
  $('call-bluff').addEventListener('click', () => {
    beep('challenge');
    socket.emit('callBluff');
  });
  $$('[data-open-settings]').forEach((button) => button.addEventListener('click', () => $('settings-dialog').showModal()));
  $$('[data-open-rules]').forEach((button) => button.addEventListener('click', () => $('rules-dialog').showModal()));
}

function leave() {
  socket.emit('leaveGame');
  state = null;
  selected.clear();
  showScreen('menu');
}

socket.on('joined', ({ code, playerToken }) => {
  save(STORAGE.code, code);
  save(STORAGE.token, playerToken);
  restoreButton();
});

socket.on('state', (nextState) => {
  state = nextState;
  render();
});

socket.on('notice', ({ message }) => toast(message));
socket.on('reveal', showReveal);
socket.on('connect', () => {
  const code = read(STORAGE.code);
  const token = read(STORAGE.token);
  if (code && token && !state) socket.emit('rejoinGame', { code, playerToken: token });
});
socket.on('connect_error', () => toast('Connection trouble. Retrying...'));
socket.on('disconnect', () => toast('Connection lost. Reconnecting...'));

document.addEventListener('fullscreenchange', () => {
  settings.fullscreen = Boolean(document.fullscreenElement);
  persistSettings();
  renderSettings();
});

bindEvents();
renderSettings();
applySettings();
restoreButton();
