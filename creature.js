// Broken Dawn creature motion mockup: part-rigged Husk Scuttler with procedural locomotion.
// Painted parts (shell, head, femur, tibia) are cut from the game's cr-scuttler painting; everything else is runtime math.
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
function rng(seed) { let s = seed >>> 0; return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noise(t, s) { return Math.sin(t * 1.31 + s) * 0.5 + Math.sin(t * 2.73 + s * 1.7) * 0.3 + Math.sin(t * 5.17 + s * 0.37) * 0.2; }

class Path {
  constructor(pts, closed = true, n = 24) {
    const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
    const out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      for (let j = 0; j < n; j++) {
        const t = j / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(closed ? out[0] : P[P.length - 2]);
    this.pts = out; this.acc = [0];
    for (let i = 1; i < out.length; i++) this.acc.push(this.acc[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    this.len = this.acc[this.acc.length - 1]; this.closed = closed;
  }
  at(s) {
    s = this.closed ? ((s % this.len) + this.len) % this.len : clamp(s, 0, this.len - 0.001);
    let lo = 0, hi = this.acc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.acc[m] <= s) lo = m; else hi = m; }
    const f = (s - this.acc[lo]) / (this.acc[hi] - this.acc[lo] || 1), a = this.pts[lo], b = this.pts[hi];
    return { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f) };
  }
}

// ---- rig layout in creature-local units (k = 1): x = right, y = forward ----
const RIG = {
  shellW: 58, shellPivotY: 20, shellPivotV: 0.06,
  headW: 34, headY: 24, headOriginV: 0.8,
  mandY: 44, mandX: 5.5, mandLen: 15,
  antY: 33, antX: 9, antSeg: [11, 9, 7],
  hipsY: [14, 5, -5, -15], hipX: 15,
  legAng: [0.62, 1.2, 1.85, 2.45],     // splay from forward (rad)
  reach: [46, 46, 46, 50],
  L1: 29, L2: 35, femW: 8, tibW: 7,
};
const GROUP = (side, i) => ((i + (side > 0 ? 1 : 0)) % 2); // alternating tetrapod: L1 R2 L3 R4 | R1 L2 R3 L4

class Creature {
  constructor(scene, o) {
    this.s = scene; this.k = o.k || 1; this.x = o.x; this.y = o.y; this.th = o.heading || 0;
    this.v = 0; this.vx = 0; this.vy = 0; this.maxV = (o.speed || 46) * this.k; this.turnRate = o.turnRate || 2.6;
    this.r = rng(o.seed || 1); this.seed = (o.seed || 1) * 7.3; this.t = 0; this.dist = 0;
    this.tint = o.tint || 0xffffff; this.name = o.name; this.level = o.level;
    this.path = o.path; this.script = o.script || []; this.si = 0; this.act = null; this.carrot = null; this.sCarrot = o.s0 || 0;
    this.shellAng = this.th; this.yaw = 0; this.yawT = 0; this.lookAt = 0; this.breath = this.r() * TAU;
    this.mand = 0.1; this.mandT = 0.1; this.chewAt = 1; this.lunge = 0; this.bodyZx = 0; this.crouch = 0;
    this.ant = [-1, 1].map((side) => ({ side, tw: 0, tv: 0, next: 0.5 + this.r() * 1.5 }));
    const K = this.k;
    this.g0 = scene.add.graphics();           // ground shadows
    this.legs = [];
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const fem = scene.add.image(0, 0, 'femur').setOrigin(0.5, 0.04).setTint(this.tint).setFlipX(side < 0);
      const tib = scene.add.image(0, 0, 'tibia').setOrigin(0.5, 0.03).setTint(this.tint).setFlipX(side < 0);
      const leg = { side, i, fem, tib, group: GROUP(side, i), stepping: false, st: 0, dur: 0.18, from: null, foot: null, z: 0, forceLift: 0 };
      this.legs.push(leg);
    }
    this.mandL = scene.add.image(0, 0, 'mand').setOrigin(0.5, 1).setFlipX(true).setTint(this.tint);
    this.mandR = scene.add.image(0, 0, 'mand').setOrigin(0.5, 1).setTint(this.tint);
    this.head = scene.add.image(0, 0, 'head').setOrigin(0.5, RIG.headOriginV).setTint(this.tint);
    this.shell = scene.add.image(0, 0, 'shell').setOrigin(0.5, RIG.shellPivotV).setTint(this.tint);
    this.g1 = scene.add.graphics();           // antennae
    this.shellBase = (RIG.shellW * K) / 200; this.headBase = (RIG.headW * K) / 112;
    this.shell.setScale(this.shellBase); this.head.setScale(this.headBase);
    this.mandL.setScale((RIG.mandLen * K) / 40); this.mandR.setScale((RIG.mandLen * K) / 40);
    // label (Ants-style level tag)
    if (o.name) {
      this.tag = scene.add.container(0, 0);
      const txt = scene.add.text(0, 0, o.name, { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#f4efe4' }).setOrigin(0, 0.5).setShadow(0, 1, '#000', 4, false, true);
      const box = scene.add.graphics(); box.fillStyle(0x0d0f12, 0.88).fillRoundedRect(-18, -8, 16, 16, 3).lineStyle(1, 0xc9a45a, 0.6).strokeRoundedRect(-18, -8, 16, 16, 3);
      const lv = scene.add.text(-10, 0, String(o.level), { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#ffffff' }).setOrigin(0.5);
      txt.x = 2; this.tag.add([box, lv, txt]); this.tag.setDepth(5000);
      this.tagW = txt.width + 20;
    }
    for (const L of this.legs) { const p = this.restWorld(L); L.foot = { x: p.x, y: p.y }; }
  }
  // local -> world (body frame at pos, heading th)
  lw(lx, ly, th = this.th, ox = this.x, oy = this.y) { const c = Math.cos(th), s = Math.sin(th); return { x: ox + c * ly - s * lx, y: oy + s * ly + c * lx }; }
  bodyPos() { const c = Math.cos(this.th), s = Math.sin(this.th); const sway = this.sway || 0; return { x: this.x + c * this.lunge - s * sway, y: this.y + s * this.lunge + c * sway }; }
  hipLocal(L) { return { x: L.side * RIG.hipX * this.k, y: RIG.hipsY[L.i] * this.k }; }
  restLocal(L) { const a = RIG.legAng[L.i], R = RIG.reach[L.i] * this.k, h = this.hipLocal(L); return { x: h.x + L.side * Math.sin(a) * R * 0.92, y: h.y + Math.cos(a) * R * 0.92 }; }
  restWorld(L, lead = 0) { const p = this.restLocal(L); const w = this.lw(p.x, p.y); return { x: w.x + this.vx * lead, y: w.y + this.vy * lead }; }

  nextAct() { if (!this.script.length) return null; const a = { ...this.script[this.si % this.script.length], t: 0 }; this.si++; return a; }
  update(dt) {
    this.t += dt; const K = this.k;
    if (!this.act || this.act.done) { this.act = this.nextAct(); if (this.act && this.act.onStart) this.act.onStart(this); }
    const a = this.act; let wantV = 0, wantTh = this.th, turn = this.turnRate;
    if (a) {
      a.t += dt;
      if (a.type === 'walk') {
        const tgt = a.to; let ahead = tgt - this.sCarrot; if (this.path.closed) ahead = ((ahead % this.path.len) + this.path.len) % this.path.len;
        const cp = this.path.at(this.sCarrot), dC = Math.hypot(cp.x - this.x, cp.y - this.y);
        if (ahead > 0.5 && dC < 26 * K) this.sCarrot += Math.min(ahead, Math.max(this.v, 20 * K) * 1.4 * dt + (26 * K - dC) * 0.5 * dt);
        const c2 = this.path.at(this.sCarrot), dx = c2.x - this.x, dy = c2.y - this.y, d = Math.hypot(dx, dy);
        wantTh = Math.atan2(dy, dx);
        const turnErr = Math.abs(angDiff(this.th, wantTh));
        const remaining = ahead + d;
        wantV = (a.speed ? a.speed * K : this.maxV) * clamp(remaining / (34 * K), 0.0, 1) * clamp(1.15 - turnErr * 0.9, 0.15, 1);
        if (ahead <= 0.5 && d < 3 * K) { a.done = true; }
        if (d < 2 * K) wantTh = this.th;
        this.lookAt = clamp(angDiff(this.th, wantTh) * 0.9, -0.4, 0.4);
      } else if (a.type === 'idle') {
        if (a.t > a.dur) a.done = true;
        if (this.t > (this.nextLook || 0)) { this.lookAt = (this.r() - 0.5) * 0.7; this.nextLook = this.t + 0.6 + this.r() * 1.2; }
        if (this.t > (this.nextShuffle || 0) && a.t > 0.5) { const L = this.legs[Math.floor(this.r() * 8)]; if (!L.stepping) this.startStep(L, 0.22, (this.r() - 0.5) * 7 * K); this.nextShuffle = this.t + 0.5 + this.r() * 0.9; }
      } else if (a.type === 'face') {
        const tg = a.target; wantTh = Math.atan2(tg.y - this.y, tg.x - this.x); turn = 1.7; this.lookAt = clamp(angDiff(this.th, wantTh), -0.4, 0.4);
        if (Math.abs(angDiff(this.th, wantTh)) < 0.04 && a.t > 0.3) a.done = true;
      } else if (a.type === 'lunge') {
        this.doLunge(a, dt);
      }
    }
    // steering + speed
    const acc = wantV > this.v ? 70 * K : 110 * K;
    this.v += clamp(wantV - this.v, -acc * dt, acc * dt);
    const dth = angDiff(this.th, wantTh); const maxTurn = turn * dt * (0.4 + 0.6 * clamp(this.v / this.maxV, 0, 1)) + (a && a.type === 'face' ? turn * dt : 0);
    this.th += clamp(dth, -maxTurn, maxTurn);
    this.vx = Math.cos(this.th) * this.v; this.vy = Math.sin(this.th) * this.v;
    this.x += this.vx * dt; this.y += this.vy * dt; this.dist += this.v * dt;
    this.angVel = (this.th - (this.prevTh ?? this.th)) / Math.max(dt, 1e-4); this.prevTh = this.th;
    this.updateLegs(dt);
    this.updateBody(dt);
    this.draw();
  }

  startStep(L, dur, jitter = 0) {
    L.stepping = true; L.st = 0; L.dur = dur; L.from = { ...L.foot }; L.jit = jitter;
  }
  updateLegs(dt) {
    const K = this.k, speedF = clamp(this.v / this.maxV, 0, 1), turning = Math.abs(this.angVel || 0);
    const dur = lerp(0.2, 0.13, speedF);
    const lead = dur * 0.9;
    const thresh = (this.v > 3 * K || turning > 0.15) ? lerp(7, 13, speedF) * K : 99 * K;
    const steppingGroup = this.legs.filter((l) => l.stepping).map((l) => l.group);
    for (const L of this.legs) {
      if (L.stepping || L.forceLift) continue;
      const des = this.restWorld(L, lead), err = Math.hypot(des.x - L.foot.x, des.y - L.foot.y);
      if (err > thresh && !steppingGroup.includes(1 - L.group)) {
        // start this leg's whole group together (tetrapod)
        for (const M of this.legs) if (M.group === L.group && !M.stepping && !M.forceLift) {
          const d2 = this.restWorld(M, lead); if (Math.hypot(d2.x - M.foot.x, d2.y - M.foot.y) > thresh * 0.45) this.startStep(M, dur * (0.9 + this.r() * 0.2));
        }
        steppingGroup.push(L.group);
      }
    }
    for (const L of this.legs) {
      if (L.stepping) {
        L.st += dt; const p = clamp(L.st / L.dur, 0, 1);
        const des = this.restWorld(L, lead); if (L.jit) { des.x += L.jit; des.y += L.jit * 0.6; }
        const e = smooth(p); L.foot.x = lerp(L.from.x, des.x, e); L.foot.y = lerp(L.from.y, des.y, e);
        L.z = Math.sin(Math.PI * p) * (5 + 4 * speedF) * K;
        if (p >= 1) { L.stepping = false; L.z = 0; if (this.v > 8 * K && this.r() < 0.5) this.s.dust(L.foot.x, L.foot.y, 0.10 * K, 0.6 * K); }
      } else if (!L.forceLift) L.z = Math.max(0, L.z - dt * 60);
    }
  }
  updateBody(dt) {
    const K = this.k, speedF = clamp(this.v / this.maxV, 0, 1);
    // gait-driven bob + sway: body dips as each tetrapod lands
    const swingA = this.legs.filter((l) => l.group === 0 && l.stepping).reduce((s, l) => s + Math.sin(Math.PI * clamp(l.st / l.dur, 0, 1)), 0) / 4;
    const swingB = this.legs.filter((l) => l.group === 1 && l.stepping).reduce((s, l) => s + Math.sin(Math.PI * clamp(l.st / l.dur, 0, 1)), 0) / 4;
    const swayT = (swingA - swingB) * 1.6 * K;
    this.sway = lerp(this.sway || 0, swayT, clamp(dt * 14, 0, 1));
    this.roll = (this.sway / K) * 0.035;
    const bob = (swingA + swingB) * 1.4 * K;
    this.breath += dt * TAU * (this.v > 5 ? 0.9 : 0.42);
    const br = Math.sin(this.breath);
    this.bodyZ = (9 + bob - this.crouch * 4 + this.bodyZx) * K;
    this.br = br;
    // abdomen lags on turns (spring), head leads into the turn
    this.shellAng += angDiff(this.shellAng, this.th) * clamp(dt * 5.5, 0, 1);
    const lag = clamp(angDiff(this.th, this.shellAng), -0.35, 0.35);
    this.shellAng = this.th + lag;
    this.yaw += (this.lookAt - this.yaw) * clamp(dt * 5, 0, 1);
    // mandibles: slow chew while idle, snap shut after lunges
    if (!this.attacking) {
      if (this.t > this.chewAt) { this.mandT = this.mandT > 0.15 ? 0.05 : 0.18 + this.r() * 0.12; this.chewAt = this.t + (this.v > 5 ? 0.6 : 0.25 + this.r() * 0.9); }
    }
    this.mand += (this.mandT - this.mand) * clamp(dt * (this.attacking ? 30 : 9), 0, 1);
    // antennae twitch springs
    for (const A of this.ant) {
      if (this.t > A.next) { A.tv += (this.r() - 0.35) * (this.v > 5 ? 6 : 14); A.next = this.t + (this.v > 5 ? 0.4 + this.r() * 0.8 : 0.3 + this.r() * 1.6); }
      A.tv += (-90 * A.tw - 9 * A.tv) * dt; A.tw += A.tv * dt;
    }
  }
  doLunge(a, dt) {
    const K = this.k, t = a.t, A = 0.36, S = 0.1, R = 0.8, BACK = 10 * K, FWD = 26 * K;
    this.attacking = true;
    const front = this.legs.filter((l) => l.i === 0);
    if (t < A) {
      const p = easeInOut(t / A); this.lunge = -BACK * p; this.crouch = p; this.mandT = 0.75; this.lookAt = 0;
      for (const L of front) { L.forceLift = 1; L.z = 12 * K * p; }
    } else if (t < A + S) {
      const p = easeOut((t - A) / S); this.lunge = lerp(-BACK, FWD, p); this.crouch = 1 - p; this.bodyZx = 5 * p;
      for (const L of front) { const w = this.lw(L.side * 14 * K, 56 * K); L.foot.x = lerp(L.foot.x, w.x, p); L.foot.y = lerp(L.foot.y, w.y, p); L.z = 9 * K * (1 - p * 0.6); }
      if (!a.hit && p > 0.85) { a.hit = true; this.mandT = -0.12; if (a.onHit) a.onHit(this); }
    } else if (t < A + S + R) {
      const p = easeInOut((t - A - S) / R); this.lunge = lerp(FWD, 0, p); this.bodyZx = 5 * (1 - p); this.crouch = 0;
      for (const L of front) { L.z = 4 * K * (1 - p); if (p > 0.35 && L.forceLift) { L.forceLift = 0; this.startStep(L, 0.2); } }
    } else { this.lunge = 0; this.bodyZx = 0; this.attacking = false; this.mandT = 0.1; for (const L of front) L.forceLift = 0; a.done = true; }
  }

  draw() {
    const K = this.k, s = this.s, bp = this.bodyPos(), th = this.th, z = this.bodyZ;
    const LX = 0.55, LY = 0.75;            // light from top-left -> shadows fall down-right
    const depth = this.y + 1000;
    const g0 = this.g0; g0.clear(); g0.setDepth(depth);
    // body shadow (soft): stacked ellipses rotated with the shell
    const shp = { x: bp.x + LX * z, y: bp.y + LY * z };
    const c = Math.cos(this.shellAng), sn = Math.sin(this.shellAng);
    for (let i = 5; i >= 1; i--) {
      const f = 0.6 + i * 0.12; g0.fillStyle(0x000000, 0.075);
      const cx = shp.x + c * (-8 * K), cy = shp.y + sn * (-8 * K);
      this.ellipseRot(g0, cx, cy, 33 * K * f, 26 * K * f * 0.85, this.shellAng);
    }
    // legs (IK) + leg shadows
    const hipZ = z * 0.85;
    for (const L of this.legs) {
      const hl = this.hipLocal(L), H = this.lw(hl.x, hl.y, th, bp.x, bp.y);
      const F = { x: L.foot.x, y: L.foot.y };
      let dx = F.x - H.x, dy = F.y - H.y, d = Math.hypot(dx, dy) || 1;
      const L1 = RIG.L1 * K, L2 = RIG.L2 * K, dd = clamp(d, Math.abs(L1 - L2) + 1, L1 + L2 - 0.5);
      const ca = clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1), A = Math.acos(ca);
      const base = Math.atan2(dy, dx), bend = L.side * (L.i < 2 ? -1 : 1);
      // knee bends away from body: choose sign so knee is on the outer side
      const outer = th + L.side * Math.PI / 2;
      const k1 = { x: H.x + Math.cos(base + A) * L1, y: H.y + Math.sin(base + A) * L1 }, k2 = { x: H.x + Math.cos(base - A) * L1, y: H.y + Math.sin(base - A) * L1 };
      const dot = (p) => (p.x - H.x) * Math.cos(outer) + (p.y - H.y) * Math.sin(outer);
      const Kn = dot(k1) > dot(k2) ? k1 : k2;
      const Fe = d > dd ? { x: H.x + dx / d * dd, y: H.y + dy / d * dd } : F; // clamp (no stretching)
      const kneeZ = z * 1.35 + L.z * 0.6;
      // screen positions lift toward camera a little with height
      const up = 0.35;
      const Hs = { x: H.x, y: H.y - hipZ * up }, Ks = { x: Kn.x, y: Kn.y - kneeZ * up }, Fs = { x: Fe.x, y: Fe.y - L.z * up };
      // shadows
      g0.lineStyle(3.2 * K, 0x000000, 0.22);
      g0.beginPath(); g0.moveTo(H.x + LX * hipZ, H.y + LY * hipZ); g0.lineTo(Kn.x + LX * kneeZ, Kn.y + LY * kneeZ); g0.lineTo(Fe.x + LX * L.z, Fe.y + LY * L.z); g0.strokePath();
      g0.fillStyle(0x000000, 0.18); g0.fillCircle(Fe.x + LX * L.z, Fe.y + LY * L.z, 1.6 * K);
      this.seg(L.fem, Hs, Ks, RIG.femW * K, 106, depth + 0.1 + (L.i === 0 ? 0.01 : 0));
      this.seg(L.tib, Ks, Fs, RIG.tibW * K, 140, depth + 0.11 + (L.i === 0 ? 0.01 : 0));
    }
    // head (pivots at neck, leads into turns)
    const hy = this.headAng = th + this.yaw * 0.8;
    const neck = this.lw(0, RIG.headY * K, th, bp.x, bp.y - z * 0.35);
    this.head.setPosition(neck.x, neck.y).setRotation(hy + Math.PI / 2).setDepth(depth + 0.2).setScale(this.headBase * (1 + this.crouch * -0.02));
    // mandibles
    const mL = this.lw(-RIG.mandX * K, RIG.mandY * K - RIG.headY * K, hy, neck.x, neck.y), mR = this.lw(RIG.mandX * K, RIG.mandY * K - RIG.headY * K, hy, neck.x, neck.y);
    this.mandL.setPosition(mL.x, mL.y).setRotation(hy + Math.PI / 2 - this.mand).setDepth(depth + 0.21);
    this.mandR.setPosition(mR.x, mR.y).setRotation(hy + Math.PI / 2 + this.mand).setDepth(depth + 0.21);
    // shell (abdomen): pivots at waist, lags on turns, breathes, rolls with sway
    const waist = this.lw(0, RIG.shellPivotY * K, th, bp.x, bp.y - z * 0.4);
    const br = this.br, bs = this.v > 5 ? 0.008 : 0.022;
    this.shell.setPosition(waist.x, waist.y).setRotation(this.shellAng + Math.PI / 2 + this.roll).setDepth(depth + 0.3)
      .setScale(this.shellBase * (1 + br * bs + this.bodyZx * 0.008) * (1 - Math.abs(this.roll) * 0.6), this.shellBase * (1 + br * bs * 0.5 + this.bodyZx * 0.008));
    // antennae
    const g1 = this.g1; g1.clear(); g1.setDepth(depth + 0.4);
    const speedF = clamp(this.v / this.maxV, 0, 1);
    for (const A of this.ant) {
      let p = this.lw(A.side * RIG.antX * K, RIG.antY * K - RIG.headY * K, hy, neck.x, neck.y);
      let ang = hy + A.side * (0.42 + 0.12 * noise(this.t * 0.9, this.seed + A.side * 3)) + A.tw * A.side
        + Math.sin(this.t * 7 + (A.side > 0 ? Math.PI : 0)) * 0.22 * speedF + (this.attacking ? -A.side * 0.25 : 0);
      const pts = [p];
      RIG.antSeg.forEach((len, j) => {
        ang += A.side * (0.18 + 0.1 * noise(this.t * (1.6 + j), this.seed + j + A.side)) * (j ? 1 : 0.3);
        p = { x: p.x + Math.cos(ang) * len * K, y: p.y + Math.sin(ang) * len * K }; pts.push(p);
      });
      // shadow
      g1.lineStyle(1.4 * K, 0x000000, 0.18); g1.beginPath(); g1.moveTo(pts[0].x + LX * z * 1.1, pts[0].y + LY * z * 1.1); for (let j = 1; j < pts.length; j++) g1.lineTo(pts[j].x + LX * z * (1.1 + j * 0.25), pts[j].y + LY * z * (1.1 + j * 0.25)); g1.strokePath();
      for (let j = 1; j < pts.length; j++) {
        const w = (2.3 - j * 0.45) * K;
        g1.lineStyle(w, 0x2a1d10, 1).lineBetween(pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y);
        g1.lineStyle(w * 0.4, 0xd8b878, 0.7).lineBetween(pts[j - 1].x - 0.3, pts[j - 1].y - 0.3, pts[j].x - 0.3, pts[j].y - 0.3);
        g1.fillStyle(0x1a120a, 1).fillCircle(pts[j].x, pts[j].y, w * 0.55);
      }
      g1.fillStyle(0x5ff2dc, 0.9).fillCircle(pts[pts.length - 1].x, pts[pts.length - 1].y, 1.1 * K); // teal tip glow
    }
    if (this.tag) this.tag.setPosition(this.x - this.tagW / 2 + 18, this.y + 54 * K);
  }
  seg(img, a, b, w, texH, depth) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    img.setPosition(a.x, a.y).setRotation(Math.atan2(dy, dx) - Math.PI / 2).setScale(w / img.width, (len * 1.06) / texH).setDepth(depth);
  }
  ellipseRot(g, cx, cy, rx, ry, ang) {
    const n = 20, pts = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * TAU, x = Math.cos(t) * ry, y = Math.sin(t) * rx; pts.push({ x: cx + Math.cos(ang) * y - Math.sin(ang) * x, y: cy + Math.sin(ang) * y + Math.cos(ang) * x }); }
    g.fillPoints(pts, true);
  }
}
