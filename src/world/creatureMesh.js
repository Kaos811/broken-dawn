// Preview mesh motion for the painted world creatures (not the Rift Behemoth — that stays in behemothMesh.js).
// Same idea as the approved A4 Behemoth: one Phaser grid over the existing painting. At zero drivers every
// vertex sits on the source pixel. Motion is per anatomy (gait, flap, coil), with a rigid plateau on each
// face so eyes and teeth do not smear, and stance feet returned to those rest pixels.
import Phaser from 'phaser';

const TAU = Math.PI * 2;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };
const gau = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
const rot = (x, y, cx, cy, a) => { const c = Math.cos(a), s = Math.sin(a); return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; };
const mix = (ax, ay, bx, by, w) => [ax + (bx - ax) * w, ay + (by - ay) * w];
const rand = () => Math.random();

function ell(px, py, cx, cy, rx, ry) {
  const e = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
  return 1 - ss(0.45, 1.05, e);
}
function plat(px, py, cx, cy, r0, r1) {
  return 1 - ss(r0, r1, Math.hypot(px - cx, py - cy));
}
function nearestLeg(px, py, legs) {
  let best = -1, score = 1e9, along = 0;
  for (let i = 0; i < legs.length; i++) {
    const L = legs[i], dx = L.foot[0] - L.hip[0], dy = L.foot[1] - L.hip[1];
    const L2 = dx * dx + dy * dy || 1;
    let t = ((px - L.hip[0]) * dx + (py - L.hip[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const qx = L.hip[0] + dx * t, qy = L.hip[1] + dy * t;
    const rad = L.rad0 + (L.rad1 - L.rad0) * t;
    const sc = Math.hypot(px - qx, py - qy) / rad;
    if (sc < score) { score = sc; best = i; along = t; }
  }
  return { leg: best, along, score };
}

function bootWalk(extra = {}) {
  return { ph: rand() * TAU, br: 2.2, hd: 5.2, hph: rand() * TAU, jaw: 3.4, jph: rand() * TAU, gait: 1,
    spine: 3.6, horn: 0.42, crys: 3.8, shift: 0, tshift: 0, shiftAt: 1 + rand() * 2, stomp: 0, stompSide: 0, stompAt: 4 + rand() * 3, ...extra };
}
function stepShift(T, t, dt, every, rate) {
  if (t > T.shiftAt) { T.shiftAt = t + every[0] + rand() * every[1]; T.tshift = rand() * 2 - 1; }
  T.shift += (T.tshift - T.shift) * Math.min(1, dt * rate);
}
function stepStomp(T, t, dt, every, decay, sides) {
  if (t > T.stompAt) { T.stompAt = t + every[0] + rand() * every[1]; T.stomp = 1; T.stompSide = sides[Math.floor(rand() * sides.length)]; }
  T.stomp = Math.max(0, T.stomp - dt / decay);
}

// Shared grounded walker: chest breath, rigid head, planted stance feet, mid-limb bend.
function walkDisplace(C, q, T, t) {
  if (T.hold === 'rest') return [q.px, q.py];
  const br = Math.sin(TAU * t / T.br + T.ph);
  const look = Math.sin(TAU * t / T.hd + T.hph);
  const jaw = Math.max(0, Math.sin(TAU * t / T.jaw + T.jph));
  let x = q.px, y = q.py;
  const e = C.breath * br * (q.chest || 0);
  x += (q.px - C.cx) * e;
  y += (q.py - C.cy) * e;
  y -= (q.body || 0) * (1 - (q.foot || 0)) * C.rise * br;
  x += T.shift * C.shiftPx * (q.body || 0) * (1 - (q.head || 0));
  if (q.head > 0.01) {
    const [hx, hy] = rot(q.px, q.py, C.neck[0], C.neck[1], C.headAng * look);
    [x, y] = mix(x, y, hx, hy, q.head);
  }
  if (q.jaw > 0.01) y += q.jaw * jaw * C.jawPx;
  if (q.spine > 0.01) {
    const [sx, sy] = rot(q.px, q.py, C.spineAt[0], C.spineAt[1], C.spineAng * Math.sin(TAU * t / T.spine + T.ph));
    [x, y] = mix(x, y, sx, sy, q.spine);
  }
  if (q.crys > 0.01) {
    const kick = Math.sin(Math.min(1, T.stomp) * Math.PI) ** 2;
    const [cx, cy] = rot(q.px, q.py, C.crysAt[0], C.crysAt[1], C.crysAng * Math.sin(TAU * t / T.crys + T.ph) + 0.06 * kick);
    [x, y] = mix(x, y, cx, cy, q.crys);
  }
  if (q.horn > 0.01) {
    const [hx, hy] = rot(q.px, q.py, C.hornAt[0], C.hornAt[1], C.hornAng * Math.sin(TAU * t / T.horn + T.ph));
    [x, y] = mix(x, y, hx, hy, q.horn);
  }
  if (q.leg >= 0 && q.legW > 0.01) {
    const L = C.legs[q.leg];
    const swing = Math.sin(TAU * t / T.gait + L.ph);
    const bend = Math.sin(Math.min(1, q.along) * Math.PI);
    const ang = bend * (L.ang || C.legAng) * swing;
    let [lx, ly] = rot(q.px, q.py, L.hip[0], L.hip[1], ang);
    const lift = Math.max(0, swing);
    const extra = T.stompSide === q.leg ? Math.sin(Math.min(1, T.stomp) * Math.PI) ** 2 * (L.stomp || 0) : 0;
    const dx = L.foot[0] - L.hip[0], dy = L.foot[1] - L.hip[1], len = Math.hypot(dx, dy) || 1;
    ly -= (q.foot || 0) * (lift * L.lift + extra);
    lx += (-dy / len) * (q.foot || 0) * lift * (L.stride || 0);
    [x, y] = mix(x, y, lx, ly, q.legW);
  }
  if (q.plant > 0.01) [x, y] = mix(x, y, q.px, q.py, q.plant);
  return [x, y];
}

function weighLegs(px, py, C, body, head) {
  const n = nearestLeg(px, py, C.legs);
  const legW = (1 - ss(0.12, 1.02, n.score)) * (1 - body) * (1 - head);
  const foot = ss(0.52, 0.84, n.along) * (1 - ss(0.05, 0.95, n.score)) * (1 - body) * (1 - head);
  return { leg: legW > 0.02 ? n.leg : -1, along: n.along, legW, foot };
}

// --- Husk Scuttler: low beetle, eight legs, skitter --------------------------------
const SCUTTLER = {
  seg: 42,
  cx: 128, cy: 108, breath: 0.05, rise: 4.5, shiftPx: 8, headAng: 0.09, jawPx: 8,
  neck: [124, 158], hornAt: [142, 52], hornAng: 0.2, spineAt: [128, 108], spineAng: 0,
  crysAt: [128, 108], crysAng: 0, legAng: 0.62,
  legs: [
    { hip: [58, 112], foot: [18, 168], ph: 0.0, lift: 18, stride: 4, rad0: 18, rad1: 12, ang: 0.42 },
    { hip: [74, 132], foot: [22, 208], ph: 2.2, lift: 16, stride: 4, rad0: 16, rad1: 11, ang: 0.38 },
    { hip: [98, 150], foot: [52, 200], ph: 4.3, lift: 12, stride: 3, rad0: 15, rad1: 11, ang: 0.32 },
    { hip: [116, 160], foot: [100, 206], ph: 1.1, lift: 11, stride: 3, rad0: 14, rad1: 10, ang: 0.28 },
    { hip: [128, 166], foot: [124, 242], ph: 3.6, lift: 16, stride: 3, rad0: 14, rad1: 11, ang: 0.32 },
    { hip: [160, 160], foot: [206, 226], ph: 1.6, lift: 16, stride: 4, rad0: 17, rad1: 12, ang: 0.36 },
    { hip: [188, 140], foot: [240, 196], ph: 4.8, lift: 14, stride: 4, rad0: 17, rad1: 12, ang: 0.38 },
    { hip: [198, 114], foot: [238, 152], ph: 2.7, lift: 12, stride: 3, rad0: 15, rad1: 11, ang: 0.34 },
  ],
  boot: () => bootWalk({ br: 1.7 + rand() * 0.35, gait: 0.62 + rand() * 0.08, hd: 4.2 + rand(), jaw: 2.6 }),
  step: (T, t, dt) => stepShift(T, t, dt, [1.4, 1.2], 2.4),
  weigh(px, py) {
    const body = ell(px, py, 128, 102, 72, 52);
    const head = plat(px, py, 124, 138, 26, 42);
    const chest = gau(px, py, 128, 86, 42) * (1 - head);
    const horn = plat(px, py, 146, 24, 8, 26) * (1 - head);
    const jaw = ss(150, 168, py) * ss(96, 114, px) * ss(160, 140, px);
    const L = weighLegs(px, py, SCUTTLER, Math.max(body, head * 0.85), head);
    return { px, py, body, head, chest, horn, jaw, spine: 0, crys: 0, plant: 0, ...L };
  },
  displace: (q, T, t) => walkDisplace(SCUTTLER, q, T, t),
  shadow: (T, t) => ({ sh: 1 - 0.04 * Math.sin(TAU * t / T.br + T.ph), shx: T.shift * 3 }),
};

// --- Void Hound: side-view trot, rigid skull, panting jaw -------------------------
const HOUND = {
  seg: 40,
  cx: 150, cy: 118, breath: 0.045, rise: 3.5, shiftPx: 7, headAng: 0.11, jawPx: 7,
  neck: [112, 124], spineAt: [168, 92], spineAng: 0.07, hornAt: [0, 0], hornAng: 0,
  crysAt: [150, 118], crysAng: 0, legAng: 0.48,
  legs: [
    { hip: [72, 150], foot: [46, 222], ph: 0, lift: 14, stride: 4, rad0: 20, rad1: 14, ang: 0.3 },
    { hip: [108, 156], foot: [88, 232], ph: Math.PI, lift: 12, stride: 3, rad0: 18, rad1: 13, ang: 0.28 },
    { hip: [160, 152], foot: [134, 234], ph: Math.PI, lift: 11, stride: 3, rad0: 20, rad1: 14, ang: 0.26 },
    { hip: [202, 146], foot: [224, 200], ph: 0, lift: 10, stride: 3, rad0: 18, rad1: 13, ang: 0.26 },
  ],
  boot: () => bootWalk({ br: 2.15 + rand() * 0.35, gait: 1.02 + rand() * 0.12, hd: 5.4 + rand(), jaw: 1.7 }),
  step(T, t, dt) { stepShift(T, t, dt, [2.2, 1.8], 1.6); stepStomp(T, t, dt, [5.5, 2.5], 0.55, [0, 3]); },
  weigh(px, py) {
    const head = plat(px, py, 70, 108, 32, 50);
    const body = ell(px, py, 155, 116, 68, 40) * (1 - head);
    const chest = gau(px, py, 150, 120, 36) * (1 - head);
    const spine = ss(100, 48, py) * ss(124, 150, px) * ss(215, 185, px) * (1 - head);
    const jaw = head * ss(122, 142, py) * ss(130, 100, px);
    const L = weighLegs(px, py, HOUND, body, head);
    return { px, py, body, head, chest, spine, jaw, horn: 0, crys: 0, plant: 0, ...L };
  },
  displace: (q, T, t) => walkDisplace(HOUND, q, T, t),
  shadow: (T, t) => ({ sh: 1 - 0.035 * Math.sin(TAU * t / T.br + T.ph), shx: T.shift * 4 }),
};

// --- Shard Golem: heavy, slow, crystal crest, two stepping forelegs, center toes planted
const GOLEM = {
  seg: 32,
  cx: 140, cy: 155, breath: 0.04, rise: 3.2, shiftPx: 6, headAng: 0.06, jawPx: 6,
  neck: [136, 200], spineAt: [140, 150], spineAng: 0, hornAt: [0, 0], hornAng: 0,
  crysAt: [140, 168], crysAng: 0.12, legAng: 0.3,
  legs: [
    { hip: [74, 178], foot: [56, 236], ph: 0, lift: 12, stride: 3, rad0: 26, rad1: 18, ang: 0.26, stomp: 10 },
    { hip: [186, 176], foot: [196, 234], ph: Math.PI, lift: 12, stride: 3, rad0: 26, rad1: 18, ang: 0.26, stomp: 10 },
  ],
  boot: () => bootWalk({ br: 3.5 + rand() * 0.4, gait: 2.45 + rand() * 0.25, hd: 6.5 + rand(), jaw: 4.8, crys: 4.1 + rand() * 0.4 }),
  step(T, t, dt) { stepShift(T, t, dt, [3.2, 2], 1.1); stepStomp(T, t, dt, [6.5, 2.5], 0.85, [0, 1]); },
  weigh(px, py) {
    const head = plat(px, py, 136, 192, 16, 32);
    const body = ell(px, py, 140, 150, 78, 48) * (1 - ss(40, 90, py) * 0.65);
    const chest = gau(px, py, 140, 158, 40) * (1 - head) * ss(70, 110, py);
    const crys = ss(155, 55, py) * ss(55, 85, px) * ss(215, 180, px) * (1 - head);
    const jaw = head * ss(196, 214, py);
    const L = weighLegs(px, py, GOLEM, Math.max(body * (1 - crys), 0), head);
    return { px, py, body: body * (1 - crys * 0.5), head, chest, crys, jaw, spine: 0, horn: 0, plant: 0, ...L };
  },
  displace: (q, T, t) => walkDisplace(GOLEM, q, T, t),
  shadow: (T, t) => ({ sh: 1 - 0.03 * Math.sin(TAU * t / T.br + T.ph), shx: T.shift * 3 }),
};

// --- Rift Drone: hovering wasp. Wings bend from the root; abdomen curls; legs dangle.
const DRONE = {
  seg: 34,
  fore: [92, 72], hind: [112, 98], abd: [[116, 128], [150, 160], [140, 200], [118, 242]],
  boot: () => ({ ph: rand() * TAU, flap: 0.58 + rand() * 0.06, abd: 2.7 + rand() * 0.4, hd: 4.8 + rand(), hph: rand() * TAU, dangle: 1.35 + rand() * 0.2 }),
  step() {},
  weigh(px, py) {
    const head = plat(px, py, 58, 112, 20, 36);
    const ant = plat(px, py, 40, 96, 6, 18) * (1 - ss(20, 8, Math.hypot(px - 58, py - 112)));
    const body = ell(px, py, 100, 116, 36, 32) * (1 - head);
    const fdx = px - 92, fdy = py - 72, fd = Math.hypot(fdx, fdy), fang = Math.atan2(fdy, fdx);
    let fore = 0, foreR = 0;
    if (fd > 18 && px > 78 && py < 112 && fang < -0.02 && fang > -1.65 && head < 0.2) {
      foreR = Math.max(0, Math.min(1, (fd - 18) / 130));
      fore = foreR * (1 - body * 0.85);
    }
    const hdx = px - 112, hdy = py - 98, hd = Math.hypot(hdx, hdy);
    let hind = 0, hindR = 0;
    if (hd > 16 && px > 120 && py > 62 && py < 128 && px < 215 && fore < 0.35 && head < 0.1) {
      hindR = Math.max(0, Math.min(1, (hd - 16) / 90));
      hind = hindR * (1 - body);
    }
    const abd = abdomenW(px, py);
    const legs = [
      { hip: [60, 134], foot: [46, 190], ph: 0, rad0: 9, rad1: 6 },
      { hip: [76, 138], foot: [68, 208], ph: 2.1, rad0: 8, rad1: 6 },
      { hip: [94, 140], foot: [102, 176], ph: 4.2, rad0: 8, rad1: 5 },
    ];
    const n = nearestLeg(px, py, legs);
    const legW = (1 - ss(0.1, 1, n.score)) * (1 - body) * (1 - head) * (1 - abd.w) * (1 - fore) * (1 - hind);
    return { px, py, head, ant, body, fore, foreR, hind, hindR, abd: abd.w, abdR: abd.r, leg: legW > 0.02 ? n.leg : -1, along: n.along, legW, foot: 0, plant: 0, chest: 0, spine: 0, crys: 0, horn: 0, jaw: 0 };
  },
  displace(q, T, t) {
    if (T.hold === 'rest') return [q.px, q.py];
    const flap = Math.sin(TAU * t / T.flap + T.ph);
    const flap2 = Math.sin(TAU * t / T.flap + T.ph + 1.05);
    const look = Math.sin(TAU * t / T.hd + T.hph);
    let x = q.px, y = q.py;
    if (q.body > 0.01) {
      const [bx, by] = rot(q.px, q.py, 100, 120, 0.055 * flap);
      [x, y] = mix(x, y, bx, by - Math.max(0, flap) * 5, q.body);
    }
    if (q.fore > 0.01) {
      const [wx, wy] = rot(q.px, q.py, DRONE.fore[0], DRONE.fore[1], q.foreR * 0.62 * flap);
      [x, y] = mix(x, y, wx, wy, q.fore);
    }
    if (q.hind > 0.01) {
      const [wx, wy] = rot(q.px, q.py, DRONE.hind[0], DRONE.hind[1], q.hindR * 0.4 * flap2);
      [x, y] = mix(x, y, wx, wy, q.hind);
    }
    if (q.abd > 0.01) {
      const [ax, ay] = rot(q.px, q.py, 120, 132, q.abdR * 0.2 * Math.sin(TAU * t / T.abd + T.ph));
      [x, y] = mix(x, y, ax, ay, q.abd);
    }
    if (q.head > 0.01) {
      const [hx, hy] = rot(q.px, q.py, 78, 122, 0.07 * look);
      [x, y] = mix(x, y, hx, hy, q.head);
    }
    if (q.ant > 0.01) {
      const [ax, ay] = rot(x, y, 52, 108, q.ant * 0.28 * Math.sin(TAU * t / 0.33 + T.ph));
      [x, y] = mix(x, y, ax, ay, q.ant);
    }
    if (q.leg >= 0 && q.legW > 0.01) {
      const hips = [[60, 134], [76, 138], [94, 140]];
      const ph = [0, 2.1, 4.2][q.leg];
      const ang = q.along * 0.32 * Math.sin(TAU * t / T.dangle + ph);
      const [lx, ly] = rot(q.px, q.py, hips[q.leg][0], hips[q.leg][1], ang);
      [x, y] = mix(x, y, lx, ly, q.legW);
    }
    return [x, y];
  },
  shadow(T, t) {
    const flap = Math.sin(TAU * t / T.flap + T.ph);
    return { sh: 1 - 0.07 * Math.max(0, flap), shx: 0 };
  },
};

function abdomenW(px, py) {
  const P = DRONE.abd;
  let best = 1e9, s = 0, acc = 0, total = 0;
  const seg = [];
  for (let i = 0; i < P.length - 1; i++) {
    const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1];
    seg.push(Math.hypot(dx, dy));
    total += seg[i];
  }
  let run = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], ay = P[i][1], dx = P[i + 1][0] - ax, dy = P[i + 1][1] - ay, L2 = seg[i] ** 2 || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (d < best) { best = d; s = run + seg[i] * t; }
    run += seg[i];
  }
  if (py < 126) return { w: 0, r: 0 };
  const w = (1 - ss(14, 28, best)) * ss(124, 142, py);
  return { w, r: total ? s / total : 0 };
}

// --- Dusk Wyrm: centipede. Geodesic distance along the opaque painting (not a polyline the coil can
// flip across) so a travelling wave cannot tear the body. Thin pixels are legs and paddle a little.
let WYRM_FIELD = null;
function prepareWyrm(scene) {
  if (WYRM_FIELD) return;
  const src = scene.textures.get('cr-wyrm').getSourceImage();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, 256, 256);
  const px = g.getImageData(0, 0, 256, 256).data;
  const N = 256 * 256, solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) solid[i] = px[i * 4 + 3] > 48 ? 1 : 0;
  const s = new Float32Array(N); s.fill(-1);
  let seed = 98 * 256 + 102;
  if (!solid[seed]) {
    let best = 1e9, bi = seed;
    for (let i = 0; i < N; i++) if (solid[i]) {
      const x = i & 255, y = i >> 8, d = (x - 102) ** 2 + (y - 98) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    seed = bi;
  }
  const q = [seed]; s[seed] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i & 255, y = i >> 8, base = s[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx > 255 || ny > 255) continue;
      const j = ny * 256 + nx; if (!solid[j] || s[j] >= 0) continue;
      s[j] = base + 1; q.push(j);
    }
  }
  // thickness = distance to transparency, so legs (thin) can paddle without moving the plates
  const thick = new Float32Array(N);
  const bq = [];
  for (let i = 0; i < N; i++) if (!solid[i]) { thick[i] = 0; bq.push(i); }
  for (let qi = 0; qi < bq.length; qi++) {
    const i = bq[qi], x = i & 255, y = i >> 8;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx > 255 || ny > 255) continue;
      const j = ny * 256 + nx; if (!solid[j] || thick[j]) continue;
      thick[j] = thick[i] + 1; bq.push(j);
    }
  }
  const tx = new Float32Array(N), ty = new Float32Array(N);
  for (let y = 1; y < 255; y++) for (let x = 1; x < 255; x++) {
    const i = y * 256 + x; if (s[i] < 0) continue;
    let gx = s[i + 1] - s[i - 1], gy = s[i + 256] - s[i - 256];
    if (s[i + 1] < 0) gx = s[i] - s[i - 1];
    if (s[i - 1] < 0) gx = s[i + 1] - s[i];
    if (s[i + 256] < 0) gy = s[i] - s[i - 256];
    if (s[i - 256] < 0) gy = s[i + 256] - s[i];
    const l = Math.hypot(gx, gy) || 1;
    tx[i] = gx / l; ty[i] = gy / l;
  }
  let len = 0; for (let i = 0; i < N; i++) if (s[i] > len) len = s[i];
  WYRM_FIELD = { s, tx, ty, thick, len };
}
function wyrmAt(px, py) {
  const F = WYRM_FIELD;
  if (!F) return null;
  const x = Math.max(0, Math.min(255, px | 0)), y = Math.max(0, Math.min(255, py | 0));
  const i = y * 256 + x;
  if (F.s[i] < 0) return null;
  return { s: F.s[i], tx: F.tx[i], ty: F.ty[i], nx: -F.ty[i], ny: F.tx[i], thick: F.thick[i], len: F.len };
}

const WYRM = {
  seg: 40,
  boot: () => ({ ph: rand() * TAU, wave: 2.7 + rand() * 0.35, legs: 0.9 + rand() * 0.1, h1: 5.1 + rand() * 0.6, h2: 6.3 + rand() * 0.5, hph: rand() * TAU }),
  step() {},
  weigh(px, py) {
    const sp = wyrmAt(px, py);
    const headU = plat(px, py, 102, 98, 22, 40);
    const headL = plat(px, py, 96, 214, 20, 38);
    const head = Math.max(headU, headL);
    const face = headU >= headL ? [102, 98] : [96, 214];
    const horn = head * ss(22, 36, Math.hypot(px - face[0], py - face[1]));
    const reach = sp ? (1 - ss(3, 9, sp.thick)) * (1 - head) : 0;
    return {
      px, py, head, headU, headL, horn, face, reach,
      s: sp ? sp.s : 0, tx: sp ? sp.tx : 1, ty: sp ? sp.ty : 0, nx: sp ? sp.nx : 0, ny: sp ? sp.ny : 1, len: sp ? sp.len : 1,
      body: 0, chest: 0, leg: -1, legW: 0, foot: 0, plant: 0, spine: 0, crys: 0, jaw: 0, ant: 0, fore: 0, hind: 0, abd: 0,
    };
  },
  displace(q, T, t) {
    if (T.hold === 'rest') return [q.px, q.py];
    const u = Math.max(0, Math.min(1, q.s / (q.len || 1)));
    const env = Math.sin(Math.PI * u) * 0.65 + 0.35;
    const wave = 10 * env * Math.sin(TAU * (q.s / 110 - t / T.wave) + T.ph);
    const swing = Math.sin(TAU * (t / T.legs - q.s / 48) + T.ph);
    let x = q.px + q.nx * wave + q.tx * swing * 8 * q.reach;
    let y = q.py + q.ny * wave + q.ty * swing * 8 * q.reach;
    const hw = Math.max(q.headU, q.headL);
    if (hw > 0.01) {
      const upper = q.headU >= q.headL;
      const pivot = upper ? [126, 78] : [134, 198];
      const ang = upper ? 0.1 * Math.sin(TAU * t / T.h1 + T.hph) : -0.12 * Math.sin(TAU * t / T.h2 + T.hph);
      const [hx, hy] = rot(q.px, q.py, pivot[0], pivot[1], ang);
      [x, y] = mix(x, y, hx, hy, hw);
    }
    if (q.horn > 0.01) {
      const tw = 0.14 * Math.sin(TAU * t / 0.55 + q.s * 0.02);
      const [hx, hy] = rot(x, y, q.face[0], q.face[1], q.horn * tw);
      [x, y] = mix(x, y, hx, hy, q.horn);
    }
    return [x, y];
  },
  shadow: () => ({ sh: 1, shx: 0 }),
};

const SPEC = { scuttler: SCUTTLER, drone: DRONE, hound: HOUND, golem: GOLEM, wyrm: WYRM };
export const MESH_CREATURES = Object.keys(SPEC);

function grid(scene, key, x, y, depth, tw, seg) {
  const m = scene.add.mesh(x, y, key);
  Phaser.Geom.Mesh.GenerateGridVerts({ mesh: m, texture: key, width: tw, height: tw, widthSegments: seg, heightSegments: seg });
  m.hideCCW = false;
  m.ignoreDirtyCache = true;
  m.setDepth(depth);
  m.setOrtho(scene.scale.width, scene.scale.height);
  return m;
}
function place(r, x0, y0, sc, f) {
  const tw = r.tw, cx = tw / 2;
  r.body.setPosition(x0, y0);
  const vb = r.body.vertices;
  for (let i = 0; i < vb.length; i++) {
    const q = r.w[i];
    const d = f ? f(q) : null;
    const px = d ? d[0] : q.px, py = d ? d[1] : q.py;
    vb[i].x = (px - cx) * sc;
    vb[i].y = -(py - tw * 0.97) * sc;
  }
}
export function buildCreatureMesh(scene, img) {
  const type = img.texture.key.replace(/^cr-/, '');
  const spec = SPEC[type];
  if (!spec) return null;
  if (type === 'wyrm') prepareWyrm(scene);
  const tw = img.width;
  const body = grid(scene, img.texture.key, img.x, img.y, img.depth + 0.0002, tw, spec.seg);
  const w = body.vertices.map((v) => spec.weigh(v.x + tw / 2, tw / 2 - v.y));
  const rig = { body, w, all: [body], T: spec.boot(), type, spec, tw };
  place(rig, img.x, img.y, img.scaleX, null);
  return rig;
}
export function poseCreatureMesh(s, t, dt) {
  const r = s.rig, img = s.img;
  img.setScale(s.base).setPosition(s.x0, s.y0).setRotation(0);
  r.spec.step(r.T, t, dt || 0);
  place(r, s.x0, s.y0, s.base, (q) => r.spec.displace(q, r.T, t));
  const tint = img.tintTopLeft;
  if (r._t !== tint) { r._t = tint; r.body.setTint(tint); }
  return r.spec.shadow(r.T, t);
}

// Drivers zeroed: displacement must be ~0 (the painting). Used by the preview inspection.
export function restError(type, n = 48) {
  const spec = SPEC[type];
  const T = spec.boot();
  T.hold = 'rest';
  let max = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = (x + 0.5) * 256 / n, py = (y + 0.5) * 256 / n;
    const q = spec.weigh(px, py);
    const d = spec.displace(q, T, 1.7);
    max = Math.max(max, Math.hypot(d[0] - px, d[1] - py));
  }
  return max;
}
// Stance claws (foot weight high, that leg's swing <= 0, no stomp) stay on the painted pixel.
export function stanceFootError(type) {
  const spec = SPEC[type];
  if (!spec.legs) return 0;
  const T = spec.boot();
  T.shift = 0; T.stomp = 0; T.ph = 0; T.hph = 0;
  let max = 0;
  for (let y = 8; y < 250; y += 4) for (let x = 8; x < 250; x += 4) {
    const q = spec.weigh(x, y);
    if ((q.foot || 0) < 0.8 || q.leg < 0) continue;
    const L = spec.legs[q.leg];
    for (let step = 0; step < 24; step++) {
      const t = step / 24 * T.gait;
      const swing = Math.sin(TAU * t / T.gait + L.ph);
      if (swing > 0) continue;
      const d = spec.displace(q, T, t);
      max = Math.max(max, Math.hypot(d[0] - x, d[1] - y));
    }
  }
  return max;
}
