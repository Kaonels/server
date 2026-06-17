# DITCOIN SPACEX TOWN — Online Server

This makes the game **multiplayer worldwide** and lets wallet players **register & save** their character/progress.

One small Node process does two jobs:
- **WebSocket** — live presence so everyone sees each other moving, dancing, emoting in real time.
- **HTTP API** — Sign-In-With-Solana login + per-wallet save (game, character, purchases).

## 1. Deploy (Railway — easiest)

1. Push this `server/` folder to a GitHub repo (or drag-drop on Railway).
2. On https://railway.app → **New Project → Deploy from repo** (or **Empty → Add service → from this folder**).
3. Railway auto-detects Node and runs `npm start`. It gives you a public URL like:
   `https://ditcoin-spacex-town-production.up.railway.app`
4. (Optional) Set env vars:
   - `CLIENT_ORIGIN` = your site origin (e.g. `https://ditcoin.fun`) for stricter CORS.
   - `DATABASE_URL` = a Postgres URL if you switch on the Postgres block (recommended for production so saves survive restarts).

Render/Fly work the same way: Node service, start command `npm start`.

## 2. Point the game at your server

In `index.html`, find this line and fill both URLs:

```js
const SERVER = { base:'', ws:'' };
```

Set it to your deployed host (note `https` for base, `wss` for ws):

```js
const SERVER = {
  base: 'https://ditcoin-spacex-town-production.up.railway.app',
  ws:   'wss://ditcoin-spacex-town-production.up.railway.app'
};
```

Redeploy the site (Vercel). That's it — players who **Connect Phantom** now:
- see each other live (real online count + 🌐 name tags),
- get their progress synced to their wallet across devices.

Guests still play offline against the simulated crowd.

## 3. Production notes
- Swap the JSON-file store for **Postgres** (uncomment the `pg` block at the bottom of `server.js`, create the `saves` table, set `DATABASE_URL`). The file store is fine for testing but resets when the container restarts.
- Cookies use `SameSite=None; Secure`, so the server must be served over **https/wss** (Railway/Render give you this automatically).
- For real on-chain purchases, verify the buyer's signed transaction server-side before granting premium items, then record the item under their wallet in `saves`.
