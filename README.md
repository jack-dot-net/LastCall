# Last Call

An original online multiplayer bluffing bar game for up to 8 players. Inspired by tense social-deduction tavern games — rebuilt from scratch with original branding, rules, UI, and implementation.

> Deal five cards. Claim the call. Bluff or play it straight. Get called out, and you're pulling **The Bell** — six chambers, Russian-roulette odds, one chamber that costs you a life. Last drinker standing closes the bar.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Framer Motion + Zustand
- **Backend**: Node.js + Express + Socket.IO (server-authoritative game engine, TypeScript via tsx)
- **Persistence**: JSON files only (match history under `./data/state.json`) — no database
- **Deploy**: Render.com (Blueprint) or Docker

## Quick Start (local)

```bash
npm install
npm run dev
```

Open http://localhost:5173.

The Vite dev server runs on `:5173` and proxies `/socket.io` and `/api` to the backend on `:3001`. Both processes are started by the single `npm run dev` script (concurrent).

To simulate multiple players locally, open two browser tabs (or browsers) — each gets its own session. Reconnect tokens are stored per-browser in `localStorage`.

## Production Build

```bash
npm run build       # bundles client to ./dist
npm start           # serves client + Socket.IO on $PORT (default 3001)
```

## Environment Variables

Copy `.env.example` to `.env` and edit as needed. All are optional.

| Variable       | Default                  | Notes                                            |
|----------------|--------------------------|--------------------------------------------------|
| `PORT`         | `3001`                   | Render injects this automatically                |
| `NODE_ENV`     | `development`            | Set `production` to enable static client serving |
| `CORS_ORIGINS` | `http://localhost:5173`  | Comma-separated; dev only                        |
| `DATA_DIR`     | `./data`                 | Where `state.json` is written                    |

## Deploy to Render.com

This repo ships a Render Blueprint (`render.yaml`).

1. Push the repo to GitHub.
2. In Render, create a new **Blueprint** and point it at the repo.
3. Render will:
   - Run `npm install && npm run build`
   - Start `npm start`
   - Health-check `/api/health`
4. Socket.IO works over the same web service — no extra config needed.

Free tier note: instances spin down after idleness. The first reconnect after wake takes a few seconds.

## Docker

```bash
docker build -t last-call .
docker run --rm -p 3001:3001 -e NODE_ENV=production last-call
```

## Gameplay (Liar's Bar rules)

1. **Create or join a lobby.** Lobby codes are 6 characters (e.g. `EMBR42`). Up to 8 seats.
2. **Ready up.** The host starts the match once everyone is ready (minimum 2 players).
3. **The call.** Each round names a table card — **Whiskey**, **Gin**, or **Rum**.
4. **The deal.** Every alive player gets 5 cards (kept private). Card supply: 14 of each suit + 4 **Wilds** that count as any rank.
5. **Open the round.** The starting player (last round's bell-puller, or the seat after them if eliminated) plays **1–3 cards face down** and claims they all match the table call.
6. **The chain.** The next player has two choices:
   - **Play 1–3 of their own cards** — implicitly trusting the previous play. The pile keeps growing. Decision burden passes to the *next* player.
   - **Call LIAR!** — only the *last* batch on the pile is flipped. If any of those cards isn't the call (and isn't wild), the player who played them loses. Otherwise the challenger loses.
7. **No refills mid-round.** Cards you play this round are *gone* until the round ends. If you empty your hand, you're not eliminated — but you can only sit and watch until someone calls LIAR. If your turn to *decide* comes back around and you have zero cards, your only option is LIAR.
8. **The Bell.** The loser pulls a six-chamber bell rope. Escalating odds: 1/6 on the first pull, 1/5 on the next safe pull, ... 1/1 on the sixth. A ring costs a life and resets the chambers; a safe pull bumps you closer to the next one.
9. **Round over.** The bell-puller (if alive) starts the next round with a fresh deal and a new call.
10. **Lose all your lives → spectator.** The last surviving player wins.

## Controls

- **Click / tap** a card to select (up to 3). Selected cards lift.
- **Play** commits 1–3 face-down cards under the current call. In the middle of a chain, *playing is how you trust* the previous play.
- **LIAR!** reveals the previous play only.
- **Pull the Rope** triggers your bell pull when you've lost the round.
- **Reaction emojis** float above your seat for other players to see.
- **Chat** is available in the lobby; event log is available in-game.

## Multiplayer & networking

- Server-authoritative game state — clients never compute lying, life loss, or bell odds locally.
- Reconnect tokens persist per-browser in `localStorage`. If you refresh or briefly lose connection, you'll rejoin your seat for up to 60 seconds.
- Host migration: if the host leaves, the next seated player becomes host.
- Mid-game departures are treated as eliminations; the round advances automatically.
- Rate limiting on chat, lobby create/join, and reactions prevents trivial spam.

## Settings

Stored in `localStorage`, applied immediately:

- Master audio + per-channel volume sliders (music / ambient / SFX)
- Bloom & smoke atmospheric layers
- Reduced motion (disables transitions)
- "Confirm before playing" guard
- Haptic-style feedback (visual flashes on touch)

## Project Structure

```
.
├── index.html              # Vite entry
├── vite.config.ts          # Dev server + /socket.io proxy
├── package.json            # Single root package
├── tsconfig.json           # Client TS config
├── tsconfig.server.json    # Server TS check config
├── tailwind.config.ts
├── postcss.config.js
├── render.yaml             # Render Blueprint
├── Dockerfile
├── shared/
│   └── types.ts            # Wire protocol shared by client+server
├── server/
│   ├── index.ts            # Express + Socket.IO + static serving
│   ├── game/
│   │   ├── deck.ts         # Deck, shuffle, dealing
│   │   ├── lobby.ts        # Lobby + authoritative game engine
│   │   └── sessions.ts     # Player sessions + reconnect tokens
│   ├── socket/handlers.ts  # All socket.io event handlers
│   ├── persistence/store.ts # JSON file persistence
│   └── util/{codes,log}.ts
└── src/                    # React app
    ├── main.tsx
    ├── App.tsx             # Socket wiring, routing, modal/toast host
    ├── index.css / styles.css
    ├── lib/socket.ts       # Singleton socket.io-client + auth
    ├── store/game.ts       # Zustand global store
    ├── components/         # Atmosphere, Modal, Toast, Card, BellOverlay, primitives
    └── screens/            # Menu, LobbyBrowser, CreateLobby, JoinByCode, LobbyRoom, Game, Settings
```

## Known limitations

- Match state is in-memory; if the server restarts mid-game, lobbies are lost (clients return to the menu).
- No spectate-from-outside: spectator mode is automatic only for eliminated players inside a match.
- Audio toggles + volume sliders persist preferences but the design ships without bundled audio assets — drop your own files into `public/sfx/` and wire them up if desired.
- Render free tier sleeps after ~15 minutes idle. Players reconnecting after wake will see a brief loading screen.

## Scripts

| Command          | What it does                                     |
|------------------|--------------------------------------------------|
| `npm run dev`    | Vite + Socket.IO server concurrently             |
| `npm run build`  | Bundle client to `./dist`                        |
| `npm start`      | Run production server (serves `./dist`)          |
| `npm run typecheck` | Strict TS check across client and server      |
| `npm run preview` | Vite preview server for the built client only   |

## License

Original work. All names, art directions, and code in this repo are original — no third-party game assets, branding, or copyrighted mechanics are reused.
