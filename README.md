# PLAY DITCOIN

A browser **isometric MMO** modeled on **kintara.gg** — crypto / play-to-earn aesthetic, real-estate
ownership, cosmetics, and live multiplayer. Built as **one self-contained HTML file** (HTML5 Canvas +
vanilla JavaScript, no framework, no build step) plus a small Node multiplayer server.

> Token/currency naming is the project's own: **CP** (free in-game "Crypto Points" / gold), **$DITCOIN**,
> **🔮 shards**, and **SOL** (premium, via Phantom). The on-chain side is demo by default.

---

## Files
```
PLAY-DITCOIN/
├── index.html      ← THE GAME. Everything is here (UI + all game logic). Edit this.
├── server.js       ← Multiplayer WebSocket relay + static host (serves index.html). For Railway.
├── package.json    ← deps: "ws". start: node server.js
├── railway.json    ← Railway/Nixpacks config
└── README.md       ← this file
```

## Quick start
- **Just play / edit:** open `index.html` in a browser. Works fully offline (single-player + the live
  counter shows "connecting…" with no server). Edit `index.html` and refresh.
- **With multiplayer locally:** `npm install` then `npm start` → http://localhost:8080 (needs Node 18+).
  The game auto-connects its WebSocket to the same origin it's served from (a `window.DITCOIN_SERVER`
  script is injected at the very top of `index.html`).

## Deploy
- **Railway (recommended — supports persistent WebSockets):**
  ```bash
  npm i -g @railway/cli
  railway login && railway init && railway up && railway domain
  ```
  Open the https URL → game + real multiplayer + Phantom connect all work.
- **Vercel (static only — NO WebSocket server):** host `index.html`, but real multiplayer needs a WS
  server elsewhere (Railway). In `index.html`, replace the same-origin `window.DITCOIN_SERVER` script
  with `window.DITCOIN_SERVER = { ws:"wss://YOUR-railway.up.railway.app", base:"https://..." }`.

> **Phantom wallet only works on HTTPS with the Phantom extension/app installed** — never in a local
> `file://` or `http://localhost` iframe. Test connect on the deployed https URL.

---

## Architecture
- **`index.html`** = the whole client. A `<script>window.DITCOIN_SERVER={ws:same-origin}</script>` is
  injected at the top; the rest is the original game in one big `<script>`. Rendering is a single
  `requestAnimationFrame` loop drawing an isometric tilemap to one `<canvas id="game">`. Tile math:
  `isoX=(gx-gy)*32`, `isoY=(gx+gy)*16` (TW=64, TH=32).
- **`server.js`** = HTTP static host + a `ws` relay. Protocol:
  - client → server: `{t:'join',name,pub,x,y,spec,look}`, `{t:'pos',x,y,px,py,emote,spec,look}`, `{t:'chat',text}`
  - server → client: `{t:'welcome',id}`, `{t:'state',count,watching,players:[...]}`, `{t:'chat',name,text}`
  - `count` = real players, `watching` = guest spectators (the client sends `spec:true` for guests).

## Code map (search `index.html` for these — it's one file)
- **Cosmetics data:** `const WEAPONS`, `OUTFITS`, `BOOTS`, `MOUNTS`, `RODS`, `AURAS`, `FACES`, `CAPS`,
  `HAIRS`, `NAME_STYLES`, `POTIONS`, `LISTINGS`. Rarity `GEAR_RARITY` + limited mint supply.
- **Global price knob:** `const PRICE_MULT=2.5` (multiplies all CP costs at load).
- **Character render (voxel):** `drawPlayer`; mounts `drawMount` (kinds quad/dino/spider/bird/dragon, blocky);
  auras `drawAura` (body-silhouette outline like kintara); NPCs `drawHumanoid`; interior/frontier avatar `drawMascotAt`.
- **Real estate:** `houses[]`, `buildUptown()` (the organized California district), `drawHouse`, `openHouse`,
  investment helpers near `houseRadius` (`holdDays`, `houseStaked`, `resaleValueCP`, `sellHouse`, `plotsLeft`,
  `houseListing`), `stakePool` + daily dividends in `updateWar`.
- **Spectator mode:** `player.spectator` (guests); set in `onWalletChange`; pointer in `drawPlayer`;
  HUD hidden via `body.spectating` CSS; actions gated in `gather/tryFish/buyOrEquip/buyPlot/placeStructure`;
  banner `#specBanner`.
- **Multiplayer:** `connectMP`, `mpTick`, `updateRemotes`, `drawRemote`, `updateOnline` (real counter),
  `SERVER` (reads `window.DITCOIN_SERVER` or `?server=`). `connectPhantom` (window.phantom.solana || window.solana + mobile deep-link).
- **Economy/world:** gold mine is one hard cluster (rare drops); fishing `doFish`/`CATCHES`; nobility ranks
  `nobilityRank`/`playerTitle`; admin gift chests `dropGiftChest`/`claimGiftChest`; banner-plane purchase
  ticker `bannerMsgs`; server-wide announce `serverAnnounce`.

## Roadmap / not done yet
- **Apply the art packs** the owner provided (these are sprite assets to wire into the canvas render, NOT
  saved game files): `fishing_free` (fish/item sprites for the fishing loot), `Farm`, `Monsters Creatures
  Fantasy 2`. (The `isometric tileset` and `critters` boar/wolf are already applied.)
- **California map polish:** more streets/bars-for-sale, state progression (California → Texas → Pennsylvania).
- **Mansion "party / disco" mode** toggle (reuse the RGB/disco effect).
- **Recruit/defense loop** (walls/barracks/soldiers guarding the village) — owner reported it not obeying.
- **Real persistence/auth:** wire `server.js` `/auth/*` + `/save` stubs to a DB + Phantom `signMessage`
  (client already calls them via `SERVER.base`).

## ⚠️ Important design/legal note (read before building the "airdrop")
The owner wants an airdrop/rewards system. **Paying users daily returns out of other users' purchases/
deposits = a Ponzi scheme** (illegal, collapses, founder liable) — do NOT build that with real money.
Safe versions already in code: the **stake pool/dividends are in-game currency only**, and **admin gift
chests are founder-funded giveaways** (the owner pays from their own pocket = a gift, fine). Any REAL
payment must deliver the **actual item/NFT bought** (real value), never a cut of others' deposits.
