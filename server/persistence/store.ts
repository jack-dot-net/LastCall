import fs from 'node:fs';
import path from 'node:path';
import { log } from '../util/log.ts';

export interface MatchRecord {
  id: string;
  lobbyCode: string;
  lobbyName: string;
  mode: string;
  winnerName: string;
  playerCount: number;
  rounds: number;
  startedAt: number;
  endedAt: number;
}

export interface PersistedState {
  matches: MatchRecord[];
}

const DEFAULT_STATE: PersistedState = { matches: [] };
const MAX_MATCHES = 200;

export class JsonStore {
  private dir: string;
  private file: string;
  private state: PersistedState;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.state = this.load();
  }

  private load(): PersistedState {
    try {
      if (!fs.existsSync(this.dir)) {
        fs.mkdirSync(this.dir, { recursive: true });
      }
      if (!fs.existsSync(this.file)) return { ...DEFAULT_STATE };
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return { matches: parsed.matches ?? [] };
    } catch (e) {
      log.error('Failed to load persisted state:', e);
      return { ...DEFAULT_STATE };
    }
  }

  private save(): void {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writePromise = this.writePromise.then(
      () =>
        new Promise((resolve) => {
          fs.writeFile(this.file, snapshot, 'utf8', (err) => {
            if (err) log.error('Failed to persist state:', err);
            resolve();
          });
        })
    );
  }

  recordMatch(record: MatchRecord): void {
    this.state.matches.unshift(record);
    if (this.state.matches.length > MAX_MATCHES) {
      this.state.matches.length = MAX_MATCHES;
    }
    this.save();
  }

  recentMatches(limit = 20): MatchRecord[] {
    return this.state.matches.slice(0, limit);
  }
}
