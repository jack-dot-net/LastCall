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

## Gameplay

1. **Create or join a lobby.** Lobby codes are 6 characters (e.g. `EMBR42`). Up to 8 seats.
2. **Ready up.** The host starts the round once everyone is ready (minimum 2 players).
3. **The call.** Each round names a rank — **Whiskey**, **Gin**, or **Rum**.
4. **Play.** On your turn, play 1–3 cards face down and claim they all match the call.
   - **Wild** cards count as any rank.
5. **The next player decides.** Trust the play, or shout **LIAR!**
   - **Trust** → previous play's cards stay played, player refills hand to 5, *you* must now play.
   - **Challenge** → cards are revealed. If any card isn't the call (and isn't wild), the *bluffer* loses. Otherwise the *challenger* loses.
6. **The Bell.** The loser pulls the bell rope. Six chambers, escalating odds:
   - 1st pull after a fresh reset: 1/6 ring chance
   - Each safe pull advances the chamber, so the 6th is guaranteed
   - On a ring, the puller loses a life and the chambers reset
7. **Lose all your lives → spectator.** The last surviving player wins.

## Controls

- **Click / tap** a card to select (up to 3). Selected cards lift.
- **Play** sends them to the pile under the current call.
- **LIAR!** challenges the previous play.
- **Trust** accepts the play and forces you to declare next.
- **Pull the Rope** triggers your bell pull.
- **Reaction emojis** float above your seat for other players to see.
- **Chat** is available in the lobby (lobby room) and event log (in-game).

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
