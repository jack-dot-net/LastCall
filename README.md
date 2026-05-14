# Last Call

Last Call is an original online multiplayer bluffing game for up to 8 players. It is inspired by tense social deduction tavern games, but uses original branding, visuals, rules, UI, and implementation.

## Features

- Online multiplayer lobbies with unique 5-character game codes
- Real-time Socket.io synchronization
- Up to 8 players per lobby
- Host migration when the host leaves
- Ready/unready lobby flow
- Server-authoritative hands, turns, claims, challenges, life totals, and win checks
- Duplicate-name, invalid-code, full-lobby, invalid-action, and out-of-turn validation
- Reconnect tokens stored locally, with mid-game grace handling
- Premium dark tavern/casino UI with responsive desktop and mobile layouts
- Local settings panel with iOS-style toggles
- Render.com-ready Express deployment

## Local Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On Windows PowerShell, if `npm` is blocked by script policy, use:

```bash
npm.cmd install
npm.cmd run dev
```

## Production Start

```bash
npm start
```

The server binds to `process.env.PORT` and serves the static frontend from `public/`.

## Render.com Deployment

This repository includes `render.yaml`.

1. Create a new Blueprint on Render.
2. Point it at this repository.
3. Render will run `npm install`.
4. Render will start the service with `npm start`.

Required environment variables:

- `PORT`: provided automatically by Render
- `NODE_ENV`: optional, set to `production` if desired

Socket.io runs on the same Express web service, so WebSockets work through Render's normal web service routing.

## Gameplay Rules

1. Create a game and share the lobby code, or join an existing game with a code.
2. Everyone readies up. The host starts the game.
3. Each player begins with 3 lives.
4. Each round deals 5 hidden cards to every surviving player.
5. The table names a claim rank: `Crows`, `Moons`, or `Keys`.
6. On your turn, play 1-3 cards face down and claim they match the round rank.
7. `Ember` cards are wild and count as any rank.
8. The next player can either make their own claim or call bluff.
9. If the revealed cards all match, the caller loses a life.
10. If any revealed card fails, the bluffer loses a life.
11. Players with 0 lives become spectators.
12. The last surviving player wins.

## Controls

- `Create Game`: starts a new lobby and generates a code
- `Join Game`: joins an existing lobby by code
- `Ready` / `Unready`: toggles lobby readiness
- `Start Game`: host-only, enabled when the lobby is ready
- Card click/tap: selects or deselects a card
- `Play Selected`: submits 1-3 selected cards as the current rank
- `Call Bluff`: challenges the previous claim
- `Settings`: opens local UI/game preferences

## Settings

Settings are saved in `localStorage` and apply immediately where possible.

- Sound effects
- Music preference
- Reduced motion
- Fullscreen mode
- Action log visibility
- Cinematic dark mode

## Project Structure

```text
.
├── server.js          # Express, Socket.io, room management, authoritative game engine
├── public/
│   ├── index.html     # App shell and accessible UI structure
│   ├── client.js      # Socket client, rendering, settings, interactions
│   └── style.css      # Responsive cinematic tavern/casino visual system
├── package.json       # Scripts and dependencies
├── render.yaml        # Render Blueprint
└── README.md
```

## Quality Checks

Run:

```bash
npm test
```

Manual verification performed during implementation:

- Local server start on a test port
- Browser load of the menu and lobby with no console errors
- Socket.io multiplayer simulation covering create, join, ready, start, play, challenge, reveal, and state sync

## Known Limitations

- Lobby and game state are in memory, so active games reset when the server restarts.
- Reconnect is best-effort and depends on the same browser retaining its local reconnect token.
- Voice/video chat is not included; players should use an external call if they want live table talk.
