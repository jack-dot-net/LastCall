const socket = io();
let state = null;
let selectedCards = new Set();
let revealActive = false;

const SUITS = { King: '♛', Queen: '♕', Ace: '♠', Joker: '★' };

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

function loadName() {
  try { return localStorage.getItem('liarsbar.name') || ''; } catch { return ''; }
}
function saveName(n) {
  try { localStorage.setItem('liarsbar.name', n); } catch {}
}

const savedName = loadName();
if (savedName) $('name-input').value = savedName;

/* ───── MENU ───── */
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

$('room-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});
$('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});

/* ───── LOBBY ───── */
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

/* ───── GAME ───── */
$('btn-play').onclick = () => {
  const indices = [...selectedCards];
  if (indices.length < 1 || indices.length > 3) {
    toast('Select 1–3 cards.');
    return;
  }
  socket.emit('playCards', { indices });
  selectedCards.clear();
};

$('btn-liar').onclick = () => {
  socket.emit('callLiar');
};

/* ───── GAME OVER ───── */
$('btn-new-game').onclick = () => socket.emit('resetGame');
$('btn-back-menu').onclick = () => {
  socket.emit('leaveRoom');
  state = null;
  showScreen('menu');
};

/* ───── SOCKET EVENTS ───── */
socket.on('connect_error', () => toast('Connection lost. Refresh.'));
socket.on('errorMsg', (msg) => toast(msg));

socket.on('roomJoined', () => { /* roomUpdate follows */ });

socket.on('roomUpdate', (s) => {
  state = s;
  render();
});

socket.on('reveal', (data) => {
  showReveal(data);
});

socket.on('shot', (data) => {
  showShot(data);
});

/* ───── RENDER ───── */
function render() {
  if (!state) return;
  if (state.state === 'lobby') {
    showScreen('lobby');
    renderLobby();
  } else if (state.state === 'playing') {
    showScreen('game');
    renderGame();
  } else if (state.state === 'finished') {
    showScreen('gameover');
    renderGameOver();
  }
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
  const isHost = state.yourId === state.hostId;
  $('btn-start').style.display = isHost ? 'inline-block' : 'none';
  $('btn-start').disabled = state.players.length < 2;
  $('lobby-hint').textContent = isHost
    ? (state.players.length < 2 ? 'Waiting for more players to join…' : 'Ready when you are.')
    : 'Waiting for the host to start.';
}

function renderGame() {
  const me = state.players.find(p => p.id === state.yourId);
  const myIdx = state.players.findIndex(p => p.id === state.yourId);
  const myTurn = (myIdx === state.currentPlayerIdx) && me && me.alive;
  const current = state.players[state.currentPlayerIdx];

  // Players
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

    div.innerHTML = `
      <div class="player-name">${escapeHtml(p.name)}${p.id === state.yourId ? ' (you)' : ''}</div>
      <div class="player-cards">🂠 × ${p.handSize}</div>
      <div class="player-gun">${chambersHtml}</div>
      ${!p.alive ? '<div class="player-status-dead">💀</div>' : ''}
    `;
    pa.appendChild(div);
  }

  // Table
  $('table-card').textContent = state.tableCard ? state.tableCard.toUpperCase() : '?';
  $('pile-info').textContent = state.lastPlayedCount > 0
    ? `${state.lastPlayedCount} card${state.lastPlayedCount > 1 ? 's' : ''} face down`
    : 'No cards played yet';
  $('turn-info').textContent = current
    ? (myTurn ? 'Your turn.' : `Waiting for ${current.name}…`)
    : '';

  // Hand
  const hand = $('hand-area');
  hand.innerHTML = '';
  const handCards = state.yourHand || [];
  if (handCards.length === 0 && me && me.alive) {
    hand.innerHTML = '<div style="opacity:0.6; font-style:italic; align-self:center;">Hand empty — you must call LIAR.</div>';
  }
  for (let i = 0; i < handCards.length; i++) {
    const card = handCards[i];
    const div = document.createElement('div');
    const selected = selectedCards.has(i);
    div.className = `card card-${card.toLowerCase()}${selected ? ' selected' : ''}${myTurn ? '' : ' disabled'}`;
    div.innerHTML = `<div class="card-rank">${card.toUpperCase()}</div><div class="card-suit">${SUITS[card] || ''}</div>`;
    div.onclick = () => {
      if (!myTurn) return;
      if (selectedCards.has(i)) selectedCards.delete(i);
      else if (selectedCards.size < 3) selectedCards.add(i);
      else toast('Max 3 cards.');
      renderGame();
    };
    hand.appendChild(div);
  }

  // Actions
  const canPlay = myTurn && selectedCards.size > 0 && selectedCards.size <= 3 && handCards.length > 0;
  const canLiar = myTurn && state.lastPlayedCount > 0 && state.lastPlayerIdx !== null;
  $('btn-play').disabled = !canPlay;
  $('btn-liar').disabled = !canLiar;

  // Log
  const log = $('log');
  log.innerHTML = '';
  for (const entry of state.log.slice(-20)) {
    const div = document.createElement('div');
    div.textContent = entry.msg;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

function renderGameOver() {
  const winner = state.players.find(p => p.alive);
  $('winner').innerHTML = winner
    ? `🏆 ${escapeHtml(winner.name)} wins!`
    : 'No survivors.';
  $('btn-new-game').style.display = (state.yourId === state.hostId) ? 'inline-block' : 'none';
}

/* ───── OVERLAYS ───── */
function showReveal(data) {
  revealActive = true;
  const overlay = $('reveal-overlay');
  const cardsEl = $('reveal-cards');
  cardsEl.innerHTML = '';
  for (const c of data.cards) {
    const div = document.createElement('div');
    div.className = `card card-${c.toLowerCase()}`;
    div.style.cursor = 'default';
    div.innerHTML = `<div class="card-rank">${c.toUpperCase()}</div><div class="card-suit">${SUITS[c] || ''}</div>`;
    cardsEl.appendChild(div);
  }
  $('reveal-verdict').textContent = data.truthful
    ? `Truthful! All were ${data.tableCard}s or Jokers.`
    : `LIE! Not all were ${data.tableCard}s or Jokers.`;
  overlay.style.display = 'flex';

  setTimeout(() => {
    overlay.style.display = 'none';
    revealActive = false;
  }, 2500);
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

  setTimeout(() => {
    overlay.style.display = 'none';
  }, 1800);
}
