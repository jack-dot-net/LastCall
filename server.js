const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingTimeout: 20000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const STARTING_LIVES = 3;
const RECONNECT_GRACE_MS = 45000;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLAIM_RANKS = ['Crows', 'Moons', 'Keys'];

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, name: 'Last Call' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = new Map();
const socketIndex = new Map();

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function makeRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const cleaned = String(name || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return cleaned || 'Stranger';
}

function nameTaken(room, name, exceptId = null) {
  return room.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createDeck(playerCount) {
  const deck = [];
  const copies = Math.max(1, Math.ceil(playerCount / 4));
  for (let c = 0; c < copies; c += 1) {
    for (const rank of CLAIM_RANKS) {
      for (let i = 0; i < 8; i += 1) deck.push({ rank, wild: false });
    }
    for (let i = 0; i < 4; i += 1) deck.push({ rank: 'Ember', wild: true });
  }
  return shuffle(deck);
}

function log(room, text, type = 'info', data = {}) {
  room.log.push({ id: randomId(6), time: Date.now(), text, type, data });
  if (room.log.length > 120) room.log.shift();
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    ready: player.ready,
    host: false,
    connected: player.connected,
    alive: player.alive,
    lives: player.lives,
    handCount: player.hand.length,
  };
}

function viewerState(room, viewerId) {
  const viewer = room.players.find((p) => p.id === viewerId);
  return {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    winnerId: room.winnerId,
    round: room.round,
    claimRank: room.claimRank,
    currentTurnId: room.currentTurnId,
    lastClaim: room.lastClaim,
    resolving: room.resolving,
    settings: {
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
      startingLives: STARTING_LIVES,
    },
    players: room.players.map((p) => ({ ...publicPlayer(p), host: p.id === room.hostId })),
    hand: viewer && room.state === 'playing' && viewer.alive ? viewer.hand : [],
    you: viewerId,
    log: room.log.slice(-40),
  };
}

function emitRoom(room) {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('state', viewerState(room, player.id));
  }
}

function alivePlayers(room) {
  return room.players.filter((p) => p.alive);
}

function nextAliveAfter(room, playerId) {
  const alive = alivePlayers(room);
  if (alive.length === 0) return null;
  const start = Math.max(0, room.players.findIndex((p) => p.id === playerId));
  for (let step = 1; step <= room.players.length; step += 1) {
    const candidate = room.players[(start + step) % room.players.length];
    if (candidate && candidate.alive) return candidate.id;
  }
  return alive[0].id;
}

function safeRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

function assignNewHost(room) {
  if (room.players.some((p) => p.id === room.hostId && p.connected)) return;
  const next = room.players.find((p) => p.connected) || room.players[0];
  if (next) {
    room.hostId = next.id;
    log(room, `${next.name} now holds the house key.`, 'system', { playerId: next.id });
  }
}

function maybeFinish(room) {
  const survivors = alivePlayers(room);
  if (room.state === 'playing' && survivors.length <= 1) {
    room.state = 'finished';
    room.currentTurnId = null;
    room.resolving = false;
    room.winnerId = survivors[0]?.id || null;
    if (survivors[0]) log(room, `${survivors[0].name} survives Last Call.`, 'win', { playerId: survivors[0].id });
    return true;
  }
  return false;
}

function startRound(room, starterId = null) {
  if (maybeFinish(room)) return;
  const survivors = alivePlayers(room);
  const deck = createDeck(survivors.length);
  room.round += 1;
  room.claimRank = CLAIM_RANKS[Math.floor(Math.random() * CLAIM_RANKS.length)];
  room.lastClaim = null;
  room.resolving = false;
  for (const player of room.players) {
    player.hand = player.alive ? deck.splice(0, 5) : [];
  }
  const starter = starterId && survivors.some((p) => p.id === starterId) ? starterId : survivors[Math.floor(Math.random() * survivors.length)].id;
  room.currentTurnId = starter;
  log(room, `Round ${room.round}: the house calls ${room.claimRank}.`, 'round', { rank: room.claimRank, round: room.round });
  log(room, `${room.players.find((p) => p.id === starter)?.name || 'Someone'} has the first word.`, 'turn', { playerId: starter });
}

function createRoom(hostSocket, name) {
  const code = makeRoomCode();
  const host = {
    id: randomId(10),
    socketId: hostSocket.id,
    token: randomId(18),
    name,
    ready: true,
    connected: true,
    alive: true,
    lives: STARTING_LIVES,
    hand: [],
    disconnectTimer: null,
  };
  const room = {
    code,
    hostId: host.id,
    state: 'lobby',
    players: [host],
    round: 0,
    claimRank: null,
    currentTurnId: null,
    lastClaim: null,
    resolving: false,
    winnerId: null,
    log: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  socketIndex.set(hostSocket.id, { roomCode: code, playerId: host.id });
  hostSocket.join(code);
  log(room, `${host.name} opened a table.`, 'system', { playerId: host.id });
  hostSocket.emit('joined', { code, playerId: host.id, playerToken: host.token });
  emitRoom(room);
}

function joinRoom(socket, room, name) {
  if (room.state !== 'lobby') return socket.emit('notice', { type: 'error', message: 'That table is already in a game.' });
  if (room.players.length >= MAX_PLAYERS) return socket.emit('notice', { type: 'error', message: 'That table is full.' });
  if (nameTaken(room, name)) return socket.emit('notice', { type: 'error', message: 'That name is already seated here.' });
  const player = {
    id: randomId(10),
    socketId: socket.id,
    token: randomId(18),
    name,
    ready: false,
    connected: true,
    alive: true,
    lives: STARTING_LIVES,
    hand: [],
    disconnectTimer: null,
  };
  room.players.push(player);
  socketIndex.set(socket.id, { roomCode: room.code, playerId: player.id });
  socket.join(room.code);
  log(room, `${player.name} slipped into the booth.`, 'system', { playerId: player.id });
  socket.emit('joined', { code: room.code, playerId: player.id, playerToken: player.token });
  emitRoom(room);
}

function reconnect(socket, room, player) {
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  player.socketId = socket.id;
  player.connected = true;
  socketIndex.set(socket.id, { roomCode: room.code, playerId: player.id });
  socket.join(room.code);
  log(room, `${player.name} found their way back through the smoke.`, 'system', { playerId: player.id });
  socket.emit('joined', { code: room.code, playerId: player.id, playerToken: player.token });
  emitRoom(room);
}

function removeFromLobby(room, player) {
  const index = room.players.findIndex((p) => p.id === player.id);
  if (index >= 0) room.players.splice(index, 1);
  log(room, `${player.name} left the table.`, 'system', { playerId: player.id });
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  assignNewHost(room);
  emitRoom(room);
}

function handleDisconnect(socket) {
  const ref = socketIndex.get(socket.id);
  if (!ref) return;
  socketIndex.delete(socket.id);
  const room = rooms.get(ref.roomCode);
  if (!room) return;
  socket.leave(room.code);
  const player = room.players.find((p) => p.id === ref.playerId);
  if (!player || player.socketId !== socket.id) return;
  player.socketId = null;
  player.connected = false;

  if (room.state === 'lobby' || room.state === 'finished') {
    removeFromLobby(room, player);
    return;
  }

  log(room, `${player.name} vanished from the table. Reconnect grace started.`, 'disconnect', { playerId: player.id });
  assignNewHost(room);
  if (room.currentTurnId === player.id) room.currentTurnId = nextAliveAfter(room, player.id);
  player.disconnectTimer = setTimeout(() => {
    const latestRoom = rooms.get(room.code);
    const latest = latestRoom?.players.find((p) => p.id === player.id);
    if (!latest || latest.connected || latestRoom.state !== 'playing') return;
    latest.alive = false;
    latest.lives = 0;
    latest.hand = [];
    log(latestRoom, `${latest.name} missed Last Call and is out.`, 'penalty', { playerId: latest.id });
    maybeFinish(latestRoom);
    emitRoom(latestRoom);
  }, RECONNECT_GRACE_MS);
  maybeFinish(room);
  emitRoom(room);
}

function applyPenalty(room, loser, reason) {
  loser.lives = Math.max(0, loser.lives - 1);
  log(room, `${loser.name} loses composure: ${reason}`, 'penalty', { playerId: loser.id, lives: loser.lives });
  if (loser.lives <= 0) {
    loser.alive = false;
    loser.hand = [];
    log(room, `${loser.name} is out of the night.`, 'out', { playerId: loser.id });
  }
}

io.on('connection', (socket) => {
  socket.on('createGame', ({ username }) => {
    createRoom(socket, cleanName(username));
  });

  socket.on('joinGame', ({ code, username, playerToken }) => {
    const room = safeRoom(code);
    if (!room) return socket.emit('notice', { type: 'error', message: 'No table with that code.' });
    const returning = room.players.find((p) => p.token === playerToken);
    if (returning) return reconnect(socket, room, returning);
    return joinRoom(socket, room, cleanName(username));
  });

  socket.on('rejoinGame', ({ code, playerToken }) => {
    const room = safeRoom(code);
    const player = room?.players.find((p) => p.token === playerToken);
    if (!room || !player) return socket.emit('notice', { type: 'error', message: 'Could not restore that seat.' });
    reconnect(socket, room, player);
  });

  socket.on('setReady', ({ ready }) => {
    const ref = socketIndex.get(socket.id);
    const room = ref && rooms.get(ref.roomCode);
    const player = room?.players.find((p) => p.id === ref.playerId);
    if (!room || !player || room.state !== 'lobby') return;
    player.ready = Boolean(ready);
    emitRoom(room);
  });

  socket.on('startGame', () => {
    const ref = socketIndex.get(socket.id);
    const room = ref && rooms.get(ref.roomCode);
    if (!room || room.hostId !== ref.playerId) return socket.emit('notice', { type: 'error', message: 'Only the host can start.' });
    if (room.state !== 'lobby') return;
    if (room.players.length < MIN_PLAYERS) return socket.emit('notice', { type: 'error', message: `Need at least ${MIN_PLAYERS} players.` });
    if (!room.players.every((p) => p.ready || p.id === room.hostId)) {
      return socket.emit('notice', { type: 'error', message: 'Everyone must be ready first.' });
    }
    room.state = 'playing';
    room.winnerId = null;
    room.round = 0;
    for (const player of room.players) {
      player.alive = true;
      player.lives = STARTING_LIVES;
      player.hand = [];
      player.ready = false;
    }
    log(room, 'The doors lock. Last Call begins.', 'event');
    startRound(room);
    emitRoom(room);
  });

  socket.on('playCards', ({ indices }) => {
    const ref = socketIndex.get(socket.id);
    const room = ref && rooms.get(ref.roomCode);
    const player = room?.players.find((p) => p.id === ref.playerId);
    if (!room || !player || room.state !== 'playing' || room.resolving) return;
    if (room.currentTurnId !== player.id) return socket.emit('notice', { type: 'error', message: 'Not your turn.' });
    if (!player.alive) return socket.emit('notice', { type: 'error', message: 'You are spectating.' });
    if (!Array.isArray(indices) || indices.length < 1 || indices.length > 3) {
      return socket.emit('notice', { type: 'error', message: 'Play one to three cards.' });
    }
    const unique = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < player.hand.length);
    if (unique.length !== indices.length) return socket.emit('notice', { type: 'error', message: 'Invalid card selection.' });
    unique.sort((a, b) => b - a);
    const played = unique.map((i) => player.hand.splice(i, 1)[0]);
    room.lastClaim = {
      by: player.id,
      name: player.name,
      count: played.length,
      cards: played,
      rank: room.claimRank,
    };
    room.currentTurnId = nextAliveAfter(room, player.id);
    log(room, `${player.name} slides ${played.length} card${played.length > 1 ? 's' : ''} as ${room.claimRank}.`, 'play', {
      playerId: player.id,
      count: played.length,
      rank: room.claimRank,
    });
    emitRoom(room);
  });

  socket.on('callBluff', () => {
    const ref = socketIndex.get(socket.id);
    const room = ref && rooms.get(ref.roomCode);
    const caller = room?.players.find((p) => p.id === ref.playerId);
    if (!room || !caller || room.state !== 'playing' || room.resolving) return;
    if (room.currentTurnId !== caller.id) return socket.emit('notice', { type: 'error', message: 'Not your turn.' });
    if (!room.lastClaim) return socket.emit('notice', { type: 'error', message: 'There is no claim to challenge.' });
    const accused = room.players.find((p) => p.id === room.lastClaim.by);
    if (!accused) return;
    const truthful = room.lastClaim.cards.every((card) => card.wild || card.rank === room.lastClaim.rank);
    const loser = truthful ? caller : accused;
    const revealed = room.lastClaim.cards.map((card) => ({ rank: card.rank, wild: card.wild }));
    room.resolving = true;
    log(room, `${caller.name} calls the bluff on ${accused.name}.`, 'challenge', { callerId: caller.id, accusedId: accused.id });
    log(room, truthful ? 'The claim holds.' : 'The lie cracks open.', truthful ? 'truth' : 'lie', { cards: revealed, rank: room.lastClaim.rank });
    io.to(room.code).emit('reveal', {
      callerId: caller.id,
      accusedId: accused.id,
      loserId: loser.id,
      truthful,
      rank: room.lastClaim.rank,
      cards: revealed,
    });
    applyPenalty(room, loser, truthful ? 'the call was wrong' : 'the bluff was caught');
    emitRoom(room);
    setTimeout(() => {
      const latest = rooms.get(room.code);
      if (!latest || latest.state !== 'playing') return;
      if (maybeFinish(latest)) return emitRoom(latest);
      startRound(latest, loser.alive ? loser.id : nextAliveAfter(latest, loser.id));
      emitRoom(latest);
    }, 3200);
  });

  socket.on('returnToLobby', () => {
    const ref = socketIndex.get(socket.id);
    const room = ref && rooms.get(ref.roomCode);
    if (!room || room.hostId !== ref.playerId || room.state !== 'finished') return;
    room.state = 'lobby';
    room.winnerId = null;
    room.currentTurnId = null;
    room.lastClaim = null;
    room.claimRank = null;
    room.resolving = false;
    for (const player of room.players) {
      player.alive = true;
      player.lives = STARTING_LIVES;
      player.hand = [];
      player.ready = player.id === room.hostId;
    }
    log(room, 'Fresh glasses. New table.', 'system');
    emitRoom(room);
  });

  socket.on('leaveGame', () => {
    handleDisconnect(socket);
  });

  socket.on('disconnect', () => handleDisconnect(socket));
});

server.listen(PORT, () => {
  console.log(`Last Call listening on port ${PORT}`);
});
