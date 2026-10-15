// shared.js — hem oyun (telefon) hem sunucu aynı dosyayı kullanır.
// Harita, silahlar, çarpışma ve ışın (raycast) hesapları burada. Bağımlılık yok.

export const TEAM_A = 0;
export const TEAM_B = 1;
export const TEAM_NAMES = ['MAVİ', 'KIRMIZI'];
export const TEAM_COLORS = ['#37d5ff', '#ff4d5e'];
export const SCORE_LIMIT = 30;
export const MAX_PLAYERS = 10;
export const RESPAWN_TIME = 4; // saniye
export const MAP_HALF = 36; // harita -36..+36

export const PLAYER = {
  R: 0.35, // yarıçap (çarpışma)
  H: 1.8, // boy
  EYE: 1.62, // göz yüksekliği
  STEP: 0.62, // otomatik basamak çıkma
  SPEED: 6.2,
  JUMP: 7.2,
  GRAVITY: 21,
  HEAD_R: 0.24,
  HEAD_Y: 1.58,
  BODY_R: 0.4,
  BODY_H: 1.36,
  MAX_HP: 100,
};

export const WEAPONS = [
  { id: 0, name: 'TÜFEK', rate: 0.1, body: 25, head: 80, mag: 25, reload: 2.1, spread: 0.012, range: 160, recoil: 0.011, zoom: 0 },
  { id: 1, name: 'TABANCA', rate: 0.24, body: 22, head: 70, mag: 12, reload: 1.3, spread: 0.006, range: 120, recoil: 0.02, zoom: 0 },
  { id: 2, name: 'KESKİN', rate: 1.1, body: 85, head: 200, mag: 5, reload: 2.8, spread: 0.002, range: 300, recoil: 0.045, zoom: 28 },
];

// ---------------------------------------------------------------------------
// HARİTA: [merkezX, tabanY, merkezZ, genişlik, yükseklik, derinlik, malzeme]
// "half" listesi 180° döndürülerek karşı yarıya kopyalanır (adil harita).
// ---------------------------------------------------------------------------
const center = [
  [0, 0, -36.5, 74, 7, 1, 'border'],
  [0, 0, 36.5, 74, 7, 1, 'border'],
  [-36.5, 0, 0, 1, 7, 74, 'border'],
  [36.5, 0, 0, 1, 7, 74, 'border'],
  [0, 0, 0, 7, 5, 7, 'tower'], // orta kule
];

const half = [
  // spawn kapı duvarları
  [-15, 0, -23, 18, 4.5, 1, 'wall'],
  [15, 0, -23, 18, 4.5, 1, 'wall'],
  // spawn içi siperler
  [-12, 0, -31, 2, 1.1, 2, 'crate'],
  [11, 0, -33, 3, 1.1, 1.5, 'cover'],
  // yan koridor duvarı
  [-29, 0, -14, 1, 4.5, 12, 'wall'],
  // platform + merdiven
  [-18, 0, -8, 8, 2.4, 8, 'plat'],
  [-13.4, 0, -8, 1.2, 1.8, 3, 'plat'],
  [-12.2, 0, -8, 1.2, 1.2, 3, 'plat'],
  [-11, 0, -8, 1.2, 0.6, 3, 'plat'],
  // orta siperler
  [-9, 0, -10, 5, 1.1, 1.2, 'cover'],
  [9, 0, -14, 1.2, 2.2, 5, 'cover'],
  [-5, 0, -16, 3, 2.2, 1.2, 'cover'],
  // kule çevresi kasalar
  [-6, 0, -5, 2, 1.1, 2, 'crate'],
  [-6, 1.1, -5, 2, 1.1, 2, 'crate'],
  [-3.8, 0, -6.5, 2, 1.1, 2, 'crate'],
  // sütunlar
  [-26, 0, -26, 2, 4.5, 2, 'tower'],
  [20, 0, -8, 2, 4.5, 2, 'tower'],
  // uzun duvar + kasa
  [14, 0, -6, 10, 4.5, 1, 'wall'],
  [19.5, 0, -4, 2, 1.1, 2, 'crate'],
];

function mk(a) {
  const [cx, y, cz, w, h, d, mat] = a;
  return {
    cx, y, cz, w, h, d, mat,
    minX: cx - w / 2, maxX: cx + w / 2,
    minY: y, maxY: y + h,
    minZ: cz - d / 2, maxZ: cz + d / 2,
  };
}

export const BOXES = [];
for (const a of center) BOXES.push(mk(a));
for (const a of half) {
  BOXES.push(mk(a));
  BOXES.push(mk([-a[0], a[1], -a[2], a[3], a[4], a[5], a[6]]));
}

// Doğma noktaları. A takımı z=-31'de +z'ye (yaw=PI), B takımı z=+31'de -z'ye (yaw=0) bakar.
const xs = [-8, -4, 0, 4, 8, -6, -2, 2, 6, 10];
export const SPAWNS = [
  xs.map((x) => ({ x, z: -31, yaw: Math.PI })),
  xs.map((x) => ({ x: -x, z: 31, yaw: 0 })),
];

// ---------------------------------------------------------------------------
// ÇARPIŞMA
// ---------------------------------------------------------------------------
const EPS = 1e-4;

export function hitAt(x, y, z) {
  const R = PLAYER.R, H = PLAYER.H;
  let best = null;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (x + R > b.minX && x - R < b.maxX && z + R > b.minZ && z - R < b.maxZ &&
        y + H > b.minY + EPS && y < b.maxY - EPS) {
      if (!best || b.maxY > best.maxY) best = b;
    }
  }
  return best;
}

function moveAxis(s, axis, d) {
  if (d === 0) return;
  const nx = axis === 'x' ? s.x + d : s.x;
  const nz = axis === 'z' ? s.z + d : s.z;
  const b = hitAt(nx, s.y, nz);
  if (!b) { s.x = nx; s.z = nz; return; }
  // basamak çıkma
  if (b.maxY - s.y <= PLAYER.STEP && !hitAt(nx, b.maxY + 0.002, nz)) {
    s.x = nx; s.z = nz; s.y = b.maxY;
    if (s.vy < 0) s.vy = 0;
    return;
  }
  if (axis === 'x') s.vx = 0; else s.vz = 0;
}

// s: {x,y,z,vx,vy,vz,onGround}
export function stepPlayer(s, dt) {
  moveAxis(s, 'x', s.vx * dt);
  moveAxis(s, 'z', s.vz * dt);
  s.vy -= PLAYER.GRAVITY * dt;
  const ny = s.y + s.vy * dt;
  s.onGround = false;
  const b = hitAt(s.x, ny, s.z);
  if (b) {
    if (s.vy <= 0) { s.y = b.maxY; s.onGround = true; }
    else s.y = b.minY - PLAYER.H - 0.001;
    s.vy = 0;
  } else {
    s.y = ny;
  }
  if (s.y <= 0) { s.y = 0; s.vy = 0; s.onGround = true; }
  const lim = MAP_HALF - PLAYER.R;
  if (s.x > lim) s.x = lim; else if (s.x < -lim) s.x = -lim;
  if (s.z > lim) s.z = lim; else if (s.z < -lim) s.z = -lim;
}

// ---------------------------------------------------------------------------
// IŞIN (RAYCAST)
// ---------------------------------------------------------------------------
function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// En yakın duvara mesafe (yoksa maxT)
export function rayBoxes(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

// Oyuncuya ışın: {t, head} ya da null. (px,py,pz) ayak konumu.
export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz) {
  const th = raySphere(ox, oy, oz, dx, dy, dz, px, py + PLAYER.HEAD_Y, pz, PLAYER.HEAD_R);
  const br = PLAYER.BODY_R;
  const tb = rayAABB(ox, oy, oz, dx, dy, dz, px - br, py, pz - br, px + br, py + PLAYER.BODY_H, pz + br);
  if (th < 0 && tb < 0) return null;
  if (th >= 0 && (tb < 0 || th <= tb + 0.05)) return { t: th, head: true };
  return { t: tb, head: false };
}
