// Play Ditcoin — realtime multiplayer server (WebSocket relay) + static host.
// Railway provides PORT. The game is served at "/" and connects its WebSocket to the
// SAME origin (see the window.DITCOIN_SERVER injection in public/index.html).
// Protocol (verified against the client):
//   client -> server: {t:'join',name,pub,x,y,look}, {t:'pos',x,y,px,py,emote,look}, {t:'chat',text}
//   server -> client: {t:'welcome',id}, {t:'state',count,players:[...]}, {t:'chat',name,text}
const http = require('http');
const path = require('path');
const fs   = require('fs');
const { WebSocketServer } = require('ws');

const PORT   = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json', '.svg':'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // --- minimal HTTP API stubs for wallet auth / cloud save (swap in a real DB later) ---
  if (url.startsWith('/auth/') || url.startsWith('/save') || url.startsWith('/load')) {
    res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify({ ok:true, message:'ditcoin-'+Date.now() }));
    return;
  }
  // --- static files (the game) ---
  let p = (url === '/' || url === '') ? '/index.html' : url;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- realtime relay ----
const wss = new WebSocketServer({ server });
const players = new Map();   // ws -> {id,name,x,y,px,py,emote,look}
let nextId = 1;

function broadcast() {
  const list = [...players.values()];
  const playing  = list.filter(p => !p.spec).length;   // real players
  const watching = list.filter(p =>  p.spec).length;   // guest spectators
  const msg = JSON.stringify({ t:'state', count:playing, watching:watching, players:list });
  for (const ws of wss.clients) if (ws.readyState === 1) { try { ws.send(msg); } catch (e) {} }
}
setInterval(broadcast, 200);   // 5 Hz world sync

wss.on('connection', (ws) => {
  const id = String(nextId++);
  players.set(ws, { id, name:'Player', x:29, y:29, px:0, py:0, emote:null, look:{} });
  try { ws.send(JSON.stringify({ t:'welcome', id })); } catch (e) {}
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const p = players.get(ws); if (!p) return;
    if (m.t === 'join' || m.t === 'pos') {
      for (const k of ['name','x','y','px','py','emote','spec','look']) if (k in m) p[k] = m[k];
    } else if (m.t === 'chat') {
      const cm = JSON.stringify({ t:'chat', name:p.name, text:String(m.text || '').slice(0, 160) });
      for (const c of wss.clients) if (c !== ws && c.readyState === 1) { try { c.send(cm); } catch (e) {} }  // don't echo to sender
    }
  });
  ws.on('close', () => players.delete(ws));
  ws.on('error', () => players.delete(ws));
});

server.listen(PORT, () => console.log('Play Ditcoin server listening on :' + PORT));
