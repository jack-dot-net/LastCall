# Liar's Bar

A web-based multiplayer game with three modes — all share the same revolver: bluff, call LIAR, the loser pulls the trigger. Last one breathing wins.

- **Liar's Cards** — Kings, Queens, Aces, and wild Jokers. Play 1–3 face down claiming they match the table card.
- **Liar's Dice** — 5 hidden dice each. Bid quantity × face across all dice (1s are wild). Raise or call.
- **Poker** — Same flow as Liar's Cards but with a 52-card poker deck plus 2 wild Jokers. Each round picks a random target rank (2–A); you play 1–3 cards face down claiming they match.

Built with Node.js + Express + Socket.IO and 2D sprites (no build step, no framework). Designed for one-click deploy to Render.

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

Each gun has 6 chambers and 1 bullet at a random position. The chamber advances with every shot — it gets more dangerous the longer you live. Last one breathing wins.

### Liar's Cards
- Deck: 6 Kings, 6 Queens, 6 Aces, 2 wild Jokers (scaled up for >4 players).
- Each round, one rank is the "table card" and everyone is dealt 5 cards.
- On your turn, play 1–3 cards face down claiming they're the table card (or Jokers), or call LIAR.
- LIAR revealed: liar shoots if they lied; false accuser shoots if the bluff was clean.

### Liar's Dice
- Everyone rolls 5 hidden dice.
- Bid format: `quantity × face` (e.g. "5 × 4" — claiming at least five 4s across all players' dice).
- Each next bid must strictly increase: higher quantity, OR same quantity with higher face.
- 1s are wild — they count as whatever face is being bid (except when 1 itself is bid).
- Call LIAR to reveal all dice; if the count meets the bid, the caller loses; otherwise the bidder loses.

### Poker
- Standard 52-card deck plus 2 wild Jokers (scaled up if needed for big games).
- Each round one rank (2 through A) is randomly chosen as the target. Each player is dealt 5 cards.
- On your turn, play 1–3 cards face down claiming they're the target rank (Jokers always count as a match), or call LIAR.
- LIAR resolves the same way as Liar's Cards: liar shoots if they lied, false accuser shoots otherwise.

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
