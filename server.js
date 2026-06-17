/* DITCOIN SPACEX TOWN — realtime + auth + save server
 * Deploy on Railway / Render / Fly. One process serves:
 *   - WebSocket  : live presence (players see each other worldwide)
 *   - HTTP API   : Sign-In-With-Solana auth + per-wallet save
 *
 * In the game client (index.html) set:
 *   const SERVER = { base:'https://YOUR-APP.up.railway.app', ws:'wss://YOUR-APP.up.railway.app' };
 *
 * Storage: this demo keeps saves in a JSON file (saves.json). For production use
 * Postgres (see the commented pg block at the bottom) so data survives restarts/scales.
 */
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
// With credentials, CORS cannot be '*'. Default reflects the caller's origin (works with cookies);
// set CLIENT_ORIGIN to lock it to your Vercel domain in production.
const ORIGIN = process.env.CLIENT_ORIGIN || true;
const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use(cors({ origin: ORIGIN, credentials: true }));

// ---- tiny file store (swap for Postgres in prod) ----
const FILE = process.env.SAVE_FILE || './saves.json';
let saves = {};
try { saves = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
let writePending = false;
function persist() { if (writePending) return; writePending = true;
  setTimeout(() => { writePending = false; try { fs.writeFileSync(FILE, JSON.stringify(saves)); } catch (e) {} }, 800); }

// ---- Sign-In-With-Solana ----
const nonces = new Map();   // pubkey -> { nonce, exp }
const sessions = new Map(); // token  -> { pubkey, exp }
const DAY = 86400e3;

app.post('/auth/nonce', (req, res) => {
  const { pubkey } = req.body || {};
  if (!pubkey) return res.status(400).json({ error: 'pubkey required' });
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(pubkey, { nonce, exp: Date.now() + 5 * 60e3 });
  res.json({ message: `Sign in to DITCOIN SPACEX TOWN\nWallet: ${pubkey}\nNonce: ${nonce}` });
});

app.post('/auth/verify', (req, res) => {
  const { pubkey, signature } = req.body || {};
  const rec = nonces.get(pubkey);
  if (!rec || rec.exp < Date.now()) return res.status(400).json({ error: 'nonce expired' });
  try {
    const msg = new TextEncoder().encode(`Sign in to DITCOIN SPACEX TOWN\nWallet: ${pubkey}\nNonce: ${rec.nonce}`);
    const sig = Uint8Array.from(signature);
    const ok = nacl.sign.detached.verify(msg, sig, bs58.decode(pubkey));
    if (!ok) return res.status(401).json({ error: 'bad signature' });
  } catch (e) { return res.status(401).json({ error: 'verify failed' }); }
  nonces.delete(pubkey);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { pubkey, exp: Date.now() + 30 * DAY });
  res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 30 * DAY });
  res.json({ ok: true, pubkey });
});

function auth(req, res, next) {
  const t = req.cookies.sid; const s = t && sessions.get(t);
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'unauthorized' });
  req.pubkey = s.pubkey; next();
}

app.get('/save', auth, (req, res) => res.json({ data: saves[req.pubkey] || null }));
app.put('/save', auth, (req, res) => { saves[req.pubkey] = req.body.data; persist(); res.json({ ok: true }); });
app.get('/', (_req, res) => res.send('DITCOIN SPACEX TOWN server up'));

// ---- realtime presence ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const players = new Map(); // ws -> { id, name, x, y, px, py, emote, look }
let nextId = 1;

wss.on('connection', (ws) => {
  const id = 'p' + (nextId++);
  players.set(ws, { id, name: 'Player', x: 29, y: 29, px: 0, py: 0, emote: null, look: {} });
  ws.send(JSON.stringify({ t: 'welcome', id }));

  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    const p = players.get(ws); if (!p) return;
    if (m.t === 'join' || m.t === 'pos') {
      if (m.name) p.name = String(m.name).slice(0, 16);
      if (typeof m.x === 'number') p.x = m.x;
      if (typeof m.y === 'number') p.y = m.y;
      if (typeof m.px === 'number') p.px = m.px;
      if (typeof m.py === 'number') p.py = m.py;
      p.emote = m.emote || null;
      if (m.look) p.look = m.look;
    } else if (m.t === 'chat') {
      const text = String(m.text || '').slice(0, 120);
      broadcast({ t: 'chat', name: p.name, text });
    }
  });
  ws.on('close', () => players.delete(ws));
  ws.on('error', () => { try { ws.close(); } catch (e) {} });
});

function broadcast(obj) { const s = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) { try { ws.send(s); } catch (e) {} } }

// broadcast world state ~12x/sec
setInterval(() => {
  const list = [...players.values()].map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, px: p.px, py: p.py, emote: p.emote, look: p.look }));
  broadcast({ t: 'state', count: list.length, players: list });
}, 80);

server.listen(PORT, () => console.log('DITCOIN SPACEX TOWN server on :' + PORT));

/* ---- PRODUCTION: Postgres instead of the JSON file ----
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// CREATE TABLE saves (pubkey text primary key, data jsonb, updated_at timestamptz default now());
// GET : const r = await pool.query('select data from saves where pubkey=$1',[req.pubkey]); res.json({data:r.rows[0]?.data||null});
// PUT : await pool.query('insert into saves(pubkey,data) values($1,$2) on conflict(pubkey) do update set data=$2,updated_at=now()',[req.pubkey,req.body.data]);
*/
