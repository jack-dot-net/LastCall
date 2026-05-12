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
const MODE_LABELS = { cards: "Liar's Cards", dice: "Liar's Dice", poker: 'Bluff Poker' };
const HAND_TYPE_LABELS = {
  pair: 'Pair', twopair: 'Two Pair', three: 'Three of a Kind',
  straight: 'Straight', flush: 'Flush', fullhouse: 'Full House',
  quads: 'Four of a Kind', straightflush: 'Straight Flush'
};
const HAND_TYPE_RANK_RANGE = {
  pair: [2, 14], twopair: [3, 14], three: [2, 14],
  straight: [5, 14], flush: [0, 0], fullhouse: [2, 14],
  quads: [2, 14], straightflush: [0, 0],
};
const HAND_TYPE_BASE = {
  pair: 0, twopair: 13, three: 24, straight: 37,
  flush: 47, fullhouse: 48, quads: 61, straightflush: 74
};

function $(id) { return document.getElementById(id); }
function showScreen(name) {
  for (const s of ['menu', 'lobby', 'game', 'gameover']) {
    $('screen-' + s).classList.toggle('active', s === name);
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
function declarationValue(type, rank) {
  const b = HAND_TYPE_BASE[type];
  if (b === undefined) return -1;
  if (type === 'flush' || type === 'straightflush') return b;
  if (type === 'twopair') return b + (rank - 3);
  if (type === 'straight') return b + (rank - 5);
  return b + (rank - 2);
}
function formatDeclaration(type, rank) {
  switch (type) {
    case 'pair': return `Pair of ${rankName(rank)}s`;
    case 'twopair': return `Two pair, ${rankName(rank)}s high`;
    case 'three': return `Three ${rankName(rank)}s`;
    case 'straight': return `Straight to ${rankName(rank)}`;
    case 'flush': return 'Flush';
    case 'fullhouse': return `Full house, ${rankName(rank)}s full`;
    case 'quads': return `Four ${rankName(rank)}s`;
    case 'straightflush': return 'Straight flush';
    default: return '?';
  }
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
  const suitClass = `suit-${card.suit.toLowerCase()}`;
  div.className = `poker-card ${suitClass}` + (opts.selected ? ' selected' : '') + (opts.flipped ? ' flipped' : '');
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
}

// ============================================================
// GAME — POKER
// ============================================================

$('decl-type').onchange = () => { updatePokerRankOptions(); updatePokerButtons(); };
$('decl-rank').onchange = updatePokerButtons;
$('btn-declare').onclick = () => {
  const type = $('decl-type').value;
  const [rMin] = HAND_TYPE_RANK_RANGE[type];
  const rank = rMin > 0 ? parseInt($('decl-rank').value) : 0;
  socket.emit('gameAction', { action: 'play', payload: { type, rank } });
};
$('btn-liar-poker').onclick = () => socket.emit('gameAction', { action: 'liar' });

function updatePokerRankOptions() {
  const type = $('decl-type').value;
  const [rMin, rMax] = HAND_TYPE_RANK_RANGE[type];
  const sel = $('decl-rank');
  sel.innerHTML = '';
  if (rMin === 0) {
    sel.disabled = true;
    const opt = document.createElement('option');
    opt.textContent = '—';
    opt.value = '0';
    sel.appendChild(opt);
  } else {
    sel.disabled = false;
    for (let r = rMin; r <= rMax; r++) {
      const opt = document.createElement('option');
      opt.value = String(r);
      opt.textContent = rankName(r);
      sel.appendChild(opt);
    }
    sel.value = String(rMin);
  }
}

function setDefaultPokerDeclaration() {
  if (!state) return;
  if (state.lastDeclaration) {
    const v = declarationValue(state.lastDeclaration.type, state.lastDeclaration.rank);
    // Find the next valid declaration
    for (const type of ['pair','twopair','three','straight','flush','fullhouse','quads','straightflush']) {
      const [rMin, rMax] = HAND_TYPE_RANK_RANGE[type];
      if (rMin === 0) {
        if (declarationValue(type, 0) > v) {
          $('decl-type').value = type;
          updatePokerRankOptions();
          return;
        }
      } else {
        for (let r = rMin; r <= rMax; r++) {
          if (declarationValue(type, r) > v) {
            $('decl-type').value = type;
            updatePokerRankOptions();
            $('decl-rank').value = String(r);
            return;
          }
        }
      }
    }
  } else {
    $('decl-type').value = 'pair';
    updatePokerRankOptions();
    $('decl-rank').value = '2';
  }
}

function updatePokerButtons() {
  const myIdx = state ? state.players.findIndex(p => p.id === state.yourId) : -1;
  const myTurn = state && myIdx === state.currentPlayerIdx && state.players[myIdx]?.alive;
  const type = $('decl-type').value;
  const [rMin] = HAND_TYPE_RANK_RANGE[type];
  const rank = rMin > 0 ? parseInt($('decl-rank').value) : 0;
  let legal = true;
  if (state?.lastDeclaration) {
    legal = declarationValue(type, rank) > declarationValue(state.lastDeclaration.type, state.lastDeclaration.rank);
  }
  $('btn-declare').disabled = !myTurn || !legal;
  $('btn-liar-poker').disabled = !myTurn || !state?.lastDeclaration;
}

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
    poker: 'Declare a poker hand that exists somewhere in everyone\'s combined cards.',
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
    const dec = document.createElement('div');
    dec.className = 'decl-display';
    dec.innerHTML = `<div class="ctr-label">CURRENT DECLARATION</div><div class="ctr-value">${state.lastDeclaration ? formatDeclaration(state.lastDeclaration.type, state.lastDeclaration.rank) : '—'}</div>`;
    cd.appendChild(dec);
    const pl = document.createElement('div');
    pl.className = 'pile-info';
    const pool = state.players.filter(p => p.alive).reduce((s, p) => s + p.handSize, 0);
    pl.textContent = `${pool} cards in the combined pool`;
    cd.appendChild(pl);
  }

  $('turn-info').textContent = current
    ? (myTurn ? 'Your turn.' : `Waiting for ${current.name}…`)
    : '';
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
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = myIdx === state.currentPlayerIdx && state.players[myIdx]?.alive;
  const pa = $('poker-hand-area');
  pa.innerHTML = '';
  const myHand = state.yourHand || [];
  const lbl = document.createElement('div');
  lbl.className = 'your-label';
  lbl.textContent = myHand.length ? 'Your cards (hidden from others):' : 'No cards — you are out.';
  pa.appendChild(lbl);
  const tray = document.createElement('div');
  tray.className = 'poker-tray';
  for (const c of myHand) tray.appendChild(makePokerCard(c));
  pa.appendChild(tray);

  if (myTurn && (!$('decl-rank').options.length || $('decl-rank').disabled)) {
    updatePokerRankOptions();
  }
  if (myTurn) setDefaultPokerDeclaration();
  updatePokerButtons();
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

function makeLogEntry(entry) {
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.type}`;
  const data = entry.data || {};

  switch (entry.type) {
    case 'round': {
      div.innerHTML = `<span class="log-round-text">${escapeHtml(entry.msg)}</span>`;
      break;
    }
    case 'round-info': {
      const inner = document.createElement('div');
      inner.className = 'log-round-info';
      if (data.tableCard) {
        const lbl = document.createElement('span');
        lbl.className = 'log-label';
        lbl.textContent = 'Table card';
        inner.appendChild(lbl);
        const val = document.createElement('span');
        val.className = `log-tablecard tc-${data.tableCard.toLowerCase()}`;
        val.textContent = data.tableCard;
        inner.appendChild(val);
      } else {
        inner.textContent = entry.msg;
      }
      div.appendChild(inner);
      break;
    }
    case 'event': {
      div.innerHTML = `<span class="log-event-text">${escapeHtml(entry.msg)}</span>`;
      break;
    }
    case 'turn': {
      div.innerHTML = `<span class="log-icon">▸</span> <span class="log-turn-text">${escapeHtml(entry.msg)}</span>`;
      break;
    }
    case 'play': {
      const ico = document.createElement('span');
      ico.className = 'log-icon';
      ico.textContent = data.mode === 'dice' ? '🎲' : (data.mode === 'poker' ? '♠' : '🂠');
      div.appendChild(ico);
      const pn = document.createElement('span');
      pn.className = 'log-player';
      pn.textContent = data.player || '';
      div.appendChild(pn);
      const body = document.createElement('span');
      body.className = 'log-body';
      if (data.mode === 'dice') {
        body.innerHTML = ' bids ';
        const qty = document.createElement('span');
        qty.className = 'log-num';
        qty.textContent = data.qty;
        body.appendChild(qty);
        body.appendChild(document.createTextNode(' × '));
        body.appendChild(makeDie(data.face));
        if (data.face === 1) {
          const w = document.createElement('span');
          w.className = 'log-wild';
          w.textContent = 'WILD';
          body.appendChild(w);
        }
      } else if (data.mode === 'cards') {
        body.innerHTML = ` plays <span class="log-num">${data.count}</span> as `;
        const tc = document.createElement('span');
        tc.className = `log-tablecard tc-${(data.tableCard || '').toLowerCase()}`;
        tc.textContent = data.tableCard + (data.count > 1 ? 's' : '');
        body.appendChild(tc);
      } else if (data.mode === 'poker') {
        body.innerHTML = ` declares <span class="log-decl">${escapeHtml(data.declaration)}</span>`;
      } else {
        body.textContent = ' ' + (entry.msg.split(' ').slice(1).join(' '));
      }
      div.appendChild(body);
      break;
    }
    case 'liar': {
      const ico = document.createElement('span');
      ico.className = 'log-icon liar-bolt';
      ico.textContent = '⚡';
      div.appendChild(ico);
      const caller = document.createElement('span');
      caller.className = 'log-player';
      caller.textContent = data.caller || '';
      div.appendChild(caller);
      const middle = document.createElement('span');
      middle.className = 'log-liar-text';
      middle.textContent = ' calls LIAR on ';
      div.appendChild(middle);
      const accused = document.createElement('span');
      accused.className = 'log-player';
      accused.textContent = data.accused || '';
      div.appendChild(accused);
      div.appendChild(document.createTextNode('!'));
      break;
    }
    case 'verdict-truth':
    case 'verdict-lie': {
      const tag = document.createElement('span');
      tag.className = 'log-verdict-tag ' + (entry.type === 'verdict-truth' ? 'truth' : 'lie');
      tag.textContent = entry.type === 'verdict-truth' ? 'TRUTH' : 'LIE';
      div.appendChild(tag);
      const body = document.createElement('span');
      body.className = 'log-body';
      body.textContent = ' ' + entry.msg;
      div.appendChild(body);
      break;
    }
    case 'tension': {
      div.innerHTML = `<span class="log-icon">🔫</span> <span class="log-tension-text">${escapeHtml(entry.msg)}</span>`;
      break;
    }
    case 'dead': {
      const ico = document.createElement('span');
      ico.className = 'log-icon log-bang-icon';
      ico.textContent = '💥';
      div.appendChild(ico);
      const text = document.createElement('span');
      text.className = 'log-bang-text';
      text.innerHTML = `BANG — <span class="log-player">${escapeHtml(data.player || '')}</span> is dead.`;
      div.appendChild(text);
      break;
    }
    case 'survive': {
      const ico = document.createElement('span');
      ico.className = 'log-icon';
      ico.textContent = '•';
      div.appendChild(ico);
      const text = document.createElement('span');
      text.className = 'log-survive-text';
      text.innerHTML = `<i>click</i> — <span class="log-player">${escapeHtml(data.player || '')}</span> survives. <span class="log-chambers-left">${data.chambersLeft || 0} left</span>`;
      div.appendChild(text);
      break;
    }
    case 'win': {
      const ico = document.createElement('span');
      ico.className = 'log-icon log-trophy';
      ico.textContent = '🏆';
      div.appendChild(ico);
      const text = document.createElement('span');
      text.className = 'log-win-text';
      text.innerHTML = `<span class="log-player">${escapeHtml(data.player || '')}</span> wins the bar!`;
      div.appendChild(text);
      break;
    }
    case 'system':
    default: {
      const text = document.createElement('span');
      text.className = 'log-system-text';
      text.textContent = entry.msg;
      div.appendChild(text);
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
  body.innerHTML = '';

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
    $('reveal-verdict').textContent = data.bidMet ? 'Bid stands — challenger loses.' : 'Bid busts — bidder loses.';
  } else if (data.mode === 'poker') {
    const summary = document.createElement('div');
    summary.className = 'reveal-summary';
    summary.innerHTML = `Declaration: <b>${formatDeclaration(data.type, data.rank)}</b>`;
    body.appendChild(summary);
    const grid = document.createElement('div');
    grid.className = 'reveal-hands-grid';
    for (const pdata of data.allHands) {
      const block = document.createElement('div');
      block.className = 'reveal-player-block';
      const nm = document.createElement('div');
      nm.className = 'rev-name';
      nm.textContent = pdata.name;
      block.appendChild(nm);
      const tray = document.createElement('div');
      tray.className = 'poker-tray small';
      for (const c of pdata.hand) tray.appendChild(makePokerCard(c, { flipped: true }));
      block.appendChild(tray);
      grid.appendChild(block);
    }
    body.appendChild(grid);
    $('reveal-verdict').textContent = data.exists ? 'Hand exists in pool — truthful.' : 'Hand not in pool — LIE.';
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
updatePokerRankOptions();
renderDiceControls();
