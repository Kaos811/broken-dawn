import Phaser from 'phaser';
import { WORLD, PALETTE, CREATURES, SQUADS, BASE_TIERS, baseTier, RES, GAME_WIDTH as LW, GAME_HEIGHT as LH } from '../config.js';
import { store } from '../state/store.js';
import { mulberry32 } from '../world/battle.js';
import { LOCAL_OWNER, BASE_ID, CENTER, dist } from '../world/worldState.js';
import { attachLeadIcon } from '../ui/widgets.js';

const T = WORLD.tile;
const SIZE = WORLD.size * T;
const TAP_SLOP = 10;
const tileToWorld = (x, y) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T });

// The World map (stage 12: painted wasteland). The Rift Citadel sits at the centre under a golden dome;
// creature zones get tougher closer to it. Your base and seeded neighbour bases (WorldService bases())
// render by Beacon tier with an alliance banner. Squads march out, auto-battle and march back.
// Pan: drag. Zoom: pinch / wheel. Tap a creature to target it, a base for its profile, the Citadel for its card.
// Perf: every prop is one image from the 'wmap' atlas (one batch) and off-screen props are culled.
const TIER_FRAMES = ['base-t1', 'base-t2', 'base-t3', 'base-t4', 'base-t5'];
const TIER_W = [180, 205, 230, 250, 275]; // on-map width in px (world units)
// stage 12b painted lairs: sandworm burrow, bat roost, crawler nest, crystal tower (+ a concept crater)
const LAIR_OF = { wyrm: 'lair-burrow', drone: 'lair-roost', scuttler: 'lair-nest', golem: 'lair-tower', hound: 'lair-crater' };
const LAIR_W = { 'lair-burrow': 190, 'lair-roost': 150, 'lair-nest': 140, 'lair-tower': 130, 'lair-crater': 120 };
const FONT = 'system-ui, sans-serif';
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
    const b = tileToWorld(WORLD.baseX, WORLD.baseY);
    this.marchG = this.add.graphics().setDepth(5);
    this.selG = this.add.graphics().setDepth(6);
    this.crSprites = new Map();   // id -> { img, badge, lock }
    this.marchSprites = new Map(); // id -> { img, label }
    this.nodeSprites = new Map();  // stage 16: Alloy nodes, id -> { img, badge, e, tex }
    this.selected = null;
    this.gesture = null; this.pinch = null;

    this.setZl(WORLD.startZoom);
    cam.centerOn(b.x, b.y);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.ui()?.blocksPointer(p.x, p.y)) return;
      this.zoomAt(p.x, p.y, this.zl * (dy > 0 ? 0.9 : 1.1));
    });
    this.unsubs = [
      store.on('hunt', (r) => this.battleFx(r)),
      store.on('reset', () => { this.select(null); this.syncAll(true); }),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
    this.syncAll(true);
  }

  ui() { return this.scene.get('UI'); }

  // Map labels are plaques (dark pill + bold text) that keep a constant on-screen size at any zoom;
  // `min` hides them when zoomed out past it so the overview stays clean.
  plaque(x, y, str, o = {}) {
    const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${o.size ?? 24}px`, fontStyle: o.bold === false ? 'normal' : 'bold', color: o.color ?? '#f2ead8', backgroundColor: o.bg ?? '#07090dcc', padding: { x: 10, y: 4 }, align: 'center' })
      .setOrigin(0.5, o.oy ?? 0).setDepth(o.depth ?? 41);
    attachLeadIcon(t);
    this.labels.push({ t, min: o.min ?? 0 });
    this.fitLabel(this.labels[this.labels.length - 1]);
    return t;
  }
  fitLabel(l, z = this.zl) { l.t.setScale(1 / z); l.t.setVisible(z >= l.min && !l.t.hiddenByGame); }
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
    // the land darkens + scorches toward the Citadel (tougher zones)
    this.add.image(c.x, c.y, 'wmap', 'shadow').setScale((WORLD.rings[1].max * 2.3 * T) / 96).setAlpha(0.55).setDepth(0.1);
    this.add.image(c.x, c.y, 'wmap', 'shadow').setScale((WORLD.rings[3].max * 2.4 * T) / 96).setAlpha(0.6).setDepth(0.1);
    // keep-out test for decor (bases, citadel, creatures move so we only avoid fixed things)
    const fixed = store.world.entities().filter((e) => e.kind !== 'creature').map((e) => ({ ...tileToWorld(e.x, e.y), r: (e.kind === 'citadel' ? WORLD.citadelRadius + 1.5 : 2) * T }));
    const clear = (x, y, pad = 0) => fixed.every((f) => Math.hypot(f.x - x, f.y - y) > f.r + pad);
    // broken roads: from your base and the map edges toward the Citadel, with gaps
    const roads = [[tileToWorld(WORLD.baseX, WORLD.baseY), c]];
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
    // zone rings (gold, red at the inner zone) + labels
    const g = this.add.graphics().setDepth(0.5);
    WORLD.rings.forEach((R, i) => {
      g.lineStyle(14, PALETTE.gold, 0.05).strokeCircle(c.x, c.y, (R.max + 1) * T);
      g.lineStyle(3, i === 3 ? 0xff4d5e : PALETTE.gold, 0.28).strokeCircle(c.x, c.y, (R.max + 1) * T);
      for (const a of [Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42]) {
        const r = (R.min + (R.max - R.min) / 2) * T;
        this.add.text(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, `ZONE ${i + 1} · Lv ${R.levels[0]}–${R.levels[1]}`, { fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffd27f88', stroke: '#05070a99', strokeThickness: 5, letterSpacing: 4 }).setOrigin(0.5).setDepth(1);
      }
    });
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
    // Rift Citadel + golden contested dome (LOCKED)
    const cw = WORLD.citadelRadius * 2 * T;
    this.domeGlow = this.add.image(c.x, c.y, 'wmap', 'glow-gold').setBlendMode('ADD').setScale(cw * 1.5 / 128).setAlpha(0.45).setDepth(2.4);
    this.citadel = this.add.image(c.x, c.y - 0.6 * T, 'wmap', 'citadel').setDepth(2.5);
    this.citadel.setScale(cw / this.citadel.width);
    const ctop = this.citadel.y - this.citadel.displayHeight / 2;
    this.coreGlow = this.add.image(c.x, ctop + this.citadel.displayHeight * 0.09, 'wmap', 'glow-teal').setBlendMode('ADD').setScale(2.4).setDepth(2.6);
    // golden contested dome: crackling rings over the Citadel (static graphics, one draw)
    const dome = this.add.graphics().setDepth(2.7).setBlendMode('ADD');
    const R = (WORLD.citadelRadius + 0.6) * T;
    for (let k = 0; k < 3; k++) { dome.lineStyle(18 - k * 5, PALETTE.gold, 0.08 + k * 0.05).strokeEllipse(c.x, c.y + 0.4 * T, R * 2, R * 1.25); }
    dome.lineStyle(4, 0xffd27f, 0.75).strokeEllipse(c.x, c.y + 0.4 * T, R * 2, R * 1.25);
    for (let k = 0; k < 4; k++) { const sx = 2 - k * 0.35; dome.lineStyle(3, 0xffd27f, 0.45).beginPath(); dome.arc(c.x, c.y + 0.4 * T, R, Math.PI * (1 + 0.04 * k), Math.PI * (2 - 0.04 * k), false); dome.strokePath(); dome.lineStyle(2, 0xffd27f, 0.3).strokeEllipse(c.x, c.y + 0.4 * T - R * 0.15 * k, R * sx * 0.98, R * 0.3 * (4 - k) / 2); }
    this.tweens.add({ targets: [this.domeGlow, dome], alpha: { from: 0.45, to: 0.85 }, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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
      const key = `${tier}|${color}|${e.x},${e.y}|${e.name}`;
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
      const nt = this.plaque(p.x, below, name, { size: local ? 26 : 22, color: local ? PALETTE.textGold : '#f2ead8', min: local ? 0 : 0.42, bg: local ? '#2a1b06dd' : '#07090dcc' });
      const lt = this.plaque(p.x, below, `Lv ${level} · ${BASE_TIERS[tier].name}`, { size: 18, bold: false, color: local ? '#7ff6ee' : '#c3ccd8', min: 0.42 });
      lt.setData('stackUnder', nt);
      parts.push(nt, lt);
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
        const elite = !!CREATURES[e.type].elite;
        const lf = LAIR_OF[e.type] ?? 'lair-crater';
        const lair = this.add.image(p.x, p.y + 4, 'wmap', lf).setOrigin(0.5, 0.6).setDepth(0.9);
        lair.setScale(LAIR_W[lf] / lair.width);
        const img = this.add.image(p.x, p.y - 14, `cr-${e.type}`).setScale(elite ? 0.8 : 0.6).setDepth(10 + p.y / SIZE);
        const badge = this.plaque(p.x, p.y + 30, '', { size: 22, depth: 11, min: 0.33 });
        const lock = this.add.text(p.x + 30, p.y - 54, '', { fontSize: '1px' }).setVisible(false); // lock shown in the plaque
        s = { img, badge, lock, lair, e };
        this.crSprites.set(e.id, s);
        if (!force) { img.setAlpha(0).setScale(0.2); this.tweens.add({ targets: img, alpha: 1, scale: elite ? 0.8 : 0.6, duration: 500, ease: 'Back.easeOut' }); }
      }
      const locked = e.level > maxL;
      s.badge.setText(`${locked ? '🔒 ' : e.busy ? '⚔ ' : ''}Lv ${e.level}`).setColor(locked ? '#9aa6b8' : (CREATURES[e.type].elite ? '#ffb347' : '#ffffff'));
      s.img.setTint(locked ? 0x9a9a9a : 0xffffff);
    }
    this.syncNodes(force);
    for (const [id, s] of this.crSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); s.lock.destroy(); s.lair.destroy(); this.crSprites.delete(id); if (this.selected === id) this.select(null); }
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
        const badge = this.plaque(p.x, p.y + 34, '', { size: 22, depth: 11, min: 0.33 });
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
      s.badge.setText(e.amount < 1 ? `Lv ${e.level} · drained` : gathering ? `${SQUADS[m.squadId].name} ${Math.floor(m.gather.load)}/${m.gather.cap}` : `Lv ${e.level} Alloy`)
        .setColor(e.amount < 1 ? '#9aa6b8' : '#7ff5e2');
    }
    for (const [id, s] of this.nodeSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); this.nodeSprites.delete(id); if (this.selected === id) this.select(null); }
  }

  drawMarches() {
    const g = this.marchG; g.clear();
    const live = new Set();
    for (const m of store.world.marches(LOCAL_OWNER)) {
      live.add(m.id);
      const a = tileToWorld(m.from.x, m.from.y), b = tileToWorld(m.to.x, m.to.y);
      const k = m.phase === 'gather' ? 1 : m.phase === 'out' ? Math.min(1, m.t / m.travel) : Math.max(0, 1 - m.t / m.back) * (m.recalled ? Math.min(1, m.back / m.travel) : 1);
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const col = m.phase === 'gather' ? 0x2fe0c8 : m.phase === 'out' ? PALETTE.cyan : PALETTE.gold;
      if (m.phase === 'gather') { // sitting at the node: the camp sprite + node plaque show progress
        let s = this.marchSprites.get(m.id);
        if (s) { s.img.setVisible(false); s.label.hiddenByGame = true; s.label.setVisible(false); }
        continue;
      }
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
      s.label.setPosition(x, y - 30).setText(`${SQUADS[m.squadId].name} ${m.phase === 'out' ? '→' : '↩'} ${Math.ceil(Math.max(0, left))}s`).setColor(m.phase === 'out' ? '#3ff0ff' : PALETTE.textGold);
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
    const t = this.add.text(p.x, p.y - 60, report.win ? 'VICTORY' : 'DEFEAT', { fontFamily: 'system-ui, sans-serif', fontSize: '34px', fontStyle: 'bold', color: report.win ? PALETTE.textGold : '#ff6f7b', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(31);
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
    const cam = this.cameras.main, p = tileToWorld(x, y);
    if (zoom) this.setZl(zoom);
    this.tweens.add({ targets: cam, scrollX: p.x - cam.width / 2, scrollY: p.y - cam.height / 2 + 120, duration: 350, ease: 'Cubic.easeOut', onUpdate: () => this.clampCamera() });
  }
  focusBase() { this.focusTile(WORLD.baseX, WORLD.baseY); }

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
      this.pinch = { a: a.id, b: b.id, d0: Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), z0: this.zl, w: this.screenToWorld(mid.x, mid.y) };
      return;
    }
    if (this.ui()?.blocksPointer(p.x, p.y)) { this.gesture = null; return; }
    const cam = this.cameras.main;
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
    if (g.mode === 'pending' && Phaser.Math.Distance.Between(p.x, p.y, g.sx, g.sy) > TAP_SLOP) g.mode = 'pan';
    if (g.mode === 'pan') {
      const cam = this.cameras.main;
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
      this.select(this.pick(w.x, w.y));
    }
    this.gesture = null;
  }

  update() {
    this.cull();
    this.fitLabels();
    this.stackLabels();
    if (!this.lastSync || this.time.now - this.lastSync > 250) { this.lastSync = this.time.now; this.syncAll(); }
    this.drawMarches();
    this.drawSelection();
    if ((this.gesture || this.pinch) && this.downPointers().length === 0) { this.gesture = null; this.pinch = null; }
  }
}
