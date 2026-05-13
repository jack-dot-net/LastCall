const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const rooms = new Map();
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 12;
const MIN_PLAYERS = 2;

// ============================================================
// SHARED HELPERS
// ============================================================

function genRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addLog(room, msg, type = 'info', data = null) {
  const entry = { time: Date.now(), msg, type };
  if (data) entry.data = data;
  room.log.push(entry);
  if (room.log.length > 200) room.log.shift();
}

function nextAlivePlayer(room, fromIdx) {
  const n = room.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIdx + step) % n;
    if (room.players[i].alive) return i;
  }
  return -1;
}

function sanitizeName(name) {
  name = String(name || '').replace(/[<>]/g, '').slice(0, 16).trim();
  return name || 'Player';
}

function pickRandomAlive(room) {
  const alive = room.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
  return alive[Math.floor(Math.random() * alive.length)];
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    alive: p.alive,
    disconnected: p.disconnected,
    chambers: p.chambers,
    shotsFired: p.shotsFired,
    handSize: p.hand ? p.hand.length : 0,
    diceCount: p.dice ? p.dice.length : 0,
  };
}

function getRoomState(room, viewerId) {
  const me = room.players.find(p => p.id === viewerId);
  const base = {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    gameMode: room.gameMode,
    players: room.players.map(publicPlayer),
    log: room.log.slice(-30),
    yourId: viewerId,
    roundNumber: room.roundNumber,
    currentPlayerIdx: room.currentPlayerIdx,
    lastActorIdx: room.lastActorIdx,
    resolving: room.resolving,
  };
  if (room.gameMode === 'cards') {
    base.tableCard = room.tableCard;
    base.lastPlayedCount = room.lastPlayedCards ? room.lastPlayedCards.length : 0;
    base.yourHand = me ? (me.hand || []) : [];
  } else if (room.gameMode === 'dice') {
    base.lastBid = room.lastBid;
    base.yourDice = me ? (me.dice || []) : [];
    base.totalDiceInPlay = room.players.filter(p => p.alive).reduce((s, p) => s + (p.dice ? p.dice.length : 0), 0);
  } else if (room.gameMode === 'poker') {
    base.targetRank = room.targetRank;
    base.lastPlayedCount = room.lastPlayedCards ? room.lastPlayedCards.length : 0;
    base.yourHand = me ? (me.hand || []) : [];
  }
  return base;
}

function broadcastRoom(room) {
  for (const p of room.players) {
    io.to(p.id).emit('roomUpdate', getRoomState(room, p.id));
  }
}

// ============================================================
// SHARED SHOT RESOLUTION
// ============================================================

function performShot(room, loserId, callerId, accusedId) {
  const loser = room.players.find(p => p.id === loserId);
  if (!loser) return;

  setTimeout(() => {
    const chamber = loser.shotsFired;
    loser.shotsFired++;
    const isBullet = (chamber === loser.bulletPos);

    if (isBullet) {
      loser.alive = false;
      addLog(room, `${loser.name} is dead.`, 'dead', { player: loser.name });
    } else {
      const left = loser.chambers - loser.shotsFired;
      addLog(room, `${loser.name} survives — ${left} chamber${left === 1 ? '' : 's'} left.`, 'survive', { player: loser.name, chambersLeft: left });
    }

    io.to(room.code).emit('shot', {
      playerId: loser.id,
      died: isBullet,
      shotsFired: loser.shotsFired,
      chambers: loser.chambers,
    });
    broadcastRoom(room);

    let nextStarter;
    if (loser.alive) {
      nextStarter = room.players.findIndex(p => p.id === loser.id);
    } else {
      const otherId = (loser.id === callerId) ? accusedId : callerId;
      nextStarter = room.players.findIndex(p => p.id === otherId);
      if (nextStarter < 0 || !room.players[nextStarter].alive) {
        nextStarter = nextAlivePlayer(room, nextStarter >= 0 ? nextStarter : 0);
      }
    }
    room.currentPlayerIdx = nextStarter;

    setTimeout(() => {
      room.resolving = false;
      const survivors = room.players.filter(p => p.alive);
      if (survivors.length <= 1) {
        room.state = 'finished';
        if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`, 'win', { player: survivors[0].name });
        broadcastRoom(room);
        return;
      }
      games[room.gameMode].startRound(room);
    }, 2800);
  }, 1800);
}

// ============================================================
// CARDS MODE
// ============================================================

const CARD_TYPES = ['King', 'Queen', 'Ace'];

function createCardsDeck(multiplier) {
  const deck = [];
  for (let m = 0; m < multiplier; m++) {
    for (let i = 0; i < 6; i++) deck.push('King');
    for (let i = 0; i < 6; i++) deck.push('Queen');
    for (let i = 0; i < 6; i++) deck.push('Ace');
    for (let i = 0; i < 2; i++) deck.push('Joker');
  }
  return deck;
}

const cardsGame = {
  name: 'cards',
  init(room) {
    room.tableCard = null;
    room.lastPlayedCards = null;
    room.lastActorIdx = null;
    room.currentPlayerIdx = null;
    room.roundNumber = 0;
    for (const p of room.players) { p.hand = []; p.dice = []; }
  },
  startRound(room) {
    const survivors = room.players.filter(p => p.alive);
    if (survivors.length <= 1) {
      room.state = 'finished';
      if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`, 'win');
      else addLog(room, 'No survivors.', 'system');
      broadcastRoom(room);
      return;
    }
    const multiplier = Math.max(1, Math.ceil(survivors.length / 4));
    const deck = shuffle(createCardsDeck(multiplier));
    let idx = 0;
    for (const p of room.players) {
      if (p.alive) { p.hand = deck.slice(idx, idx + 5); idx += 5; }
      else { p.hand = []; }
    }
    room.tableCard = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
    room.lastPlayedCards = null;
    room.lastActorIdx = null;
    room.roundNumber++;
    if (room.currentPlayerIdx === null || room.currentPlayerIdx < 0 || !room.players[room.currentPlayerIdx]?.alive) {
      room.currentPlayerIdx = pickRandomAlive(room);
    }
    addLog(room, `Round ${room.roundNumber}`, 'round');
    addLog(room, `Table card: ${room.tableCard}`, 'round-info', { tableCard: room.tableCard });
    addLog(room, `${room.players[room.currentPlayerIdx].name} starts.`, 'turn');
    broadcastRoom(room);
  },
  handlePlay(room, socket, { indices }) {
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    const player = room.players[playerIdx];
    if (!player.alive) return;
    if (!Array.isArray(indices) || indices.length < 1 || indices.length > 3) {
      return socket.emit('errorMsg', 'You must play 1–3 cards.');
    }
    const uniq = [...new Set(indices)].filter(i => Number.isInteger(i) && i >= 0 && i < player.hand.length);
    if (uniq.length !== indices.length) return socket.emit('errorMsg', 'Invalid selection.');
    uniq.sort((a, b) => b - a);
    const played = uniq.map(i => player.hand.splice(i, 1)[0]);
    room.lastPlayedCards = played;
    room.lastActorIdx = playerIdx;
    addLog(room, `${player.name} plays ${played.length} card${played.length > 1 ? 's' : ''} as ${room.tableCard}${played.length > 1 ? 's' : ''}.`, 'play', { player: player.name, mode: 'cards', count: played.length, tableCard: room.tableCard });
    room.currentPlayerIdx = nextAlivePlayer(room, playerIdx);
    broadcastRoom(room);
  },
  handleLiar(room, socket) {
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (room.lastPlayedCards === null || room.lastActorIdx === null) {
      return socket.emit('errorMsg', 'No one has played yet.');
    }
    const caller = room.players[callerIdx];
    const accused = room.players[room.lastActorIdx];
    const cards = room.lastPlayedCards;
    const tableCard = room.tableCard;
    const allMatch = cards.every(c => c === tableCard || c === 'Joker');
    const loser = allMatch ? caller : accused;

    addLog(room, `${caller.name} calls LIAR on ${accused.name}!`, 'liar', { caller: caller.name, accused: accused.name });
    addLog(room, `Cards: ${cards.join(', ')} — ${allMatch ? 'truth!' : 'lie!'}`, allMatch ? 'verdict-truth' : 'verdict-lie');
    addLog(room, `${loser.name} pulls the trigger…`, 'tension');

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'cards', cards, tableCard, truthful: allMatch,
      accusedId: accused.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, accused.id);
  },
};

// ============================================================
// DICE MODE
// ============================================================

function bidValue(qty, face) {
  return qty * 7 + face;
}

const diceGame = {
  name: 'dice',
  init(room) {
    room.lastBid = null;
    room.lastActorIdx = null;
    room.currentPlayerIdx = null;
    room.roundNumber = 0;
    for (const p of room.players) { p.dice = []; p.hand = []; }
  },
  startRound(room) {
    const survivors = room.players.filter(p => p.alive);
    if (survivors.length <= 1) {
      room.state = 'finished';
      if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`, 'win');
      broadcastRoom(room);
      return;
    }
    for (const p of room.players) {
      p.dice = p.alive ? Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6)) : [];
    }
    room.lastBid = null;
    room.lastActorIdx = null;
    room.roundNumber++;
    if (room.currentPlayerIdx === null || room.currentPlayerIdx < 0 || !room.players[room.currentPlayerIdx]?.alive) {
      room.currentPlayerIdx = pickRandomAlive(room);
    }
    addLog(room, `Round ${room.roundNumber}`, 'round');
    addLog(room, 'Dice rolled.', 'round-info', { event: 'dice-rolled' });
    addLog(room, `${room.players[room.currentPlayerIdx].name} starts the bidding.`, 'turn');
    broadcastRoom(room);
  },
  handlePlay(room, socket, { qty, face }) {
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    const player = room.players[playerIdx];
    if (!player.alive) return;
    qty = parseInt(qty);
    face = parseInt(face);
    if (!Number.isInteger(qty) || qty < 1) return socket.emit('errorMsg', 'Invalid quantity.');
    if (!Number.isInteger(face) || face < 1 || face > 6) return socket.emit('errorMsg', 'Invalid face.');

    const totalDice = room.players.filter(p => p.alive).reduce((s, p) => s + p.dice.length, 0);
    if (qty > totalDice) return socket.emit('errorMsg', `Only ${totalDice} dice in play.`);

    if (room.lastBid) {
      const prev = bidValue(room.lastBid.qty, room.lastBid.face);
      const next = bidValue(qty, face);
      if (next <= prev) return socket.emit('errorMsg', 'Bid must increase.');
    }

    room.lastBid = { qty, face, playerIdx };
    room.lastActorIdx = playerIdx;
    addLog(room, `${player.name} bids ${qty} × ${face}${face === 1 ? ' (wild)' : ''}.`, 'play', { player: player.name, mode: 'dice', qty, face });
    room.currentPlayerIdx = nextAlivePlayer(room, playerIdx);
    broadcastRoom(room);
  },
  handleLiar(room, socket) {
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (!room.lastBid) return socket.emit('errorMsg', 'No bid yet.');

    const caller = room.players[callerIdx];
    const bidder = room.players[room.lastBid.playerIdx];
    const { qty, face } = room.lastBid;

    let count = 0;
    const allDice = [];
    for (const p of room.players) {
      if (p.alive) {
        allDice.push({ playerId: p.id, name: p.name, dice: p.dice.slice() });
        for (const d of p.dice) {
          if (d === face || (d === 1 && face !== 1)) count++;
        }
      }
    }

    const bidMet = count >= qty;
    const loser = bidMet ? caller : bidder;

    addLog(room, `${caller.name} calls LIAR on ${bidder.name}!`, 'liar', { caller: caller.name, accused: bidder.name });
    addLog(room, `Bid ${qty} × ${face} — found ${count}. ${bidMet ? 'Bid stands!' : 'Bid busts!'}`, bidMet ? 'verdict-truth' : 'verdict-lie', { mode: 'dice', qty, face, count });
    addLog(room, `${loser.name} pulls the trigger…`, 'tension');

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'dice', callType: 'liar', qty, face, count, bidMet, allDice,
      bidderId: bidder.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, bidder.id);
  },
  handleSpotOn(room, socket) {
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (!room.lastBid) return socket.emit('errorMsg', 'No bid yet.');

    const caller = room.players[callerIdx];
    const bidder = room.players[room.lastBid.playerIdx];
    const { qty, face } = room.lastBid;

    let count = 0;
    const allDice = [];
    for (const p of room.players) {
      if (p.alive) {
        allDice.push({ playerId: p.id, name: p.name, dice: p.dice.slice() });
        for (const d of p.dice) {
          if (d === face || (d === 1 && face !== 1)) count++;
        }
      }
    }

    const exact = count === qty;
    const loser = exact ? bidder : caller;

    addLog(room, `${caller.name} calls SPOT ON on ${bidder.name}!`, 'spoton', { caller: caller.name, accused: bidder.name });
    addLog(room, `Bid ${qty} × ${face} — found ${count}. ${exact ? 'SPOT ON!' : 'Off — missed by ' + Math.abs(count - qty) + '.'}`, exact ? 'verdict-truth' : 'verdict-lie', { mode: 'dice', qty, face, count });
    addLog(room, `${loser.name} pulls the trigger…`, 'tension');

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'dice', callType: 'spoton', qty, face, count, exact, allDice,
      bidderId: bidder.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, bidder.id);
  },
};

// ============================================================
// POKER MODE — Liar's-Bar-style with 52-card deck
// ============================================================

function rankName(r) {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r);
}

function pokerCardLabel(c) {
  if (c && c.joker) return 'Joker';
  return `${rankName(c.rank)}${c.suit}`;
}

function createPokerDeck(numDecks) {
  const suits = ['S', 'H', 'D', 'C'];
  const deck = [];
  for (let n = 0; n < numDecks; n++) {
    for (const s of suits) {
      for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    }
    deck.push({ joker: true });
    deck.push({ joker: true });
  }
  return deck;
}

const pokerGame = {
  name: 'poker',
  init(room) {
    room.targetRank = null;
    room.lastPlayedCards = null;
    room.lastActorIdx = null;
    room.currentPlayerIdx = null;
    room.roundNumber = 0;
    for (const p of room.players) { p.hand = []; p.dice = []; }
  },
  startRound(room) {
    const survivors = room.players.filter(p => p.alive);
    if (survivors.length <= 1) {
      room.state = 'finished';
      if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`, 'win');
      broadcastRoom(room);
      return;
    }
    const cardsNeeded = survivors.length * 5;
    const numDecks = Math.max(1, Math.ceil(cardsNeeded / 54));
    const deck = shuffle(createPokerDeck(numDecks));
    let idx = 0;
    for (const p of room.players) {
      if (p.alive) { p.hand = deck.slice(idx, idx + 5); idx += 5; }
      else { p.hand = []; }
    }
    // Pick a random target rank for this round
    room.targetRank = 2 + Math.floor(Math.random() * 13);
    room.lastPlayedCards = null;
    room.lastActorIdx = null;
    room.roundNumber++;
    if (room.currentPlayerIdx === null || room.currentPlayerIdx < 0 || !room.players[room.currentPlayerIdx]?.alive) {
      room.currentPlayerIdx = pickRandomAlive(room);
    }
    addLog(room, `Round ${room.roundNumber}`, 'round');
    addLog(room, `Target rank: ${rankName(room.targetRank)}`, 'round-info', { targetRank: room.targetRank });
    addLog(room, `${room.players[room.currentPlayerIdx].name} starts.`, 'turn');
    broadcastRoom(room);
  },
  handlePlay(room, socket, { indices }) {
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    const player = room.players[playerIdx];
    if (!player.alive) return;
    if (!Array.isArray(indices) || indices.length < 1 || indices.length > 3) {
      return socket.emit('errorMsg', 'You must play 1–3 cards.');
    }
    const uniq = [...new Set(indices)].filter(i => Number.isInteger(i) && i >= 0 && i < player.hand.length);
    if (uniq.length !== indices.length) return socket.emit('errorMsg', 'Invalid selection.');
    uniq.sort((a, b) => b - a);
    const played = uniq.map(i => player.hand.splice(i, 1)[0]);
    room.lastPlayedCards = played;
    room.lastActorIdx = playerIdx;
    const tn = rankName(room.targetRank);
    addLog(room, `${player.name} plays ${played.length} card${played.length > 1 ? 's' : ''} as ${tn}${played.length > 1 ? 's' : ''}.`, 'play', { player: player.name, mode: 'poker', count: played.length, targetRank: room.targetRank });
    room.currentPlayerIdx = nextAlivePlayer(room, playerIdx);
    broadcastRoom(room);
  },
  handleLiar(room, socket) {
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (room.lastPlayedCards === null || room.lastActorIdx === null) {
      return socket.emit('errorMsg', 'No one has played yet.');
    }
    const caller = room.players[callerIdx];
    const accused = room.players[room.lastActorIdx];
    const cards = room.lastPlayedCards;
    const target = room.targetRank;
    const allMatch = cards.every(c => c.joker || c.rank === target);
    const loser = allMatch ? caller : accused;

    addLog(room, `${caller.name} calls LIAR on ${accused.name}!`, 'liar', { caller: caller.name, accused: accused.name });
    addLog(room, `Cards: ${cards.map(pokerCardLabel).join(', ')} — ${allMatch ? 'truth!' : 'lie!'}`, allMatch ? 'verdict-truth' : 'verdict-lie');
    addLog(room, `${loser.name} pulls the trigger…`, 'tension');

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'poker', cards, targetRank: target, truthful: allMatch,
      accusedId: accused.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, accused.id);
  },
};

// ============================================================
// CONNECTION HANDLING
// ============================================================

const games = { cards: cardsGame, dice: diceGame, poker: pokerGame };

io.on('connection', (socket) => {
  let currentRoomCode = null;
  const getRoom = () => currentRoomCode ? rooms.get(currentRoomCode) : null;

  function addPlayerToRoom(room, name) {
    socket.join(room.code);
    room.players.push({
      id: socket.id, name,
      alive: true, disconnected: false,
      chambers: 6, shotsFired: 0,
      bulletPos: Math.floor(Math.random() * 6),
      hand: [], dice: [],
    });
    addLog(room, `${name} entered the bar.`, 'system');
  }

  socket.on('createRoom', ({ name }) => {
    name = sanitizeName(name);
    const code = genRoomCode();
    const room = {
      code, hostId: socket.id, players: [],
      state: 'lobby', gameMode: 'cards',
      tableCard: null, lastPlayedCards: null,
      lastBid: null, targetRank: null,
      currentPlayerIdx: null, lastActorIdx: null,
      roundNumber: 0, log: [], resolving: false,
    };
    rooms.set(code, room);
    addPlayerToRoom(room, name);
    currentRoomCode = code;
    socket.emit('roomJoined', { code });
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    name = sanitizeName(name);
    const room = rooms.get(code);
    if (!room) return socket.emit('errorMsg', 'Room not found.');
    if (room.state !== 'lobby') return socket.emit('errorMsg', 'Game already in progress.');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('errorMsg', 'Room is full.');
    addPlayerToRoom(room, name);
    currentRoomCode = code;
    socket.emit('roomJoined', { code });
    broadcastRoom(room);
  });

  socket.on('setGameMode', ({ mode }) => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    if (!games[mode]) return;
    if (room.gameMode === mode) return;
    room.gameMode = mode;
    const labels = { cards: "Liar's Cards", dice: "Liar's Dice", poker: 'Bluff Poker' };
    addLog(room, `Mode set to ${labels[mode]}.`, 'system');
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = getRoom();
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('errorMsg', 'Only the host can start.');
    if (room.players.length < MIN_PLAYERS) return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players.`);
    if (room.state !== 'lobby') return;
    room.state = 'playing';
    for (const p of room.players) {
      p.alive = true;
      p.shotsFired = 0;
      p.bulletPos = Math.floor(Math.random() * 6);
    }
    const labels = { cards: "Liar's Cards", dice: "Liar's Dice", poker: 'Bluff Poker' };
    addLog(room, `${labels[room.gameMode]} — game start`, 'event');
    games[room.gameMode].init(room);
    games[room.gameMode].startRound(room);
  });

  socket.on('resetGame', () => {
    const room = getRoom();
    if (!room || room.hostId !== socket.id || room.state !== 'finished') return;
    room.state = 'lobby';
    for (const p of room.players) {
      p.alive = true;
      p.hand = [];
      p.dice = [];
      p.shotsFired = 0;
      p.disconnected = false;
    }
    room.tableCard = null;
    room.lastPlayedCards = null;
    room.lastBid = null;
    room.targetRank = null;
    room.currentPlayerIdx = null;
    room.lastActorIdx = null;
    room.roundNumber = 0;
    addLog(room, 'Back to lobby.', 'system');
    broadcastRoom(room);
  });

  socket.on('gameAction', ({ action, payload }) => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || room.resolving) return;
    const mode = games[room.gameMode];
    if (!mode) return;
    if (action === 'play') mode.handlePlay(room, socket, payload || {});
    else if (action === 'liar') mode.handleLiar(room, socket);
    else if (action === 'spoton' && mode.handleSpotOn) mode.handleSpotOn(room, socket);
  });

  socket.on('leaveRoom', () => handleLeave());
  socket.on('disconnect', () => handleLeave());

  function handleLeave() {
    const room = getRoom();
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    const player = room.players[idx];

    if (room.state === 'lobby' || room.state === 'finished') {
      room.players.splice(idx, 1);
      addLog(room, `${player.name} left.`, 'system');
      if (room.players.length === 0) {
        rooms.delete(room.code);
        currentRoomCode = null;
        return;
      }
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
        addLog(room, `${room.players[0].name} is now the host.`, 'system');
      }
      broadcastRoom(room);
    } else {
      player.disconnected = true;
      player.alive = false;
      addLog(room, `${player.name} disconnected.`, 'system');
      const survivors = room.players.filter(p => p.alive);
      if (survivors.length <= 1) {
        room.state = 'finished';
        if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`, 'win');
      } else if (idx === room.currentPlayerIdx) {
        room.currentPlayerIdx = nextAlivePlayer(room, idx);
      }
      broadcastRoom(room);
    }
    currentRoomCode = null;
  }
});

server.listen(PORT, () => {
  console.log(`Liar's Bar listening on port ${PORT}`);
});
