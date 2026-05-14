import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  CreateLobbyPayload,
  GameEvent,
  LobbyMode,
  ServerToClientEvents,
  Visibility,
} from '../../shared/types.ts';
import {
  CHAT_MAX,
  LIVES_MAX,
  LIVES_MIN,
  NAME_MAX,
  PLAYER_MAX,
  PLAYER_MIN,
} from '../../shared/types.ts';
import { Lobby, LobbyManager } from '../game/lobby.ts';
import { SessionManager, type PlayerSession } from '../game/sessions.ts';
import { JsonStore } from '../persistence/store.ts';
import { generateEventId } from '../util/codes.ts';
import { log } from '../util/log.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const RECONNECT_GRACE_MS = 60_000;

const LOBBY_MODES: LobbyMode[] = ['classic', 'blitz', 'duel', 'tournament'];
const VISIBILITIES: Visibility[] = ['public', 'private'];

interface RateLimitState {
  windowStart: number;
  count: number;
}

export interface AppContext {
  io: IO;
  sessions: SessionManager;
  lobbies: LobbyManager;
  store: JsonStore;
  rateLimits: Map<string, RateLimitState>;
  /** Per-lobby turn / bell auto-action timer. */
  turnTimers: Map<string, NodeJS.Timeout>;
}

export function createContext(io: IO, store: JsonStore): AppContext {
  return {
    io,
    sessions: new SessionManager(),
    lobbies: new LobbyManager(),
    store,
    rateLimits: new Map(),
    turnTimers: new Map(),
  };
}

export function attachHandlers(ctx: AppContext): void {
  ctx.io.on('connection', (socket) => bindSocket(ctx, socket));
  // Periodic prune of disconnected sessions not in any lobby.
  setInterval(() => ctx.sessions.prune(10 * 60 * 1000), 60_000).unref();
  // Periodic broadcast of public lobby list (for browser screen).
  setInterval(() => broadcastLobbyList(ctx), 5_000).unref();
}

function bindSocket(ctx: AppContext, socket: IOSocket): void {
  log.info('socket connect', socket.id);

  socket.on('auth:identify', (payload, ack) => {
    try {
      const session = ctx.sessions.identify(
        socket.id,
        sanitizeName(payload?.name),
        typeof payload?.reconnectToken === 'string'
          ? payload.reconnectToken
          : undefined
      );
      // If they were in a lobby, rejoin that room.
      let inLobbyCode: string | undefined;
      if (session.lobbyCode) {
        const lobby = ctx.lobbies.get(session.lobbyCode);
        if (lobby && lobby.hasPlayer(session.id)) {
          socket.join(lobby.code);
          lobby.markConnected(session.id);
          inLobbyCode = lobby.code;
          // Re-send full state to this client.
          emitLobbyState(ctx, lobby);
          emitHand(ctx, lobby, session.id);
        } else {
          ctx.sessions.bindLobby(session.id, null);
        }
      }
      ack({
        ok: true,
        playerId: session.id,
        reconnectToken: session.reconnectToken,
        name: session.name,
        ...(inLobbyCode ? { inLobbyCode } : {}),
      });
    } catch (e) {
      log.error('auth:identify failed', e);
      ack({ ok: false, error: 'Identify failed.' });
    }
  });

  socket.on('lobby:list', (ack) => {
    if (!checkRate(ctx, socket.id, 'lobby:list', 30)) {
      ack({ lobbies: [] });
      return;
    }
    ack({ lobbies: ctx.lobbies.list() });
  });

  socket.on('lobby:create', (payload, ack) => {
    if (!checkRate(ctx, socket.id, 'lobby:create', 5)) {
      ack({ ok: false, error: 'Slow down.' });
      return;
    }
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    if (session.lobbyCode) {
      ack({ ok: false, error: 'Already in a lobby.' });
      return;
    }
    const sanitized = sanitizeCreatePayload(payload);
    if (!sanitized) {
      ack({ ok: false, error: 'Invalid lobby settings.' });
      return;
    }
    const lobby = ctx.lobbies.create(session, sanitized);
    ctx.sessions.bindLobby(session.id, lobby.code);
    socket.join(lobby.code);
    log.info(
      `lobby:create ${lobby.code} by ${session.name} mode=${lobby.mode} max=${lobby.maxPlayers}`
    );
    emitLobbyState(ctx, lobby);
    broadcastLobbyList(ctx);
    ack({ ok: true, data: { lobby: lobby.toPublic() } });
  });

  socket.on('lobby:join', (payload, ack) => {
    if (!checkRate(ctx, socket.id, 'lobby:join', 10)) {
      ack({ ok: false, error: 'Slow down.' });
      return;
    }
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const code = typeof payload?.code === 'string'
      ? payload.code.toUpperCase().trim()
      : '';
    if (!code) {
      ack({ ok: false, error: 'Lobby code is required.' });
      return;
    }
    if (session.lobbyCode && session.lobbyCode !== code) {
      ack({ ok: false, error: 'Leave your current lobby first.' });
      return;
    }
    const lobby = ctx.lobbies.get(code);
    if (!lobby) {
      ack({ ok: false, error: 'Lobby not found.' });
      return;
    }
    const result = lobby.addPlayer(session);
    if (!result.ok) {
      ack({ ok: false, error: result.error ?? 'Cannot join.' });
      return;
    }
    ctx.sessions.bindLobby(session.id, lobby.code);
    socket.join(lobby.code);
    log.info(`lobby:join ${lobby.code} ← ${session.name}`);
    pushSystemChat(ctx, lobby, `${session.name} pulled up a stool.`);
    emitLobbyState(ctx, lobby);
    emitHand(ctx, lobby, session.id);
    broadcastLobbyList(ctx);
    ack({ ok: true, data: { lobby: lobby.toPublic() } });
  });

  socket.on('lobby:leave', (ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    leaveLobby(ctx, session);
    ack({ ok: true });
  });

  socket.on('lobby:setReady', (payload, ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const outcome = lobby.setReady(session.id, !!payload?.ready);
    if (!outcome.ok) {
      ack({ ok: false, error: outcome.error ?? 'Invalid action.' });
      return;
    }
    emitLobbyState(ctx, lobby);
    ack({ ok: true });
  });

  socket.on('lobby:start', (ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const outcome = lobby.start(session.id);
    if (!outcome.ok) {
      ack({ ok: false, error: outcome.error ?? 'Cannot start.' });
      return;
    }
    log.info(`lobby:start ${lobby.code}`);
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, outcome.events);
    for (const id of outcome.handsToPush) emitHand(ctx, lobby, id);
    broadcastLobbyList(ctx);
    scheduleTurnTimer(ctx, lobby);
    ack({ ok: true });
  });

  socket.on('chat:send', (payload, ack) => {
    if (!checkRate(ctx, socket.id, 'chat:send', 12)) {
      ack?.({ ok: false, error: 'Slow down.' });
      return;
    }
    const session = ctx.sessions.getBySocket(socket.id);
    if (!session) {
      ack?.({ ok: false, error: 'Not identified.' });
      return;
    }
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack?.({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const text = sanitizeChat(payload?.text);
    if (!text) {
      ack?.({ ok: false, error: 'Empty message.' });
      return;
    }
    ctx.io.to(lobby.code).emit('chat:message', {
      id: generateEventId(),
      fromId: session.id,
      fromName: session.name,
      text,
      ts: Date.now(),
    });
    ack?.({ ok: true });
  });

  socket.on('game:play', (payload, ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const cardIds = Array.isArray(payload?.cardIds)
      ? payload.cardIds.filter((n) => Number.isFinite(n)).map((n) => Number(n))
      : [];
    const outcome = lobby.play(session.id, cardIds);
    if (!outcome.ok) {
      ack({ ok: false, error: outcome.error ?? 'Invalid play.' });
      return;
    }
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, outcome.events);
    for (const id of outcome.handsToPush) emitHand(ctx, lobby, id);
    scheduleTurnTimer(ctx, lobby);
    ack({ ok: true });
  });

  socket.on('game:callLiar', (ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const outcome = lobby.callLiar(session.id);
    if (!outcome.ok) {
      ack({ ok: false, error: outcome.error ?? 'Invalid challenge.' });
      return;
    }
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, outcome.events);
    for (const id of outcome.handsToPush) emitHand(ctx, lobby, id);
    if (lobby.game?.phase === 'match_end') recordMatch(ctx, lobby);
    scheduleTurnTimer(ctx, lobby);
    ack({ ok: true });
  });

  socket.on('game:pullBell', (ack) => {
    const session = requireSession(ctx, socket, ack);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) {
      ack({ ok: false, error: 'Not in a lobby.' });
      return;
    }
    const outcome = lobby.pullBell(session.id);
    if (!outcome.ok) {
      ack({ ok: false, error: outcome.error ?? 'Cannot pull bell.' });
      return;
    }
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, outcome.events);
    // pullBell sets bell.* on the state, so the bell auto-pull timer is no
    // longer needed. The post-bell advance handler will reschedule for the
    // next turn after it transitions out of the bell phase.
    clearTurnTimer(ctx, lobby.code);
    schedulePostBellAdvance(ctx, lobby);
    ack({ ok: true });
  });

  socket.on('game:react', (payload) => {
    if (!checkRate(ctx, socket.id, 'game:react', 20)) return;
    const session = ctx.sessions.getBySocket(socket.id);
    if (!session) return;
    const lobby = activeLobby(ctx, session);
    if (!lobby) return;
    const emoji = typeof payload?.emoji === 'string' ? payload.emoji.slice(0, 4) : '';
    if (!emoji) return;
    const player = lobby.toPublic().players.find((p) => p.id === session.id);
    if (!player) return;
    ctx.io.to(lobby.code).emit('react', { fromSeat: player.seat, emoji });
  });

  socket.on('disconnect', () => {
    const session = ctx.sessions.disconnect(socket.id);
    if (!session) return;
    log.info('socket disconnect', socket.id, session.name);
    if (session.lobbyCode) {
      const lobby = ctx.lobbies.get(session.lobbyCode);
      if (lobby) {
        lobby.markDisconnected(session.id);
        emitLobbyState(ctx, lobby);
        // Schedule cleanup if they don't return.
        setTimeout(() => {
          const stillThere = ctx.sessions.getById(session.id);
          if (stillThere && stillThere.connected) return; // they came back
          leaveLobby(ctx, session, /*system*/ true);
        }, RECONNECT_GRACE_MS).unref?.();
      }
    }
  });
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function requireSession(
  ctx: AppContext,
  socket: IOSocket,
  ack: (res: { ok: false; error: string }) => void
): PlayerSession | null {
  const s = ctx.sessions.getBySocket(socket.id);
  if (!s) {
    ack({ ok: false, error: 'Not identified.' });
    return null;
  }
  return s;
}

function activeLobby(ctx: AppContext, session: PlayerSession): Lobby | null {
  if (!session.lobbyCode) return null;
  const lobby = ctx.lobbies.get(session.lobbyCode);
  if (!lobby || !lobby.hasPlayer(session.id)) return null;
  return lobby;
}

function emitLobbyState(ctx: AppContext, lobby: Lobby): void {
  ctx.io.to(lobby.code).emit('lobby:state', { lobby: lobby.toPublic() });
}

function emitHand(ctx: AppContext, lobby: Lobby, playerId: string): void {
  const hand = lobby.getHand(playerId);
  const session = ctx.sessions.getById(playerId);
  if (!session?.socketId) return;
  ctx.io.to(session.socketId).emit('hand:update', { hand });
}

function emitEvents(ctx: AppContext, lobby: Lobby, events: GameEvent[]): void {
  for (const event of events) {
    ctx.io.to(lobby.code).emit('game:event', event);
  }
}

function clearTurnTimer(ctx: AppContext, code: string): void {
  const t = ctx.turnTimers.get(code);
  if (t) {
    clearTimeout(t);
    ctx.turnTimers.delete(code);
  }
}

/**
 * Schedules the auto-action timer for a lobby based on its game state's
 * `turnDeadline`. Clears any prior timer first.
 *
 * When the timer fires, asks the Lobby to take an auto-action for the
 * current turn (auto-play, auto-LIAR, or auto-pull bell), broadcasts the
 * result, then reschedules for the new turn.
 */
function scheduleTurnTimer(ctx: AppContext, lobby: Lobby): void {
  clearTurnTimer(ctx, lobby.code);
  const deadline = lobby.game?.turnDeadline;
  if (deadline == null) return;
  const remaining = Math.max(0, deadline - Date.now());
  const seatAtSchedule = lobby.game!.turnSeat;
  const phaseAtSchedule = lobby.game!.phase;
  const handle = setTimeout(() => {
    ctx.turnTimers.delete(lobby.code);
    // Confirm the game state hasn't moved on between when we scheduled and
    // when we fired — otherwise we'd be auto-acting on a stale turn.
    const game = lobby.game;
    if (!game) return;
    if (game.phase !== phaseAtSchedule || game.turnSeat !== seatAtSchedule) {
      // State already advanced; reschedule for whatever is current.
      scheduleTurnTimer(ctx, lobby);
      return;
    }
    const outcome = lobby.autoTurnAction(seatAtSchedule);
    if (!outcome.ok) {
      log.warn('auto-action failed:', outcome.error);
      // Try to reschedule anyway so the game doesn't stall.
      scheduleTurnTimer(ctx, lobby);
      return;
    }
    if (!outcome.changed) {
      scheduleTurnTimer(ctx, lobby);
      return;
    }
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, outcome.events);
    for (const id of outcome.handsToPush) emitHand(ctx, lobby, id);
    // If the auto-action transitioned to bell, we need to schedule the
    // post-pull advance the same way the human pull handler does.
    if (lobby.game?.phase === 'bell' && lobby.game.bell) {
      schedulePostBellAdvance(ctx, lobby);
    }
    if (lobby.game?.phase === 'match_end') {
      recordMatch(ctx, lobby);
      broadcastLobbyList(ctx);
    }
    scheduleTurnTimer(ctx, lobby);
  }, remaining);
  // unref so node can exit if this is the only thing pending.
  handle.unref?.();
  ctx.turnTimers.set(lobby.code, handle);
}

const BELL_ADVANCE_DELAY_MS = 2_400;

function schedulePostBellAdvance(ctx: AppContext, lobby: Lobby): void {
  setTimeout(() => {
    const advance = lobby.advanceAfterBell();
    if (!advance.changed) return;
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, advance.events);
    for (const id of advance.handsToPush) emitHand(ctx, lobby, id);
    if (lobby.game?.phase === 'match_end') {
      recordMatch(ctx, lobby);
      broadcastLobbyList(ctx);
    }
    scheduleTurnTimer(ctx, lobby);
  }, BELL_ADVANCE_DELAY_MS).unref?.();
}

function pushSystemChat(ctx: AppContext, lobby: Lobby, text: string): void {
  ctx.io.to(lobby.code).emit('chat:message', {
    id: generateEventId(),
    fromId: 'system',
    fromName: 'House',
    text,
    ts: Date.now(),
    system: true,
  });
}

function leaveLobby(
  ctx: AppContext,
  session: PlayerSession,
  silentLeave = false
): void {
  if (!session.lobbyCode) return;
  const lobby = ctx.lobbies.get(session.lobbyCode);
  ctx.sessions.bindLobby(session.id, null);
  if (!lobby) return;
  if (!silentLeave) pushSystemChat(ctx, lobby, `${session.name} settled the tab.`);
  const result = lobby.removePlayer(session.id);
  if (result.closed) {
    ctx.io.to(lobby.code).emit('lobby:closed', { reason: 'Lobby closed.' });
    clearTurnTimer(ctx, lobby.code);
    ctx.lobbies.close(lobby.code);
  } else {
    emitLobbyState(ctx, lobby);
    emitEvents(ctx, lobby, result.events);
    // The departure may have advanced the turn (e.g. they were the active
    // seat). Reschedule based on whatever state the lobby settled into.
    scheduleTurnTimer(ctx, lobby);
    if (lobby.game?.phase === 'match_end') {
      recordMatch(ctx, lobby);
    }
  }
  // Also leave the socket.io room.
  if (session.socketId) {
    const sock = ctx.io.sockets.sockets.get(session.socketId);
    sock?.leave(lobby.code);
  }
  broadcastLobbyList(ctx);
}

function broadcastLobbyList(ctx: AppContext): void {
  ctx.io.emit('lobby:list', { lobbies: ctx.lobbies.list() });
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'Stranger';
  return name.trim().slice(0, NAME_MAX) || 'Stranger';
}

function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  // Strip ASCII control chars, collapse whitespace, trim, cap length.
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue;
    out += text[i];
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  return out || null;
}

function sanitizeCreatePayload(payload: unknown): CreateLobbyPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const name = typeof p.name === 'string' ? p.name : '';
  const mode = LOBBY_MODES.includes(p.mode as LobbyMode)
    ? (p.mode as LobbyMode)
    : 'classic';
  const maxPlayers = clamp(
    Number(p.maxPlayers ?? PLAYER_MIN),
    PLAYER_MIN,
    PLAYER_MAX
  );
  const lives = clamp(Number(p.lives ?? 3), LIVES_MIN, LIVES_MAX);
  const visibility = VISIBILITIES.includes(p.visibility as Visibility)
    ? (p.visibility as Visibility)
    : 'public';
  return { name, mode, maxPlayers, lives, visibility };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function checkRate(
  ctx: AppContext,
  key: string,
  bucket: string,
  perMinute: number
): boolean {
  const fullKey = `${key}:${bucket}`;
  const now = Date.now();
  const state = ctx.rateLimits.get(fullKey);
  if (!state || now - state.windowStart > 60_000) {
    ctx.rateLimits.set(fullKey, { windowStart: now, count: 1 });
    return true;
  }
  state.count += 1;
  return state.count <= perMinute;
}

function recordMatch(ctx: AppContext, lobby: Lobby): void {
  const view = lobby.toPublic();
  const winner = view.players.find((p) => p.id === view.game?.winnerId);
  if (!winner || !view.startedAt) return;
  ctx.store.recordMatch({
    id: generateEventId(),
    lobbyCode: lobby.code,
    lobbyName: view.name,
    mode: view.mode,
    winnerName: winner.name,
    playerCount: view.players.length,
    rounds: view.game?.round ?? 0,
    startedAt: view.startedAt,
    endedAt: Date.now(),
  });
}
