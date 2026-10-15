import * as THREE from './three.module.js';
import {
  BOXES, PLAYER, WEAPONS, SPAWNS, TEAM_NAMES, TEAM_COLORS, SCORE_LIMIT, RESPAWN_TIME,
  stepPlayer, rayBoxes, MAP_HALF,
} from './shared.js';
import { SERVER_URL as CFG_SERVER } from './config.js';
import { createRoom, newCode } from './engine.js';
window.__fpsReady = true; // index.html'deki yükleme denetimi için

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ============================================================ AYARLAR
const BASE_FOV = 68;
let sens = +store.get('sens', 1);
let assistOn = store.get('assist', '1') === '1';
let quality = store.get('quality', 'high');
$('sens').value = sens; $('assist').checked = assistOn; $('quality').value = quality;
$('name').value = store.get('name', '');
$('sens').oninput = (e) => { sens = +e.target.value; store.set('sens', sens); };
$('assist').onchange = (e) => { assistOn = e.target.checked; store.set('assist', assistOn ? '1' : '0'); };
$('quality').onchange = (e) => { store.set('quality', e.target.value); location.reload(); };

// Özel sunucu alanı varsayılan olarak BOŞ: boşsa oda kurma/katılma doğrudan (P2P) çalışır.
$('server').value = CFG_SERVER || '';
try { localStorage.removeItem('srv'); } catch {}

// ============================================================ SES
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (actx && actx.state === 'suspended') actx.resume();
}
let noiseBuf = null;
function noise(dur, vol, freq) {
  if (!actx) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = actx.createGain(); const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t); src.stop(t + dur);
}
function tone(freq, dur, vol, type = 'sine', slide = 0) {
  if (!actx) return;
  const o = actx.createOscillator(); o.type = type;
  const g = actx.createGain(); const t = actx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
}
function shotSound(w, vol) {
  if (w === 2) { noise(0.35, vol, 2500); tone(110, 0.3, vol * 0.8, 'triangle', -70); }
  else if (w === 1) { noise(0.12, vol * 0.8, 3500); tone(220, 0.1, vol * 0.5, 'square', -120); }
  else { noise(0.1, vol * 0.9, 3000); tone(150, 0.08, vol * 0.6, 'square', -90); }
}
const sndHit = (head) => tone(head ? 1900 : 1200, 0.07, 0.15, 'sine');
const sndHurt = () => { tone(140, 0.18, 0.3, 'sawtooth', -60); };
const sndKill = () => { tone(880, 0.1, 0.2, 'triangle'); setTimeout(() => tone(1320, 0.14, 0.2, 'triangle'), 90); };
const sndEmpty = () => tone(300, 0.04, 0.1, 'square');
const sndReload = () => { tone(500, 0.05, 0.12, 'square'); setTimeout(() => tone(700, 0.05, 0.12, 'square'), 600); };

// ============================================================ SAHNE
const canvas = $('c');
const lowQ = quality === 'low';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowQ, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQ ? 1 : 1.5));
renderer.shadowMap.enabled = !lowQ;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const SKY = 0x8fbfe3;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 55, 130);
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xd8ecff, 0x55606c, 1.05));
const sun = new THREE.DirectionalLight(0xfff0d6, 1.5);
sun.position.set(-30, 55, -20);
if (!lowQ) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 140;
  sun.shadow.bias = -0.0008;
}
scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// --- zemin dokusu
function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3b4a5a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#425364'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#2b3846'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(MAP_HALF, MAP_HALF);
  t.anisotropy = 4;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
  new THREE.MeshLambertMaterial({ map: gridTexture() }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

for (let team = 0; team < 2; team++) { // spawn bölgesi boyaması
  const m = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2 - 2, 11),
    new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.22 }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.02, team === 0 ? -30.5 : 30.5); scene.add(m);
}

// --- harita kutuları
const MATS = {
  wall: 0xd5d9de, border: 0x56677a, tower: 0x34465c, cover: 0x8294a8, crate: 0xd08e4e, plat: 0x9db0c6,
};
const matCache = {};
const edgeMat = new THREE.LineBasicMaterial({ color: 0x14202c, transparent: true, opacity: 0.55 });
for (const b of BOXES) {
  const mat = matCache[b.mat] || (matCache[b.mat] = new THREE.MeshLambertMaterial({ color: MATS[b.mat] || 0xaaaaaa }));
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(b.cx, b.y + b.h / 2, b.cz);
  mesh.castShadow = b.mat !== 'border'; mesh.receiveShadow = true;
  scene.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
  edges.position.copy(mesh.position); scene.add(edges);
}

// --- uzakta silüet (derinlik hissi)
{
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const m = new THREE.MeshLambertMaterial({ color: 0x6d8199 });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = 52 + rnd() * 22;
    const w = 5 + rnd() * 9, h = 10 + rnd() * 28;
    const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, 5 + rnd() * 9), m);
    bld.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); bld.rotation.y = rnd() * 3;
    scene.add(bld);
  }
}

// ============================================================ OYUNCU MODELLERİ
const skinMat = new THREE.MeshLambertMaterial({ color: 0xe7c3a0 });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x1f2a36 });
const gunMat = new THREE.MeshLambertMaterial({ color: 0x20262d });
const teamMats = TEAM_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c }));
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd070 });
const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };

function makeAvatar(team, name, showTag) {
  const g = new THREE.Group();
  const legL = box(0.18, 0.8, 0.22, darkMat, -0.12, 0.4, 0);
  const legR = box(0.18, 0.8, 0.22, darkMat, 0.12, 0.4, 0);
  const torso = box(0.5, 0.62, 0.28, teamMats[team], 0, 1.1, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skinMat); head.position.y = 1.58;
  const armR = box(0.12, 0.12, 0.55, teamMats[team], 0.3, 1.2, -0.22);
  const armL = box(0.12, 0.12, 0.45, teamMats[team], -0.22, 1.15, -0.2); armL.rotation.y = 0.5;
  const gun = box(0.07, 0.1, 0.55, gunMat, 0.3, 1.2, -0.5);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), flashMat);
  flash.position.set(0.3, 1.2, -0.85); flash.visible = false;
  g.add(legL, legR, torso, head, armR, armL, gun, flash);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legL, legR, flash, flashT: 0 };
  if (showTag) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d'); x.font = 'bold 34px sans-serif'; x.textAlign = 'center';
    x.lineWidth = 6; x.strokeStyle = '#000a'; x.strokeText(name, 128, 42);
    x.fillStyle = TEAM_COLORS[team]; x.fillText(name, 128, 42);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(1.6, 0.4, 1); sp.position.y = 2.15; sp.renderOrder = 10; g.add(sp);
  }
  return g;
}

// --- kendi silahın (kamera üstünde)
const vmRoot = new THREE.Group();
camera.add(vmRoot);
const vmGuns = [];
function buildViewmodels() {
  const rifle = new THREE.Group();
  rifle.add(box(0.07, 0.11, 0.55, gunMat, 0, 0, 0), box(0.04, 0.04, 0.28, gunMat, 0, 0.01, -0.4),
    box(0.05, 0.16, 0.08, gunMat, 0, -0.12, 0.08), box(0.045, 0.1, 0.1, gunMat, 0, -0.08, -0.12));
  const pistol = new THREE.Group();
  pistol.add(box(0.06, 0.09, 0.28, gunMat, 0, 0, 0), box(0.05, 0.13, 0.07, gunMat, 0, -0.1, 0.09));
  const sniper = new THREE.Group();
  sniper.add(box(0.06, 0.1, 0.8, gunMat, 0, 0, 0), box(0.03, 0.03, 0.4, gunMat, 0, 0.01, -0.6),
    box(0.05, 0.06, 0.2, gunMat, 0, 0.09, -0.05), box(0.05, 0.15, 0.08, gunMat, 0, -0.11, 0.2));
  for (const gnode of [rifle, pistol, sniper]) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), flashMat);
    flash.position.set(0, 0.01, gnode === pistol ? -0.2 : gnode === sniper ? -0.85 : -0.62); flash.visible = false;
    gnode.add(flash); gnode.userData.flash = flash;
    gnode.position.set(0.2, -0.19, -0.42); gnode.visible = false;
    gnode.traverse((o) => { if (o.isMesh && o !== flash) o.frustumCulled = false; });
    vmRoot.add(gnode); vmGuns.push(gnode);
  }
  // el
  const hand = box(0.09, 0.09, 0.09, skinMat, 0.2, -0.28, -0.3); vmRoot.add(hand);
}
buildViewmodels();

// ============================================================ DURUM
const S = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true };
let yaw = 0, pitch = 0;
let hp = 100, alive = false, playing = false, paused = false;
let myId = 0, myTeam = 0, roomCode = '';
let curW = 0, scoped = false, reloadLeft = 0, nextShot = 0;
const ammo = WEAPONS.map((w) => w.mag);
let kick = 0, bobT = 0;
let score = [0, 0], over = false;
const roster = new Map(); // id -> {name,team,k,d}
const remotes = new Map(); // id -> {mesh, tx,ty,tz, tyaw, alive, w, ...}
let net = null;
let respawnAt = 0, deadMsg = '';

// ============================================================ GİRİŞ (dokunmatik + klavye)
const joy = { x: 0, y: 0, id: -1, ox: 0, oy: 0 };
let fireHeld = false, jumpReq = false;
const keys = {};
const looks = new Map(); // pointerId -> {x,y}

function applyLook(dx, dy) {
  const k = 0.0042 * sens * (scoped ? WEAPONS[2].zoom / BASE_FOV : 1);
  yaw -= dx * k;
  pitch = clamp(pitch - dy * k, -1.45, 1.45);
}
function bindLook(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); audio();
    el.setPointerCapture(e.pointerId);
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onDown && onDown(e);
  });
  el.addEventListener('pointermove', (e) => {
    const l = looks.get(e.pointerId); if (!l) return;
    applyLook(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY;
  });
  const up = (e) => { if (looks.delete(e.pointerId)) onUp && onUp(e); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
bindLook($('lookzone'));
bindLook($('bFire'), () => { fireHeld = true; $('bFire').classList.add('on'); }, () => { fireHeld = false; $('bFire').classList.remove('on'); });

// joystick
const jz = $('joyzone'), jb = $('joybase'), jk = $('joyknob');
const joyCenter = () => { const r = jb.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
function joyMove(e) {
  const R = 60, c = joyCenter();
  let dx = e.clientX - c.x, dy = e.clientY - c.y;
  const l = Math.hypot(dx, dy);
  if (l > R) { dx = dx / l * R; dy = dy / l * R; }
  jk.style.transform = `translate(${dx}px,${dy}px)`;
  joy.x = dx / R; joy.y = -dy / R;
  if (Math.hypot(joy.x, joy.y) < 0.12) { joy.x = 0; joy.y = 0; }
}
jz.addEventListener('pointerdown', (e) => {
  e.preventDefault(); audio();
  jz.setPointerCapture(e.pointerId); joy.id = e.pointerId; joyMove(e);
});
jz.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.id = -1; joy.x = joy.y = 0; jk.style.transform = 'translate(0,0)'; };
jz.addEventListener('pointerup', joyEnd); jz.addEventListener('pointercancel', joyEnd);

function tapBtn(id, fn) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); audio(); el.classList.add('on'); fn(); });
  const off = () => el.classList.remove('on');
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
}
tapBtn('bJump', () => { jumpReq = true; });
tapBtn('bRel', () => startReload());
tapBtn('bWep', () => switchWeapon((curW + 1) % WEAPONS.length));
tapBtn('bScope', () => toggleScope());
$('bTab').addEventListener('pointerdown', (e) => { e.preventDefault(); showBoard(!boardOpen); });
$('bPause').addEventListener('pointerdown', (e) => { e.preventDefault(); $('pause').classList.remove('hidden'); });
$('bResume').onclick = () => $('pause').classList.add('hidden');
$('bLeave').onclick = () => location.reload();

// klavye + fare (bilgisayarda test için)
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!playing) return;
  if (e.code === 'Space') jumpReq = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
  if (e.code === 'Tab') { e.preventDefault(); showBoard(true); }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Tab') showBoard(false); });
canvas.addEventListener('click', () => { if (playing && canvas.requestPointerLock && matchMedia('(pointer:fine)').matches) canvas.requestPointerLock(); });
window.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) applyLook(e.movementX, e.movementY); });
window.addEventListener('mousedown', (e) => { if (document.pointerLockElement === canvas) { if (e.button === 0) fireHeld = true; if (e.button === 2) toggleScope(); } });
window.addEventListener('mouseup', (e) => { if (e.button === 0 && document.pointerLockElement === canvas) fireHeld = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ============================================================ SİLAH
function switchWeapon(i) {
  if (!alive || i === curW) return;
  curW = i; reloadLeft = 0; scoped = false; nextShot = performance.now() / 1000 + 0.25;
  refreshWeaponUI();
}
function refreshWeaponUI() {
  vmGuns.forEach((g, i) => (g.visible = i === curW));
  $('wname').textContent = WEAPONS[curW].name;
  $('bScope').classList.toggle('hidden', curW !== 2);
  $('scope').style.display = scoped ? 'block' : 'none';
  vmRoot.visible = !scoped;
  camera.fov = scoped ? WEAPONS[2].zoom : BASE_FOV; camera.updateProjectionMatrix();
}
function toggleScope() {
  if (!alive || curW !== 2) return;
  scoped = !scoped; refreshWeaponUI();
}
function startReload() {
  const w = WEAPONS[curW];
  if (!alive || reloadLeft > 0 || ammo[curW] >= w.mag) return;
  reloadLeft = w.reload; sndReload();
}

const _v = new THREE.Vector3();
const tracers = [];
const sparkGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe7a0 });
function addTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false; scene.add(line); tracers.push({ line, t: 0.07 });
}
function addSpark(p) {
  const m = new THREE.Mesh(sparkGeo, sparkMat); m.position.copy(p); scene.add(m); tracers.push({ line: m, t: 0.12, spark: true });
}

function tryShoot(now) {
  if (!alive || over || reloadLeft > 0 || now < nextShot) return;
  const w = WEAPONS[curW];
  if (ammo[curW] <= 0) { sndEmpty(); nextShot = now + 0.3; startReload(); return; }
  ammo[curW]--; nextShot = now + w.rate;

  const speed = Math.hypot(S.vx, S.vz);
  let spread = w.spread * (1 + speed / PLAYER.SPEED * 2.2) + (S.onGround ? 0 : 0.035);
  if (curW === 2 && !scoped) spread += 0.05;
  let rx, ry; do { rx = Math.random() * 2 - 1; ry = Math.random() * 2 - 1; } while (rx * rx + ry * ry > 1);
  camera.updateMatrixWorld();
  _v.set(rx * spread, ry * spread, -1).normalize().applyQuaternion(camera.quaternion);
  const dx = _v.x, dy = _v.y, dz = _v.z;

  send({ t: 'shoot', dx, dy, dz });

  // görsel: iz + kıvılcım
  const ox = S.x, oy = S.y + PLAYER.EYE, oz = S.z;
  const dist = rayBoxes(ox, oy, oz, dx, dy, dz, w.range);
  const muzzle = new THREE.Vector3(0.2, -0.17, -0.8).applyMatrix4(camera.matrixWorld);
  const end = new THREE.Vector3(ox + dx * dist, oy + dy * dist, oz + dz * dist);
  if (!scoped) addTracer(muzzle, end);
  if (dist < w.range) addSpark(end);

  const f = vmGuns[curW].userData.flash; f.visible = true; setTimeout(() => (f.visible = false), 45);
  shotSound(curW, 0.28);
  kick = 1;
  pitch = clamp(pitch + w.recoil * (scoped ? 0.4 : 1), -1.45, 1.45);
  yaw += (Math.random() - 0.5) * w.recoil * 0.6;
  if (ammo[curW] <= 0) startReload();
}

// Mobil için hafif nişan yardımı: ateş ederken düşmana doğru yavaşça çeker
function aimAssist(dt) {
  if (!assistOn || !fireHeld || !alive) return;
  camera.updateMatrixWorld();
  const ex = S.x, ey = S.y + PLAYER.EYE, ez = S.z;
  const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
  let best = null, bestAng = 0.09;
  for (const r of remotes.values()) {
    if (!r.alive || r.team === myTeam) continue;
    const tx = r.cx - ex, ty = r.cy + 1.25 - ey, tz = r.cz - ez;
    const d = Math.hypot(tx, ty, tz); if (d < 1) continue;
    const ang = Math.acos(clamp((tx * fx + ty * fy + tz * fz) / d, -1, 1));
    if (ang < bestAng && rayBoxes(ex, ey, ez, tx / d, ty / d, tz / d, d) >= d - 0.3) { bestAng = ang; best = { tx, ty, tz, d }; }
  }
  if (!best) return;
  const tYaw = Math.atan2(-best.tx, -best.tz);
  const tPitch = Math.asin(best.ty / best.d);
  let dy2 = tYaw - yaw; dy2 = Math.atan2(Math.sin(dy2), Math.cos(dy2));
  const k = Math.min(1, 5 * dt);
  yaw += dy2 * k; pitch += (tPitch - pitch) * k;
}

// ============================================================ AĞ
function send(o) { if (net) net.send(o); }

function normalizeUrl(u) {
  u = u.trim().replace(/\/+$/, '');
  if (!u) return '';
  u = u.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  if (!/^wss?:\/\//i.test(u)) u = 'wss://' + u;
  return u;
}

const showErr = (m) => { $('err').textContent = m; };
const busy = (b) => { $('bCreate').disabled = $('bJoin').disabled = b; };
function lost() {
  if (!playing) return;
  alive = false; fireHeld = false;
  setMsg('Bağlantı koptu', 'Oda sahibi çıkmış olabilir · menü için sayfayı yenile');
}

function loadPeerJS() {
  return new Promise((res, rej) => {
    if (window.Peer) return res();
    const urls = ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'];
    let i = 0;
    const next = () => {
      if (i >= urls.length) return rej(new Error('cdn'));
      const sc = document.createElement('script'); sc.src = urls[i++];
      sc.onload = () => (window.Peer ? res() : next()); sc.onerror = next;
      document.head.appendChild(sc);
    };
    next();
  });
}

// ---- Oda kuran telefon: sunucu görevini kendisi yapar (ek sunucu gerekmez)
function hostP2P(name, attempt = 0) {
  const code = newCode();
  const room = createRoom(code);
  let peer, ready = false;
  const timeout = setTimeout(() => fail('Bağlantı sunucusuna ulaşılamadı. İnterneti kontrol et.'), 15000);
  const fail = (m) => { clearTimeout(timeout); try { peer.destroy(); } catch {} room.destroy(); busy(false); showErr(m); };
  try { peer = new Peer('afps-' + code); } catch (e) { return fail('Bağlantı kurulamadı.'); }
  peer.on('error', (e) => {
    if (!ready && e.type === 'unavailable-id' && attempt < 4) { clearTimeout(timeout); try { peer.destroy(); } catch {} room.destroy(); return hostP2P(name, attempt + 1); }
    if (!ready) fail('Bağlantı sunucusuna ulaşılamadı (' + e.type + ').');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  peer.on('open', () => {
    ready = true; clearTimeout(timeout);
    peer.on('connection', (conn) => {
      let client = null;
      conn.on('open', () => { client = room.connect((m) => { if (conn.open) conn.send(m); }); });
      conn.on('data', (m) => { if (client) client.onMessage(m); });
      const gone = () => { if (client) { client.onClose(); client = null; } };
      conn.on('close', gone); conn.on('error', gone);
    });
    const local = room.connect((m) => queueMicrotask(() => onMsg(m)));
    net = { send: (o) => local.onMessage(o), close: () => { try { peer.destroy(); } catch {} room.destroy(); } };
    send({ t: 'join', name, create: true });
  });
}

// ---- Arkadaş: oda koduyla doğrudan oda sahibinin telefonuna bağlanır
function joinP2P(name, code) {
  let peer, done = false;
  const fail = (m) => { if (done) return; done = true; clearTimeout(timeout); try { peer.destroy(); } catch {} busy(false); showErr(m); };
  const timeout = setTimeout(() => fail('Odaya bağlanılamadı. Kod doğru mu? Oda sahibi oyunda mı?'), 20000);
  try { peer = new Peer(); } catch (e) { return fail('Bağlantı kurulamadı.'); }
  peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? 'Oda bulunamadı: ' + code : 'Bağlantı hatası (' + e.type + ')'));
  peer.on('open', () => {
    const conn = peer.connect('afps-' + code, { serialization: 'json' });
    conn.on('open', () => {
      done = true; clearTimeout(timeout);
      net = { send: (o) => { if (conn.open) conn.send(o); }, close: () => { try { peer.destroy(); } catch {} } };
      send({ t: 'join', name, room: code });
    });
    conn.on('data', (m) => onMsg(m));
    conn.on('close', () => { if (done) lost(); else fail('Bağlantı kapandı.'); });
    conn.on('error', () => { if (!done) fail('Bağlantı hatası.'); });
  });
}

// ---- İsteğe bağlı: ayrı WebSocket sunucusu (Render vb.). Adres boşsa kullanılmaz.
function connectWS(url, name, code, create) {
  let opened = false, sock;
  try { sock = new WebSocket(url); } catch (e) { busy(false); return showErr('Adres geçersiz.'); }
  net = { send: (o) => { if (sock.readyState === 1) sock.send(JSON.stringify(o)); }, close: () => { try { sock.close(); } catch {} } };
  sock.onopen = () => { opened = true; send({ t: 'join', name, room: code, create: !!create }); };
  sock.onerror = () => {};
  sock.onclose = () => { if (!opened) { busy(false); showErr('Sunucuya bağlanılamadı. Adresi kontrol et.'); } else lost(); };
  sock.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
}

function connect(create) {
  audio();
  const name = $('name').value.trim() || 'Oyuncu' + Math.floor(Math.random() * 90 + 10);
  const code = $('code').value.trim().toUpperCase();
  const url = normalizeUrl($('server').value);
  if (!create && code.length < 4) return showErr('4 harfli oda kodunu yaz.');
  store.set('name', name);
  busy(true); showErr('Bağlanılıyor…');
  if (url) return connectWS(url, name, code, create);
  loadPeerJS()
    .then(() => (create ? hostP2P(name) : joinP2P(name, code)))
    .catch(() => { busy(false); showErr('İnternete bağlanılamadı. Tekrar dene.'); });
}
$('bCreate').onclick = () => connect(true);
$('bJoin').onclick = () => connect(false);

function setRoster(list) {
  roster.clear();
  for (const p of list) roster.set(p.id, p);
  for (const [id, r] of remotes) if (!roster.has(id)) { scene.remove(r.mesh); remotes.delete(id); }
  if (boardOpen) showBoard(true);
}
function ensureRemote(id) {
  let r = remotes.get(id);
  if (r) return r;
  const info = roster.get(id); if (!info) return null;
  const mesh = makeAvatar(info.team, info.name, info.team === myTeam);
  scene.add(mesh);
  r = { mesh, team: info.team, cx: 0, cy: 0, cz: 0, tx: 0, ty: 0, tz: 0, yaw: 0, tyaw: 0, alive: false, w: 0, first: true, walk: 0 };
  remotes.set(id, r); return r;
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      myId = m.id; myTeam = m.team; roomCode = m.room; score = m.score;
      setRoster(m.players);
      $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('touch').classList.remove('hidden');
      $('room').textContent = 'ODA ' + roomCode;
      $('lim').textContent = `${TEAM_NAMES[0]} · ilk ${SCORE_LIMIT} · ${TEAM_NAMES[1]}`;
      playing = true; updScore(); setMsg('Takımın: ' + TEAM_NAMES[myTeam], 'Arkadaşlarına oda kodunu ver: ' + roomCode);
      setTimeout(() => setMsg(''), 9000);
      try { screen.orientation.lock('landscape').catch(() => {}); } catch {}
      try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {}
      setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);
      break;
    case 'roster': setRoster(m.players); break;
    case 'spawn':
      S.x = m.x; S.y = m.y; S.z = m.z; S.vx = S.vy = S.vz = 0; yaw = m.yaw; pitch = 0;
      hp = m.hp;
      if (!alive) { // yeniden doğuş
        for (let i = 0; i < ammo.length; i++) ammo[i] = WEAPONS[i].mag;
        curW = 0; scoped = false; reloadLeft = 0; refreshWeaponUI();
      }
      alive = true; if (deadMsg) { setMsg(''); deadMsg = ''; } updHp();
      break;
    case 'snap':
      for (const p of m.p) {
        if (p[0] === myId) continue;
        const r = ensureRemote(p[0]); if (!r) continue;
        r.tx = p[1]; r.ty = p[2]; r.tz = p[3]; r.tyaw = p[4]; r.alive = !!p[6]; r.w = p[7];
        if (r.first) { r.cx = r.tx; r.cy = r.ty; r.cz = r.tz; r.yaw = r.tyaw; r.first = false; }
      }
      break;
    case 'shot': {
      const r = remotes.get(m.id); if (!r || !r.alive) break;
      r.mesh.userData.flash.visible = true; r.mesh.userData.flashT = 0.05;
      const d = Math.hypot(r.cx - S.x, r.cz - S.z);
      shotSound(m.w, clamp(1 - d / 70, 0.04, 1) * 0.35);
      break;
    }
    case 'hitmark': {
      const h = $('hit'); h.classList.toggle('head', !!m.head); h.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => h.classList.remove('on')));
      m.kill ? sndKill() : sndHit(m.head);
      break;
    }
    case 'hurt': {
      hp = m.hp; updHp(); sndHurt();
      const v = $('vig'); v.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('on')));
      if (hp <= 0) die(m.from);
      break;
    }
    case 'kill': {
      score = m.score; updScore();
      const d = document.createElement('div');
      d.innerHTML = `<b style="color:${TEAM_COLORS[m.kt]}">${esc(m.kn)}</b> ${m.head ? '★' : '›'} <b style="color:${TEAM_COLORS[m.vt]}">${esc(m.vn)}</b>`;
      $('feed').appendChild(d); setTimeout(() => d.remove(), 5000);
      while ($('feed').children.length > 5) $('feed').firstChild.remove();
      if (m.victim === myId && alive) die(m.killer);
      break;
    }
    case 'over': {
      over = true; fireHeld = false; setRoster(m.players); score = m.score; updScore();
      showEnd(m); break;
    }
    case 'reset':
      over = false; $('board').classList.add('hidden'); score = [0, 0]; updScore(); setRoster(m.players); break;
    case 'pong': $('ping').textContent = Math.round(performance.now() - m.c) + ' ms'; break;
    case 'err':
      showErr(m.msg); busy(false); if (net) net.close(); net = null;
      break;
  }
}

function die(killerId) {
  if (!alive) return;
  alive = false; fireHeld = false; scoped = false; refreshWeaponUI(); vmRoot.visible = false;
  const k = roster.get(killerId);
  respawnAt = performance.now() / 1000 + RESPAWN_TIME;
  deadMsg = k ? k.name + ' seni vurdu' : 'Öldün';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function setMsg(a, b) { $('msg').innerHTML = a ? esc(a) + (b ? `<small>${esc(b)}</small>` : '') : ''; }
function updHp() { $('hpn').textContent = Math.max(0, Math.ceil(hp)); $('hpb').style.width = clamp(hp, 0, 100) + '%'; $('hpn').style.color = hp <= 30 ? '#ff4655' : ''; }
function updScore() { $('sa').textContent = score[0]; $('sb').textContent = score[1]; }

let boardOpen = false;
function boardHtml() {
  const rows = [...roster.values()].sort((a, b) => b.k - a.k);
  let h = '<h2>SKOR</h2><table><tr><th>OYUNCU</th><th>TAKIM</th><th>K</th><th>Ö</th></tr>';
  for (const p of rows) h += `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)}</td><td style="color:${TEAM_COLORS[p.team]}">${TEAM_NAMES[p.team]}</td><td>${p.k}</td><td>${p.d}</td></tr>`;
  return h + '</table>';
}
function showBoard(on) {
  boardOpen = on;
  const b = $('board'); b.classList.toggle('hidden', !on);
  b.style.pointerEvents = 'none';
  if (on) b.innerHTML = boardHtml();
}
function showEnd(m) {
  const b = $('board'); b.classList.remove('hidden'); b.style.pointerEvents = 'auto'; boardOpen = false;
  const win = m.winner === myTeam;
  b.innerHTML = `<h2 style="color:${win ? '#37d5ff' : '#ff4655'}">${win ? 'ZAFER' : 'YENİLGİ'}</h2><div>${TEAM_NAMES[m.winner]} takımı kazandı · ${m.score[0]} - ${m.score[1]}</div>${boardHtml()}<div>Yeni maç birazdan başlıyor…</div>`;
}

// ============================================================ DÖNGÜ
let last = performance.now() / 1000, lastSend = 0, hudAmmo = '';
const keyAxis = () => ({
  x: (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0),
  y: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
});

function update(dt, now) {
  if (alive) {
    const ka = keyAxis();
    const ix = clamp(joy.x + ka.x, -1, 1), iy = clamp(joy.y + ka.y, -1, 1);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let wx = rx * ix + fx * iy, wz = rz * ix + fz * iy;
    const l = Math.hypot(wx, wz); if (l > 1) { wx /= l; wz /= l; }
    const sp = PLAYER.SPEED * (scoped ? 0.5 : curW === 2 ? 0.92 : 1);
    const acc = (S.onGround ? 75 : 14) * dt;
    S.vx += clamp(wx * sp - S.vx, -acc, acc);
    S.vz += clamp(wz * sp - S.vz, -acc, acc);
    if (jumpReq && S.onGround) { S.vy = PLAYER.JUMP; S.onGround = false; }
    jumpReq = false;
    stepPlayer(S, dt);

    if (reloadLeft > 0) {
      reloadLeft -= dt;
      if (reloadLeft <= 0) { reloadLeft = 0; ammo[curW] = WEAPONS[curW].mag; }
    }
    aimAssist(dt);
    if (fireHeld) tryShoot(now);

    if (now - lastSend > 0.05) {
      lastSend = now;
      send({ t: 's', x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +S.z.toFixed(3), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), w: curW });
    }
  } else if (!over) {
    const left = Math.max(0, respawnAt - now);
    setMsg(deadMsg, left > 0 ? 'Yeniden doğuş: ' + Math.ceil(left) : '');
  }

  // HUD
  const a = reloadLeft > 0 ? 'ŞARJÖR…' : ammo[curW] + ' / ' + WEAPONS[curW].mag;
  if (a !== hudAmmo) { hudAmmo = a; $('ammon').textContent = a; }
}

function updateCamera(dt) {
  const speed = Math.hypot(S.vx, S.vz);
  bobT += dt * speed * 1.6;
  const eye = alive ? PLAYER.EYE : 0.35;
  camera.position.set(S.x, S.y + eye + (alive && S.onGround ? Math.sin(bobT) * 0.012 * Math.min(1, speed / 3) : 0), S.z);
  camera.rotation.y = yaw; camera.rotation.x = pitch;
  camera.rotation.z = alive ? 0 : 0.7;
  kick = Math.max(0, kick - dt * 9);
  vmRoot.position.set(Math.sin(bobT * 0.5) * 0.006 * (speed / 6), -Math.abs(Math.sin(bobT)) * 0.008 * (speed / 6), kick * 0.05);
  vmRoot.rotation.x = kick * 0.08 + (reloadLeft > 0 ? -0.5 : 0);
}

function updateRemotes(dt, now) {
  const k = 1 - Math.exp(-dt * 14);
  for (const r of remotes.values()) {
    const ox = r.cx, oz = r.cz;
    r.cx += (r.tx - r.cx) * k; r.cy += (r.ty - r.cy) * k; r.cz += (r.tz - r.cz) * k;
    let dy = r.tyaw - r.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.yaw += dy * k;
    const m = r.mesh;
    m.visible = r.alive;
    m.position.set(r.cx, r.cy, r.cz); m.rotation.y = r.yaw;
    const sp = Math.hypot(r.cx - ox, r.cz - oz) / Math.max(dt, 0.001);
    r.walk += dt * sp * 1.8;
    const sw = Math.sin(r.walk) * Math.min(1, sp / 3) * 0.7;
    m.userData.legL.rotation.x = sw; m.userData.legR.rotation.x = -sw;
    if (m.userData.flashT > 0) { m.userData.flashT -= dt; if (m.userData.flashT <= 0) m.userData.flash.visible = false; }
  }
}

function updateFx(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.t -= dt;
    if (t.t <= 0) {
      scene.remove(t.line);
      if (!t.spark) { t.line.geometry.dispose(); t.line.material.dispose(); }
      tracers.splice(i, 1);
    }
  }
}

function frame(ms) {
  requestAnimationFrame(frame);
  const now = ms / 1000;
  const dt = Math.min(0.05, now - last); last = now;
  if (playing) update(dt, now);
  updateCamera(dt);
  updateRemotes(dt, now);
  updateFx(dt);
  renderer.render(scene, camera);
}
refreshWeaponUI();
requestAnimationFrame(frame);

// Hata ayıklama için (konsoldan bakmak istersen)
window.__fps = { S, remotes, roster, SPAWNS };
