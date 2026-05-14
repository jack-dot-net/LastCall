import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  AuthResult,
} from '@shared/types';

export type LCSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const STORAGE_TOKEN = 'lastcall.reconnectToken';
const STORAGE_NAME = 'lastcall.playerName';

let socket: LCSocket | null = null;

export function getSocket(): LCSocket {
  if (socket) return socket;
  socket = io({
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function loadStoredName(): string {
  return localStorage.getItem(STORAGE_NAME) || 'Stranger';
}

export function loadStoredToken(): string | undefined {
  return localStorage.getItem(STORAGE_TOKEN) || undefined;
}

export function persistName(name: string): void {
  localStorage.setItem(STORAGE_NAME, name);
}

export function persistToken(token: string): void {
  localStorage.setItem(STORAGE_TOKEN, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_TOKEN);
}

export function identify(name: string): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    const token = loadStoredToken();
    s.emit(
      'auth:identify',
      { name, reconnectToken: token },
      (res) => {
        if ('ok' in res && res.ok) {
          persistName(res.name);
          persistToken(res.reconnectToken);
          resolve(res);
        } else {
          reject(new Error('error' in res ? res.error : 'Identify failed'));
        }
      }
    );
  });
}
