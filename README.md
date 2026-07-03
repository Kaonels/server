# Play Ditcoin — server (Railway)

Realtime multiplayer **WebSocket relay** + static host for the game. One Railway service serves
the game at `/` and runs the realtime server on the same origin (the game auto-connects — no config).

## What's inside
- `server.js` — Node HTTP static host + `ws` WebSocket relay (protocol: `join/pos → welcome/state/chat`).
- `public/index.html` — the game, with `window.DITCOIN_SERVER` injected so it connects to its own origin.
- `package.json`, `railway.json` — Railway/Nixpacks build + `npm start`.

## Deploy to Railway (one time — needs YOUR Railway login)

**Option A — CLI (fastest):**
```bash
npm i -g @railway/cli
cd ditcoin-server
railway login          # opens your browser to authenticate (only you can do this)
railway init           # create a new project
railway up             # build & deploy
railway domain         # get your public https URL
```
Open the URL → the game loads and connects multiplayer automatically. Share it; players see each other live.

**Option B — GitHub + Railway dashboard:**
1. Push this folder to a new GitHub repo.
2. railway.app → New Project → Deploy from GitHub repo → pick it.
3. Railway auto-detects Node, runs `npm start`, gives a domain. Done.

## Local run (needs Node 18+)
```bash
npm install
npm start          # http://localhost:8080
```

## Notes / next steps
- The `/auth/*` and `/save` routes are stubs — wire a real DB (Postgres/Redis) + Phantom signature
  verification for persistent accounts & cloud saves (the client already calls them via `SERVER.base`).
- To update the game: re-copy the latest `index-3.html` into `public/index.html` (keep the
  `window.DITCOIN_SERVER` script at the top) and redeploy.
