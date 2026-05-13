const socket = io();
let state = null;
let selectedCards = new Set();
let bidQty = 1;
let bidFace = 2;

const SUITS_LIARS = { King: '♛', Queen: '♕', Ace: '♠', Joker: '★' };
const SUITS_POKER = { S: '♠', H: '♥', D: '♦', C: '♣' };
const PIP_LAYOUTS = {
  1: [[2,2]],
  2: [[1,1],[3,3]],
  3: [[1,1],[2,2],[3,3]],
  4: [[1,1],[1,3],[3,1],[3,3]],
  5: [[1,1],[1,3],[2,2],[3,1],[3,3]],
  6: [[1,1],[1,3],[2,1],[2,3],[3,1],[3,3]],
};
const MODE_LABELS = { cards: "Liar's Cards", dice: "Liar's Dice", poker: 'Poker' };

function $(id) { return document.getElementById(id); }
function showScreen(name) {
  for (const s of ['menu', 'lobby', 'game', 'gameover']) {
    $('screen-' + s).classList.toggle('active', s === name);
  }
  if (name !== 'game') {
    document.body.classList.remove('my-turn');
    document.body.classList.remove('spectating');
  }
}
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function rankName(r) { return ({11:'J',12:'Q',13:'K',14:'A'})[r] || String(r); }
function pokerCardLabel(c) {
  if (!c) return '?';
  if (c.joker) return 'Joker';
  return `${rankName(c.rank)}${SUITS_POKER[c.suit] || ''}`;
}

function loadName() { try { return localStorage.getItem('liarsbar.name') || ''; } catch { return ''; } }
function saveName(n) { try { localStorage.setItem('liarsbar.name', n); } catch {} }

const savedName = loadName();
if (savedName) $('name-input').value = savedName;

// ============================================================
// SPRITES
// ============================================================

function makeDie(face, opts = {}) {
  const die = document.createElement('div');
  die.className = 'die' + (opts.rolling ? ' rolling' : '') + (opts.highlight ? ' highlight' : '') + (opts.dim ? ' dim' : '');
  die.dataset.face = face;
  const layout = PIP_LAYOUTS[face] || [];
  for (const [r, c] of layout) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.style.gridRow = r;
    pip.style.gridColumn = c;
    die.appendChild(pip);
  }
  return die;
}

function makePokerCard(card, opts = {}) {
  const div = document.createElement('div');
  if (card && card.joker) {
    div.className = 'poker-card joker'
      + (opts.selected ? ' selected' : '')
      + (opts.disabled ? ' disabled' : '')
      + (opts.flipped ? ' flipped' : '');
    div.innerHTML = `
      <div class="pc-corner pc-top">JKR<br>★</div>
      <div class="pc-center">★</div>
      <div class="pc-corner pc-bot">JKR<br>★</div>
    `;
    return div;
  }
  const suitClass = `suit-${card.suit.toLowerCase()}`;
  div.className = `poker-card ${suitClass}`
    + (opts.selected ? ' selected' : '')
    + (opts.disabled ? ' disabled' : '')
    + (opts.flipped ? ' flipped' : '');
  const suitChar = SUITS_POKER[card.suit];
  const rn = rankName(card.rank);
  div.innerHTML = `
    <div class="pc-corner pc-top">${rn}<br>${suitChar}</div>
    <div class="pc-center">${suitChar}</div>
    <div class="pc-corner pc-bot">${rn}<br>${suitChar}</div>
  `;
  return div;
}

function makeLiarsCard(name, opts = {}) {
  const div = document.createElement('div');
  div.className = `card card-${name.toLowerCase()}` + (opts.selected ? ' selected' : '') + (opts.disabled ? ' disabled' : '');
  div.innerHTML = `<div class="card-rank">${name.toUpperCase()}</div><div class="card-suit">${SUITS_LIARS[name] || ''}</div>`;
  return div;
}

function makeCardBack() {
  const div = document.createElement('div');
  div.className = 'card-back';
  div.innerHTML = '<div class="back-pattern"></div>';
  return div;
}

// ============================================================
// MENU
// ============================================================

$('btn-create').onclick = () => {
  const name = ($('name-input').value || '').trim() || 'Player';
  saveName(name);
  socket.emit('createRoom', { name });
};
$('btn-join').onclick = () => {
  const name = ($('name-input').value || '').trim() || 'Player';
  const code = ($('room-input').value || '').trim().toUpperCase();
  if (!code) { toast('Enter a room code.'); return; }
  saveName(name);
  socket.emit('joinRoom', { code, name });
};
$('room-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
$('room-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });

// ============================================================
// LOBBY
// ============================================================

$('btn-start').onclick = () => socket.emit('startGame');
$('btn-leave').onclick = () => {
  socket.emit('leaveRoom');
  state = null;
  showScreen('menu');
};
$('btn-copy-code').onclick = () => {
  if (!state) return;
  navigator.clipboard?.writeText(state.code).then(() => toast('Code copied!')).catch(() => toast('Copy failed.'));
};
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.onclick = () => {
    if (!state || state.yourId !== state.hostId) {
      toast('Only the host can change mode.');
      return;
    }
    socket.emit('setGameMode', { mode: btn.dataset.mode });
  };
});

// ============================================================
// GAME — CARDS
// ============================================================

$('btn-play-cards').onclick = () => {
  const indices = [...selectedCards];
  if (indices.length < 1 || indices.length > 3) { toast('Select 1–3 cards.'); return; }
  socket.emit('gameAction', { action: 'play', payload: { indices } });
  selectedCards.clear();
};
$('btn-liar-cards').onclick = () => socket.emit('gameAction', { action: 'liar' });

// ============================================================
// GAME — DICE
// ============================================================

$('qty-down').onclick = () => { if (bidQty > 1) { bidQty--; renderDiceControls(); } };
$('qty-up').onclick = () => {
  const max = state?.totalDiceInPlay || 60;
  if (bidQty < max) { bidQty++; renderDiceControls(); }
};
$('btn-bid').onclick = () => {
  socket.emit('gameAction', { action: 'play', payload: { qty: bidQty, face: bidFace } });
};
$('btn-liar-dice').onclick = () => socket.emit('gameAction', { action: 'liar' });
$('btn-spoton-dice').onclick = () => socket.emit('gameAction', { action: 'spoton' });

function bidVal(qty, face) { return qty * 7 + face; }

function setDefaultDiceBid() {
  if (!state) return;
  if (state.lastBid) {
    bidQty = state.lastBid.qty;
    bidFace = state.lastBid.face;
    if (bidFace < 6) bidFace++;
    else { bidFace = 2; bidQty++; }
  } else {
    bidQty = Math.max(1, Math.floor((state.totalDiceInPlay || 5) / 3));
    bidFace = 2;
  }
}

function renderDiceControls() {
  $('qty-value').textContent = bidQty;
  const picker = $('face-picker');
  picker.innerHTML = '';
  for (let f = 1; f <= 6; f++) {
    const btn = document.createElement('button');
    btn.className = 'face-btn' + (f === bidFace ? ' active' : '');
    btn.appendChild(makeDie(f));
    if (f === 1) {
      const wild = document.createElement('div');
      wild.className = 'wild-tag';
      wild.textContent = 'WILD';
      btn.appendChild(wild);
    }
    btn.onclick = () => { bidFace = f; renderDiceControls(); };
    picker.appendChild(btn);
  }
  const bidBtn = $('btn-bid');
  const myIdx = state ? state.players.findIndex(p => p.id === state.yourId) : -1;
  const myTurn = state && myIdx === state.currentPlayerIdx && state.players[myIdx]?.alive;
  let legal = true;
  if (state?.lastBid) legal = bidVal(bidQty, bidFace) > bidVal(state.lastBid.qty, state.lastBid.face);
  if (state?.totalDiceInPlay && bidQty > state.totalDiceInPlay) legal = false;
  bidBtn.disabled = !myTurn || !legal;
  $('btn-liar-dice').disabled = !myTurn || !state?.lastBid;
  $('btn-spoton-dice').disabled = !myTurn || !state?.lastBid;
}

// ============================================================
// GAME — POKER  (Liar's-Bar style: target rank, face-down play)
// ============================================================

$('btn-play-poker').onclick = () => {
  const indices = [...selectedCards];
  if (indices.length < 1 || indices.length > 3) { toast('Select 1–3 cards.'); return; }
  socket.emit('gameAction', { action: 'play', payload: { indices } });
  selectedCards.clear();
};
$('btn-liar-poker').onclick = () => socket.emit('gameAction', { action: 'liar' });

// ============================================================
// GAME OVER
// ============================================================

$('btn-new-game').onclick = () => socket.emit('resetGame');
$('btn-back-menu').onclick = () => {
  socket.emit('leaveRoom');
  state = null;
  showScreen('menu');
};

// ============================================================
// SOCKETS
// ============================================================

socket.on('connect_error', () => toast('Connection lost. Refresh.'));
socket.on('errorMsg', (msg) => toast(msg));
socket.on('roomJoined', () => {});
socket.on('roomUpdate', (s) => {
  state = s;
  render();
});
socket.on('reveal', (data) => showReveal(data));
socket.on('shot', (data) => showShot(data));

// ============================================================
// RENDER
// ============================================================

function render() {
  if (!state) return;
  if (state.state !== 'playing') {
    document.body.classList.remove('my-turn');
    document.body.classList.remove('spectating');
  }
  if (state.state === 'lobby') { showScreen('lobby'); renderLobby(); }
  else if (state.state === 'playing') { showScreen('game'); renderGame(); }
  else if (state.state === 'finished') { showScreen('gameover'); renderGameOver(); }
}

function renderLobby() {
  $('room-code').textContent = state.code;
  const ul = $('player-list');
  ul.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(p.name)}${p.id === state.yourId ? ' (you)' : ''}</span>${p.id === state.hostId ? '<span class="host-tag">★ HOST</span>' : ''}`;
    ul.appendChild(li);
  }
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.gameMode);
  });
  const modeHints = {
    cards: 'Play cards face down claiming they match the table card. Bluff or be honest.',
    dice: 'Bid total quantity × face across all hidden dice. 1s are wild.',
    poker: '52-card deck plus wild Jokers. Play cards face down claiming they match the target rank.',
  };
  $('mode-hint').textContent = modeHints[state.gameMode] || '';
  const isHost = state.yourId === state.hostId;
  $('btn-start').style.display = isHost ? 'inline-block' : 'none';
  $('btn-start').disabled = state.players.length < 2;
  $('lobby-hint').textContent = isHost
    ? (state.players.length < 2 ? 'Waiting for more players to join…' : 'Ready when you are.')
    : 'Waiting for the host to start.';
}

function renderGame() {
  $('mode-badge').textContent = MODE_LABELS[state.gameMode];

  // Show only the active mode panel
  $('game-cards').style.display = state.gameMode === 'cards' ? 'block' : 'none';
  $('game-dice').style.display = state.gameMode === 'dice' ? 'block' : 'none';
  $('game-poker').style.display = state.gameMode === 'poker' ? 'block' : 'none';

  // Body class: are you the active player?
  const meForTurn = state.players.find(p => p.id === state.yourId);
  const myIdxForTurn = state.players.findIndex(p => p.id === state.yourId);
  const myTurnFlag = myIdxForTurn === state.currentPlayerIdx && meForTurn && meForTurn.alive && !state.resolving;
  document.body.classList.toggle('my-turn', !!myTurnFlag);
  document.body.classList.toggle('spectating', !myTurnFlag);

  renderPlayers();
  renderCenter();

  if (state.gameMode === 'cards') renderCardsMode();
  else if (state.gameMode === 'dice') renderDiceMode();
  else if (state.gameMode === 'poker') renderPokerMode();

  renderLog();
}

function renderPlayers() {
  const pa = $('players-area');
  pa.innerHTML = '';
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const div = document.createElement('div');
    div.className = 'player'
      + (p.id === state.yourId ? ' me' : '')
      + (i === state.currentPlayerIdx && p.alive ? ' current' : '')
      + (!p.alive ? ' dead' : '')
      + (p.disconnected ? ' disconnected' : '');

    let chambersHtml = '<div class="chambers">';
    for (let c = 0; c < p.chambers; c++) {
      chambersHtml += `<span class="chamber${c < p.shotsFired ? ' fired' : ''}"></span>`;
    }
    chambersHtml += '</div>';

    let countHtml = '';
    if (state.gameMode === 'dice') {
      countHtml = `<div class="player-count">🎲 × ${p.diceCount}</div>`;
    } else if (state.gameMode === 'poker') {
      countHtml = `<div class="player-count">♠ × ${p.handSize}</div>`;
    } else {
      countHtml = `<div class="player-count">🂠 × ${p.handSize}</div>`;
    }

    div.innerHTML = `
      <div class="player-name">${escapeHtml(p.name)}${p.id === state.yourId ? ' (you)' : ''}</div>
      ${countHtml}
      <div class="player-gun">${chambersHtml}</div>
      ${!p.alive ? '<div class="player-status-dead">💀</div>' : ''}
    `;
    pa.appendChild(div);
  }
}

function renderCenter() {
  const cd = $('center-display');
  cd.innerHTML = '';
  const me = state.players.find(p => p.id === state.yourId);
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = myIdx === state.currentPlayerIdx && me && me.alive;
  const current = state.players[state.currentPlayerIdx];

  if (state.gameMode === 'cards') {
    const tc = document.createElement('div');
    tc.className = 'table-card-display';
    tc.innerHTML = `<div class="ctr-label">TABLE CARD</div><div class="ctr-value">${state.tableCard ? state.tableCard.toUpperCase() : '?'}</div>`;
    cd.appendChild(tc);
    const pi = document.createElement('div');
    pi.className = 'pile-info';
    pi.textContent = state.lastPlayedCount > 0
      ? `${state.lastPlayedCount} card${state.lastPlayedCount > 1 ? 's' : ''} face down`
      : 'No cards played yet';
    cd.appendChild(pi);
  } else if (state.gameMode === 'dice') {
    const bid = document.createElement('div');
    bid.className = 'bid-display';
    if (state.lastBid) {
      bid.innerHTML = `<div class="ctr-label">CURRENT BID</div><div class="bid-line"><span class="bid-qty">${state.lastBid.qty}</span><span class="bid-x">×</span></div>`;
      bid.appendChild(makeDie(state.lastBid.face, { highlight: true }));
    } else {
      bid.innerHTML = `<div class="ctr-label">CURRENT BID</div><div class="ctr-value">—</div>`;
    }
    cd.appendChild(bid);
    const di = document.createElement('div');
    di.className = 'pile-info';
    di.textContent = `${state.totalDiceInPlay || 0} dice in play`;
    cd.appendChild(di);
  } else if (state.gameMode === 'poker') {
    const tc = document.createElement('div');
    tc.className = 'table-card-display';
    const tn = state.targetRank ? rankName(state.targetRank) : '?';
    tc.innerHTML = `<div class="ctr-label">TARGET RANK</div><div class="ctr-value">${tn === '?' ? '?' : tn + 's'}</div>`;
    cd.appendChild(tc);
    const pi = document.createElement('div');
    pi.className = 'pile-info';
    pi.textContent = state.lastPlayedCount > 0
      ? `${state.lastPlayedCount} card${state.lastPlayedCount > 1 ? 's' : ''} face down`
      : 'No cards played yet';
    cd.appendChild(pi);
  }

  $('turn-info').textContent = current
    ? (myTurn ? 'Your turn.' : `Waiting for ${current.name}…`)
    : '';

  const wpName = $('waiting-player');
  if (wpName) wpName.textContent = current ? current.name : 'the table';
}

// ===== CARDS MODE =====
function renderCardsMode() {
  const me = state.players.find(p => p.id === state.yourId);
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = myIdx === state.currentPlayerIdx && me && me.alive;

  const hand = $('hand-area');
  hand.innerHTML = '';
  const handCards = state.yourHand || [];
  if (handCards.length === 0 && me && me.alive) {
    hand.innerHTML = '<div class="hand-empty">Hand empty — you must call LIAR.</div>';
  }
  for (let i = 0; i < handCards.length; i++) {
    const card = handCards[i];
    const selected = selectedCards.has(i);
    const div = makeLiarsCard(card, { selected, disabled: !myTurn });
    div.onclick = () => {
      if (!myTurn) return;
      if (selectedCards.has(i)) selectedCards.delete(i);
      else if (selectedCards.size < 3) selectedCards.add(i);
      else toast('Max 3 cards.');
      renderCardsMode();
    };
    hand.appendChild(div);
  }

  const canPlay = myTurn && selectedCards.size > 0 && selectedCards.size <= 3 && handCards.length > 0;
  const canLiar = myTurn && state.lastPlayedCount > 0 && state.lastActorIdx !== null;
  $('btn-play-cards').disabled = !canPlay;
  $('btn-liar-cards').disabled = !canLiar;
}

// ===== DICE MODE =====
function renderDiceMode() {
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = myIdx === state.currentPlayerIdx && state.players[myIdx]?.alive;
  const da = $('dice-area');
  da.innerHTML = '';
  const myDice = state.yourDice || [];
  const lbl = document.createElement('div');
  lbl.className = 'your-label';
  lbl.textContent = myDice.length ? 'Your dice (hidden from others):' : 'No dice — you are out.';
  da.appendChild(lbl);
  const tray = document.createElement('div');
  tray.className = 'dice-tray';
  for (const d of myDice) tray.appendChild(makeDie(d));
  da.appendChild(tray);

  // Auto-bump bid defaults when it becomes your turn
  if (myTurn) {
    if (state.lastBid) {
      const min = bidVal(state.lastBid.qty, state.lastBid.face) + 1;
      if (bidVal(bidQty, bidFace) < min) setDefaultDiceBid();
    } else if (bidQty < 1) {
      setDefaultDiceBid();
    }
  }

  renderDiceControls();
}

// ===== POKER MODE =====
function renderPokerMode() {
  const me = state.players.find(p => p.id === state.yourId);
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = myIdx === state.currentPlayerIdx && me && me.alive;

  const pa = $('poker-hand-area');
  pa.innerHTML = '';
  const myHand = state.yourHand || [];
  const lbl = document.createElement('div');
  lbl.className = 'your-label';
  lbl.textContent = myHand.length ? 'Your cards (hidden from others):' : 'No cards — you are out.';
  pa.appendChild(lbl);
  const tray = document.createElement('div');
  tray.className = 'poker-tray';
  if (myHand.length === 0 && me && me.alive) {
    const empty = document.createElement('div');
    empty.className = 'hand-empty';
    empty.textContent = 'Hand empty — you must call LIAR.';
    tray.appendChild(empty);
  }
  for (let i = 0; i < myHand.length; i++) {
    const card = myHand[i];
    const selected = selectedCards.has(i);
    const div = makePokerCard(card, { selected, disabled: !myTurn });
    div.onclick = () => {
      if (!myTurn) return;
      if (selectedCards.has(i)) selectedCards.delete(i);
      else if (selectedCards.size < 3) selectedCards.add(i);
      else toast('Max 3 cards.');
      renderPokerMode();
    };
    tray.appendChild(div);
  }
  pa.appendChild(tray);

  const canPlay = myTurn && selectedCards.size > 0 && selectedCards.size <= 3 && myHand.length > 0;
  const canLiar = myTurn && state.lastPlayedCount > 0 && state.lastActorIdx !== null;
  $('btn-play-poker').disabled = !canPlay;
  $('btn-liar-poker').disabled = !canLiar;
}

let _lastLogTime = 0;
function renderLog() {
  const log = $('log');
  log.innerHTML = '';
  const entries = state.log.slice(-25);

  for (const entry of entries) {
    const el = makeLogEntry(entry);
    if (entry.time > _lastLogTime) el.classList.add('fresh');
    log.appendChild(el);
  }
  _lastLogTime = entries.length ? entries[entries.length - 1].time : _lastLogTime;
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

// --- Mini sprite builders for log entries ---
function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function makePlayerChip(name, extra = '') {
  const c = elem('span', 'player-chip ' + extra, name || '');
  return c;
}

function makeMiniCardBack() {
  return elem('span', 'mini-card-back');
}

function makeMiniLiarsCard(name) {
  const c = elem('span', `mini-liars-card mc-${(name || '').toLowerCase()}`);
  c.textContent = name === 'Joker' ? '★' : (name || '?').charAt(0);
  return c;
}

function makeMiniPokerCard(card) {
  if (!card) return elem('span', 'mini-poker-card');
  if (card.joker) {
    const c = elem('span', 'mini-poker-card joker', '★');
    return c;
  }
  const c = elem('span', `mini-poker-card suit-${(card.suit || '').toLowerCase()}`);
  c.innerHTML = `<span class="mpc-rank">${rankName(card.rank)}</span><span class="mpc-suit">${SUITS_POKER[card.suit] || ''}</span>`;
  return c;
}

function makeRankChip(rank) {
  return elem('span', 'rank-chip', rankName(rank) + 's');
}

function makeRevolverIcon(opts = {}) {
  const div = elem('span', 'revolver-icon' + (opts.smoke ? ' smoke' : '') + (opts.fired ? ' fired' : ''));
  div.innerHTML = `<svg viewBox="0 0 32 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="10" y="7.5" width="13" height="2.5" fill="#3a3a3a" stroke="#1a1a1a" stroke-width="0.3"/>
    <rect x="22.5" y="6.8" width="2.5" height="4" fill="#222"/>
    <circle cx="6" cy="9" r="4.6" fill="#5a5a5a" stroke="#1a1a1a" stroke-width="0.5"/>
    <circle cx="6" cy="9" r="3.4" fill="#3a3a3a"/>
    <circle cx="4.4" cy="7.4" r="0.55" fill="#0a0604"/>
    <circle cx="7.6" cy="7.4" r="0.55" fill="#0a0604"/>
    <circle cx="4.4" cy="10.6" r="0.55" fill="#0a0604"/>
    <circle cx="7.6" cy="10.6" r="0.55" fill="#0a0604"/>
    <circle cx="6" cy="9" r="0.7" fill="#0a0604"/>
    <path d="M 4.8 13 L 8.2 13 L 9 16 L 4 16 Z" fill="#6b4423" stroke="#3a2010" stroke-width="0.3"/>
  </svg>`;
  return div;
}

function makeChamberRow(chambersLeft, total = 6) {
  const row = elem('span', 'log-chamber-row');
  const fired = total - chambersLeft;
  for (let i = 0; i < total; i++) {
    row.appendChild(elem('span', 'log-chamber-dot' + (i < fired ? ' fired' : '')));
  }
  return row;
}

function makeLogEntry(entry) {
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.type}`;
  const data = entry.data || {};

  switch (entry.type) {
    case 'round': {
      const n = data.round || (entry.msg.match(/\d+/) || ['?'])[0];
      div.appendChild(elem('span', 'log-round-banner', `Round ${n}`));
      break;
    }
    case 'round-info': {
      if (data.mode === 'cards' && data.tableCard) {
        div.appendChild(elem('span', 'log-mini-label', 'Table card'));
        div.appendChild(makeMiniLiarsCard(data.tableCard));
      } else if (data.mode === 'poker' && data.targetRank) {
        div.appendChild(elem('span', 'log-mini-label', 'Target'));
        div.appendChild(makeRankChip(data.targetRank));
      } else if (data.mode === 'dice') {
        div.appendChild(elem('span', 'log-mini-label', 'Dice rolled'));
        const tray = elem('span', 'log-cards-row');
        tray.appendChild(makeDie(2));
        tray.appendChild(makeDie(5));
        tray.appendChild(makeDie(3));
        div.appendChild(tray);
      } else {
        div.appendChild(elem('span', 'log-mini-text', entry.msg));
      }
      break;
    }
    case 'event': {
      div.appendChild(elem('span', 'log-event-banner', entry.msg));
      break;
    }
    case 'turn': {
      div.appendChild(makePlayerChip(data.player || ''));
      div.appendChild(elem('span', 'log-arrow', '▸'));
      div.appendChild(elem('span', 'log-mini-text', 'to act'));
      break;
    }
    case 'play': {
      div.appendChild(makePlayerChip(data.player || ''));
      div.appendChild(elem('span', 'log-arrow', '▸'));
      if (data.mode === 'dice') {
        div.appendChild(elem('span', 'log-mini-text', 'bids'));
        div.appendChild(elem('span', 'log-qty', String(data.qty)));
        div.appendChild(elem('span', 'log-mult', '×'));
        div.appendChild(makeDie(data.face));
        if (data.face === 1) div.appendChild(elem('span', 'log-wild', 'WILD'));
      } else if (data.mode === 'cards') {
        const tray = elem('span', 'log-cards-row');
        for (let i = 0; i < Math.min(data.count || 1, 3); i++) tray.appendChild(makeMiniCardBack());
        div.appendChild(tray);
        div.appendChild(elem('span', 'log-mini-text', 'as'));
        div.appendChild(makeMiniLiarsCard(data.tableCard));
      } else if (data.mode === 'poker') {
        const tray = elem('span', 'log-cards-row');
        for (let i = 0; i < Math.min(data.count || 1, 3); i++) tray.appendChild(makeMiniCardBack());
        div.appendChild(tray);
        div.appendChild(elem('span', 'log-mini-text', 'as'));
        div.appendChild(makeRankChip(data.targetRank));
      }
      break;
    }
    case 'liar': {
      div.appendChild(makePlayerChip(data.caller || '', 'log-player-caller'));
      const center = elem('span', 'log-liar-center');
      center.innerHTML = `<span class="liar-bolt log-icon">⚡</span><span class="log-liar-text">LIAR</span><span class="liar-bolt log-icon">⚡</span>`;
      div.appendChild(center);
      div.appendChild(makePlayerChip(data.accused || '', 'log-player-accused'));
      break;
    }
    case 'spoton': {
      div.appendChild(makePlayerChip(data.caller || '', 'log-player-caller'));
      const center = elem('span', 'log-spoton-center');
      center.innerHTML = `<span class="spoton-target log-icon">🎯</span><span class="log-spoton-text">SPOT ON</span>`;
      div.appendChild(center);
      div.appendChild(makePlayerChip(data.accused || '', 'log-player-accused'));
      break;
    }
    case 'verdict-truth':
    case 'verdict-lie': {
      const truth = entry.type === 'verdict-truth';
      div.appendChild(elem('span', 'log-verdict-tag ' + (truth ? 'truth' : 'lie'), truth ? 'TRUTH' : 'LIE'));
      if (data.mode === 'dice') {
        const body = elem('span', 'log-verdict-body');
        body.appendChild(elem('span', 'log-qty', String(data.qty)));
        body.appendChild(elem('span', 'log-mult', '×'));
        body.appendChild(makeDie(data.face));
        body.appendChild(elem('span', 'log-eq', '='));
        body.appendChild(elem('span', 'log-num', String(data.count)));
        div.appendChild(body);
      } else if (data.mode === 'cards' && Array.isArray(data.cards)) {
        const tray = elem('span', 'log-cards-row');
        for (const c of data.cards) tray.appendChild(makeMiniLiarsCard(c));
        div.appendChild(tray);
      } else if (data.mode === 'poker' && Array.isArray(data.cards)) {
        const tray = elem('span', 'log-cards-row');
        for (const c of data.cards) tray.appendChild(makeMiniPokerCard(c));
        div.appendChild(tray);
      } else {
        div.appendChild(elem('span', 'log-verdict-body', entry.msg));
      }
      break;
    }
    case 'tension': {
      div.appendChild(makeRevolverIcon());
      div.appendChild(makePlayerChip(data.player || ''));
      div.appendChild(elem('span', 'log-tension-dots', '…'));
      break;
    }
    case 'dead': {
      div.appendChild(makeRevolverIcon({ fired: true }));
      div.appendChild(elem('span', 'log-bang-text', 'BANG'));
      div.appendChild(makePlayerChip(data.player || '', 'log-player-dead'));
      div.appendChild(elem('span', 'log-dead-x', '✕'));
      break;
    }
    case 'survive': {
      div.appendChild(makeRevolverIcon({ smoke: true }));
      div.appendChild(elem('span', 'log-click-text', '*click*'));
      div.appendChild(makePlayerChip(data.player || ''));
      div.appendChild(makeChamberRow(data.chambersLeft || 0));
      break;
    }
    case 'win': {
      div.appendChild(elem('span', 'log-icon log-trophy', '🏆'));
      div.appendChild(makePlayerChip(data.player || '', 'log-player-winner'));
      div.appendChild(elem('span', 'log-win-text', 'wins the bar'));
      break;
    }
    case 'system':
    default: {
      div.appendChild(elem('span', 'log-system-text', entry.msg));
    }
  }
  return div;
}

function renderGameOver() {
  const winner = state.players.find(p => p.alive);
  $('winner').innerHTML = winner ? `🏆 ${escapeHtml(winner.name)} wins!` : 'No survivors.';
  $('btn-new-game').style.display = (state.yourId === state.hostId) ? 'inline-block' : 'none';
}

// ============================================================
// OVERLAYS
// ============================================================

function showReveal(data) {
  const overlay = $('reveal-overlay');
  const body = $('reveal-body');
  const title = $('reveal-title');
  body.innerHTML = '';
  title.textContent = data.callType === 'spoton' ? 'SPOT ON CALLED!' : 'LIAR CALLED!';
  title.classList.toggle('spot', data.callType === 'spoton');

  if (data.mode === 'cards') {
    const row = document.createElement('div');
    row.className = 'reveal-cards-row';
    for (const c of data.cards) row.appendChild(makeLiarsCard(c, { disabled: true }));
    body.appendChild(row);
    $('reveal-verdict').textContent = data.truthful
      ? `All ${data.tableCard}s or Jokers — truthful.`
      : `Not all ${data.tableCard}s — LIE.`;
  } else if (data.mode === 'dice') {
    const summary = document.createElement('div');
    summary.className = 'reveal-summary';
    summary.innerHTML = `Bid: <b>${data.qty} × ${data.face}</b> &nbsp;·&nbsp; Found: <b>${data.count}</b>`;
    body.appendChild(summary);
    const grid = document.createElement('div');
    grid.className = 'reveal-dice-grid';
    for (const pdata of data.allDice) {
      const block = document.createElement('div');
      block.className = 'reveal-player-block';
      const nm = document.createElement('div');
      nm.className = 'rev-name';
      nm.textContent = pdata.name;
      block.appendChild(nm);
      const dt = document.createElement('div');
      dt.className = 'dice-tray small';
      for (const d of pdata.dice) {
        dt.appendChild(makeDie(d, { highlight: (d === data.face || (d === 1 && data.face !== 1)), dim: !(d === data.face || (d === 1 && data.face !== 1)) }));
      }
      block.appendChild(dt);
      grid.appendChild(block);
    }
    body.appendChild(grid);
    if (data.callType === 'spoton') {
      $('reveal-verdict').textContent = data.exact ? 'Exact hit — bidder pulls the trigger.' : `Off by ${Math.abs(data.count - data.qty)} — caller pulls the trigger.`;
    } else {
      $('reveal-verdict').textContent = data.bidMet ? 'Bid stands — challenger loses.' : 'Bid busts — bidder loses.';
    }
  } else if (data.mode === 'poker') {
    const summary = document.createElement('div');
    summary.className = 'reveal-summary';
    summary.innerHTML = `Target rank: <b>${rankName(data.targetRank)}</b>`;
    body.appendChild(summary);
    const row = document.createElement('div');
    row.className = 'reveal-cards-row';
    for (const c of data.cards) row.appendChild(makePokerCard(c, { disabled: true, flipped: true }));
    body.appendChild(row);
    $('reveal-verdict').textContent = data.truthful
      ? `All ${rankName(data.targetRank)}s or Jokers — truthful.`
      : `Not all ${rankName(data.targetRank)}s — LIE.`;
  }

  overlay.style.display = 'flex';
  const dur = (data.mode === 'cards') ? 2500 : 3500;
  setTimeout(() => { overlay.style.display = 'none'; }, dur);
}

function showShot(data) {
  const overlay = $('shot-overlay');
  const box = $('shot-box');
  if (data.died) {
    box.className = 'shot-box';
    box.textContent = '💥 BANG!';
  } else {
    box.className = 'shot-box click';
    box.textContent = '*click*';
  }
  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; }, 1800);
}

// initialize controls
renderDiceControls();
