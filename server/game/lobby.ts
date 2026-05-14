import {
  BELL_TIMEOUT_MS,
  CHAMBERS,
  LIVES_MAX,
  LIVES_MIN,
  PLAYER_MAX,
  PLAYER_MIN,
  TURN_TIMEOUT_MS,
  type ChallengeReveal,
  type Card,
  type CreateLobbyPayload,
  type GameEvent,
  type GamePhase,
  type Lobby as PublicLobby,
  type LobbyMode,
  type LobbySummary,
  type PublicGameState,
  type PublicPlayer,
  type Rank,
  type Visibility,
  type LastPlay,
  type BellRoll,
} from '../../shared/types.ts';
import { dealHands, makeDeck, pickRank } from './deck.ts';
import { generateLobbyCode } from '../util/codes.ts';
import type { PlayerSession } from './sessions.ts';

interface PlayerSeat {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  seat: number;
  lives: number;
  hand: Card[];
  out: boolean;
  spectator: boolean;
  chamber: number;
}

interface InternalGameState {
  phase: GamePhase;
  round: number;
  turnSeat: number;
  currentRank: Rank;
  deck: Card[];
  pile: Card[];
  /** Server-side LastPlay always carries the actual cards. */
  lastPlay: (LastPlay & { cards: Card[] }) | null;
  bell: BellRoll | null;
  winnerId: string | null;
  pendingNextStarterSeat: number | null;
  /** Seat that owes the bell pull once the reveal phase finishes. */
  pendingBellSeat: number | null;
  reveal: ChallengeReveal | null;
  /** ms since epoch — when the current actor must have acted by. */
  turnDeadline: number | null;
}

export interface ActionOutcome {
  ok: boolean;
  error?: string;
  events: GameEvent[];
  /** Player IDs whose private hand state should be re-pushed. */
  handsToPush: string[];
  /** True if state should be broadcast to the room. */
  changed: boolean;
}

const ok = (events: GameEvent[] = [], handsToPush: string[] = []): ActionOutcome => ({
  ok: true,
  events,
  handsToPush,
  changed: true,
});
const fail = (error: string): ActionOutcome => ({
  ok: false,
  error,
  events: [],
  handsToPush: [],
  changed: false,
});

const MIN_PLAYERS_TO_START = 2;

export class Lobby {
  code: string;
  name: string;
  mode: LobbyMode;
  maxPlayers: number;
  livesPerPlayer: number;
  visibility: Visibility;
  hostId: string;
  createdAt: number;
  startedAt: number | null = null;

  private seats = new Map<string, PlayerSeat>();
  /** PlayerIds in seat order. Holes appear as `null` after a leave during game. */
  private seatOrder: (string | null)[] = [];
  game: InternalGameState | null = null;

  constructor(code: string, payload: CreateLobbyPayload, host: PlayerSession) {
    this.code = code;
    this.name = sanitizeLobbyName(payload.name) || 'A Quiet Booth';
    this.mode = payload.mode;
    this.maxPlayers = clamp(payload.maxPlayers, PLAYER_MIN, PLAYER_MAX);
    this.livesPerPlayer = clamp(payload.lives, LIVES_MIN, LIVES_MAX);
    this.visibility = payload.visibility;
    this.hostId = host.id;
    this.createdAt = Date.now();
    this.addPlayer(host);
  }

  // ============================================================
  // Membership
  // ============================================================

  addPlayer(player: PlayerSession): { ok: boolean; error?: string } {
    if (this.seats.has(player.id)) {
      // Reconnect.
      const s = this.seats.get(player.id)!;
      s.connected = true;
      s.name = player.name;
      return { ok: true };
    }
    if (this.game && this.game.phase !== 'lobby') {
      // Game in progress, only allow rejoin of existing seats. Don't add new.
      return { ok: false, error: 'Game already in progress.' };
    }
    if (this.seats.size >= this.maxPlayers) {
      return { ok: false, error: 'Lobby is full.' };
    }
    if (this.nameTaken(player.name, player.id)) {
      return { ok: false, error: 'Name already taken in this lobby.' };
    }
    const seat = this.nextEmptySeat();
    this.seatOrder[seat] = player.id;
    this.seats.set(player.id, {
      id: player.id,
      name: player.name,
      ready: false,
      connected: true,
      seat,
      lives: this.livesPerPlayer,
      hand: [],
      out: false,
      spectator: false,
      chamber: 0,
    });
    return { ok: true };
  }

  private nextEmptySeat(): number {
    for (let i = 0; i < this.maxPlayers; i++) {
      if (this.seatOrder[i] == null) return i;
    }
    return this.seatOrder.length;
  }

  private nameTaken(name: string, exceptId: string): boolean {
    for (const s of this.seats.values()) {
      if (s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  removePlayer(
    playerId: string
  ): { closed: boolean; hostChanged: boolean; events: GameEvent[] } {
    const s = this.seats.get(playerId);
    if (!s) return { closed: false, hostChanged: false, events: [] };
    this.seats.delete(playerId);
    this.seatOrder[s.seat] = null;

    const events: GameEvent[] = [
      { type: 'log', text: `${s.name} left the bar.`, ts: Date.now() },
    ];

    if (this.seats.size === 0) {
      return { closed: true, hostChanged: false, events };
    }

    let hostChanged = false;
    if (this.hostId === playerId) {
      const next = this.firstSeatedPlayer();
      if (next) {
        this.hostId = next.id;
        hostChanged = true;
        events.push({
          type: 'log',
          text: `${next.name} is the new host.`,
          ts: Date.now(),
        });
      }
    }

    // If game in progress, treat leaver as eliminated.
    if (this.game && this.game.phase !== 'lobby' && this.game.phase !== 'match_end') {
      this.handleInGameDeparture(s.seat, events);
    }

    return { closed: this.seats.size === 0, hostChanged, events };
  }

  markDisconnected(playerId: string): void {
    const s = this.seats.get(playerId);
    if (s) s.connected = false;
  }

  markConnected(playerId: string): void {
    const s = this.seats.get(playerId);
    if (s) s.connected = true;
  }

  private firstSeatedPlayer(): PlayerSeat | undefined {
    for (let i = 0; i < this.seatOrder.length; i++) {
      const id = this.seatOrder[i];
      if (id) {
        const s = this.seats.get(id);
        if (s) return s;
      }
    }
    return undefined;
  }

  private handleInGameDeparture(seat: number, events: GameEvent[]): void {
    if (!this.game) return;
    // The seat is gone. If they were the loser of a pending bell, auto-fail
    // their bell pull (so the game doesn't soft-lock).
    if (this.game.phase === 'bell' && this.game.turnSeat === seat) {
      this.forceBellThenAdvance(seat, events);
      return;
    }
    // If it was their turn (declare/decision), advance.
    if (this.game.phase === 'declare' || this.game.phase === 'decision') {
      if (this.game.turnSeat === seat) {
        // No clean way to recover. End the round, new deal.
        this.beginRound(seat, events);
      }
    }
    // Check if only one player remains.
    const aliveCount = this.aliveSeatIds().length;
    if (aliveCount <= 1) {
      const winner = this.firstAlive();
      this.game.phase = 'match_end';
      this.game.winnerId = winner?.id ?? null;
      if (winner) {
        events.push({ type: 'matchEnd', winnerSeat: winner.seat });
      }
    }
  }

  setReady(playerId: string, ready: boolean): ActionOutcome {
    if (this.game && this.game.phase !== 'lobby') {
      return fail('Round in progress.');
    }
    const s = this.seats.get(playerId);
    if (!s) return fail('Not in this lobby.');
    s.ready = ready;
    return ok();
  }

  // ============================================================
  // Game lifecycle
  // ============================================================

  start(byPlayerId: string): ActionOutcome {
    if (byPlayerId !== this.hostId) return fail('Only the host can start.');
    if (this.game && this.game.phase !== 'lobby') {
      return fail('Already started.');
    }
    const seated = this.seatedPlayers();
    if (seated.length < MIN_PLAYERS_TO_START) {
      return fail(`Need at least ${MIN_PLAYERS_TO_START} players.`);
    }
    const readyCount = seated.filter((s) => s.ready).length;
    if (readyCount < seated.length) {
      return fail('Everyone must be ready.');
    }
    // Reset per-player game stats.
    for (const s of this.seats.values()) {
      s.lives = this.livesPerPlayer;
      s.hand = [];
      s.out = false;
      s.spectator = false;
      s.chamber = 0;
    }
    this.startedAt = Date.now();
    this.game = {
      phase: 'intro',
      round: 0,
      turnSeat: seated[0].seat,
      currentRank: pickRank(),
      deck: makeDeck(),
      pile: [],
      lastPlay: null,
      bell: null,
      winnerId: null,
      pendingNextStarterSeat: null,
      pendingBellSeat: null,
      reveal: null,
      turnDeadline: null,
    };
    const events: GameEvent[] = [
      {
        type: 'log',
        text: 'The doors are bolted. Round 1 begins.',
        ts: Date.now(),
      },
    ];
    this.beginRound(seated[0].seat, events);
    return { ok: true, events, handsToPush: seated.map((s) => s.id), changed: true };
  }

  private beginRound(startSeat: number, events: GameEvent[]): void {
    if (!this.game) return;
    const alive = this.aliveSeats();
    if (alive.length <= 1) {
      const winner = this.firstAlive();
      this.game.phase = 'match_end';
      this.game.winnerId = winner?.id ?? null;
      if (winner) {
        events.push({ type: 'matchEnd', winnerSeat: winner.seat });
      }
      return;
    }
    this.game.round += 1;
    this.game.lastPlay = null;
    this.game.pile = [];
    this.game.bell = null;
    this.game.pendingNextStarterSeat = null;
    this.game.pendingBellSeat = null;
    this.game.reveal = null;

    // Fresh deck each round — keeps card IDs unique within a round and avoids
    // any leftover-card weirdness between deals.
    this.game.deck = makeDeck();

    const alivePlayers = alive.map((seat) => this.playerBySeat(seat)!);
    this.game.deck = dealHands(alivePlayers, this.game.deck);

    // Pick a new call rank (different from previous if possible).
    this.game.currentRank = pickRank(this.game.currentRank);
    this.game.phase = 'declare';
    this.game.turnSeat = this.nearestAliveSeatFrom(startSeat);

    events.push({
      type: 'roundStart',
      rank: this.game.currentRank,
      round: this.game.round,
    });
    this.refreshDeadline();
  }

  // ============================================================
  // Action: play
  // ============================================================

  /**
   * Play 1-3 cards. Works in BOTH "declare" (round-opening) and "decision"
   * (mid-chain) phases — in the decision phase, playing implicitly trusts
   * the previous play and passes the decision burden to the next player.
   * Per Liar's Bar rules: cards are NOT replaced; the pile accumulates.
   */
  play(playerId: string, cardIds: number[]): ActionOutcome {
    const s = this.seats.get(playerId);
    if (!s) return fail('Not in this lobby.');
    if (!this.game) return fail('Game not started.');
    if (this.game.phase !== 'declare' && this.game.phase !== 'decision') {
      return fail('Cannot play right now.');
    }
    if (this.game.turnSeat !== s.seat) return fail('Not your turn.');
    if (s.out) return fail('You are out.');
    if (s.hand.length === 0) return fail('No cards to play — call Liar.');
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 3) {
      return fail('Play between 1 and 3 cards.');
    }
    const idSet = new Set(cardIds);
    const chosen = s.hand.filter((c) => idSet.has(c.id));
    if (chosen.length !== cardIds.length) {
      return fail('Invalid card selection.');
    }
    // Remove from hand, push to pile. NO refilling.
    s.hand = s.hand.filter((c) => !idSet.has(c.id));
    this.game.pile.push(...chosen);
    this.game.lastPlay = {
      fromSeat: s.seat,
      fromId: s.id,
      count: chosen.length,
      claimedRank: this.game.currentRank,
      cards: chosen,
    };
    this.game.phase = 'decision';
    this.game.turnSeat = this.nextAliveSeatAfter(s.seat);

    const events: GameEvent[] = [
      {
        type: 'play',
        fromSeat: s.seat,
        count: chosen.length,
        claimedRank: this.game.currentRank,
      },
      {
        type: 'log',
        text: `${s.name} plays ${chosen.length} · claims ${this.game.currentRank.toUpperCase()}.`,
        ts: Date.now(),
      },
    ];
    this.refreshDeadline();
    return { ok: true, events, handsToPush: [s.id], changed: true };
  }

  // ============================================================
  // Action: callLiar — challenge the last play
  // ============================================================

  callLiar(playerId: string): ActionOutcome {
    const s = this.seats.get(playerId);
    if (!s) return fail('Not in this lobby.');
    if (!this.game) return fail('Game not started.');
    if (this.game.phase !== 'decision') return fail('No play to challenge.');
    if (this.game.turnSeat !== s.seat) return fail('Not your decision.');
    if (!this.game.lastPlay) return fail('No play to challenge.');

    const events: GameEvent[] = [
      { type: 'callLiar', fromSeat: s.seat },
    ];

    const currentRank = this.game.currentRank;
    const lying = this.game.lastPlay.cards.some(
      (c) => c.suit !== currentRank && c.suit !== 'wild'
    );
    const loserSeat = lying ? this.game.lastPlay.fromSeat : s.seat;
    const challengerSeat = s.seat;
    events.push({
      type: 'reveal',
      cards: this.game.lastPlay.cards,
      lying,
      loserSeat,
      challengerSeat,
    });
    events.push({
      type: 'log',
      text: lying
        ? `LIAR. ${this.playerBySeat(this.game.lastPlay.fromSeat)!.name} was bluffing.`
        : `Honest. ${s.name} pays for the bad call.`,
      ts: Date.now(),
    });
    // Reveal phase: cards flip up, players read the outcome. The handler
    // schedules advanceFromReveal() after REVEAL_PHASE_MS, which transitions
    // to the bell phase.
    this.game.phase = 'reveal';
    this.game.reveal = { lying, challengerSeat, loserSeat };
    this.game.turnSeat = loserSeat;
    this.game.pendingBellSeat = loserSeat;
    // The bell loser starts the next round (if they survive). If they're
    // eliminated, the round will fall through to the next alive seat.
    this.game.pendingNextStarterSeat = loserSeat;
    this.refreshDeadline();

    return { ok: true, events, handsToPush: [], changed: true };
  }

  /**
   * Transition from the reveal phase to the bell phase. Called by the
   * socket handler after the reveal hold has elapsed. No-op if state has
   * already moved past reveal.
   */
  advanceFromReveal(): ActionOutcome {
    if (!this.game) return fail('Game not started.');
    if (this.game.phase !== 'reveal') {
      return { ok: true, events: [], handsToPush: [], changed: false };
    }
    const pending = this.game.pendingBellSeat;
    const events: GameEvent[] = [];
    // Safety: if the loser has vanished (left the lobby during reveal),
    // skip the bell and just start the next round.
    const player = pending != null ? this.playerBySeat(pending) : null;
    if (!player || player.out) {
      const startSeat = this.nearestAliveSeatFrom(
        this.game.pendingNextStarterSeat ?? pending ?? 0
      );
      events.push({ type: 'roundEnd', aliveSeats: this.aliveSeats() });
      this.beginRound(startSeat, events);
      return {
        ok: true,
        events,
        handsToPush: this.aliveSeatIds(),
        changed: true,
      };
    }
    this.game.phase = 'bell';
    this.game.turnSeat = pending!;
    this.refreshDeadline();
    return { ok: true, events, handsToPush: [], changed: true };
  }

  // ============================================================
  // Action: pullBell
  // ============================================================

  pullBell(playerId: string): ActionOutcome {
    const s = this.seats.get(playerId);
    if (!s) return fail('Not in this lobby.');
    if (!this.game) return fail('Game not started.');
    if (this.game.phase !== 'bell') return fail('No bell pending.');
    if (this.game.turnSeat !== s.seat) return fail('Not your pull.');
    if (this.game.bell) return fail('Already pulled.');
    const events: GameEvent[] = [];
    this.resolveBell(s.seat, /*forceRing*/ false, events);
    this.refreshDeadline();
    return { ok: true, events, handsToPush: [], changed: true };
  }

  /**
   * Steps the game forward from the post-bell pause into the next round
   * (or match end). Called by the socket handler after a brief delay so
   * the bell-result animation has time to play on clients.
   * No-op if the phase isn't still on the post-bell hold.
   */
  advanceAfterBell(): ActionOutcome {
    if (!this.game) return fail('Game not started.');
    if (this.game.phase !== 'bell' || !this.game.bell) {
      return { ok: true, events: [], handsToPush: [], changed: false };
    }
    const puller = this.game.bell.pullerSeat;
    const events: GameEvent[] = [];

    const alive = this.aliveSeats();
    if (alive.length <= 1) {
      const winner = this.firstAlive();
      this.game.phase = 'match_end';
      this.game.winnerId = winner?.id ?? null;
      if (winner) events.push({ type: 'matchEnd', winnerSeat: winner.seat });
      this.refreshDeadline();
      return { ok: true, events, handsToPush: [], changed: true };
    }

    // Loser starts next round if alive; if they were eliminated, fall through
    // to the next alive seat after them.
    const nextStart = this.nearestAliveSeatFrom(
      this.game.pendingNextStarterSeat ?? puller
    );
    events.push({ type: 'roundEnd', aliveSeats: alive });
    this.beginRound(nextStart, events);
    // beginRound already calls refreshDeadline.
    return { ok: true, events, handsToPush: this.aliveSeatIds(), changed: true };
  }

  private resolveBell(
    seat: number,
    forceRing: boolean,
    events: GameEvent[]
  ): void {
    if (!this.game) return;
    const player = this.playerBySeat(seat);
    if (!player) return;
    const remaining = CHAMBERS - player.chamber;
    const ring = forceRing || Math.floor(Math.random() * Math.max(1, remaining)) === 0;
    const hotChamber = Math.floor(Math.random() * CHAMBERS);

    let eliminated = false;
    if (ring) {
      player.lives = Math.max(0, player.lives - 1);
      player.chamber = 0;
      if (player.lives <= 0) {
        player.out = true;
        player.spectator = true;
        eliminated = true;
      }
    } else {
      player.chamber = Math.min(CHAMBERS - 1, player.chamber + 1);
    }

    const roll: BellRoll = {
      pullerSeat: seat,
      pullerId: player.id,
      hotChamber,
      ring,
      livesAfter: player.lives,
      eliminated,
    };
    this.game.bell = roll;
    events.push({ type: 'bellResult', result: roll });
  }

  /** Used when a player vanishes mid-bell so the round can advance. */
  private forceBellThenAdvance(seat: number, events: GameEvent[]): void {
    this.resolveBell(seat, /*forceRing*/ true, events);
    const result = this.advanceAfterBell();
    events.push(...result.events);
  }

  // ============================================================
  // Helpers
  // ============================================================

  private playerBySeat(seat: number): PlayerSeat | undefined {
    const id = this.seatOrder[seat];
    return id ? this.seats.get(id) : undefined;
  }

  private seatedPlayers(): PlayerSeat[] {
    return Array.from(this.seats.values()).sort((a, b) => a.seat - b.seat);
  }

  private aliveSeats(): number[] {
    return this.seatedPlayers()
      .filter((p) => !p.out)
      .map((p) => p.seat);
  }

  private aliveSeatIds(): string[] {
    return this.seatedPlayers()
      .filter((p) => !p.out)
      .map((p) => p.id);
  }

  private firstAlive(): PlayerSeat | undefined {
    return this.seatedPlayers().find((p) => !p.out);
  }

  private nextAliveSeatAfter(seat: number): number {
    const alive = this.aliveSeats();
    if (alive.length === 0) return seat;
    if (alive.length === 1) return alive[0];
    for (let i = 1; i <= this.seatOrder.length; i++) {
      const candidate = (seat + i) % this.seatOrder.length;
      if (alive.includes(candidate)) return candidate;
    }
    return alive[0];
  }

  private nearestAliveSeatFrom(seat: number): number {
    const alive = this.aliveSeats();
    if (alive.includes(seat)) return seat;
    return this.nextAliveSeatAfter(seat);
  }

  /**
   * Recompute when the current actor must act by. Called after every
   * phase / turn transition. Returns the deadline so callers can also
   * use it to schedule timeouts.
   */
  private refreshDeadline(): number | null {
    if (!this.game) return null;
    if (this.game.phase === 'declare' || this.game.phase === 'decision') {
      this.game.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
    } else if (this.game.phase === 'bell' && !this.game.bell) {
      this.game.turnDeadline = Date.now() + BELL_TIMEOUT_MS;
    } else {
      this.game.turnDeadline = null;
    }
    return this.game.turnDeadline;
  }

  /**
   * Server-driven timeout action. Called when `turnDeadline` passes
   * without the current actor making a move. Picks the cheapest sensible
   * action so AFK players don't stall the game.
   *
   * declare / decision phase:
   *   - 0 cards in hand → call LIAR (only valid action)
   *   - otherwise        → play 1-3 cards, preferring matching/wild so the
   *                         AFK player is less likely to be caught lying
   * bell phase:
   *   - pull the rope (random chamber roll)
   */
  autoTurnAction(seat: number): ActionOutcome {
    if (!this.game) return fail('Game not started.');
    if (this.game.turnSeat !== seat) {
      return { ok: true, events: [], handsToPush: [], changed: false };
    }
    const player = this.playerBySeat(seat);
    if (!player) return fail('No player at seat.');
    const events: GameEvent[] = [
      {
        type: 'log',
        text: `${player.name} timed out.`,
        ts: Date.now(),
      },
    ];

    if (this.game.phase === 'bell') {
      const out = this.pullBell(player.id);
      return { ...out, events: [...events, ...out.events] };
    }
    if (this.game.phase === 'decision' || this.game.phase === 'declare') {
      if (player.hand.length === 0) {
        if (this.game.phase !== 'decision') {
          // No cards and no chain to challenge — shouldn't happen.
          return fail('Cannot auto-act in declare phase with no cards.');
        }
        const out = this.callLiar(player.id);
        return { ...out, events: [...events, ...out.events] };
      }
      // Pick 1-3 cards, prefer matching the call (incl. wild).
      const rank = this.game.currentRank;
      const matching = player.hand.filter(
        (c) => c.suit === rank || c.suit === 'wild'
      );
      const desired = Math.min(
        player.hand.length,
        1 + Math.floor(Math.random() * 3)
      );
      let chosen: Card[];
      if (matching.length >= desired) {
        chosen = matching.slice(0, desired);
      } else if (matching.length > 0) {
        const rest = player.hand.filter((c) => !matching.includes(c));
        chosen = [...matching, ...rest.slice(0, desired - matching.length)];
      } else {
        // No matches — forced to lie. Play just 1 to minimise risk.
        chosen = [player.hand[0]];
      }
      const out = this.play(
        player.id,
        chosen.map((c) => c.id)
      );
      return { ...out, events: [...events, ...out.events] };
    }
    return fail('No auto-action for current phase.');
  }


  // ============================================================
  // Views
  // ============================================================

  hostName(): string {
    return this.seats.get(this.hostId)?.name ?? 'host';
  }

  isEmpty(): boolean {
    return this.seats.size === 0;
  }

  inGame(): boolean {
    return !!this.game && this.game.phase !== 'lobby' && this.game.phase !== 'match_end';
  }

  getHand(playerId: string): Card[] {
    return this.seats.get(playerId)?.hand ?? [];
  }

  hasPlayer(playerId: string): boolean {
    return this.seats.has(playerId);
  }

  toSummary(): LobbySummary {
    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      playerCount: this.seats.size,
      hostName: this.hostName(),
      locked: this.visibility === 'private',
      inGame: this.inGame(),
    };
  }

  toPublic(): PublicLobby {
    const seated = this.seatedPlayers();
    const publicPlayers: PublicPlayer[] = seated.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === this.hostId,
      ready: p.ready,
      connected: p.connected,
      seat: p.seat,
      lives: p.lives,
      out: p.out,
      spectator: p.spectator,
      chamber: p.chamber,
      handCount: p.hand.length,
    }));

    let game: PublicGameState | null = null;
    if (this.game) {
      const publicLastPlay: LastPlay | null = this.game.lastPlay
        ? {
            fromSeat: this.game.lastPlay.fromSeat,
            fromId: this.game.lastPlay.fromId,
            count: this.game.lastPlay.count,
            claimedRank: this.game.lastPlay.claimedRank,
            // Only reveal cards during reveal/bell phases.
            ...(this.game.phase === 'reveal' || this.game.phase === 'bell'
              ? { cardsRevealed: this.game.lastPlay.cards }
              : {}),
          }
        : null;
      game = {
        phase: this.game.phase,
        round: this.game.round,
        turnSeat: this.game.turnSeat,
        currentRank: this.game.currentRank,
        pileSize: this.game.pile.length,
        deckSize: this.game.deck.length,
        lastPlay: publicLastPlay,
        bell: this.game.bell,
        winnerId: this.game.winnerId,
        aliveSeats: this.aliveSeats(),
        turnDeadline: this.game.turnDeadline,
        reveal: this.game.reveal,
      };
    }

    return {
      code: this.code,
      name: this.name,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      lives: this.livesPerPlayer,
      visibility: this.visibility,
      hostId: this.hostId,
      players: publicPlayers,
      game,
      startedAt: this.startedAt,
      createdAt: this.createdAt,
    };
  }
}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();

  create(host: PlayerSession, payload: CreateLobbyPayload): Lobby {
    let code: string;
    do {
      code = generateLobbyCode();
    } while (this.lobbies.has(code));
    const lobby = new Lobby(code, payload, host);
    this.lobbies.set(code, lobby);
    return lobby;
  }

  get(code: string): Lobby | undefined {
    return this.lobbies.get(code.toUpperCase());
  }

  close(code: string): void {
    this.lobbies.delete(code);
  }

  list(): LobbySummary[] {
    return Array.from(this.lobbies.values())
      .filter((l) => l.visibility === 'public' && !l.isEmpty())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((l) => l.toSummary());
  }

  all(): Lobby[] {
    return Array.from(this.lobbies.values());
  }
}

function sanitizeLobbyName(name: string): string {
  return (name ?? '').replace(/[\s]+/g, ' ').trim().slice(0, 40);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
