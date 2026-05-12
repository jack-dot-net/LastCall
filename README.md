# Liar's Bar

A web-based multiplayer Liar's Bar game. Bluff, call LIAR, spin the chamber — last player breathing wins.

Built with Node.js + Express + Socket.IO. Designed for one-click deploy to Render.

## Run locally

```bash
npm install
npm start
```

Open <http://localhost:3000>. Create a room in one tab, then open more tabs (or share the room code over the network) and join with the code. Minimum 2 players, max 12. The deck scales with player count (each additional 4 players adds another standard 20-card deck) so there are always enough cards.

## Deploy to Render

1. Push this folder to a new GitHub repo.
2. Go to <https://render.com> → **New** → **Web Service** → connect your repo.
3. Render will auto-detect Node. Confirm:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node (≥18)
4. Click **Create Web Service**. Render gives you a public `https://*.onrender.com` URL.

WebSockets work on Render's free tier, so Socket.IO is happy out of the box. The app reads `PORT` from the environment, which Render sets automatically.

> **Note on the free tier:** Render spins down free services after ~15 minutes of inactivity. The first request after sleep takes ~30 seconds. Upgrade or use a keep-alive ping if that matters.

## How to play

- Deck: 6 Kings, 6 Queens, 6 Aces, 2 Jokers (Jokers are wild).
- Each round, one rank is the "table card" and everyone is dealt 5 cards.
- On your turn, either:
  - **Play 1–3 cards face down**, claiming they are all the table card (or Jokers).
  - **Call LIAR!** on the previous player.
- If LIAR is called, the last cards played are revealed. The liar — or the false accuser — pulls the trigger on their own gun.
- Each gun has 6 chambers and 1 bullet. The chamber advances with every shot; it gets more dangerous the longer you live.
- Last one breathing wins.

## Project layout

```
liars-bar/
├── server.js         # Express + Socket.IO server, all game logic
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js     # Vanilla JS client
└── README.md
```
"# Liars-Bar-Like" 
