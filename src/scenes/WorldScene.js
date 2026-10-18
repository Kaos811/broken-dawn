import Phaser from 'phaser';
import { WORLD, PALETTE, CREATURES, SQUADS } from '../config.js';
import { store } from '../state/store.js';
import { mulberry32 } from '../world/battle.js';
import { LOCAL_OWNER } from '../world/worldState.js';

const T = WORLD.tile;
const SIZE = WORLD.size * T;
const TAP_SLOP = 10;
const tileToWorld = (x, y) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T });

// The World map: a separate view from the base. Creatures in level rings around your base; squads
// march out, auto-battle, and march back. Pan: drag. Zoom: pinch / wheel. Tap a creature to target it.
export default class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }

  create() {
    this.input.addPointer(2);
    this.input.setGlobalTopOnly(false);
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x05070a);
    this.drawGround();
    const b = tileToWorld(WORLD.baseX, WORLD.baseY);
    this.baseGlow = this.add.image(b.x, b.y, 'glow').setBlendMode('ADD').setScale(1.6).setAlpha(0.6).setDepth(2);
    this.tweens.add({ targets: this.baseGlow, scale: 2, alpha: 0.9, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.baseSprite = this.add.image(b.x, b.y - 10, 'world-base').setScale(0.9).setDepth(3);
    this.add.text(b.x, b.y + 72, 'YOUR BASE', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: PALETTE.textGold, stroke: '#05070a', strokeThickness: 6 }).setOrigin(0.5, 0).setDepth(4);
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

  drawGround() {
    const g = this.add.graphics().setDepth(0);
    const rnd = mulberry32(777);
    g.fillStyle(0x05070a, 1).fillRect(-2000, -2000, SIZE + 4000, SIZE + 4000);
    g.fillStyle(0x0d1015, 1).fillRect(0, 0, SIZE, SIZE);
    // ring tint bands (darker / redder farther out = more dangerous)
    const c = tileToWorld(WORLD.baseX, WORLD.baseY);
    const tints = [0x1a1f1c, 0x1f1c18, 0x231916, 0x271413];
    for (let i = WORLD.rings.length - 1; i >= 0; i--) {
      const R = WORLD.rings[i];
      g.fillStyle(tints[i], 1).fillCircle(c.x, c.y, (R.max + 1) * T);
    }
    g.fillStyle(0x1c222b, 1).fillCircle(c.x, c.y, (WORLD.rings[0].min) * T);
    // scattered rocks + crystals
    for (let i = 0; i < 900; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, k = rnd();
      if (k < 0.6) { const s = 4 + rnd() * 16; g.fillStyle(0x2b2420, 0.55 + rnd() * 0.4).fillEllipse(x, y, s * 2, s * 1.2); }
      else if (k < 0.85) { const s = 10 + rnd() * 30; g.lineStyle(2, 0x3a302a, 0.6).strokeEllipse(x, y, s * 2, s); }
      else { const s = 4 + rnd() * 7, col = rnd() > 0.5 ? PALETTE.cyan : PALETTE.teal; g.fillStyle(col, 0.12).fillCircle(x, y, s * 2.2); g.fillStyle(col, 0.8).fillTriangle(x - s * 0.5, y, x + s * 0.5, y, x, y - s * 2); }
    }
    // faint tile grid
    g.lineStyle(1, 0xffffff, 0.03);
    for (let i = 0; i <= WORLD.size; i++) { g.lineBetween(i * T, 0, i * T, SIZE); g.lineBetween(0, i * T, SIZE, i * T); }
    // ring borders + level labels
    WORLD.rings.forEach((R, i) => {
      g.lineStyle(10, PALETTE.gold, 0.05).strokeCircle(c.x, c.y, (R.max + 1) * T);
      g.lineStyle(2, i === 3 ? 0xff4d5e : PALETTE.gold, 0.35).strokeCircle(c.x, c.y, (R.max + 1) * T);
      for (const a of [-Math.PI / 2, Math.PI / 2]) {
        const r = (R.min + (R.max - R.min) / 2) * T;
        this.add.text(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, `ZONE ${i + 1} · Lv ${R.levels[0]}–${R.levels[1]}`, { fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffb34766', letterSpacing: 4 }).setOrigin(0.5).setDepth(1);
      }
    });
    g.lineStyle(4, 0xff4d5e, 0.5).strokeRect(0, 0, SIZE, SIZE);
  }

  // ------------------------------------------------------------ sync ---
  syncAll(force = false) {
    const maxL = store.maxAttackLevel();
    const live = new Set();
    for (const e of store.creatures()) {
      live.add(e.id);
      let s = this.crSprites.get(e.id);
      const p = tileToWorld(e.x, e.y);
      if (!s) {
        const elite = !!CREATURES[e.type].elite;
        const img = this.add.image(p.x, p.y - 14, `cr-${e.type}`).setScale(elite ? 0.95 : 0.72).setDepth(10 + p.y / SIZE);
        const badge = this.add.text(p.x, p.y + 30, '', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#05070a', strokeThickness: 6, align: 'center' }).setOrigin(0.5, 0).setDepth(11);
        const lock = this.add.text(p.x + 30, p.y - 54, '🔒', { fontSize: '24px' }).setOrigin(0.5).setDepth(12);
        s = { img, badge, lock, e };
        this.crSprites.set(e.id, s);
        if (!force) { img.setAlpha(0).setScale(0.2); this.tweens.add({ targets: img, alpha: 1, scale: elite ? 0.95 : 0.72, duration: 500, ease: 'Back.easeOut' }); }
      }
      const locked = e.level > maxL;
      s.badge.setText(`Lv ${e.level}${e.busy ? ' ⚔' : ''}`).setColor(locked ? '#8a96a8' : (CREATURES[e.type].elite ? '#ffb347' : '#ffffff'));
      s.img.setTint(locked ? 0x777777 : 0xffffff);
      s.lock.setVisible(locked);
    }
    for (const [id, s] of this.crSprites) if (!live.has(id)) { s.img.destroy(); s.badge.destroy(); s.lock.destroy(); this.crSprites.delete(id); if (this.selected === id) this.select(null); }
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
    const s = this.selected && this.crSprites.get(this.selected);
    if (!s) return;
    const p = tileToWorld(s.e.x, s.e.y), r = 52 + Math.sin(this.time.now / 180) * 4;
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
    return best;
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
    if (!this.lastSync || this.time.now - this.lastSync > 250) { this.lastSync = this.time.now; this.syncAll(); }
    this.drawMarches();
    this.drawSelection();
    if ((this.gesture || this.pinch) && this.downPointers().length === 0) { this.gesture = null; this.pinch = null; }
  }
}
