import Phaser from 'phaser';
import { WORLD, PALETTE, CREATURES, SQUADS, BASE_TIERS, baseTier } from '../config.js';
import { store } from '../state/store.js';
import { mulberry32 } from '../world/battle.js';
import { LOCAL_OWNER, BASE_ID, CENTER, dist } from '../world/worldState.js';

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
const LAIR_OF = { hound: 'lair-3', scuttler: 'lair-1', drone: 'ruin-3', golem: 'ruin-1', wyrm: 'lair-2' };
export default class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }

  create() {
    this.input.addPointer(2);
    this.input.setGlobalTopOnly(false);
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x05070a);
    this.props = [];               // culled decor
    this.drawWorld();
    this.baseSprites = new Map();  // id -> { parts[], tier, e }
    const b = tileToWorld(WORLD.baseX, WORLD.baseY);
    this.marchG = this.add.graphics().setDepth(5);
    this.selG = this.add.graphics().setDepth(6);
    this.crSprites = new Map();   // id -> { img, badge, lock }
    this.marchSprites = new Map(); // id -> { img, label }
    this.selected = null;
    this.gesture = null; this.pinch = null;

    cam.setZoom(WORLD.startZoom);
    cam.centerOn(b.x, b.y);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.ui()?.blocksPointer(p.x, p.y)) return;
      this.zoomAt(p.x, p.y, cam.zoom * (dy > 0 ? 0.9 : 1.1));
    });
    this.unsubs = [
      store.on('hunt', (r) => this.battleFx(r)),
      store.on('reset', () => { this.select(null); this.syncAll(true); }),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
    this.syncAll(true);
  }

  ui() { return this.scene.get('UI'); }

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
      else if (k < 0.72) this.prop(x, y, 'lair-1', { w: 150 + rnd() * 60, depth: 0.8, alpha: 0.75, flip: rnd() > 0.5 });
    }
    // Rift Citadel + golden contested dome (LOCKED)
    const cw = (WORLD.citadelRadius * 2 + 2.4) * T;
    this.domeGlow = this.add.image(c.x, c.y, 'wmap', 'glow-gold').setBlendMode('ADD').setScale(cw * 1.15 / 128).setAlpha(0.5).setDepth(2.4);
    this.citadel = this.add.image(c.x, c.y - 0.4 * T, 'wmap', 'citadel').setScale(cw / 550).setDepth(2.5);
    this.coreGlow = this.add.image(c.x - 0.15 * T, c.y - 2.9 * T, 'wmap', 'glow-teal').setBlendMode('ADD').setScale(2.6).setDepth(2.6);
    this.tweens.add({ targets: this.domeGlow, alpha: 0.85, scale: cw * 1.22 / 128, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.coreGlow, alpha: 0.4, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.text(c.x, c.y + WORLD.citadelRadius * T + 30, '🔒  RIFT CITADEL', { fontFamily: 'system-ui, sans-serif', fontSize: '34px', fontStyle: 'bold', color: PALETTE.textGold, stroke: '#05070a', strokeThickness: 7, letterSpacing: 3 }).setOrigin(0.5).setDepth(40);
    this.add.text(c.x, c.y + WORLD.citadelRadius * T + 72, 'contested dome · alliance war coming', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#ffd27fcc', stroke: '#05070a', strokeThickness: 6 }).setOrigin(0.5).setDepth(40);
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
      const img = this.add.image(p.x, p.y, 'wmap', TIER_FRAMES[tier]).setDepth(d);
      img.setScale(TIER_W[tier] / img.width);
      if (tier === 4) img.setTint(0xfff0c8);
      parts.push(img);
      const top = p.y - img.displayHeight * 0.3;
      if (tier === 3) parts.push(this.add.image(p.x + 4, top + 22, 'wmap', 'glow-teal').setBlendMode('ADD').setScale(1.3).setDepth(d + 0.001));
      if (tier === 4) parts.push(this.add.image(p.x, top - 8, 'wmap', 'crown').setScale(0.9).setDepth(d + 0.002));
      const flag = this.add.image(p.x + img.displayWidth * 0.3, top + 4, 'wmap', 'banner').setOrigin(0.15, 1).setScale(0.85).setTint(color).setDepth(d + 0.003);
      parts.push(flag);
      this.tweens.add({ targets: flag, scaleX: 0.75, duration: 900 + (e.x * 37) % 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const label = local ? 'YOUR BASE' : `${e.tag ? `[${e.tag}] ` : ''}${e.name}`;
      parts.push(this.add.text(p.x, p.y + img.displayHeight / 2 + 4, label, { fontFamily: 'system-ui, sans-serif', fontSize: local ? '24px' : '19px', fontStyle: 'bold', color: local ? PALETTE.textGold : '#e8e1d0', stroke: '#05070a', strokeThickness: 6 }).setOrigin(0.5, 0).setDepth(41));
      parts.push(this.add.text(p.x, p.y + img.displayHeight / 2 + (local ? 32 : 27), `Lv ${level} · ${BASE_TIERS[tier].name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: local ? '#7ff6ee' : '#a9b3c2', stroke: '#05070a', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(41));
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
        const lair = this.add.image(p.x, p.y + 6, 'wmap', LAIR_OF[e.type] ?? 'lair-3').setAlpha(0.8).setDepth(0.9);
        lair.setScale((elite ? 170 : 120) / lair.width);
        const img = this.add.image(p.x, p.y - 14, `cr-${e.type}`).setScale(elite ? 0.95 : 0.72).setDepth(10 + p.y / SIZE);
        const badge = this.add.text(p.x, p.y + 30, '', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#05070a', strokeThickness: 6, align: 'center' }).setOrigin(0.5, 0).setDepth(11);
        const lock = this.add.text(p.x + 30, p.y - 54, '🔒', { fontSize: '24px' }).setOrigin(0.5).setDepth(12);
        s = { img, badge, lock, lair, e };
        this.crSprites.set(e.id, s);
        if (!force) { img.setAlpha(0).setScale(0.2); this.tweens.add({ targets: img, alpha: 1, scale: elite ? 0.95 : 0.72, duration: 500, ease: 'Back.easeOut' }); }
      }
      const locked = e.level > maxL;
      s.badge.setText(`Lv ${e.level}${e.busy ? ' ⚔' : ''}`).setColor(locked ? '#8a96a8' : (CREATURES[e.type].elite ? '#ffb347' : '#ffffff'));
      s.img.setTint(locked ? 0x777777 : 0xffffff);
      s.lock.setVisible(locked);
    }
    for (const [id, s] of this.crSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); s.lock.destroy(); s.lair.destroy(); this.crSprites.delete(id); if (this.selected === id) this.select(null); }
  }

  drawMarches() {
    const g = this.marchG; g.clear();
    const live = new Set();
    for (const m of store.world.marches(LOCAL_OWNER)) {
      live.add(m.id);
      const a = tileToWorld(m.from.x, m.from.y), b = tileToWorld(m.to.x, m.to.y);
      const k = m.phase === 'out' ? Math.min(1, m.t / m.travel) : Math.max(0, 1 - m.t / m.back) * (m.recalled ? Math.min(1, m.back / m.travel) : 1);
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      const col = m.phase === 'out' ? PALETTE.cyan : PALETTE.gold;
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
        s = { img: this.add.image(x, y, 'world-squad').setDepth(20), label: this.add.text(x, y - 46, '', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#3ff0ff', stroke: '#05070a', strokeThickness: 6 }).setOrigin(0.5, 1).setDepth(21) };
        this.marchSprites.set(m.id, s);
      }
      const left = m.phase === 'out' ? m.travel - m.t : m.back - m.t;
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
  screenToWorld(sx, sy) { const cam = this.cameras.main, cx = cam.width / 2, cy = cam.height / 2; return { x: cam.scrollX + cx + (sx - cx) / cam.zoom, y: cam.scrollY + cy + (sy - cy) / cam.zoom }; }
  worldToScreen(wx, wy) { const cam = this.cameras.main, cx = cam.width / 2, cy = cam.height / 2; return { x: (wx - cam.scrollX - cx) * cam.zoom + cx, y: (wy - cam.scrollY - cy) * cam.zoom + cy }; }
  tileToScreen(x, y) { const p = tileToWorld(x, y); return this.worldToScreen(p.x, p.y); }
  setZoomKeeping(z, wx, wy, sx, sy) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(z, WORLD.minZoom, WORLD.maxZoom));
    const cx = cam.width / 2, cy = cam.height / 2;
    cam.scrollX = wx - cx - (sx - cx) / cam.zoom; cam.scrollY = wy - cy - (sy - cy) / cam.zoom;
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
    if (zoom) cam.setZoom(zoom);
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
      this.pinch = { a: a.id, b: b.id, d0: Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), z0: this.cameras.main.zoom, w: this.screenToWorld(mid.x, mid.y) };
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
      cam.scrollX = g.cam0.x - (p.x - g.sx) / cam.zoom; cam.scrollY = g.cam0.y - (p.y - g.sy) / cam.zoom;
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
    if (!this.lastSync || this.time.now - this.lastSync > 250) { this.lastSync = this.time.now; this.syncAll(); }
    this.drawMarches();
    this.drawSelection();
    if ((this.gesture || this.pinch) && this.downPointers().length === 0) { this.gesture = null; this.pinch = null; }
  }
}
