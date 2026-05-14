import {
  generatePlayerId,
  generateReconnectToken,
} from '../util/codes.ts';
import { NAME_MAX } from '../../shared/types.ts';

export interface PlayerSession {
  id: string;
  name: string;
  reconnectToken: string;
  socketId: string | null;
  lobbyCode: string | null;
  connected: boolean;
  lastSeen: number;
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').replace(/[\s]+/g, ' ').trim().slice(0, NAME_MAX);
  return trimmed || 'Stranger';
}

export class SessionManager {
  private byId = new Map<string, PlayerSession>();
  private bySocket = new Map<string, string>();
  private byToken = new Map<string, string>();

  identify(
    socketId: string,
    name: string,
    reconnectToken?: string
  ): PlayerSession {
    const cleanName = sanitizeName(name);

    if (reconnectToken && this.byToken.has(reconnectToken)) {
      const id = this.byToken.get(reconnectToken)!;
      const existing = this.byId.get(id);
      if (existing) {
        if (existing.socketId && existing.socketId !== socketId) {
          this.bySocket.delete(existing.socketId);
        }
        existing.socketId = socketId;
        existing.connected = true;
        existing.name = cleanName;
        existing.lastSeen = Date.now();
        this.bySocket.set(socketId, id);
        return existing;
      }
    }

    const id = generatePlayerId();
    const token = generateReconnectToken();
    const session: PlayerSession = {
      id,
      name: cleanName,
      reconnectToken: token,
      socketId,
      lobbyCode: null,
      connected: true,
      lastSeen: Date.now(),
    };
    this.byId.set(id, session);
    this.byToken.set(token, id);
    this.bySocket.set(socketId, id);
    return session;
  }

  bindLobby(playerId: string, code: string | null): void {
    const s = this.byId.get(playerId);
    if (s) s.lobbyCode = code;
  }

  getBySocket(socketId: string): PlayerSession | undefined {
    const id = this.bySocket.get(socketId);
    return id ? this.byId.get(id) : undefined;
  }

  getById(id: string): PlayerSession | undefined {
    return this.byId.get(id);
  }

  rename(playerId: string, name: string): void {
    const s = this.byId.get(playerId);
    if (s) s.name = sanitizeName(name);
  }

  disconnect(socketId: string): PlayerSession | undefined {
    const id = this.bySocket.get(socketId);
    if (!id) return undefined;
    const s = this.byId.get(id);
    if (s) {
      s.connected = false;
      s.socketId = null;
      s.lastSeen = Date.now();
    }
    this.bySocket.delete(socketId);
    return s;
  }

  /** Permanently remove sessions older than maxAge ms that aren't in a lobby. */
  prune(maxAge: number): void {
    const now = Date.now();
    for (const [id, s] of this.byId) {
      if (s.connected) continue;
      if (s.lobbyCode) continue;
      if (now - s.lastSeen < maxAge) continue;
      this.byId.delete(id);
      this.byToken.delete(s.reconnectToken);
    }
  }
}
