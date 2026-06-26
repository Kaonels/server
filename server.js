// ============================================================
// PLAY DITCOIN — Multiplayer Server (Railway)
// Express + Socket.io · Authoritative game state
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://playditcoin.vercel.app",
      "https://ditcoin.vercel.app",
      "https://isditcoin.vercel.app",
      "http://localhost:3000",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      // 👆 Add your Vercel URL here
    ],
    methods: ["GET", "POST"]
  }
});

// ---- CONSTANTS (must match client) ----
const MAP_W = 40, MAP_H = 40;
const BASE_SPD = 110;
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;

// ---- ROOMS ----
const rooms = new Map();

// ---- GLOBAL ONLINE COUNT ----
let totalOnline = 0;

function broadcastOnlineCount() {
  let count = 0;
  for (const [, room] of rooms) count += room.players.size;
  totalOnline = count;
  io.emit('online-count', { total: count, rooms: rooms.size });
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.mobs = [];
    this.chatLog = [];
    this.lastTick = Date.now();
    this.mobSpawnTimer = 0;
  }
}

class PlayerState {
  constructor(socketId, name, wallet) {
    this.id = socketId;
    this.name = name || 'Anon';
    this.wallet = wallet || '';
    this.x = 20; this.y = 20;
    this.px = 0; this.py = 0;
    this.tx = 20; this.ty = 20;
    this.moving = false;
    this.hp = 100; this.maxHp = 100;
    this.gold = 50; this.shards = 0;
    this.level = 1; this.xp = 0;
    this.incAcc = 0;
    this.weapon = 'fists';
    this.outfit = 'basic';
    this.boots = 'basic';
    this.cap = '';
    this.ownedItems = ['fists', 'basic'];
    this.wood = 0; this.stone = 0; this.fish = 0;
    this.shieldActive = false;
    this.shieldTimer = 0;
    this.attackCd = 0;
    this.hasJet = false;
    this.admin = false;
    this.scene = 'world';
    this.lastMoveTime = Date.now();
    this.lastAttackTime = 0;
  }

  toJSON() {
    return {
      id: this.id, name: this.name, wallet: this.wallet,
      x: this.x, y: this.y, px: this.px, py: this.py,
      tx: this.tx, ty: this.ty, moving: this.moving,
      hp: this.hp, maxHp: this.maxHp, gold: this.gold,
      shards: this.shards, level: this.level, xp: this.xp,
      weapon: this.weapon, outfit: this.outfit, boots: this.boots,
      cap: this.cap, scene: this.scene,
      shieldActive: this.shieldActive
    };
  }
}

// ---- MOB SPAWNING ----
const MOB_TYPES = [
  { kind: 'slime',    hp: 18, dmg: 3, gold: 3, shards: 1, speed: 0.6 },
  { kind: 'goblin',   hp: 28, dmg: 5, gold: 5, shards: 1, speed: 0.7 },
  { kind: 'skeleton', hp: 40, dmg: 7, gold: 8, shards: 2, speed: 0.5 },
  { kind: 'wolf',     hp: 35, dmg: 8, gold: 7, shards: 2, speed: 1.0 },
];

function spawnMob(room) {
  const type = MOB_TYPES[Math.floor(Math.random() * MOB_TYPES.length)];
  const x = 2 + Math.floor(Math.random() * (MAP_W - 4));
  const y = 2 + Math.floor(Math.random() * (MAP_H - 4));
  const mob = {
    id: 'mob_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    kind: type.kind,
    x, y, px: 0, py: 0, tx: x, ty: y,
    hp: type.hp, maxHp: type.hp, dmg: type.dmg,
    gold: type.gold, shards: type.shards, speed: type.speed,
    dead: false, respawn: 0, cd: 0
  };
  mob.px = x; mob.py = y;
  room.mobs.push(mob);
  return mob;
}

// ---- ROOM MANAGEMENT ----
function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    const room = new Room(code);
    for (let i = 0; i < 12; i++) spawnMob(room);
    rooms.set(code, room);
  }
  return rooms.get(code);
}

function cleanEmptyRooms() {
  for (const [code, room] of rooms) {
    if (room.players.size === 0) rooms.delete(code);
  }
}

// ---- WEAPON DAMAGE ----
const WEAPONS_DMG = {
  fists: 0, dagger: 7, bat: 12, axe: 15,
  w_wooden: 4, w_ironsword: 6, w_steelmace: 10,
  w_crimsonsaber: 14, w_arcanestaff: 15,
  w_emberbrand: 22, w_frostfang: 23,
  w_voidedge: 32, w_prismedge: 34,
  pistol: 22, blade: 26, rifle: 34
};

function getWeaponDmg(weaponId, level) {
  const base = WEAPONS_DMG[weaponId] || 0;
  return base + level * 2;
}

function xpForLevel(lv) { return lv * 55 + 20; }

// ---- GAME LOOP ----
function tickRoom(room, dt) {
  for (let i = room.mobs.length - 1; i >= 0; i--) {
    const m = room.mobs[i];
    if (m.dead) {
      m.respawn -= dt;
      if (m.respawn <= 0) {
        m.dead = false;
        m.hp = m.maxHp;
        m.x = 2 + Math.floor(Math.random() * (MAP_W - 4));
        m.y = 2 + Math.floor(Math.random() * (MAP_H - 4));
        m.tx = m.x; m.ty = m.y;
      }
      continue;
    }
    let nearest = null, nearDist = Infinity;
    for (const [, p] of room.players) {
      if (p.scene !== 'world') continue;
      const d = Math.abs(p.x - m.x) + Math.abs(p.y - m.y);
      if (d < nearDist) { nearDist = d; nearest = p; }
    }
    if (nearest && nearDist <= 6) {
      m.cd -= dt;
      if (nearDist <= 1 && m.cd <= 0) {
        m.cd = 1.2;
        nearest.hp = Math.max(0, nearest.hp - m.dmg);
        io.to(room.code).emit('player-damaged', {
          id: nearest.id, hp: nearest.hp, maxHp: nearest.maxHp, dmg: m.dmg, from: m.id
        });
      }
      const nx = m.x + Math.sign(nearest.x - m.x);
      const ny = m.y + Math.sign(nearest.y - m.y);
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H) {
        m.tx = nx; m.ty = ny;
      }
    }
  }

  for (const [, p] of room.players) {
    const perSec = 0.5 + p.level * 0.2;
    p.incAcc += perSec * dt;
    if (p.incAcc >= 1) {
      const add = Math.floor(p.incAcc);
      p.gold += add;
      p.incAcc -= add;
    }
    if (p.shieldActive) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) p.shieldActive = false;
    }
  }

  const aliveMobs = room.mobs.filter(m => !m.dead).length;
  if (aliveMobs < 8 + room.players.size * 2) {
    spawnMob(room);
  }
}

function broadcastState(room) {
  const players = [];
  for (const [, p] of room.players) players.push(p.toJSON());
  const mobs = room.mobs.map(m => ({
    id: m.id, kind: m.kind,
    x: m.x, y: m.y, tx: m.tx, ty: m.ty,
    hp: m.hp, maxHp: m.maxHp, dead: m.dead
  }));
  io.to(room.code).emit('game-state', { players, mobs });
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const dt = Math.min(0.05, (now - room.lastTick) / 1000);
    room.lastTick = now;
    tickRoom(room, dt);
    broadcastState(room);
  }
  cleanEmptyRooms();
}, TICK_MS);

// ---- SOCKET HANDLERS ----
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  let currentRoom = null;
  let playerState = null;

  // ---- AUTO-JOIN WORLD (no lobby needed for online count) ----
  socket.on('join-world', (data) => {
    // Join a global room so we count them as online
    // even without joining a specific game room
    socket.join('__world__');
    playerState = new PlayerState(socket.id, data?.name, data?.wallet);
    socket.emit('online-count', { total: getTotalOnline(), rooms: rooms.size });
    broadcastOnlineCount();
  });

  socket.on('create-room', (data) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = getOrCreateRoom(code);
    currentRoom = code;
    playerState = new PlayerState(socket.id, data?.name, data?.wallet);
    room.players.set(socket.id, playerState);
    socket.join(code);
    socket.emit('room-created', { code, players: getRoomPlayers(room) });
    socket.to(code).emit('player-joined', playerState.toJSON());
    broadcastOnlineCount();
  });

  socket.on('join-room', (data) => {
    const code = (data?.code || '').toUpperCase();
    if (!rooms.has(code)) {
      socket.emit('error-msg', 'Room not found');
      return;
    }
    const room = rooms.get(code);
    currentRoom = code;
    playerState = new PlayerState(socket.id, data?.name, data?.wallet);
    room.players.set(socket.id, playerState);
    socket.join(code);
    socket.emit('room-joined', {
      code, players: getRoomPlayers(room),
      mobs: room.mobs.map(m => ({
        id: m.id, kind: m.kind, x: m.x, y: m.y,
        tx: m.tx, ty: m.ty, hp: m.hp, maxHp: m.maxHp, dead: m.dead
      }))
    });
    socket.to(code).emit('player-joined', playerState.toJSON());
    broadcastOnlineCount();
  });

  socket.on('list-rooms', () => {
    const list = [];
    for (const [code, room] of rooms) {
      list.push({ code, players: room.players.size });
    }
    socket.emit('room-list', list);
  });

  socket.on('move', (data) => {
    if (!playerState || !currentRoom) return;
    const dx = Math.abs(data.x - playerState.x);
    const dy = Math.abs(data.y - playerState.y);
    if (dx > 3 || dy > 3) return;
    if (data.x < 0 || data.y < 0 || data.x >= MAP_W || data.y >= MAP_H) return;

    playerState.x = data.x;
    playerState.y = data.y;
    playerState.px = data.px;
    playerState.py = data.py;
    playerState.tx = data.tx;
    playerState.ty = data.ty;
    playerState.moving = data.moving || false;
    playerState.lastMoveTime = Date.now();
    socket.to(currentRoom).emit('player-moved', playerState.toJSON());
  });

  socket.on('attack-mob', (data) => {
    if (!playerState || !currentRoom) return;
    const now = Date.now();
    if (now - playerState.lastAttackTime < 200) return;
    playerState.lastAttackTime = now;

    const room = rooms.get(currentRoom);
    if (!room) return;
    const mob = room.mobs.find(m => m.id === data.mobId);
    if (!mob || mob.dead) return;

    const dist = Math.abs(playerState.x - mob.x) + Math.abs(playerState.y - mob.y);
    if (dist > 2) return;

    const dmg = getWeaponDmg(playerState.weapon, playerState.level) + Math.floor(Math.random() * 5);
    mob.hp -= dmg;

    if (mob.hp <= 0) {
      mob.dead = true;
      mob.respawn = 5 + Math.random() * 3;
      playerState.gold += mob.gold;
      playerState.shards += mob.shards;
      const xpGain = 8 + playerState.level * 2;
      playerState.xp += xpGain;
      const needed = xpForLevel(playerState.level);
      if (playerState.xp >= needed) {
        playerState.level++;
        playerState.xp -= needed;
        playerState.maxHp += 10;
        playerState.hp = playerState.maxHp;
      }
    }

    io.to(currentRoom).emit('mob-damaged', {
      mobId: mob.id, dmg, hp: mob.hp, maxHp: mob.maxHp, dead: mob.dead,
      killerId: mob.dead ? socket.id : null,
      gold: mob.dead ? mob.gold : 0, shards: mob.dead ? mob.shards : 0,
      xpGain: mob.dead ? (8 + playerState.level * 2) : 0,
      levelUp: false
    });
  });

  socket.on('attack-player', (data) => {
    if (!playerState || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const target = room.players.get(data.targetId);
    if (!target) return;

    const dist = Math.abs(playerState.x - target.x) + Math.abs(playerState.y - target.y);
    if (dist > 2) return;

    const dmg = getWeaponDmg(playerState.weapon, playerState.level) + Math.floor(Math.random() * 5);

    if (target.shieldActive) {
      io.to(currentRoom).emit('shield-block', { targetId: target.id, attackerId: socket.id });
      return;
    }

    target.hp = Math.max(0, target.hp - dmg);
    io.to(currentRoom).emit('player-damaged', {
      id: target.id, hp: target.hp, maxHp: target.maxHp, dmg, from: socket.id
    });

    if (target.hp <= 0) {
      setTimeout(() => {
        if (room.players.has(target.id)) {
          target.hp = target.maxHp;
          target.x = 20; target.y = 20;
          target.gold = Math.max(0, target.gold - 10);
          io.to(currentRoom).emit('player-respawned', target.toJSON());
        }
      }, 3000);
    }
  });

  socket.on('use-shield', () => {
    if (!playerState || !currentRoom) return;
    playerState.shieldActive = true;
    playerState.shieldTimer = 5;
    io.to(currentRoom).emit('shield-activated', { id: socket.id });
  });

  socket.on('buy-item', (data) => {
    if (!playerState || !currentRoom) return;
    const { itemId, cost, currency, category } = data;

    if (currency === 'cp' || currency === 'gold') {
      if (playerState.gold < cost) {
        socket.emit('error-msg', 'Not enough CP');
        return;
      }
      playerState.gold -= cost;
    } else if (currency === 'shards') {
      if (playerState.shards < cost) {
        socket.emit('error-msg', 'Not enough shards');
        return;
      }
      playerState.shards -= cost;
    } else if (currency === 'sol') {
      socket.emit('error-msg', 'SOL payments not yet live');
      return;
    }

    if (!playerState.ownedItems.includes(itemId)) {
      playerState.ownedItems.push(itemId);
    }
    if (category === 'weapon') playerState.weapon = itemId;
    else if (category === 'outfit') playerState.outfit = itemId;
    else if (category === 'boots') playerState.boots = itemId;
    else if (category === 'cap') playerState.cap = itemId;

    socket.emit('purchase-ok', {
      gold: playerState.gold, shards: playerState.shards,
      weapon: playerState.weapon, outfit: playerState.outfit,
      boots: playerState.boots, cap: playerState.cap,
      ownedItems: playerState.ownedItems
    });
    io.to(currentRoom).emit('player-updated', playerState.toJSON());
  });

  socket.on('buy-house', (data) => {
    if (!playerState || !currentRoom) return;
    io.to(currentRoom).emit('house-bought', {
      index: data.index, owner: socket.id,
      ownerName: playerState.name, tier: data.tier
    });
  });

  socket.on('place-structure', (data) => {
    if (!playerState || !currentRoom) return;
    io.to(currentRoom).emit('structure-placed', {
      ...data, ownerId: socket.id, ownerName: playerState.name
    });
  });

  socket.on('chat', (data) => {
    if (!playerState || !currentRoom) return;
    const msg = (data.msg || '').slice(0, 200);
    if (!msg.trim()) return;
    const chatMsg = {
      id: Date.now(),
      name: playerState.name,
      msg,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const room = rooms.get(currentRoom);
    if (room) {
      room.chatLog.push(chatMsg);
      if (room.chatLog.length > 100) room.chatLog.shift();
    }
    io.to(currentRoom).emit('chat', chatMsg);
  });

  socket.on('emote', (data) => {
    if (!playerState || !currentRoom) return;
    io.to(currentRoom).emit('player-emote', {
      id: socket.id, name: playerState.name, emote: data.emote
    });
  });

  socket.on('fish-catch', (data) => {
    if (!playerState || !currentRoom) return;
    playerState.gold += data.gold || 0;
    playerState.shards += data.shards || 0;
    playerState.fish++;
    socket.emit('fish-confirmed', {
      gold: playerState.gold, shards: playerState.shards,
      catch: data.catch, goldGain: data.gold, shardGain: data.shards
    });
    io.to(currentRoom).emit('player-fished', {
      id: socket.id, name: playerState.name, catch: data.catch
    });
  });

  socket.on('scene-change', (data) => {
    if (!playerState) return;
    playerState.scene = data.scene;
    if (currentRoom) io.to(currentRoom).emit('player-scene', { id: socket.id, scene: data.scene });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.players.delete(socket.id);
      socket.to(currentRoom).emit('player-left', { id: socket.id, name: playerState?.name });
      if (room.players.size === 0) {
        setTimeout(() => {
          if (room.players.size === 0) rooms.delete(currentRoom);
        }, 300000);
      }
    }
    broadcastOnlineCount();
  });
});

function getRoomPlayers(room) {
  const list = [];
  for (const [, p] of room.players) list.push(p.toJSON());
  return list;
}

function getTotalOnline() {
  let count = 0;
  for (const [, room] of rooms) count += room.players.size;
  // Also count sockets in __world__ that aren't in any room
  const worldSockets = io.sockets.adapter.rooms.get('__world__');
  if (worldSockets) {
    for (const sid of worldSockets) {
      let inRoom = false;
      for (const [, room] of rooms) {
        if (room.players.has(sid)) { inRoom = true; break; }
      }
      if (!inRoom) count++;
    }
  }
  return count;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    online: getTotalOnline(),
    players: Array.from(rooms.values()).reduce((s, r) => s + r.players.size, 0),
    uptime: process.uptime()
  });
});

// Public API: get online count (for client-side fetch before socket connects)
app.get('/api/online', (req, res) => {
  res.json({ online: getTotalOnline(), rooms: rooms.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DITCOIN Server on port ${PORT}`);
});
