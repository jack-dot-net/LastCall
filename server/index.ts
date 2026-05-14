import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../shared/types.ts';
import { JsonStore } from './persistence/store.ts';
import { attachHandlers, createContext } from './socket/handlers.ts';
import { log } from './util/log.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';
const DATA_DIR =
  process.env.DATA_DIR ?? path.resolve(__dirname, '..', 'data');
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
const httpServer = http.createServer(app);

// Trust proxy when deployed behind one (e.g. Render).
app.set('trust proxy', 1);

app.use(express.json({ limit: '32kb' }));

// Healthcheck.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), env: NODE_ENV });
});

// Static client in production.
const clientDist = path.resolve(__dirname, '..', 'dist');
if (IS_PROD) {
  app.use(express.static(clientDist, { maxAge: '1h', extensions: ['html'] }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: IS_PROD
    ? { origin: false }
    : { origin: CORS_ORIGINS, credentials: false },
  pingInterval: 20000,
  pingTimeout: 20000,
  maxHttpBufferSize: 32_000,
});

const store = new JsonStore(DATA_DIR);
const context = createContext(io, store);
attachHandlers(context);

httpServer.listen(PORT, () => {
  log.info(`Last Call server listening on :${PORT} [${NODE_ENV}]`);
  if (!IS_PROD) {
    log.info(`Dev mode — accepting CORS from: ${CORS_ORIGINS.join(', ')}`);
  }
});

function shutdown(): void {
  log.info('shutting down');
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
