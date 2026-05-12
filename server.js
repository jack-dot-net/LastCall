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
const HAND_SIZE = 5;
const CARD_TYPES = ['King', 'Queen', 'Ace'];

function genRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createDeck(multiplier = 1) {
  const deck = [];
  for (let m = 0; m < multiplier; m++) {
    for (let i = 0; i < 6; i++) deck.push('King');
    for (let i = 0; i < 6; i++) deck.push('Queen');
    for (let i = 0; i < 6; i++) deck.push('Ace');
    for (let i = 0; i < 2; i++) deck.push('Joker');
  }
  return deck;
}

function deckMultiplierFor(playerCount) {
  return Math.max(1, Math.ceil(playerCount / 4));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    alive: p.alive,
    handSize: p.hand.length,
    chambers: p.chambers,
    shotsFired: p.shotsFired,
    disconnected: p.disconnected,
  };
}

function publicState(room, viewerId) {
  const me = room.players.find(p => p.id === viewerId);
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: room.players.map(publicPlayer),
    tableCard: room.tableCard,
    currentPlayerIdx: room.currentPlayerIdx,
    lastPlayerIdx: room.lastPlayerIdx,
    lastPlayedCount: room.lastPlayedCards ? room.lastPlayedCards.length : 0,
    roundNumber: room.roundNumber,
    log: room.log.slice(-30),
    yourHand: me ? me.hand : [],
    yourId: viewerId,
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    io.to(p.id).emit('roomUpdate', publicState(room, p.id));
  }
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

function startNewRound(room) {
  const survivors = room.players.filter(p => p.alive);
  if (survivors.length <= 1) {
    room.state = 'finished';
    addLog(room, survivors.length === 1 ? `${survivors[0].name} wins the bar!` : 'No survivors.');
    broadcastRoom(room);
    return;
  }

  const deck = shuffle(createDeck(deckMultiplierFor(survivors.length)));
  let idx = 0;
  for (const p of room.players) {
    if (p.alive) {
      p.hand = deck.slice(idx, idx + HAND_SIZE);
      idx += HAND_SIZE;
    } else {
      p.hand = [];
    }
  }

  room.tableCard = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
  room.lastPlayedCards = null;
  room.lastPlayerIdx = null;
  room.roundNumber++;

  if (room.currentPlayerIdx === null || room.currentPlayerIdx < 0 || !room.players[room.currentPlayerIdx]?.alive) {
    const aliveIndices = room.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
    room.currentPlayerIdx = aliveIndices[Math.floor(Math.random() * aliveIndices.length)];
  }

  addLog(room, `── Round ${room.roundNumber} ── The table card is ${room.tableCard}.`);
  addLog(room, `${room.players[room.currentPlayerIdx].name} starts.`);
  broadcastRoom(room);
}

io.on('connection', (socket) => {
  let currentRoomCode = null;

  function getRoom() {
    return currentRoomCode ? rooms.get(currentRoomCode) : null;
  }

  function addPlayerToRoom(room, name) {
    socket.join(room.code);
    room.players.push({
      id: socket.id,
      name,
      hand: [],
      alive: true,
      chambers: 6,
      bulletPos: Math.floor(Math.random() * 6),
      shotsFired: 0,
      disconnected: false,
    });
    addLog(room, `${name} entered the bar.`);
  }

  socket.on('createRoom', ({ name }) => {
    name = sanitizeName(name);
    const code = genRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: [],
      state: 'lobby',
      tableCard: null,
      currentPlayerIdx: null,
      lastPlayerIdx: null,
      lastPlayedCards: null,
      roundNumber: 0,
      log: [],
      resolving: false,
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
    room.roundNumber = 0;
    room.currentPlayerIdx = null;
    addLog(room, '─── Game start ───');
    startNewRound(room);
  });

  socket.on('resetGame', () => {
    const room = getRoom();
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.state !== 'finished') return;
    room.state = 'lobby';
    for (const p of room.players) {
      p.alive = true;
      p.hand = [];
      p.shotsFired = 0;
      p.disconnected = false;
    }
    room.tableCard = null;
    room.currentPlayerIdx = null;
    room.lastPlayerIdx = null;
    room.lastPlayedCards = null;
    room.roundNumber = 0;
    addLog(room, 'New game! Waiting in lobby.');
    broadcastRoom(room);
  });

  socket.on('playCards', ({ indices }) => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || room.resolving) return;
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
    room.lastPlayerIdx = playerIdx;
    addLog(room, `${player.name} plays ${played.length} card${played.length > 1 ? 's' : ''} as ${room.tableCard}${played.length > 1 ? 's' : ''}.`);

    room.currentPlayerIdx = nextAlivePlayer(room, playerIdx);
    broadcastRoom(room);
  });

  socket.on('callLiar', () => {
    const room = getRoom();
    if (!room || room.state !== 'playing' || room.resolving) return;
    const callerIdx = room.players.findIndex(p => p.id === socket.id);
    if (callerIdx !== room.currentPlayerIdx) return socket.emit('errorMsg', 'Not your turn.');
    if (room.lastPlayedCards === null || room.lastPlayerIdx === null) {
      return socket.emit('errorMsg', 'No one has played yet.');
    }

    const caller = room.players[callerIdx];
    const accused = room.players[room.lastPlayerIdx];
    const tableCard = room.tableCard;
    const cards = room.lastPlayedCards;
    const allMatch = cards.every(c => c === tableCard || c === 'Joker');
    const loser = allMatch ? caller : accused;

    addLog(room, `${caller.name} calls LIAR on ${accused.name}!`);
    addLog(room, `Cards revealed: ${cards.join(', ')} — ${allMatch ? 'truth!' : 'lie!'}`);
    addLog(room, `${loser.name} pulls the trigger…`);

    room.resolving = true;

    io.to(room.code).emit('reveal', {
      cards,
      accusedId: accused.id,
      callerId: caller.id,
      truthful: allMatch,
      loserId: loser.id,
      tableCard,
    });
    broadcastRoom(room);

    setTimeout(() => {
      const chamber = loser.shotsFired;
      loser.shotsFired++;
      const isBullet = (chamber === loser.bulletPos);

      if (isBullet) {
        loser.alive = false;
        addLog(room, `💥 BANG. ${loser.name} is out.`);
      } else {
        addLog(room, `*click* — ${loser.name} survives (${loser.chambers - loser.shotsFired} chamber${loser.chambers - loser.shotsFired === 1 ? '' : 's'} left).`);
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
        const otherId = (loser.id === caller.id) ? accused.id : caller.id;
        nextStarter = room.players.findIndex(p => p.id === otherId);
        if (nextStarter < 0 || !room.players[nextStarter].alive) {
          nextStarter = nextAlivePlayer(room, nextStarter >= 0 ? nextStarter : 0);
        }
      }
      room.currentPlayerIdx = nextStarter;

      setTimeout(() => {
        room.resolving = false;
        startNewRound(room);
      }, 2800);
    }, 1800);
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

function sanitizeName(name) {
  name = String(name || '').replace(/[<>]/g, '').slice(0, 16).trim();
  return name || 'Player';
}

server.listen(PORT, () => {
  console.log(`Liar's Bar listening on port ${PORT}`);
});
