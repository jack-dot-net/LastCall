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

function addLog(room, msg) {
  room.log.push({ time: Date.now(), msg });
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
    base.lastDeclaration = room.lastDeclaration;
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
      addLog(room, `💥 BANG. ${loser.name} is out.`);
    } else {
      const left = loser.chambers - loser.shotsFired;
      addLog(room, `*click* — ${loser.name} survives (${left} chamber${left === 1 ? '' : 's'} left).`);
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
        if (survivors.length === 1) addLog(room, `🏆 ${survivors[0].name} wins the bar!`);
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
      addLog(room, survivors.length === 1 ? `${survivors[0].name} wins the bar!` : 'No survivors.');
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
    addLog(room, `── Round ${room.roundNumber} ── Table card: ${room.tableCard}.`);
    addLog(room, `${room.players[room.currentPlayerIdx].name} starts.`);
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
    addLog(room, `${player.name} plays ${played.length} card${played.length > 1 ? 's' : ''} as ${room.tableCard}${played.length > 1 ? 's' : ''}.`);
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

    addLog(room, `${caller.name} calls LIAR on ${accused.name}!`);
    addLog(room, `Cards: ${cards.join(', ')} — ${allMatch ? 'truth!' : 'lie!'}`);
    addLog(room, `${loser.name} pulls the trigger…`);

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
      if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`);
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
    addLog(room, `── Round ${room.roundNumber} ── Dice rolled. ${room.players[room.currentPlayerIdx].name} starts the bidding.`);
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
    addLog(room, `${player.name} bids ${qty} × ${face}${face === 1 ? ' (wild)' : ''}.`);
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

    addLog(room, `${caller.name} calls LIAR on ${bidder.name}!`);
    addLog(room, `Bid: ${qty} × ${face}. Actual: ${count}. ${bidMet ? 'Bid stands!' : 'Bid busts!'}`);
    addLog(room, `${loser.name} pulls the trigger…`);

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'dice', qty, face, count, bidMet, allDice,
      bidderId: bidder.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, bidder.id);
  },
};

// ============================================================
// POKER MODE (Bluff Poker)
// ============================================================

const HAND_TYPES = ['pair', 'twopair', 'three', 'straight', 'flush', 'fullhouse', 'quads', 'straightflush'];
const HAND_TYPE_RANK_RANGE = {
  pair: [2, 14],
  twopair: [3, 14],
  three: [2, 14],
  straight: [5, 14],
  flush: [0, 0],
  fullhouse: [2, 14],
  quads: [2, 14],
  straightflush: [0, 0],
};

function declarationValue(type, rank) {
  const base = { pair: 0, twopair: 13, three: 24, straight: 37, flush: 47, fullhouse: 48, quads: 61, straightflush: 74 };
  const b = base[type];
  if (b === undefined) return -1;
  if (type === 'flush' || type === 'straightflush') return b;
  if (type === 'twopair') return b + (rank - 3);
  if (type === 'straight') return b + (rank - 5);
  return b + (rank - 2);
}

function rankName(r) {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r);
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

function createPokerDeck(numDecks) {
  const suits = ['S', 'H', 'D', 'C'];
  const deck = [];
  for (let n = 0; n < numDecks; n++) {
    for (const s of suits) {
      for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    }
  }
  return deck;
}

function checkStraight(rankCounts, highRank) {
  for (let off = 0; off < 5; off++) {
    let r = highRank - off;
    if (highRank === 5 && r === 1) r = 14;
    if (!rankCounts[r]) return false;
  }
  return true;
}

function checkHandExists(pool, type, rank) {
  const rankCounts = {};
  const suitCounts = {};
  const ranksBySuit = { S: new Set(), H: new Set(), D: new Set(), C: new Set() };
  for (const c of pool) {
    rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    ranksBySuit[c.suit].add(c.rank);
  }
  if (type === 'pair') return (rankCounts[rank] || 0) >= 2;
  if (type === 'three') return (rankCounts[rank] || 0) >= 3;
  if (type === 'quads') return (rankCounts[rank] || 0) >= 4;
  if (type === 'twopair') {
    if ((rankCounts[rank] || 0) < 2) return false;
    for (let r = 2; r < rank; r++) if ((rankCounts[r] || 0) >= 2) return true;
    return false;
  }
  if (type === 'fullhouse') {
    if ((rankCounts[rank] || 0) < 3) return false;
    for (let r = 2; r <= 14; r++) if (r !== rank && (rankCounts[r] || 0) >= 2) return true;
    return false;
  }
  if (type === 'straight') return checkStraight(rankCounts, rank);
  if (type === 'flush') return Object.values(suitCounts).some(c => c >= 5);
  if (type === 'straightflush') {
    for (const s of ['S', 'H', 'D', 'C']) {
      const ranks = ranksBySuit[s];
      for (let high = 5; high <= 14; high++) {
        let allPresent = true;
        for (let off = 0; off < 5; off++) {
          let r = high - off;
          if (high === 5 && r === 1) r = 14;
          if (!ranks.has(r)) { allPresent = false; break; }
        }
        if (allPresent) return true;
      }
    }
    return false;
  }
  return false;
}

const pokerGame = {
  name: 'poker',
  init(room) {
    room.lastDeclaration = null;
    room.lastActorIdx = null;
    room.currentPlayerIdx = null;
    room.roundNumber = 0;
    for (const p of room.players) { p.hand = []; p.dice = []; }
  },
  startRound(room) {
    const survivors = room.players.filter(p => p.alive);
    if (survivors.length <= 1) {
      room.state = 'finished';
      if (survivors.length === 1) addLog(room, `${survivors[0].name} wins the bar!`);
      broadcastRoom(room);
      return;
    }
    const cardsNeeded = survivors.length * 5;
    const numDecks = Math.max(1, Math.ceil(cardsNeeded / 52));
    const deck = shuffle(createPokerDeck(numDecks));
    let idx = 0;
    for (const p of room.players) {
      if (p.alive) { p.hand = deck.slice(idx, idx + 5); idx += 5; }
      else { p.hand = []; }
    }
    room.lastDeclaration = null;
    room.lastActorIdx = null;
    room.roundNumber++;
    if (room.currentPlayerIdx === null || room.currentPlayerIdx < 0 || !room.players[room.currentPlayerIdx]?.alive) {
      room.currentPlayerIdx = pickRandomAlive(room);
    }
    addLog(room, `── Round ${room.roundNumber} ── Hands dealt. ${room.players[room.currentPlayerIdx].name} declares first.`);
    broadcastRoom(room);
  },
  handlePlay(room, socket, { type, rank }) {
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    const player = room.players[playerIdx];
    if (!player.alive) return;
    if (!HAND_TYPES.includes(type)) return socket.emit('errorMsg', 'Invalid hand type.');
    const [rMin, rMax] = HAND_TYPE_RANK_RANGE[type];
    if (rMin > 0) {
      rank = parseInt(rank);
      if (!Number.isInteger(rank) || rank < rMin || rank > rMax) return socket.emit('errorMsg', 'Invalid rank.');
    } else {
      rank = 0;
    }
    const v = declarationValue(type, rank);
    if (room.lastDeclaration) {
      const prev = declarationValue(room.lastDeclaration.type, room.lastDeclaration.rank);
      if (v <= prev) return socket.emit('errorMsg', 'Declaration must increase.');
    }
    room.lastDeclaration = { type, rank, playerIdx };
    room.lastActorIdx = playerIdx;
    addLog(room, `${player.name} declares ${formatDeclaration(type, rank)}.`);
    room.currentPlayerIdx = nextAlivePlayer(room, playerIdx);
    broadcastRoom(room);
  },
  handleLiar(room, socket) {
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (!room.lastDeclaration) return socket.emit('errorMsg', 'No declaration yet.');
    const caller = room.players[callerIdx];
    const declarer = room.players[room.lastDeclaration.playerIdx];
    const { type, rank } = room.lastDeclaration;

    const pool = [];
    const allHands = [];
    for (const p of room.players) {
      if (p.alive) {
        pool.push(...p.hand);
        allHands.push({ playerId: p.id, name: p.name, hand: p.hand.slice() });
      }
    }
    const exists = checkHandExists(pool, type, rank);
    const loser = exists ? caller : declarer;

    addLog(room, `${caller.name} calls LIAR on ${declarer.name}!`);
    addLog(room, `${formatDeclaration(type, rank)} — ${exists ? 'found in pool (truth).' : 'not in pool (lie).'}`);
    addLog(room, `${loser.name} pulls the trigger…`);

    room.resolving = true;
    io.to(room.code).emit('reveal', {
      mode: 'poker', type, rank, exists, allHands,
      declarerId: declarer.id, callerId: caller.id, loserId: loser.id,
    });
    broadcastRoom(room);
    performShot(room, loser.id, caller.id, declarer.id);
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
    addLog(room, `${name} entered the bar.`);
  }

  socket.on('createRoom', ({ name }) => {
    name = sanitizeName(name);
    const code = genRoomCode();
    const room = {
      code, hostId: socket.id, players: [],
      state: 'lobby', gameMode: 'cards',
      tableCard: null, lastPlayedCards: null,
      lastBid: null, lastDeclaration: null,
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
    addLog(room, `Mode set to ${labels[mode]}.`);
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
    addLog(room, `─── ${labels[room.gameMode]} — game start ───`);
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
    room.lastDeclaration = null;
    room.currentPlayerIdx = null;
    room.lastActorIdx = null;
    room.roundNumber = 0;
    addLog(room, 'Back to lobby.');
    broadcastRoom(room);
  });

  socket.on('gameAction', ({ action, payload }) => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || room.resolving) return;
    const mode = games[room.gameMode];
    if (!mode) return;
    if (action === 'play') mode.handlePlay(room, socket, payload || {});
    else if (action === 'liar') mode.handleLiar(room, socket);
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
      addLog(room, `${player.name} left.`);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        currentRoomCode = null;
        return;
      }
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
        addLog(room, `${room.players[0].name} is now the host.`);
      }
      broadcastRoom(room);
    } else {
      player.disconnected = true;
      player.alive = false;
      addLog(room, `${player.name} disconnected.`);
      const survivors = room.players.filter(p => p.alive);
      if (survivors.length <= 1) {
        room.state = 'finished';
        if (survivors.length === 1) addLog(room, `🏆 ${survivors[0].name} wins!`);
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
