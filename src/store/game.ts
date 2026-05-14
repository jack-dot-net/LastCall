import { create } from 'zustand';
import type {
  Card,
  ChatMessage,
  GameEvent,
  Lobby,
  LobbySummary,
} from '@shared/types';

export type Route =
  | 'menu'
  | 'browser'
  | 'create'
  | 'join'
  | 'lobby'
  | 'game';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'warn' | 'success';
}

export interface AppSettings {
  audio: boolean;
  music: number;
  sfx: number;
  ambient: number;
  bloom: boolean;
  smoke: boolean;
  reducedMotion: boolean;
  confirmPlay: boolean;
  hapticFeedback: boolean;
}

const SETTINGS_KEY = 'lastcall.settings';

const defaultSettings: AppSettings = {
  audio: false,
  music: 60,
  sfx: 80,
  ambient: 50,
  bloom: true,
  smoke: true,
  reducedMotion: false,
  confirmPlay: false,
  hapticFeedback: true,
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface GameStore {
  // Identity
  playerId: string | null;
  playerName: string;
  connected: boolean;

  // Route
  route: Route;
  settingsOpen: boolean;

  // Settings
  settings: AppSettings;

  // Server-synced
  lobby: Lobby | null;
  hand: Card[];
  publicLobbies: LobbySummary[];

  // Ephemeral / UI
  toasts: Toast[];
  log: { id: string; text: string }[];
  chat: ChatMessage[];
  speech: Record<number, string>;
  reactions: Record<number, string>;
  joinError: string | null;

  // Actions
  setRoute: (r: Route) => void;
  setSettingsOpen: (open: boolean) => void;
  setIdentity: (id: string, name: string) => void;
  setConnected: (c: boolean) => void;
  setPlayerName: (n: string) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  setLobby: (lobby: Lobby | null) => void;
  setHand: (hand: Card[]) => void;
  setPublicLobbies: (lobbies: LobbySummary[]) => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
  pushChat: (msg: ChatMessage) => void;
  handleGameEvent: (event: GameEvent) => void;
  setSpeech: (seat: number, text: string) => void;
  setReaction: (seat: number, emoji: string) => void;
  setJoinError: (e: string | null) => void;
  reset: () => void;
}

let toastId = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  playerId: null,
  playerName: 'Stranger',
  connected: false,

  route: 'menu',
  settingsOpen: false,
  settings: loadSettings(),

  lobby: null,
  hand: [],
  publicLobbies: [],

  toasts: [],
  log: [],
  chat: [],
  speech: {},
  reactions: {},
  joinError: null,

  setRoute: (route) => set({ route }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setIdentity: (id, name) => set({ playerId: id, playerName: name }),
  setConnected: (connected) => set({ connected }),
  setPlayerName: (playerName) => set({ playerName }),
  setSettings: (patch) =>
    set((s) => {
      const next = { ...s.settings, ...patch };
      saveSettings(next);
      return { settings: next };
    }),
  setLobby: (lobby) => set({ lobby }),
  setHand: (hand) => set({ hand }),
  setPublicLobbies: (publicLobbies) => set({ publicLobbies }),
  pushToast: (text, tone = 'info') =>
    set((s) => {
      const id = ++toastId;
      const next = [...s.toasts, { id, text, tone }];
      setTimeout(() => {
        const cur = get().toasts;
        set({ toasts: cur.filter((t) => t.id !== id) });
      }, 2400);
      return { toasts: next };
    }),
  pushChat: (msg) =>
    set((s) => ({ chat: [...s.chat.slice(-80), msg] })),
  setSpeech: (seat, text) =>
    set((s) => ({ speech: { ...s.speech, [seat]: text } })),
  setReaction: (seat, emoji) =>
    set((s) => ({ reactions: { ...s.reactions, [seat]: emoji } })),
  setJoinError: (joinError) => set({ joinError }),
  handleGameEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'log':
        set({
          log: [
            ...state.log.slice(-30),
            { id: String(Date.now() + Math.random()), text: event.text },
          ],
        });
        break;
      case 'speech':
        state.setSpeech(event.fromSeat, event.text);
        setTimeout(() => {
          const cur = get().speech;
          if (cur[event.fromSeat] === event.text) {
            const next = { ...cur };
            delete next[event.fromSeat];
            set({ speech: next });
          }
        }, 1800);
        break;
      case 'roundStart':
        state.pushToast(
          `Round ${event.round} · pouring ${event.rank.toUpperCase()}`,
          'info'
        );
        break;
      case 'reveal':
        // The full visual lives in <RevealOverlay /> driven by game state.
        // The toast is still nice for the corner-of-eye signal.
        state.pushToast(
          event.lying ? 'LIAR EXPOSED' : 'HONEST · CHALLENGER PAYS',
          event.lying ? 'success' : 'warn'
        );
        break;
      case 'bellResult':
        state.pushToast(
          event.result.ring
            ? event.result.eliminated
              ? 'ELIMINATED'
              : 'IT RINGS'
            : 'SILENCE',
          event.result.ring ? 'warn' : 'success'
        );
        break;
      case 'matchEnd':
        // handled by component
        break;
      default:
        break;
    }
  },
  reset: () =>
    set({
      lobby: null,
      hand: [],
      log: [],
      chat: [],
      speech: {},
      reactions: {},
      joinError: null,
    }),
}));
