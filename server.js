// Oyun sunucusu: oda sistemi + otoriter isabet/hasar hesabı.
// Çalıştır: npm install && npm start   (PORT ortam değişkeni desteklenir)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  WEAPONS, PLAYER, SPAWNS, SCORE_LIMIT, MAX_PLAYERS, RESPAWN_TIME,
  rayBoxes, rayPlayer,
} from './www/shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(__dirname, 'www');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// Aynı sunucu hem oyunu (tarayıcıda test için) hem WebSocket'i sunar.
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(WWW, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('yok'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

const rooms = new Map(); // kod -> room
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, except) {
  const s = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws !== except && p.ws.readyState === 1) p.ws.send(s);
  }
}

function makeRoom(code) {
  return { code, players: new Map(), score: [0, 0], over: false, spawnIdx: [0, 0] };
}

function pickTeam(room) {
  const c = [0, 0];
  for (const p of room.players.values()) c[p.team]++;
  return c[0] <= c[1] ? 0 : 1;
}

function spawnPlayer(room, p) {
  const list = SPAWNS[p.team];
  const sp = list[room.spawnIdx[p.team]++ % list.length];
  p.x = sp.x; p.y = 0; p.z = sp.z; p.yaw = sp.yaw; p.pitch = 0;
  p.hp = PLAYER.MAX_HP; p.alive = true; p.w = 0; p.protectUntil = Date.now() + 2000;
  send(p.ws, { t: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp });
}

function fullInfo(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, team: p.team, k: p.k, d: p.d,
  }));
}

function endMatchIfNeeded(room) {
  const winner = room.score[0] >= SCORE_LIMIT ? 0 : room.score[1] >= SCORE_LIMIT ? 1 : -1;
  if (winner < 0 || room.over) return;
  room.over = true;
  broadcast(room, { t: 'over', winner, score: room.score, players: fullInfo(room) });
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.score = [0, 0]; room.over = false;
    for (const p of room.players.values()) { p.k = 0; p.d = 0; spawnPlayer(room, p); }
    broadcast(room, { t: 'reset', players: fullInfo(room) });
  }, 9000);
}

function handleShoot(room, p, m) {
  if (!p.alive || room.over) return;
  const wp = WEAPONS[p.w] || WEAPONS[0];
  const now = Date.now();
  if (now - p.lastShot < wp.rate * 1000 * 0.8) return; // hız sınırı (hile önleme)
  p.lastShot = now;

  // Işın başlangıcı sunucunun bildiği konumdan (client'ın gönderdiğine güvenme)
  const ox = p.x, oy = p.y + PLAYER.EYE, oz = p.z;
  let dx = +m.dx, dy = +m.dy, dz = +m.dz;
  const len = Math.hypot(dx, dy, dz);
  if (!isFinite(len) || len < 0.5) return;
  dx /= len; dy /= len; dz /= len;

  broadcast(room, { t: 'shot', id: p.id, w: p.w }, p.ws);

  const wallT = rayBoxes(ox, oy, oz, dx, dy, dz, wp.range);
  let best = null;
  for (const q of room.players.values()) {
    if (q === p || !q.alive || q.team === p.team || now < q.protectUntil) continue;
    const h = rayPlayer(ox, oy, oz, dx, dy, dz, q.x, q.y, q.z);
    if (h && h.t < wallT && (!best || h.t < best.t)) best = { q, t: h.t, head: h.head };
  }
  if (!best) return;

  const dmg = best.head ? wp.head : wp.body;
  const q = best.q;
  q.hp -= dmg;
  send(p.ws, { t: 'hitmark', head: best.head, kill: q.hp <= 0 });
  send(q.ws, { t: 'hurt', hp: Math.max(q.hp, 0), from: p.id, head: best.head });

  if (q.hp <= 0) {
    q.alive = false; q.d++; p.k++;
    room.score[p.team]++;
    broadcast(room, {
      t: 'kill', killer: p.id, victim: q.id, head: best.head, w: p.w,
      score: room.score, kn: p.name, vn: q.name, kt: p.team, vt: q.team,
    });
    broadcast(room, { t: 'roster', players: fullInfo(room) });
    setTimeout(() => {
      if (room.players.has(q.id) && !room.over) spawnPlayer(room, q);
    }, RESPAWN_TIME * 1000);
    endMatchIfNeeded(room);
  }
}

wss.on('connection', (ws) => {
  let room = null, me = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !me) {
      let code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (m.create || !code) code = newCode();
      room = rooms.get(code);
      if (!room) {
        if (!m.create) { send(ws, { t: 'err', msg: 'Oda bulunamadı: ' + code }); return; }
        room = makeRoom(code); rooms.set(code, room);
      }
      if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'err', msg: 'Oda dolu' }); room = null; return; }
      const name = String(m.name || 'Oyuncu').replace(/[<>&"']/g, '').slice(0, 12) || 'Oyuncu';
      me = {
        id: nextId++, ws, name, team: pickTeam(room), k: 0, d: 0,
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false, w: 0,
        lastShot: 0, protectUntil: 0,
      };
      room.players.set(me.id, me);
      send(ws, { t: 'welcome', id: me.id, room: room.code, team: me.team, score: room.score, players: fullInfo(room) });
      spawnPlayer(room, me);
      broadcast(room, { t: 'roster', players: fullInfo(room) });
      return;
    }

    if (!me || !room) return;

    if (m.t === 's') { // konum güncellemesi
      if (!me.alive) return;
      const x = +m.x, y = +m.y, z = +m.z;
      if (![x, y, z].every(Number.isFinite)) return;
      // basit ışınlanma/hız koruması
      if (Math.hypot(x - me.x, z - me.z) > 4) { send(ws, { t: 'spawn', x: me.x, y: me.y, z: me.z, yaw: me.yaw, hp: me.hp }); return; }
      me.x = x; me.y = y; me.z = z;
      me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      me.w = m.w | 0;
    } else if (m.t === 'shoot') {
      handleShoot(room, me, m);
    } else if (m.t === 'ping') {
      send(ws, { t: 'pong', c: m.c });
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    if (room.players.size === 0) rooms.delete(room.code);
    else broadcast(room, { t: 'roster', players: fullInfo(room) });
  });
});

// 20 Hz anlık durum yayını
setInterval(() => {
  for (const room of rooms.values()) {
    const p = [];
    for (const q of room.players.values()) {
      p.push([q.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2),
        +q.yaw.toFixed(2), +q.pitch.toFixed(2), q.alive ? 1 : 0, q.w]);
    }
    broadcast(room, { t: 'snap', p });
  }
}, 50);

server.listen(PORT, () => console.log('Sunucu hazır: http://localhost:' + PORT));
