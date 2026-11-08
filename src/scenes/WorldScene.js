import Phaser from 'phaser';
import { WORLD, PALETTE, CREATURES, SQUADS, BASE_TIERS, baseTier, RES, GAME_WIDTH as LW, GAME_HEIGHT as LH, REDUCED_MOTION } from '../config.js';
import { installCamFeel } from '../ui/camfeel.js';
import { store } from '../state/store.js';
import { mulberry32 } from '../world/battle.js';
import { LOCAL_OWNER, BASE_ID, CENTER, dist } from '../world/worldState.js';
import { attachLeadIcon } from '../ui/widgets.js';
import { FONT, TITLE_FONT } from '../ui/fonts.js';
import { LevelTag, BasePlate } from '../ui/levelTag.js';
import { buildBehemothMesh, poseBehemothMesh, BH_MESH_W } from '../world/behemothMesh.js';
import { buildCreatureMesh, poseCreatureMesh } from '../world/creatureMesh.js';

const T = WORLD.tile;
const SIZE = WORLD.size * T;
const TAP_SLOP = 10;
const tileToWorld = (x, y) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T });

// The World map (stage 12: painted wasteland). The Rift Citadel sits at the centre under a golden dome;
// stage 18: no zones; creatures are scattered everywhere and get tougher closer to it. Your base and seeded neighbour bases (WorldService bases())
// render by Beacon tier with an alliance banner. Squads march out, auto-battle and march back.
// Pan: drag. Zoom: pinch / wheel. Tap a creature to target it, a base for its profile, the Citadel for its card.
// Perf: every prop is one image from the 'wmap' atlas (one batch) and off-screen props are culled.
const TIER_FRAMES = ['base-t1', 'base-t2', 'base-t3', 'base-t4', 'base-t5'];
const TIER_W = [180, 205, 230, 250, 275]; // on-map width in px (world units)
// stage 12b painted lairs: sandworm burrow, bat roost, crawler nest, crystal tower (+ a concept crater)
const LAIR_OF = { wyrm: 'lair-burrow', drone: 'lair-roost', scuttler: 'lair-nest', golem: 'lair-tower', hound: 'lair-crater' };
const LAIR_W = { 'lair-burrow': 190, 'lair-roost': 150, 'lair-nest': 140, 'lair-tower': 130, 'lair-crater': 120 };
// stage 20: on-map body widths (world px) and singular names for the Ants-style tags
export const CR_W = { scuttler: 90, drone: 100, hound: 115, golem: 130, wyrm: 160, behemoth: 300 };
const CR_NAME = { scuttler: 'Husk Scuttler', drone: 'Rift Drone', hound: 'Void Hound', golem: 'Shard Golem', wyrm: 'Dusk Wyrm', behemoth: 'Behemoth' };
// Live map keeps the stage-20 idle poses. ?motion=mesh (or __BD_TEST.motion) bends the painted art.
// The Behemoth uses the approved A4 mesh unchanged. ?reel=1 is the judging lineup, not the live map.
export function meshPreviewOn() {
  if (typeof window === 'undefined') return false;
  if (window.__BD_TEST?.motion === 'mesh') return true;
  try { return new URLSearchParams(location.search).get('motion') === 'mesh'; } catch { return false; }
}
function reelRequested() {
  if (!meshPreviewOn()) return false;
  if (typeof window !== 'undefined' && window.__BD_TEST?.reel) return true;
  try { return new URLSearchParams(location.search).get('reel') === '1'; } catch { return false; }
}
// Idle motion: per-creature randomized breathing (+ type extras), evaluated per frame for on-screen creatures only.
const TAU = Math.PI * 2;
export function newIdle(type) {
  const heavy = type === 'golem' || type === 'behemoth';
  return { type, ph: Math.random() * TAU, per: heavy ? 3.2 + Math.random() * 0.8 : 2 + Math.random() * 1.4, amp: heavy ? 0.026 + Math.random() * 0.006 : 0.015 + Math.random() * 0.01,
    bob: 1.2 + Math.random() * 0.6, flut: 0.07 + Math.random() * 0.02, sway: 4.5 + Math.random() * 1.5,
    next: 1 + Math.random() * 5, dx: 0, da: 0, tdx: 0, tda: 0 };
}
export function idlePose(I, t, dt) {
  // returns { sx, sy, dx, dy, ang, sh } multipliers/offsets for the creature at time t (s)
  const b = Math.sin(TAU * t / I.per + I.ph);
  let sx = 1 - b * I.amp * 0.5, sy = 1 + b * I.amp, dx = 0, dy = 0, ang = 0, sh = 1;
  if (I.type === 'drone') {
    const h = Math.sin(TAU * t / I.bob + I.ph); dy = -3.5 * h; sh = 1 - 0.1 * h;          // hover bob; shadow pulses opposite
    sx *= 1 + 0.012 * Math.sin(TAU * t / I.flut);                                        // tiny wing flutter
  } else if (I.type === 'hound' || I.type === 'scuttler') {
    if (t > I.next) { I.next = t + 3 + Math.random() * 5; I.tdx = (Math.random() * 2 - 1) * 3; I.tda = (Math.random() * 2 - 1) * 0.03; }
    const k = Math.min(1, dt * 3); I.dx += (I.tdx - I.dx) * k; I.da += (I.tda - I.da) * k; dx = I.dx; ang = I.da; // weight shift / small turn
  } else if (I.type === 'wyrm') {
    const w = Math.sin(TAU * t / I.sway + I.ph); ang = 0.025 * w; dx = 2 * w;              // slow coil sway
  }
  return { sx, sy, dx, dy, ang, sh };
}
export default class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }

  create() {
    this.input.addPointer(2);
    this.input.setGlobalTopOnly(false);
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x05070a);
    this.props = [];               // culled decor
    this.labels = [];              // constant-size plaques
    this.drawWorld();
    this.baseSprites = new Map();  // id -> { parts[], tier, e }
    const bp = store.basePos(), b = tileToWorld(bp.x, bp.y);
    this.marchG = this.add.graphics().setDepth(5);
    this.selG = this.add.graphics().setDepth(6);
    this.crSprites = new Map();   // id -> { img, badge, lock }
    this.marchSprites = new Map(); // id -> { img, label }
    this.nodeSprites = new Map();  // stage 16: Alloy nodes, id -> { img, badge, e, tex }
    this.selected = null;
    this.reducedMotion = REDUCED_MOTION || !!window.__BD_TEST?.reducedMotion;
    this.tileSel = null;           // stage 18: an empty tile you tapped {x,y}
    this.markG = this.add.graphics().setDepth(7);
    this.gesture = null; this.pinch = null;

    this.setZl(WORLD.startZoom);
    cam.centerOn(b.x, b.y);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.ui()?.blocksPointer(p.x, p.y)) return;
      this.wheelZoom(p.x, p.y, dy > 0 ? 0.9 : 1.1);
    });
    installCamFeel(this, { minZ: () => WORLD.minZoom, maxZ: () => WORLD.maxZoom });
    this.unsubs = [
      store.on('hunt', (r) => this.battleFx(r)),
      store.on('reset', () => { this.select(null); this.syncAll(true); this.focusBase(); }),
      store.on('teleport', (r) => this.teleportFx(r)),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
    this.syncAll(true);
    if (reelRequested()) this.startReel();
  }

  ui() { return this.scene.get('UI'); }

  // Map labels are plaques (dark pill + bold text) that keep a constant on-screen size at any zoom;
  // `min` hides them when zoomed out past it so the overview stays clean.
  plaque(x, y, str, o = {}) {
    const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${o.size ?? 24}px`, fontStyle: o.bold === false ? 'normal' : 'bold', color: o.color ?? '#f2ead8', backgroundColor: o.bg ?? '#07090dcc', padding: { x: 10, y: 4 }, align: 'center' })
      .setOrigin(0.5, o.oy ?? 0).setDepth(o.depth ?? 41);
    attachLeadIcon(t);
    this.labels.push({ t, min: o.min ?? 0, reel: !!o.reel });
    this.fitLabel(this.labels[this.labels.length - 1]);
    return t;
  }
  // stage 20: Ants-style level tag (creatures, nodes) and base nameplate; zoom-fitted like plaques
  levelTag(x, y, o = {}) { const t = new LevelTag(this, x, y, o); this.labels.push({ t, min: o.min ?? 0 }); this.fitLabel(this.labels[this.labels.length - 1]); return t; }
  basePlate(x, y, o = {}) { const t = new BasePlate(this, x, y, o); this.labels.push({ t, min: o.min ?? 0 }); this.fitLabel(this.labels[this.labels.length - 1]); return t; }
  fitLabel(l, z = this.zl) {
    if (this.reelOn && !l.reel) { l.t.setVisible(false); return; }
    l.t.setScale(1 / z); l.t.setVisible(z >= l.min && !l.t.hiddenByGame);
  }
  fitLabels(force = false) {
    const z = this.zl;
    if (!force && z === this.labelZoom) return;
    this.labelZoom = z;
    this.labels = this.labels.filter((l) => l.t.active);
    for (const l of this.labels) this.fitLabel(l, z);
  }

  prop(x, y, frame, o = {}) {
    const im = this.add.image(x, y, 'wmap', frame).setDepth(o.depth ?? 1);
    if (o.w) im.setScale(o.w / im.width); else if (o.scale) im.setScale(o.scale);
    if (o.rot) im.setRotation(o.rot);
    if (o.alpha != null) im.setAlpha(o.alpha);
    if (o.add) im.setBlendMode('ADD');
    if (o.tint != null) im.setTint(o.tint);
    if (o.flip) im.setFlipX(true);
    if (o.cull !== false) this.props.push(im);
    return im;
  }

  drawWorld() {
    const rnd = mulberry32(777);
    const c = tileToWorld(CENTER.x, CENTER.y);
    this.add.rectangle(SIZE / 2, SIZE / 2, SIZE + 6000, SIZE + 6000, 0x07080a).setDepth(0);
    this.add.tileSprite(SIZE / 2, SIZE / 2, SIZE, SIZE, 'wmap-ground').setTileScale(1.25).setDepth(0);
    // stage 18: no zones. The land darkens smoothly toward the Citadel (soft stacked falloff, no hard edges)
    for (const [r, a] of [[WORLD.gradient.outer * 2.6, 0.22], [WORLD.gradient.outer * 1.8, 0.22], [WORLD.gradient.outer * 1.1, 0.24], [WORLD.gradient.inner * 2.6, 0.22]]) {
      this.add.image(c.x, c.y, 'wmap', 'shadow').setScale((r * T) / 96).setAlpha(a).setDepth(0.1);
    }
    // keep-out test for decor (bases, citadel, creatures move so we only avoid fixed things)
    const fixed = store.world.entities().filter((e) => e.kind !== 'creature').map((e) => ({ ...tileToWorld(e.x, e.y), r: (e.kind === 'citadel' ? WORLD.citadelRadius + 1.5 : 2) * T }));
    const clear = (x, y, pad = 0) => fixed.every((f) => Math.hypot(f.x - x, f.y - y) > f.r + pad);
    // broken roads: from your base and the map edges toward the Citadel, with gaps
    const roads = [[tileToWorld(WORLD.baseX, WORLD.baseY), c]]; // decor only (the old start road)
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.95 + (rnd() - 0.5) * 0.3; roads.push([{ x: c.x + Math.cos(a) * 39 * T, y: c.y + Math.sin(a) * 39 * T }, c]); }
    for (let k = 0; k < 3; k++) { const a = rnd() * Math.PI * 2, r1 = (12 + rnd() * 20) * T; const p = { x: c.x + Math.cos(a) * r1, y: c.y + Math.sin(a) * r1 }; const b2 = a + (rnd() > 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6); roads.push([p, { x: c.x + Math.cos(b2) * r1, y: c.y + Math.sin(b2) * r1 }]); }
    for (const [a, b] of roads) {
      const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.floor(len / 200), ang = Math.atan2(b.y - a.y, b.x - a.x);
      let wob = 0;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; wob += (rnd() - 0.5) * 40;
        const x = a.x + (b.x - a.x) * t - Math.sin(ang) * wob, y = a.y + (b.y - a.y) * t + Math.cos(ang) * wob;
        if (Math.hypot(x - c.x, y - c.y) < (WORLD.citadelRadius + 1) * T || !clear(x, y, 40) || rnd() < 0.14) continue; // broken
        this.prop(x, y, 'road', { w: 250, rot: ang + (rnd() - 0.5) * 0.25, alpha: 0.75, depth: 0.3 });
      }
    }
    // teal rift fissures (pulse), crystal nodes, ruins
    this.fissures = [];
    for (let i = 0; i < 70; i++) {
      const r = (WORLD.citadelRadius + 1 + rnd() * 34) * T, a = rnd() * Math.PI * 2, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      if (x < 60 || y < 60 || x > SIZE - 60 || y > SIZE - 60 || !clear(x, y, 60)) continue;
      this.fissures.push(this.prop(x, y, rnd() > 0.5 ? 'fissure-1' : 'fissure-2', { w: 200 + rnd() * 220, rot: a + Math.PI / 2 + (rnd() - 0.5) * 0.9, add: true, alpha: 0.85, depth: 0.6 }));
    }
    // radial cracks around the dome
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + rnd() * 0.3, r = (WORLD.citadelRadius + 1.6) * T; this.fissures.push(this.prop(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 'fissure-1', { w: 260, rot: a, add: true, alpha: 0.9, depth: 0.6 })); }
    this.tweens.add({ targets: this.fissures, alpha: 0.45, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    for (let i = 0; i < 220; i++) {
      const x = 80 + rnd() * (SIZE - 160), y = 80 + rnd() * (SIZE - 160), k = rnd();
      if (Math.hypot(x - c.x, y - c.y) < (WORLD.citadelRadius + 2) * T || !clear(x, y, 50)) continue;
      if (k < 0.32) this.prop(x, y, `crystal-${1 + Math.floor(rnd() * 4)}`, { w: 70 + rnd() * 50, depth: 2 + y / SIZE, flip: rnd() > 0.5 });
      else if (k < 0.62) this.prop(x, y, `ruin-${1 + Math.floor(rnd() * 3)}`, { w: 110 + rnd() * 90, depth: 0.8, alpha: 0.9, flip: rnd() > 0.5 });
      else if (k < 0.7) this.prop(x, y, 'lair-tower', { w: 110 + rnd() * 40, depth: 2 + y / SIZE, flip: rnd() > 0.5 });
    }
    // Rift Citadel + pale-teal contested dome (LOCKED)
    const cw = WORLD.citadelRadius * 2 * T;
    this.domeGlow = this.add.image(c.x, c.y, 'wmap', 'glow-teal').setBlendMode('ADD').setScale(cw * 1.4 / 128).setAlpha(0.3).setTint(0x9fe6dc).setDepth(2.4);
    this.citadel = this.add.image(c.x, c.y - 0.6 * T, 'wmap', 'citadel').setDepth(2.5);
    this.citadel.setScale(cw / this.citadel.width);
    const ctop = this.citadel.y - this.citadel.displayHeight / 2;
    this.coreGlow = this.add.image(c.x, ctop + this.citadel.displayHeight * 0.09, 'wmap', 'glow-teal').setBlendMode('ADD').setScale(2.4).setDepth(2.6);
    // contested dome: a soft translucent shell drawn BEHIND the Citadel sprite (no hard lines over the art)
    const dome = this.add.graphics().setDepth(2.45).setBlendMode('ADD');
    const R = (WORLD.citadelRadius + 0.6) * T, dy = c.y + 0.4 * T, DOME = 0x9fe6dc;
    for (let k = 0; k < 6; k++) dome.fillStyle(DOME, 0.018).fillEllipse(c.x, dy, R * 2 * (1 - k * 0.06), R * 1.25 * (1 - k * 0.06));
    [[44, 0.035], [28, 0.05], [16, 0.07], [7, 0.1]].forEach(([w, a]) => { dome.lineStyle(w, DOME, a); dome.beginPath(); dome.arc(c.x, dy, R, Math.PI * 1.02, Math.PI * 1.98, false); dome.strokePath(); dome.lineStyle(w, DOME, a * 0.8).strokeEllipse(c.x, dy, R * 2, R * 1.25); });
    this.tweens.add({ targets: [this.domeGlow, dome], alpha: { from: 0.6, to: 0.9 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.coreGlow, alpha: 0.4, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.plaque(c.x, c.y + R * 0.62 + 20, '🔒 RIFT CITADEL', { size: 28, color: PALETTE.textGold, depth: 42 });
    this.plaque(c.x, c.y + R * 0.62 + 20, 'contested dome · alliance war coming', { size: 19, bold: false, color: '#ffd27f', depth: 42, min: 0.4 }).setData('below', 1);
    // fog over the unexplored edges (+ darkness past the border): soft black falloff over the map's edge
    for (let t = -350; t <= SIZE + 350; t += 300) for (const [x, y] of [[t, -40], [t, SIZE + 40], [-40, t], [SIZE + 40, t]]) this.prop(x, y, 'shadow', { w: 900, alpha: 0.95, depth: 59 });
    for (let i = 0; i < 200; i++) {
      const side = i % 4, t = -300 + rnd() * (SIZE + 600), inset = -560 + rnd() * 660;
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? inset : SIZE - inset;
      const y = side === 0 ? inset : side === 1 ? SIZE - inset : t;
      this.prop(x, y, rnd() > 0.5 ? 'fog-1' : 'fog-2', { w: 460 + rnd() * 360, alpha: inset < 0 ? 0.95 : 0.7, depth: 60, rot: rnd() * 6.28, tint: inset < -200 ? 0x777777 : 0xffffff });
    }
  }

  tierFor(level) { return baseTier(level); }
  // second-line plaques sit right under their first line at the current zoom
  stackLabels() {
    for (const l of this.labels) {
      const up = l.t.getData('stackUnder');
      if (up?.active) l.t.setY(up.y + up.displayHeight + 2);
      else if (l.t.getData('below')) { const top = this.labels.find((m) => m.t.rawText === '🔒 RIFT CITADEL'); if (top) l.t.setY(top.t.y + top.t.displayHeight + 2); }
    }
  }

  // Player bases (yours + neighbours) from the WorldService; rebuilt when the Beacon tier changes.
  syncBases() {
    const live = new Set();
    for (const e of store.world.bases()) {
      live.add(e.id);
      const local = e.id === BASE_ID;
      const level = local ? store.state.beacon.level : e.level ?? 1;
      const tier = baseTier(level), color = local ? PALETTE.teal : e.color ?? 0x8a96a8;
      let s = this.baseSprites.get(e.id);
      const key = `${tier}|${level}|${color}|${e.x},${e.y}|${e.name}|${e.tag}`;
      if (s && s.key === key) continue;
      if (s) s.parts.forEach((o) => o.destroy());
      const p = tileToWorld(e.x, e.y), parts = [];
      const d = 3 + p.y / SIZE;
      parts.push(this.add.image(p.x, p.y + 30, 'wmap', 'shadow').setScale(TIER_W[tier] * 1.4 / 96, TIER_W[tier] * 0.6 / 96).setAlpha(0.7).setDepth(d - 0.01));
      if (local) { const gl = this.add.image(p.x, p.y, 'glow').setBlendMode('ADD').setScale(1.6).setAlpha(0.45).setDepth(d - 0.005); this.tweens.add({ targets: gl, scale: 2, alpha: 0.75, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); parts.push(gl); }
      const img = this.add.image(p.x, p.y, 'wmap', TIER_FRAMES[tier]).setOrigin(0.5, 0.62).setDepth(d);
      img.setScale(TIER_W[tier] / img.width);
      parts.push(img);
      // the painted white flag, tinted to the alliance colour (yours: teal)
      const flag = this.add.image(p.x, p.y, 'wmap', `flag-t${tier + 1}`).setOrigin(0.5, 0.62).setScale(img.scale).setTint(color).setDepth(d + 0.003);
      parts.push(flag);
      const below = p.y + img.displayHeight * 0.38 + 2;
      const name = local ? 'YOUR BASE' : `${e.tag ? `[${e.tag}] ` : ''}${e.name}`;
      // stage 20: round gold level medal over "(TAG)Name"; Lv + tier live in the tap panel
      const nt = this.basePlate(p.x, below - 4, { min: local ? 0 : 0.42 }).set(level, local ? '' : e.tag, local ? 'YOUR BASE' : e.name, { mine: local });
      parts.push(nt);
      s = { parts, tier, color, key, e };
      this.baseSprites.set(e.id, s);
    }
    for (const [id, s] of this.baseSprites) if (!live.has(id)) { s.parts.forEach((o) => o.destroy()); this.baseSprites.delete(id); }
  }

  // Hide decor outside the camera (plus a margin) so phones only draw what's on screen.
  cull(force = false) {
    const v = this.cameras.main.worldView;
    const key = `${Math.round(v.x / 64)},${Math.round(v.y / 64)},${Math.round(v.width / 64)}`;
    if (!force && key === this.cullKey) return;
    this.cullKey = key;
    const m = 300, x0 = v.x - m, y0 = v.y - m, x1 = v.right + m, y1 = v.bottom + m;
    let shown = 0;
    for (const im of this.props) { const vis = im.x > x0 && im.x < x1 && im.y > y0 && im.y < y1; im.setVisible(vis); if (vis) shown++; }
    this.propsShown = shown;
  }

  // ------------------------------------------------------------ sync ---
  syncAll(force = false) {
    this.syncBases();
    const maxL = store.maxAttackLevel();
    const live = new Set();
    for (const e of store.creatures()) {
      live.add(e.id);
      let s = this.crSprites.get(e.id);
      const p = tileToWorld(e.x, e.y);
      if (!s) {
        // stage 20: natural scale, feet on the tile centre, soft contact shadow, smaller faded lair, idle motion
        const meshOn = meshPreviewOn() && !reelRequested();
        const boss = !!CREATURES[e.type].rallyOnly, W = (meshOn && e.type === 'behemoth') ? BH_MESH_W : (CR_W[e.type] ?? 110), hover = e.type === 'drone' ? 16 : 0;
        const lf = LAIR_OF[e.type] ?? 'lair-crater';
        const lair = this.add.image(p.x, p.y + 4, 'wmap', lf).setOrigin(0.5, 0.6).setDepth(0.9).setAlpha(0.8);
        lair.setScale(W * 1.1 / lair.width).setAlpha(0.65);
        const fy = p.y + W * 0.12;
        const shadow = this.add.image(p.x + W * 0.04, fy, 'wmap', 'shadow').setDepth(9.99 + p.y / SIZE).setAlpha(0.5);
        const tex = (meshOn && e.type === 'behemoth') ? 'cr-behemoth-w' : `cr-${e.type}`;
        const img = this.add.image(p.x, fy - hover, tex).setOrigin(0.5, 0.97).setDepth(10 + p.y / SIZE);
        const base = W / img.width;
        img.setScale(base);
        shadow.setScale(W * 0.8 / 96, W * 0.24 / 96);
        if (boss) img.setData('boss', true);
        let shimmer = null;
        if (boss) shimmer = this.add.image(img.x, img.y, tex).setOrigin(0.5, 0.97).setScale(base).setBlendMode('ADD').setTint(0x2fe0c8).setAlpha(0).setDepth(img.depth + 0.0001);
        const badge = this.levelTag(p.x, fy + 16, { depth: 11, min: 0.33 });
        const lock = this.add.text(p.x + 30, p.y - 54, '', { fontSize: '1px' }).setVisible(false); // kept for old hooks; the lock is drawn in the tag
        s = { img, badge, lock, lair, shadow, shimmer, e, base, x0: img.x, y0: img.y, sx0: shadow.scaleX, sy0: shadow.scaleY, shx0: shadow.x, idle: newIdle(e.type) };
        if (meshOn && e.type === 'behemoth') {
          s.rig = buildBehemothMesh(this, img, shimmer); s.pose = poseBehemothMesh; img.setAlpha(0.001); s.meshMode = true;
          shadow.setScale(W * 0.62 / 96, W * 0.17 / 96); s.sx0 = shadow.scaleX; s.sy0 = shadow.scaleY; shadow.setX(p.x + W * 0.04); s.shx0 = shadow.x;
        } else if (meshOn) {
          s.rig = buildCreatureMesh(this, img); s.pose = poseCreatureMesh; img.setAlpha(0.001); s.meshMode = true;
        }
        this.crSprites.set(e.id, s);
        if (!force && !s.meshMode) { img.setAlpha(0); this.tweens.add({ targets: img, alpha: 1, duration: 500 }); }
      }
      if (CREATURES[e.type].rallyOnly) { // stage 19: world boss: never "locked", rallied -> crossed swords
        s.badge.set(e.level, 'Behemoth', { color: '#8ff7e6', busy: !!e.busy });
        continue;
      }
      const locked = e.level > maxL;
      s.badge.set(e.level, CR_NAME[e.type] ?? CREATURES[e.type].name, { color: locked ? '#aab3c0' : (CREATURES[e.type].elite ? '#ffb347' : '#f4efe4'), locked, busy: !!e.busy });
      s.img.setTint(locked ? 0x9a9a9a : 0xffffff);
    }
    this.syncNodes(force);
    for (const [id, s] of this.crSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); s.lock.destroy(); s.lair.destroy(); s.shadow.destroy(); s.shimmer?.destroy(); s.rig?.all?.forEach((o) => o.destroy()); this.crSprites.delete(id); if (this.selected === id) this.select(null); }
  }

  // Stage 16: Alloy nodes: full crystal, drained stump, or the gathering camp while a squad mines it.
  syncNodes(force = false) {
    const live = new Set();
    const marches = store.world.marches();
    for (const e of store.world.nodes()) {
      live.add(e.id);
      const p = tileToWorld(e.x, e.y);
      let s = this.nodeSprites.get(e.id);
      if (!s) {
        const img = this.add.image(p.x, p.y + 6, 'node-full').setOrigin(0.5, 0.72).setDepth(10 + p.y / SIZE);
        const badge = this.levelTag(p.x, p.y + 34, { depth: 11, min: 0.33 });
        s = { img, badge, e, tex: 'node-full' };
        this.nodeSprites.set(e.id, s);
        if (!force) { img.setAlpha(0); this.tweens.add({ targets: img, alpha: 1, duration: 400 }); }
      }
      s.e = e;
      const m = e.busy ? marches.find((x) => x.id === e.busy) : null;
      const gathering = m?.phase === 'gather';
      const tex = e.amount < 1 ? 'node-depleted' : gathering ? 'node-camp' : 'node-full';
      if (tex !== s.tex) { s.tex = tex; s.img.setTexture(tex); }
      s.img.setScale((tex === 'node-camp' ? 128 : 96 + e.level * 8) / s.img.width).setAlpha(e.amount < 1 ? 0.8 : 1);
      s.badge.set(e.level, e.amount < 1 ? 'Alloy · drained' : gathering ? `${SQUADS[m.squadId].name} ${Math.floor(m.gather.load)}/${m.gather.cap}` : 'Alloy', { color: e.amount < 1 ? '#9aa6b8' : '#9ff3e6' });
    }
    for (const [id, s] of this.nodeSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); this.nodeSprites.delete(id); if (this.selected === id) this.select(null); }
  }

  // Stage 19: rally FX: banner over your base, dotted lines from allies' bases, emblem on the Behemoth.
  drawRally(g) {
    const r = store.myRally();
    const fx = this.rallyFx ?? (this.rallyFx = {});
    const on = !!r && r.phase === 'gather';
    if (!on) { if (fx.banner) { fx.banner.destroy(); fx.emblem.destroy(); this.rallyFx = {}; } return; }
    const home = tileToWorld(store.basePos().x, store.basePos().y), tgt = store.world.get(r.targetId);
    if (!fx.banner) {
      fx.banner = this.add.image(home.x + 54, home.y - 70, 'rally-banner').setScale(0.42).setDepth(30);
      this.tweens.add({ targets: fx.banner, angle: { from: -4, to: 4 }, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      fx.emblem = this.add.image(0, 0, 'rally-emblem').setScale(0.5).setDepth(30);
      this.tweens.add({ targets: fx.emblem, scale: 0.6, duration: 700, yoyo: true, repeat: -1 });
    }
    fx.banner.setPosition(home.x + 54, home.y - 70);
    if (tgt) { const tp = tileToWorld(tgt.x, tgt.y); fx.emblem.setPosition(tp.x, tp.y - 150).setVisible(true); } else fx.emblem.setVisible(false);
    const now = store.world.w.clock, off = (this.time.now / 30) % 24;
    for (const p of r.plan) {
      const b = store.world.get(p.botId);
      if (!b) continue;
      const a = tileToWorld(b.x, b.y);
      const done = p.joined, k = done ? 1 : Math.max(0, Math.min(1, (now - r.start) / Math.max(1, p.at - r.start)));
      const len = Math.hypot(home.x - a.x, home.y - a.y), n = Math.floor(len / 24);
      g.fillStyle(done ? 0x2fe0c8 : 0xcfd8e3, done ? 0.9 : 0.55);
      for (let i = 0; i < n; i++) { const t = (i * 24 + off) / len; if (t > 1) break; g.fillCircle(a.x + (home.x - a.x) * t, a.y + (home.y - a.y) * t, 4); }
      if (!done) { g.fillStyle(0xffffff, 1).fillCircle(a.x + (home.x - a.x) * k, a.y + (home.y - a.y) * k, 9); g.lineStyle(3, 0x2fe0c8, 1).strokeCircle(a.x + (home.x - a.x) * k, a.y + (home.y - a.y) * k, 12); }
    }
    if (tgt) { const tp = tileToWorld(tgt.x, tgt.y); g.lineStyle(3, 0x2fe0c8, 0.35).lineBetween(home.x, home.y, tp.x, tp.y); }
  }

  drawMarches() {
    const g = this.marchG; g.clear();
    const live = new Set();
    this.drawRally(g);
    for (const m of store.world.marches(LOCAL_OWNER)) {
      live.add(m.id);
      if (m.phase === 'rally') continue; // waiting at home: drawn by drawRally
      const a = tileToWorld(m.from.x, m.from.y), b = tileToWorld(m.to.x, m.to.y);
      const k = m.phase === 'gather' ? 1 : m.phase === 'out' ? Math.min(1, m.t / m.travel) : Math.max(0, 1 - m.t / m.back) * (m.recalled ? Math.min(1, m.back / m.travel) : 1);
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const col = m.phase === 'gather' ? 0x2fe0c8 : m.phase === 'out' ? PALETTE.cyan : PALETTE.gold;
      if (m.phase === 'gather') { // sitting at the node: the camp sprite + node plaque show progress
        let s = this.marchSprites.get(m.id);
        if (s) { s.img.setVisible(false); s.label.hiddenByGame = true; s.label.setVisible(false); }
        continue;
      }
      const rl = !!m.meta?.rally;
      if (rl) g.lineStyle(22, 0x2fe0c8, 0.22).lineBetween(a.x, a.y, b.x, b.y).lineStyle(10, 0x2fe0c8, 0.5).lineBetween(a.x, a.y, b.x, b.y); // stage 19: thick rally line
      g.lineStyle(8, col, 0.12).lineBetween(a.x, a.y, b.x, b.y);
      // dashed path
      const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.floor(len / 28)), off = (this.time.now / 40) % 28;
      g.lineStyle(3, col, 0.8);
      for (let i = 0; i < n; i++) {
        const t0 = (i * 28 + off) / len, t1 = Math.min(1, (i * 28 + off + 14) / len);
        if (t0 > 1) break;
        g.lineBetween(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
      let s = this.marchSprites.get(m.id);
      if (!s) {
        s = { img: this.add.image(x, y, 'world-squad').setDepth(20), label: this.plaque(x, y - 46, '', { size: 22, color: '#3ff0ff', depth: 21, oy: 1 }) };
        this.marchSprites.set(m.id, s);
      }
      const left = m.phase === 'out' ? m.travel - m.t : m.back - m.t;
      if (s.label.hiddenByGame) { s.label.hiddenByGame = false; this.fitLabel({ t: s.label, min: 0 }); s.img.setVisible(true); }
      s.img.setPosition(x, y).setTint(m.phase === 'out' ? 0xffffff : 0xffd27f);
      if (rl) s.img.setScale(1.5);
      s.label.setPosition(x, y - 30).setText(`${rl ? 'Rally' : SQUADS[m.squadId].name} ${m.phase === 'out' ? '→' : '↩'} ${Math.ceil(Math.max(0, left))}s`).setColor(m.phase === 'out' ? '#3ff0ff' : PALETTE.textGold);
    }
    for (const [id, s] of this.marchSprites) if (!live.has(id)) { s.img.destroy(); s.label.destroy(); this.marchSprites.delete(id); }
  }

  drawSelection() {
    const g = this.selG; g.clear();
    const e = this.selected && (this.crSprites.get(this.selected)?.e ?? store.world.get(this.selected));
    if (!e) return;
    const p = tileToWorld(e.x, e.y), r = (e.kind === 'citadel' ? WORLD.citadelRadius * T : e.kind === 'base' ? 100 : 52) + Math.sin(this.time.now / 180) * 4;
    g.lineStyle(4, PALETTE.gold, 0.95).strokeCircle(p.x, p.y, r);
    g.lineStyle(10, PALETTE.gold, 0.15).strokeCircle(p.x, p.y, r);
  }

  battleFx(report) {
    const p = tileToWorld(report.target.x, report.target.y);
    const sp = this.add.particles(p.x, p.y - 10, 'spark', { speed: { min: 60, max: 260 }, lifespan: 800, scale: { start: 1.4, end: 0 }, tint: report.win ? [PALETTE.gold, 0xffffff] : [0xff4d5e, 0x9b7bff], blendMode: 'ADD', emitting: false }).setDepth(30);
    sp.explode(report.win ? 50 : 24);
    this.time.delayedCall(900, () => sp.destroy());
    const t = this.add.text(p.x, p.y - 60, report.win ? 'VICTORY' : 'DEFEAT', { fontFamily: TITLE_FONT, fontSize: '34px', fontStyle: 'bold', color: report.win ? PALETTE.textGold : '#ff6f7b', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(31);
    this.tweens.add({ targets: t, y: t.y - 70, alpha: 0, duration: 1600, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------- camera ---
  // Stage 17: real camera zoom = RES x logical zoom (see BaseScene); screen coordinates stay logical.
  get zl() { return this.cameras.main.zoom / RES; }
  setZl(z) { this.cameras.main.setZoom(z * RES); }
  screenToWorld(sx, sy) { const cam = this.cameras.main, cx = cam.width / 2, cy = cam.height / 2, z = this.zl; return { x: cam.scrollX + cx + (sx - LW / 2) / z, y: cam.scrollY + cy + (sy - LH / 2) / z }; }
  worldToScreen(wx, wy) { const cam = this.cameras.main, cx = cam.width / 2, cy = cam.height / 2, z = this.zl; return { x: (wx - cam.scrollX - cx) * z + LW / 2, y: (wy - cam.scrollY - cy) * z + LH / 2 }; }
  tileToScreen(x, y) { const p = tileToWorld(x, y); return this.worldToScreen(p.x, p.y); }
  setZoomKeeping(z, wx, wy, sx, sy) {
    const cam = this.cameras.main;
    this.setZl(Phaser.Math.Clamp(z, WORLD.minZoom, WORLD.maxZoom));
    const cx = cam.width / 2, cy = cam.height / 2, zl = this.zl;
    cam.scrollX = wx - cx - (sx - LW / 2) / zl; cam.scrollY = wy - cy - (sy - LH / 2) / zl;
    this.clampCamera();
  }
  zoomAt(sx, sy, z) { const w = this.screenToWorld(sx, sy); this.setZoomKeeping(z, w.x, w.y, sx, sy); }
  clampCamera() {
    const cam = this.cameras.main;
    const mx = Phaser.Math.Clamp(cam.scrollX + cam.width / 2, 0, SIZE), my = Phaser.Math.Clamp(cam.scrollY + cam.height / 2, 0, SIZE);
    cam.scrollX = mx - cam.width / 2; cam.scrollY = my - cam.height / 2;
  }
  focusTile(x, y, zoom) {
    this.stopGlide?.();
    const cam = this.cameras.main, p = tileToWorld(x, y);
    if (zoom) this.setZl(zoom);
    this.tweens.add({ targets: cam, scrollX: p.x - cam.width / 2, scrollY: p.y - cam.height / 2 + 120, duration: 350, ease: 'Cubic.easeOut', onUpdate: () => this.clampCamera() });
  }
  focusBase() { const b = store.basePos(); this.focusTile(b.x, b.y); }
  // tile under the screen centre (the coordinate readout); the camera's view centre minus focusTile's offset
  centerTile() {
    const cam = this.cameras.main, w = this.screenToWorld(LW / 2, LH / 2);
    return { x: Phaser.Math.Clamp(Math.floor(w.x / T), 0, WORLD.size - 1), y: Phaser.Math.Clamp(Math.floor(w.y / T), 0, WORLD.size - 1) };
  }
  // search result / teleport target: a pulsing gold marker on a tile for a few seconds
  pulseAt(x, y, ms = 4000) { this.pulse = { x, y, until: this.time.now + ms }; }
  teleportFx(r) {
    this.select(null);
    this.syncAll(true);
    for (const p of [r.from, r.to]) {
      const w = tileToWorld(p.x, p.y);
      const sp = this.add.particles(w.x, w.y, 'spark', { speed: { min: 80, max: 300 }, lifespan: 900, scale: { start: 1.6, end: 0 }, tint: [0x3ff0ff, PALETTE.gold], blendMode: 'ADD', emitting: false }).setDepth(30);
      sp.explode(40);
      this.time.delayedCall(1000, () => sp.destroy());
    }
    this.focusTile(r.to.x, r.to.y);
    this.pulseAt(r.to.x, r.to.y, 2500);
  }
  selectTile(t) {
    this.tileSel = t;
    if (t) { this.selected = null; this.game.events.emit('world:tile', t); }
    else this.game.events.emit('world:deselect');
  }
  drawMarks() {
    const g = this.markG; g.clear();
    const k = Math.sin(this.time.now / 160) * 0.5 + 0.5;
    if (this.tileSel) {
      const p = tileToWorld(this.tileSel.x, this.tileSel.y);
      g.lineStyle(4, 0x3ff0ff, 0.9).strokeRect(p.x - T / 2, p.y - T / 2, T, T);
      g.fillStyle(0x3ff0ff, 0.12 + 0.1 * k).fillRect(p.x - T / 2, p.y - T / 2, T, T);
    }
    if (this.pulse && this.time.now < this.pulse.until) {
      const p = tileToWorld(this.pulse.x, this.pulse.y), r = 50 + 40 * ((this.time.now / 900) % 1);
      g.lineStyle(6, PALETTE.gold, 1 - ((this.time.now / 900) % 1)).strokeCircle(p.x, p.y, r);
      g.lineStyle(3, PALETTE.gold, 0.9).strokeCircle(p.x, p.y, 46);
    } else this.pulse = null;
  }

  pick(wx, wy) {
    let best = null, bd = 60;
    for (const s of this.crSprites.values()) {
      const p = tileToWorld(s.e.x, s.e.y);
      const d = Math.hypot(wx - p.x, wy - (p.y - 8));
      if (d < bd) { bd = d; best = s.e.id; }
    }
    if (best) return best;
    bd = 58;
    for (const s of this.nodeSprites.values()) { const p = tileToWorld(s.e.x, s.e.y), d = Math.hypot(wx - p.x, wy - (p.y - 6)); if (d < bd) { bd = d; best = s.e.id; } }
    if (best) return best;
    bd = 95;
    for (const e of store.world.bases()) { const p = tileToWorld(e.x, e.y), d = Math.hypot(wx - p.x, wy - p.y); if (d < bd) { bd = d; best = e.id; } }
    if (best) return best;
    const ci = store.world.citadel(), cp = ci && tileToWorld(ci.x, ci.y);
    if (cp && Math.hypot(wx - cp.x, wy - cp.y) < WORLD.citadelRadius * T) return ci.id;
    return null;
  }
  select(id) {
    if (id) this.tileSel = null;
    this.selected = id;
    this.game.events.emit(id ? 'world:select' : 'world:deselect', id);
  }

  // ------------------------------------------------------------ input ---
  downPointers() { return this.input.manager.pointers.filter((p) => p.isDown); }
  onDown(p) {
    if (!this.scene.isVisible()) return;
    const downs = this.downPointers();
    if (downs.length >= 2) {
      const [a, b] = downs; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = null;
      this.stopGlide(); this.pinch = { a: a.id, b: b.id, d0: Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), z0: this.zl, w: this.screenToWorld(mid.x, mid.y) };
      return;
    }
    if (this.ui()?.blocksPointer(p.x, p.y)) { this.gesture = null; return; }
    const cam = this.cameras.main; this.stopGlide();
    this.gesture = { id: p.id, sx: p.x, sy: p.y, mode: 'pending', cam0: { x: cam.scrollX, y: cam.scrollY } };
  }
  onMove(p) {
    if (this.pinch) {
      const ptrs = this.input.manager.pointers;
      const a = ptrs.find((q) => q.id === this.pinch.a), b = ptrs.find((q) => q.id === this.pinch.b);
      if (!a?.isDown || !b?.isDown) return;
      const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      this.setZoomKeeping(this.pinch.z0 * d / this.pinch.d0, this.pinch.w.x, this.pinch.w.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const g = this.gesture;
    if (!g || p.id !== g.id || !p.isDown) return;
    if (g.mode === 'pending' && Phaser.Math.Distance.Between(p.x, p.y, g.sx, g.sy) > TAP_SLOP) { g.mode = 'pan'; this.beginPan(); }
    if (g.mode === 'pan') {
      const cam = this.cameras.main; this.trackPan(p);
      cam.scrollX = g.cam0.x - (p.x - g.sx) / this.zl; cam.scrollY = g.cam0.y - (p.y - g.sy) / this.zl;
      this.clampCamera();
    }
  }
  onUp(p) {
    if (this.pinch) { if (this.downPointers().length < 2) this.pinch = null; this.gesture = null; return; }
    const g = this.gesture;
    if (!g || p.id !== g.id) return;
    if (g.mode === 'pending') {
      const w = this.screenToWorld(p.x, p.y);
      const id = this.pick(w.x, w.y);
      // stage 18: tapping empty ground opens a tile card (coordinates + Teleport here)
      if (id || this.selected || this.tileSel) { this.tileSel = null; this.select(id); }
      else this.selectTile({ x: Phaser.Math.Clamp(Math.floor(w.x / T), 0, WORLD.size - 1), y: Phaser.Math.Clamp(Math.floor(w.y / T), 0, WORLD.size - 1) });
    } else if (g.mode === 'pan') this.releasePan();
    this.gesture = null;
  }

  poseCreature(s, t, dt) {
    if (!s.rig) {
      const q = idlePose(s.idle, t, dt);
      s.img.setScale(s.base * q.sx, s.base * q.sy).setPosition(s.x0 + q.dx, s.y0 + q.dy).setRotation(q.ang);
      s.shadow.setScale(s.sx0 * q.sh * (1 + (q.sx - 1)), s.sy0 * q.sh).setAlpha(0.5 * (0.85 + 0.15 * q.sh));
      if (s.shimmer) s.shimmer.setScale(s.img.scaleX, s.img.scaleY).setPosition(s.img.x, s.img.y).setAlpha(0.07 + 0.07 * Math.sin(TAU * t / 2.7 + s.idle.ph));
      return;
    }
    const q = s.pose(s, t, dt);
    s.shadow.setScale(s.sx0 * (q.sh ?? 1), s.sy0 * (q.sh ?? 1)).setX(s.shx0 + (q.shx || 0)).setAlpha(0.5 * (0.85 + 0.15 * (q.sh ?? 1)));
    if (s.meshMode) return;
    if (s.shimmer) s.shimmer.setScale(s.img.scaleX, s.img.scaleY).setPosition(s.img.x, s.img.y).setAlpha(0.07 + 0.07 * Math.sin(TAU * t / 2.7 + s.idle.ph));
  }

  // stage 20: idle motion for on-screen creatures only (math per frame, no tweens to manage or leak)
  animateIdle() {
    const t = this.motionClock != null ? this.motionClock : this.time.now / 1000, dt = Math.min(0.1, (this.game.loop.delta || 16) / 1000);
    this.idleAnimated = 0;
    if (this.reelOn) {
      this.hideLiveCreatures();
      if (!this.reducedMotion) for (const s of this.reelSprites) { this.poseCreature(s, t, dt); this.idleAnimated++; }
      return;
    }
    if (this.reducedMotion) return;
    const v = this.cameras.main.worldView, m = 200;
    for (const s of this.crSprites.values()) {
      const vis = s.x0 > v.x - m && s.x0 < v.right + m && s.y0 > v.y - m && s.y0 < v.bottom + m;
      s.img.setVisible(vis); s.shadow.setVisible(vis); s.shimmer?.setVisible(vis && !s.meshMode); s.rig?.all?.forEach((o) => o.setVisible(vis));
      if (!vis) continue;
      this.idleAnimated++;
      this.poseCreature(s, t, dt);
    }
  }

  hideLiveCreatures() {
    for (const s of this.crSprites.values()) {
      s.img.setVisible(false); s.shadow.setVisible(false); s.shimmer?.setVisible(false); s.lair?.setVisible(false); s.badge?.setVisible(false);
      s.rig?.all?.forEach((o) => o.setVisible(false));
    }
  }

  update() {
    this.cull();
    this.animateIdle();
    this.fitLabels();
    this.stackLabels();
    if (!this.lastSync || this.time.now - this.lastSync > 250) { this.lastSync = this.time.now; this.syncAll(); }
    this.drawMarches();
    this.drawSelection();
    this.drawMarks();
    this.ui()?.worldHud?.visible && this.ui().worldHud.coords?.();
    if ((this.gesture || this.pinch) && this.downPointers().length === 0) { this.gesture = null; this.pinch = null; }
    if (this.reelOn && !this.reelLock) this.applyReel();
  }

  // Judging lineup. Not used by the live map. Camera holds game scale, then a close-up long enough to read each gait.
  // Behemoth close-up covers the A4 roar window (first roar ~5–9s, next 7–12s later).
  startReel() {
    this.reelOn = true;
    this.scene.setVisible(false, 'UI');
    const ax = SIZE * 0.5, ay = SIZE * 0.62;
    const ground = this.add.image(ax, ay, 'wmap-ground').setDepth(11.2).setAlpha(0.96);
    ground.setDisplaySize(3600, 2600);
    // Zoom 1 shows each creature at its authored world size (CR_W). Three bands so the names do not collide.
    const spots = [
      { type: 'behemoth', name: 'Rift Behemoth', x: ax, y: ay - 200 },
      { type: 'scuttler', name: 'Husk Scuttler', x: ax - 220, y: ay + 130 },
      { type: 'drone', name: 'Rift Drone', x: ax, y: ay + 130 },
      { type: 'hound', name: 'Void Hound', x: ax + 220, y: ay + 130 },
      { type: 'golem', name: 'Shard Golem', x: ax - 170, y: ay + 430 },
      { type: 'wyrm', name: 'Dusk Wyrm', x: ax + 170, y: ay + 430 },
    ];
    this.reelSprites = spots.map((sp) => this.makeReelCreature(sp));
    const focusOf = (sp) => ({ x: sp.x, y: sp.y - CR_W[sp.type] * 0.46 });
    const zoomOf = (sp) => Math.min(6.2, (LW * 0.78) / CR_W[sp.type]);
    const all = { x: ax, y: ay + 40 };
    const shot = (t, sp, cap, who) => ({ t, zoom: sp ? zoomOf(sp) : 1, x: sp ? focusOf(sp).x : all.x, y: sp ? focusOf(sp).y : all.y, cap, who });
    const by = Object.fromEntries(spots.map((s) => [s.type, s]));
    this.reelShots = [
      shot(0, null, 'Game scale', 'all'),
      shot(9, by.behemoth, 'Close-up', 'behemoth'),
      shot(25, by.wyrm, 'Close-up', 'wyrm'),
      shot(33, by.scuttler, 'Close-up', 'scuttler'),
      shot(40, by.drone, 'Close-up', 'drone'),
      shot(47, by.hound, 'Close-up', 'hound'),
      shot(54, by.golem, 'Close-up', 'golem'),
      shot(62, null, 'Game scale', 'all'),
    ];
    this.reelEnd = 68;
    this.reelCap = this.add.text(ax, ay, '', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#f4efe4', backgroundColor: '#07090de8', padding: { x: 14, y: 7 } }).setOrigin(0.5, 0).setDepth(80);
    this.labels.push({ t: this.reelCap, min: 0, reel: true });
    this.applyReel();
  }

  makeReelCreature({ type, name, x, y }) {
    const W = type === 'behemoth' ? BH_MESH_W : CR_W[type];
    const hover = type === 'drone' ? 16 : 0;
    const tex = type === 'behemoth' ? 'cr-behemoth-w' : `cr-${type}`;
    const shadow = this.add.image(x + W * 0.04, y, 'wmap', 'shadow').setDepth(11.6).setAlpha(0.5);
    shadow.setScale(W * (type === 'behemoth' ? 0.62 : 0.8) / 96, W * (type === 'behemoth' ? 0.17 : 0.24) / 96);
    const img = this.add.image(x, y - hover, tex).setOrigin(0.5, 0.97).setDepth(12);
    const base = W / img.width;
    img.setScale(base).setAlpha(0.001);
    let shimmer = null, rig, pose;
    if (type === 'behemoth') {
      shimmer = this.add.image(img.x, img.y, tex).setOrigin(0.5, 0.97).setScale(base).setBlendMode('ADD').setTint(0x2fe0c8).setAlpha(0).setDepth(img.depth + 0.0001);
      rig = buildBehemothMesh(this, img, shimmer); pose = poseBehemothMesh;
    } else {
      rig = buildCreatureMesh(this, img); pose = poseCreatureMesh;
    }
    const tag = this.plaque(x, y - W * 0.94, name, { size: 26, oy: 1, depth: 40, reel: true, bg: '#07090de6', color: type === 'behemoth' ? '#8ff7e6' : type === 'wyrm' ? '#ffb347' : '#f4efe4' });
    return { type, name, tag, img, shadow, shimmer, rig, pose, base, x0: img.x, y0: img.y, sx0: shadow.scaleX, sy0: shadow.scaleY, shx0: shadow.x, idle: newIdle(type), meshMode: true, e: { type } };
  }

  applyReel() {
    const t = this.motionClock != null ? this.motionClock : this.time.now / 1000;
    const shots = this.reelShots;
    let i = 0;
    while (i < shots.length - 1 && t >= shots[i + 1].t) i++;
    const cur = shots[i], prev = shots[Math.max(0, i - 1)];
    const u = i === 0 ? 1 : Math.max(0, Math.min(1, (t - cur.t) / 0.7));
    const e = u * u * (3 - 2 * u);
    const from = i === 0 ? cur : prev;
    const zoom = from.zoom + (cur.zoom - from.zoom) * e;
    const x = from.x + (cur.x - from.x) * e;
    const y = from.y + (cur.y - from.y) * e;
    this.setZl(zoom);
    const cam = this.cameras.main;
    cam.centerOn(x, y);
    const who = u > 0.45 ? cur.who : from.who;
    const cap = u > 0.45 ? cur.cap : from.cap;
    const z = this.zl;
    for (const s of this.reelSprites) {
      s.tag.hiddenByGame = who !== 'all';
      s.tag.setVisible(who === 'all').setScale(1 / z);
    }
    this.reelCap.setText(cap === 'Close-up' ? `Close-up  ·  ${this.reelSprites.find((s) => s.type === who)?.name ?? ''}` : 'Game scale');
    this.reelCap.hiddenByGame = false;
    this.reelCap.setScale(1 / z);
    const p = this.screenToWorld(LW / 2, 36);
    this.reelCap.setPosition(p.x, p.y);
    this.reelWho = who;
    this.reelT = t;
  }
}
