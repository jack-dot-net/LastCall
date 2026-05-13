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
    case 'spoton': {
      const ico = document.createElement('span');
      ico.className = 'log-icon spoton-target';
      ico.textContent = '🎯';
      div.appendChild(ico);
      const caller = document.createElement('span');
      caller.className = 'log-player';
      caller.textContent = data.caller || '';
      div.appendChild(caller);
      const middle = document.createElement('span');
      middle.className = 'log-spoton-text';
      middle.textContent = ' calls SPOT ON on ';
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
