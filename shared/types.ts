// ============================================================
// Last Call — wire protocol & shared types (client + server)
// ============================================================

export type Suit = 'whiskey' | 'gin' | 'rum' | 'wild';
/** A "call rank" — the suit a player must claim. Wild is never a rank. */
export type Rank = 'whiskey' | 'gin' | 'rum';
export type LobbyMode = 'classic' | 'blitz' | 'duel' | 'tournament';
export type Visibility = 'public' | 'private';

export type GamePhase =
  | 'lobby'
  | 'intro'
  | 'declare'
  | 'decision'
  | 'reveal'
  | 'bell'
  | 'round_end'
  | 'match_end';

export interface Card {
  id: number;
  suit: Suit;
}

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  seat: number;
  lives: number;
  out: boolean;
  spectator: boolean;
  chamber: number; // 0-5; bell pulls already taken
  handCount: number;
}

export interface LastPlay {
  fromSeat: number;
  fromId: string;
  count: number;
  claimedRank: Rank;
  /** Filled only during the reveal/bell phases so everyone sees the truth. */
  cardsRevealed?: Card[];
}

export interface BellRoll {
  pullerSeat: number;
  pullerId: string;
  hotChamber: number; // 0-5
  ring: boolean;
  livesAfter: number;
  eliminated: boolean;
}

export interface PublicGameState {
  phase: GamePhase;
  round: number;
  /** Seat index whose turn it is to act (declare or decide or pull bell). */
  turnSeat: number;
  currentRank: Rank;
  pileSize: number;
  deckSize: number;
  lastPlay: LastPlay | null;
  bell: BellRoll | null;
  winnerId: string | null;
  /** Seat indexes in turn order, alive only. */
  aliveSeats: number[];
}

export interface Lobby {
  code: string;
  name: string;
  mode: LobbyMode;
  maxPlayers: number;
  lives: number;
  visibility: Visibility;
  hostId: string;
  players: PublicPlayer[];
  game: PublicGameState | null;
  startedAt: number | null;
  createdAt: number;
}

export interface LobbySummary {
  code: string;
  name: string;
  mode: LobbyMode;
  maxPlayers: number;
  playerCount: number;
  hostName: string;
  locked: boolean;
  inGame: boolean;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
  system?: boolean;
}

export type GameEvent =
  | { type: 'log'; text: string; ts: number }
  | { type: 'speech'; fromSeat: number; text: string }
  | { type: 'roundStart'; rank: Rank; round: number }
  | { type: 'play'; fromSeat: number; count: number; claimedRank: Rank }
  | { type: 'decide'; fromSeat: number; challenge: boolean }
  | { type: 'reveal'; cards: Card[]; lying: boolean; loserSeat: number }
  | { type: 'bellResult'; result: BellRoll }
  | { type: 'roundEnd'; aliveSeats: number[] }
  | { type: 'matchEnd'; winnerSeat: number };

// ============================================================
// Wire protocol
// ============================================================

export interface AuthResult {
  ok: true;
  playerId: string;
  reconnectToken: string;
  name: string;
  /** If reconnecting and they were in a lobby, the server returns it. */
  inLobbyCode?: string;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface CreateLobbyPayload {
  name: string;
  mode: LobbyMode;
  maxPlayers: number;
  lives: number;
  visibility: Visibility;
}

export interface ClientToServerEvents {
  'auth:identify': (
    payload: { name: string; reconnectToken?: string },
    ack: (res: AuthResult | { ok: false; error: string }) => void
  ) => void;
  'lobby:list': (ack: (res: { lobbies: LobbySummary[] }) => void) => void;
  'lobby:create': (
    payload: CreateLobbyPayload,
    ack: (res: ActionResult<{ lobby: Lobby }>) => void
  ) => void;
  'lobby:join': (
    payload: { code: string },
    ack: (res: ActionResult<{ lobby: Lobby }>) => void
  ) => void;
  'lobby:leave': (ack: (res: ActionResult) => void) => void;
  'lobby:setReady': (payload: { ready: boolean }, ack: (res: ActionResult) => void) => void;
  'lobby:start': (ack: (res: ActionResult) => void) => void;
  'chat:send': (payload: { text: string }, ack?: (res: ActionResult) => void) => void;
  'game:play': (payload: { cardIds: number[] }, ack: (res: ActionResult) => void) => void;
  'game:decide': (payload: { challenge: boolean }, ack: (res: ActionResult) => void) => void;
  'game:pullBell': (ack: (res: ActionResult) => void) => void;
  'game:react': (payload: { emoji: string }) => void;
}

export interface ServerToClientEvents {
  'lobby:state': (payload: { lobby: Lobby }) => void;
  'lobby:closed': (payload: { reason: string }) => void;
  'lobby:list': (payload: { lobbies: LobbySummary[] }) => void;
  'hand:update': (payload: { hand: Card[] }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'game:event': (payload: GameEvent) => void;
  'react': (payload: { fromSeat: number; emoji: string }) => void;
  'error': (payload: { code: string; message: string }) => void;
}

// Sanity bounds
export const PLAYER_MAX = 8;
export const PLAYER_MIN = 2;
export const LIVES_MIN = 1;
export const LIVES_MAX = 5;
export const NAME_MAX = 16;
export const CHAT_MAX = 240;
export const CODE_LEN = 6;
export const HAND_SIZE = 5;
export const CHAMBERS = 6;
