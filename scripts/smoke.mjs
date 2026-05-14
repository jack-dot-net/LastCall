// Tiny smoke test: connects two clients, creates a lobby, joins, readies, starts,
// plays a card, challenges, and ensures we get reasonable state transitions.
// Not a substitute for live multi-browser testing — just verifies the wire works.

import { io } from 'socket.io-client';

const PORT = process.env.PORT || '3099';
const URL = `http://localhost:${PORT}`;

function connect(name) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket', 'polling'] });
    const timeout = setTimeout(() => reject(new Error(`${name} connect timeout`)), 5000);
    s.on('connect', () => {
      clearTimeout(timeout);
      s.emit('auth:identify', { name }, (res) => {
        if (!res?.ok) return reject(new Error(`identify failed: ${res?.error}`));
        resolve({ socket: s, auth: res });
      });
    });
    s.on('connect_error', reject);
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} ack timeout`)), 5000);
    if (payload === undefined) {
      socket.emit(event, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });
    } else {
      socket.emit(event, payload, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });
    }
  });
}

function waitFor(socket, event, predicate, label = event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`wait ${label} timeout`)), 8000);
    const handler = (payload) => {
      if (!predicate || predicate(payload)) {
        clearTimeout(timeout);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

(async () => {
  console.log('connecting alice...');
  const alice = await connect('Alice');
  console.log('  alice id:', alice.auth.playerId);

  console.log('connecting bob...');
  const bob = await connect('Bob');
  console.log('  bob id:', bob.auth.playerId);

  console.log('alice creates lobby...');
  const create = await ack(alice.socket, 'lobby:create', {
    name: 'Smoke Test',
    mode: 'classic',
    maxPlayers: 4,
    lives: 3,
    visibility: 'public',
  });
  if (!create?.ok) throw new Error('create failed: ' + (create && create.error));
  const code = create.data.lobby.code;
  console.log('  lobby code:', code);

  console.log('bob joins...');
  const join = await ack(bob.socket, 'lobby:join', { code });
  if (!join?.ok) throw new Error('join failed: ' + (join && join.error));
  console.log('  bob in lobby with', join.data.lobby.players.length, 'players');

  console.log('both ready...');
  await ack(alice.socket, 'lobby:setReady', { ready: true });
  await ack(bob.socket, 'lobby:setReady', { ready: true });

  console.log('alice starts...');
  const aliceHandPromise = waitFor(alice.socket, 'hand:update', null, 'alice hand');
  const bobHandPromise = waitFor(bob.socket, 'hand:update', null, 'bob hand');
  const declarePromise = waitFor(
    alice.socket,
    'lobby:state',
    (p) => p.lobby.game && p.lobby.game.phase === 'declare',
    'declare phase'
  );
  const start = await ack(alice.socket, 'lobby:start');
  if (!start?.ok) throw new Error('start failed: ' + (start && start.error));
  const aliceHand = await aliceHandPromise;
  const bobHand = await bobHandPromise;
  console.log('  alice has', aliceHand.hand.length, 'cards');
  console.log('  bob has', bobHand.hand.length, 'cards');

  const inGameState = await declarePromise;
  console.log(
    '  game phase:',
    inGameState.lobby.game.phase,
    'rank:',
    inGameState.lobby.game.currentRank,
    'turnSeat:',
    inGameState.lobby.game.turnSeat
  );

  // Whoever's turn it is plays one card.
  const turnSeat = inGameState.lobby.game.turnSeat;
  const turnPlayer = turnSeat === 0 ? alice : bob;
  const playerHand = turnSeat === 0 ? aliceHand.hand : bobHand.hand;
  console.log('  turn belongs to seat', turnSeat);
  const oneCard = [playerHand[0].id];
  console.log('  turn player plays 1 card:', oneCard);
  const play = await ack(turnPlayer.socket, 'game:play', { cardIds: oneCard });
  if (!play?.ok) throw new Error('play failed: ' + (play && play.error));

  // Next player calls LIAR.
  const next = turnPlayer === alice ? bob : alice;
  const bellPhasePromise = waitFor(
    alice.socket,
    'lobby:state',
    (p) => p.lobby.game && p.lobby.game.phase === 'bell',
    'bell phase'
  );
  const decide = await ack(next.socket, 'game:callLiar');
  if (!decide?.ok) throw new Error('callLiar failed: ' + (decide && decide.error));
  const bellState = await bellPhasePromise;
  console.log('  bell loser seat:', bellState.lobby.game.turnSeat);

  // The bell player pulls.
  const bellLoserSeat = bellState.lobby.game.turnSeat;
  const bellPlayer = bellLoserSeat === 0 ? alice : bob;
  const bellResultPromise = waitFor(
    alice.socket,
    'game:event',
    (e) => e.type === 'bellResult',
    'bellResult event'
  );
  const pull = await ack(bellPlayer.socket, 'game:pullBell');
  if (!pull?.ok) throw new Error('pullBell failed: ' + (pull && pull.error));
  const bellResult = await bellResultPromise;
  console.log('  bell result: ring=', bellResult.result.ring, 'lives=', bellResult.result.livesAfter);

  console.log('ALL GOOD');
  process.exit(0);
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
