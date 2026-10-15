// engine.js — oyun sunucusu mantığı (oda, isabet/hasar, skor).
// Oda kuran telefonda çalışır; arkadaşlar WebRTC (PeerJS) ile ona bağlanır.
import {
  WEAPONS, PLAYER, SPAWNS, SCORE_LIMIT, MAX_PLAYERS, RESPAWN_TIME, rayBoxes, rayPlayer,
} from './shared.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
export function newCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export function createRoom(code) {
  const room = { code, players: new Map(), score: [0, 0], over: false, spawnIdx: [0, 0], dead: false };
  let nextId = 1;

  const bc = (obj, except) => { for (const p of room.players.values()) if (p !== except) p.send(obj); };
  const fullInfo = () => [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, k: p.k, d: p.d }));
  const pickTeam = () => {
    const c = [0, 0]; for (const p of room.players.values()) c[p.team]++;
    return c[0] <= c[1] ? 0 : 1;
  };

  function spawn(p) {
    const list = SPAWNS[p.team];
    const sp = list[room.spawnIdx[p.team]++ % list.length];
    p.x = sp.x; p.y = 0; p.z = sp.z; p.yaw = sp.yaw; p.pitch = 0;
    p.hp = PLAYER.MAX_HP; p.alive = true; p.w = 0; p.protectUntil = Date.now() + 2000;
    p.send({ t: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp });
  }

  function checkEnd() {
    const winner = room.score[0] >= SCORE_LIMIT ? 0 : room.score[1] >= SCORE_LIMIT ? 1 : -1;
    if (winner < 0 || room.over) return;
    room.over = true;
    bc({ t: 'over', winner, score: room.score.slice(), players: fullInfo() });
    setTimeout(() => {
      if (room.dead) return;
      room.score = [0, 0]; room.over = false;
      for (const p of room.players.values()) { p.k = 0; p.d = 0; spawn(p); }
      bc({ t: 'reset', players: fullInfo() });
    }, 9000);
  }

  function shoot(p, m) {
    if (!p.alive || room.over) return;
    const wp = WEAPONS[p.w] || WEAPONS[0];
    const now = Date.now();
    if (now - p.lastShot < wp.rate * 1000 * 0.8) return;
    p.lastShot = now;
    const ox = p.x, oy = p.y + PLAYER.EYE, oz = p.z;
    let dx = +m.dx, dy = +m.dy, dz = +m.dz;
    const len = Math.hypot(dx, dy, dz);
    if (!isFinite(len) || len < 0.5) return;
    dx /= len; dy /= len; dz /= len;
    bc({ t: 'shot', id: p.id, w: p.w }, p);

    const wallT = rayBoxes(ox, oy, oz, dx, dy, dz, wp.range);
    let best = null;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || q.team === p.team || now < q.protectUntil) continue;
      const h = rayPlayer(ox, oy, oz, dx, dy, dz, q.x, q.y, q.z);
      if (h && h.t < wallT && (!best || h.t < best.t)) best = { q, t: h.t, head: h.head };
    }
    if (!best) return;

    const q = best.q;
    q.hp -= best.head ? wp.head : wp.body;
    p.send({ t: 'hitmark', head: best.head, kill: q.hp <= 0 });
    q.send({ t: 'hurt', hp: Math.max(q.hp, 0), from: p.id, head: best.head });
    if (q.hp > 0) return;

    q.alive = false; q.d++; p.k++; room.score[p.team]++;
    bc({
      t: 'kill', killer: p.id, victim: q.id, head: best.head, w: p.w,
      score: room.score.slice(), kn: p.name, vn: q.name, kt: p.team, vt: q.team,
    });
    bc({ t: 'roster', players: fullInfo() });
    setTimeout(() => { if (!room.dead && room.players.has(q.id) && !room.over) spawn(q); }, RESPAWN_TIME * 1000);
    checkEnd();
  }

  // Yeni bağlantı: send(obj) fonksiyonunu ver, {onMessage, onClose} al.
  room.connect = (send) => {
    let me = null;
    return {
      onMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'join' && !me) {
          if (room.players.size >= MAX_PLAYERS) { send({ t: 'err', msg: 'Oda dolu' }); return; }
          const name = String(m.name || 'Oyuncu').replace(/[<>&"']/g, '').slice(0, 12) || 'Oyuncu';
          me = {
            id: nextId++, send, name, team: pickTeam(), k: 0, d: 0,
            x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, alive: false, w: 0, lastShot: 0, protectUntil: 0,
          };
          room.players.set(me.id, me);
          send({ t: 'welcome', id: me.id, room: room.code, team: me.team, score: room.score.slice(), players: fullInfo() });
          spawn(me);
          bc({ t: 'roster', players: fullInfo() });
          return;
        }
        if (!me) return;
        if (m.t === 's') {
          if (!me.alive) return;
          const x = +m.x, y = +m.y, z = +m.z;
          if (![x, y, z].every(Number.isFinite)) return;
          if (Math.hypot(x - me.x, z - me.z) > 4) { send({ t: 'spawn', x: me.x, y: me.y, z: me.z, yaw: me.yaw, hp: me.hp }); return; }
          me.x = x; me.y = y; me.z = z; me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0; me.w = m.w | 0;
        } else if (m.t === 'shoot') shoot(me, m);
        else if (m.t === 'ping') send({ t: 'pong', c: m.c });
      },
      onClose() {
        if (!me) return;
        room.players.delete(me.id);
        if (!room.dead) bc({ t: 'roster', players: fullInfo() });
        me = null;
      },
    };
  };

  const timer = setInterval(() => {
    const p = [];
    for (const q of room.players.values()) {
      p.push([q.id, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +q.yaw.toFixed(2), +q.pitch.toFixed(2), q.alive ? 1 : 0, q.w]);
    }
    bc({ t: 'snap', p });
  }, 50);
  room.destroy = () => { room.dead = true; clearInterval(timer); };
  return room;
}
