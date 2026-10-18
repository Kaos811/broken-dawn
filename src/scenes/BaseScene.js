import Phaser from 'phaser';
import { MAP, PALETTE, BEACON, BUILDINGS, BUILDING_IDS } from '../config.js';
import { store } from '../state/store.js';
import { isoToWorld, worldToIso, isPlatformTile, footprintAnchor, WORLD_W, WORLD_H, ORIGIN_Y } from '../systems/grid.js';

import { TEX } from './BootScene.js';

const LONG_PRESS_MS = 420;
const TAP_SLOP = 10;       // px (screen) before a press becomes a pan/drag
const EDGE_PAN = 80;       // px from screen edge that auto-pans while dragging a building

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function lerpColor(a, b, t) {
  const A = Phaser.Display.Color.IntegerToColor(a), B = Phaser.Display.Color.IntegerToColor(b);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(A, B, 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

export default class BaseScene extends Phaser.Scene {
  constructor() { super('Base'); }

  create() {
    this.input.addPointer(2);
    this.input.setGlobalTopOnly(false); // UI scene blocking is done explicitly via ui.blocksPointer()
    this.cameras.main.setBackgroundColor(PALETTE.bg);

    this.drawMap();
    this.overlay = this.add.graphics().setDepth(2);
    this.createAmbient();
    this.createBeacon();
    this.sprites = {};
    for (const id of BUILDING_IDS) this.createBuilding(id);

    this.selectedId = null;  // building whose info panel is open
    this.moveId = null;      // building in move mode
    this.gesture = null;
    this.pinch = null;

    const cam = this.cameras.main;
    cam.setZoom(MAP.startZoom);
    const c = this.beaconCenter;
    cam.centerOn(c.x, c.y - 40);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.ui()?.blocksPointer(p.x, p.y)) return;
      this.zoomAt(p.x, p.y, cam.zoom * (dy > 0 ? 0.9 : 1.1));
    });

    this.unsubs = [
      store.on('reset', () => { this.exitMoveMode(); this.clearSelection(); this.syncAll(); }),
      store.on('upgrade', (id, d) => this.upgradeFx(id, d)),
      store.on('change', () => this.syncLabels()),
    ];
    this.game.events.on('ui:move', (id) => this.enterMoveMode(id), this);
    this.game.events.on('ui:moveDone', () => this.exitMoveMode(), this);
    this.game.events.on('ui:panelClosed', () => this.clearSelection(), this);
    this.game.events.on('ui:focusBeacon', () => this.select(BEACON.id), this);
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
  }

  ui() { return this.scene.get('UI'); }

  // ---------------------------------------------------------------- map ---
  drawMap() {
    const rnd = mulberry32(1337);
    const g = this.add.graphics().setDepth(0);
    const N = MAP.size, HW = MAP.tileW / 2, HH = MAP.tileH / 2;
    const pMin = MAP.platformMin, pMax = MAP.platformMax;

    // Void backdrop with faint stars
    g.fillStyle(PALETTE.bg, 1).fillRect(-1500, -1500, WORLD_W + 3000, WORLD_H + 3000);
    for (let i = 0; i < 260; i++) {
      g.fillStyle(rnd() > 0.8 ? PALETTE.cyan : 0xffffff, 0.15 + rnd() * 0.35);
      g.fillCircle(-1200 + rnd() * (WORLD_W + 2400), -1200 + rnd() * (WORLD_H + 2400), rnd() * 1.8 + 0.4);
    }

    const diamond = (gx, gy, color, alpha = 1) => {
      const t = isoToWorld(gx, gy), r = isoToWorld(gx + 1, gy), b = isoToWorld(gx + 1, gy + 1), l = isoToWorld(gx, gy + 1);
      g.fillStyle(color, alpha).fillPoints([t, r, b, l], true);
      return { t, r, b, l };
    };

    // Cliff skirt under the outer terrain edges (3D feel)
    const cliff = 70;
    for (let i = 0; i < N; i++) {
      const a = isoToWorld(i, N), b = isoToWorld(i + 1, N);          // bottom-left edge
      g.fillStyle(lerpColor(PALETTE.rockDark, 0x000000, 0.3), 1).fillPoints([a, b, { x: b.x, y: b.y + cliff }, { x: a.x, y: a.y + cliff }], true);
      const c = isoToWorld(N, i), d = isoToWorld(N, i + 1);          // bottom-right edge
      g.fillStyle(PALETTE.rockDark, 1).fillPoints([c, d, { x: d.x, y: d.y + cliff }, { x: c.x, y: c.y + cliff }], true);
    }

    // Terrain + platform tiles
    const centre = (pMin + pMax + 1) / 2;
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        if (isPlatformTile(gx, gy)) continue;
        const d = Math.max(Math.abs(gx + 0.5 - centre), Math.abs(gy + 0.5 - centre)) - (pMax - pMin + 1) / 2; // tiles past platform edge
        const n = rnd();
        let col = lerpColor(PALETTE.rockLight, PALETTE.rock, n);
        if (d < 2.2 && rnd() < 0.55 - d * 0.2) col = lerpColor(PALETTE.metalDark, col, 0.5 + d * 0.2); // metal debris fading out
        col = lerpColor(col, PALETTE.rockDark, Math.min(0.7, d / 12));
        const v = diamond(gx, gy, col);
        g.lineStyle(1, 0x000000, 0.18).strokePoints([v.t, v.r, v.b, v.l], true);
      }
    }

    // Rocks, craters, crystals on the terrain
    for (let i = 0; i < 150; i++) {
      const gx = rnd() * N, gy = rnd() * N;
      if (gx > pMin - 0.8 && gx < pMax + 1.8 && gy > pMin - 0.8 && gy < pMax + 1.8) continue;
      const p = isoToWorld(gx, gy);
      const kind = rnd();
      if (kind < 0.55) {
        const s = 8 + rnd() * 22;
        g.fillStyle(0x000000, 0.3).fillEllipse(p.x + s * 0.4, p.y + s * 0.25, s * 2, s * 0.8);
        g.fillStyle(lerpColor(PALETTE.rockLight, 0x5a4a3e, rnd()), 1).fillPoints([
          { x: p.x - s, y: p.y }, { x: p.x - s * 0.4, y: p.y - s * 0.9 }, { x: p.x + s * 0.5, y: p.y - s * 0.7 }, { x: p.x + s, y: p.y }, { x: p.x, y: p.y + s * 0.35 }], true);
        g.fillStyle(0x6b5848, 1).fillPoints([{ x: p.x - s * 0.4, y: p.y - s * 0.9 }, { x: p.x + s * 0.5, y: p.y - s * 0.7 }, { x: p.x + s * 0.1, y: p.y - s * 0.35 }], true);
      } else if (kind < 0.8) {
        const s = 14 + rnd() * 26;
        g.fillStyle(0x000000, 0.35).fillEllipse(p.x, p.y, s * 2, s);
        g.lineStyle(2, 0x4a3d33, 0.8).strokeEllipse(p.x, p.y, s * 2, s);
      } else {
        const s = 6 + rnd() * 10, col = rnd() > 0.5 ? PALETTE.cyan : PALETTE.teal;
        g.fillStyle(col, 0.12).fillCircle(p.x, p.y - s, s * 2.4);
        g.fillStyle(col, 0.9).fillTriangle(p.x - s * 0.5, p.y, p.x + s * 0.5, p.y, p.x, p.y - s * 2.2);
        g.fillStyle(0xffffff, 0.6).fillTriangle(p.x, p.y, p.x + s * 0.3, p.y, p.x, p.y - s * 2);
      }
    }

    // Platform side faces (thickness)
    const th = MAP.platformThickness;
    for (let i = pMin; i <= pMax; i++) {
      const a = isoToWorld(i, pMax + 1), b = isoToWorld(i + 1, pMax + 1);
      g.fillStyle(0x12161c, 1).fillPoints([a, b, { x: b.x, y: b.y + th }, { x: a.x, y: a.y + th }], true);
      const c = isoToWorld(pMax + 1, i), d = isoToWorld(pMax + 1, i + 1);
      g.fillStyle(0x1b2029, 1).fillPoints([c, d, { x: d.x, y: d.y + th }, { x: c.x, y: c.y + th }], true);
    }
    // Platform tops
    for (let gy = pMin; gy <= pMax; gy++) {
      for (let gx = pMin; gx <= pMax; gx++) {
        const ring = Math.max(Math.abs(gx + 0.5 - centre), Math.abs(gy + 0.5 - centre));
        let col = (gx + gy) % 2 ? PALETTE.metal : lerpColor(PALETTE.metal, PALETTE.metalDark, 0.35);
        if (ring < 3) col = lerpColor(col, PALETTE.metalLight, 0.35);
        const v = diamond(gx, gy, col);
        g.lineStyle(1.5, PALETTE.metalEdge, 0.35).strokePoints([v.t, v.r, v.b, v.l], true);
        g.fillStyle(0x0b0e13, 0.6).fillCircle((v.t.x + v.l.x) / 2 + 6, (v.t.y + v.l.y) / 2 + 2, 1.6); // rivet
      }
    }
    // Hazard trim around platform edge
    const T = isoToWorld(pMin, pMin), R = isoToWorld(pMax + 1, pMin), B = isoToWorld(pMax + 1, pMax + 1), L = isoToWorld(pMin, pMax + 1);
    g.lineStyle(8, PALETTE.gold, 0.12).strokePoints([T, R, B, L], true);
    g.lineStyle(2.5, PALETTE.gold, 0.85).strokePoints([T, R, B, L], true);

    // Energy conduits from the Beacon to the platform edge (along iso axes)
    this.conduits = [];
    const mid = BEACON.gx + 1;
    const lines = [
      [isoToWorld(mid, mid), isoToWorld(mid, pMin)],
      [isoToWorld(mid, mid), isoToWorld(pMax + 1, mid)],
      [isoToWorld(mid, mid), isoToWorld(mid, pMax + 1)],
      [isoToWorld(mid, mid), isoToWorld(pMin, mid)],
    ];
    for (const [a, b] of lines) {
      g.lineStyle(10, PALETTE.cyan, 0.08).lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(3, PALETTE.cyan, 0.55).lineBetween(a.x, a.y, b.x, b.y);
      this.conduits.push([a, b]);
    }
    this.beaconCenter = isoToWorld(mid, mid);
  }

  createAmbient() {
    // Energy pulses travelling along conduits
    this.conduits.forEach(([a, b], i) => {
      const dot = this.add.image(a.x, a.y, 'glow-cyan').setScale(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
      this.tweens.add({ targets: dot, x: b.x, y: b.y, duration: 2600, delay: i * 650, repeat: -1, ease: 'Sine.easeIn',
        onRepeat: () => dot.setPosition(a.x, a.y) });
      this.tweens.add({ targets: dot, alpha: { from: 1, to: 0 }, duration: 2600, delay: i * 650, repeat: -1, ease: 'Quad.easeIn' });
    });
    // Drifting embers over the whole map
    this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: WORLD_W }, y: { min: ORIGIN_Y, max: WORLD_H },
      lifespan: { min: 5000, max: 9000 }, speedY: { min: -18, max: -6 }, speedX: { min: -6, max: 6 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.7, end: 0 },
      tint: [PALETTE.gold, PALETTE.orange, PALETTE.cyan], blendMode: 'ADD', frequency: 140, quantity: 1,
    }).setDepth(6000);
  }

  createBeacon() {
    const a = footprintAnchor(BEACON.gx, BEACON.gy, BEACON.footprint);
    const c = this.beaconCenter;
    this.beaconGlow = this.add.image(c.x, c.y - 150, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(a.y + 1).setScale(1.1).setAlpha(0.7);
    this.tweens.add({ targets: this.beaconGlow, scale: 1.45, alpha: 1, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.floorGlow = this.add.image(c.x, c.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(1).setScale(2.4, 1.2).setAlpha(0.35);
    this.tweens.add({ targets: this.floorGlow, alpha: 0.6, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.beaconSprite = this.add.image(a.x, a.y, 'tex-beacon').setOrigin(TEX.CX / TEX.W, TEX.BOTTOM / TEX.H).setDepth(a.y);
    // orbiting shards
    this.shards = [0, 1, 2].map((i) => this.add.image(c.x, c.y, 'glow-cyan').setScale(0.22).setBlendMode(Phaser.BlendModes.ADD).setDepth(a.y + 2));
    this.shardT = 0;
    this.beaconLabel = this.makeLabel();
    this.beaconSparks = this.add.particles(c.x, c.y - 150, 'spark', {
      lifespan: 1400, speed: { min: 20, max: 60 }, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [PALETTE.gold, 0xffffff], blendMode: 'ADD', frequency: 120,
    }).setDepth(a.y + 3);
    this.syncBeaconLabel();
  }

  makeLabel() {
    return this.add.text(0, 0, '', {
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontSize: '22px', fontStyle: 'bold',
      color: PALETTE.text, stroke: '#05070a', strokeThickness: 6, align: 'center',
    }).setOrigin(0.5, 0).setDepth(5000);
  }

  createBuilding(id) {
    const img = this.add.image(0, 0, `tex-${id}`).setOrigin(TEX.CX / TEX.W, TEX.BOTTOM / TEX.H);
    const label = this.makeLabel();
    this.sprites[id] = { img, label };
    const b = store.state.buildings[id];
    this.placeSprite(id, b.gx, b.gy);
    this.syncLabel(id);
  }

  placeSprite(id, gx, gy) {
    const { img, label } = this.sprites[id];
    const a = footprintAnchor(gx, gy, BUILDINGS[id].footprint);
    img.setPosition(a.x, a.y).setDepth(a.y);
    label.setPosition(a.x, a.y + 6);
  }

  syncAll() {
    for (const id of BUILDING_IDS) { const b = store.state.buildings[id]; this.placeSprite(id, b.gx, b.gy); }
    this.syncLabels();
  }
  syncLabel(id) {
    const b = store.state.buildings[id];
    this.sprites[id].label.setText(`${BUILDINGS[id].name}  ·  Lv ${b.level}`);
  }
  syncBeaconLabel() {
    const a = footprintAnchor(BEACON.gx, BEACON.gy, BEACON.footprint);
    this.beaconLabel.setText(`${BEACON.name}  ·  Lv ${store.state.beacon.level}`).setPosition(a.x, a.y + 6).setColor(PALETTE.textGold);
  }
  syncLabels() { BUILDING_IDS.forEach((id) => this.syncLabel(id)); this.syncBeaconLabel(); }

  // --------------------------------------------------------- camera ------
  screenToWorld(sx, sy) {
    const cam = this.cameras.main;
    const cx = cam.width / 2, cy = cam.height / 2;
    return { x: cam.scrollX + cx + (sx - cx) / cam.zoom, y: cam.scrollY + cy + (sy - cy) / cam.zoom };
  }
  worldToScreen(wx, wy) {
    const cam = this.cameras.main;
    const cx = cam.width / 2, cy = cam.height / 2;
    return { x: (wx - cam.scrollX - cx) * cam.zoom + cx, y: (wy - cam.scrollY - cy) * cam.zoom + cy };
  }
  // Set zoom while keeping world point (wx,wy) under screen point (sx,sy).
  setZoomKeeping(z, wx, wy, sx, sy) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(z, MAP.minZoom, MAP.maxZoom));
    const cx = cam.width / 2, cy = cam.height / 2;
    cam.scrollX = wx - cx - (sx - cx) / cam.zoom;
    cam.scrollY = wy - cy - (sy - cy) / cam.zoom;
    this.clampCamera();
  }
  zoomAt(sx, sy, z) { const w = this.screenToWorld(sx, sy); this.setZoomKeeping(z, w.x, w.y, sx, sy); }
  clampCamera() {
    const cam = this.cameras.main;
    const mx = Phaser.Math.Clamp(cam.scrollX + cam.width / 2, 0, WORLD_W);
    const my = Phaser.Math.Clamp(cam.scrollY + cam.height / 2, ORIGIN_Y - 100, WORLD_H);
    cam.scrollX = mx - cam.width / 2; cam.scrollY = my - cam.height / 2;
  }

  // -------------------------------------------------------- picking ------
  pick(wx, wy) {
    // Prefer footprint hit (exact), then sprite bounds (tall parts), front-most first.
    const iso = worldToIso(wx, wy);
    const all = [...BUILDING_IDS.map((id) => ({ id, ...store.state.buildings[id], size: BUILDINGS[id].footprint, img: this.sprites[id].img })),
      { id: BEACON.id, gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint, img: this.beaconSprite }];
    for (const o of all) if (iso.gx >= o.gx && iso.gx < o.gx + o.size && iso.gy >= o.gy && iso.gy < o.gy + o.size) return o.id;
    const hits = all.filter((o) => {
      const r = o.img.getBounds();
      return Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(r.x + 30, r.y + 40, r.width - 70, r.height - 90), wx, wy);
    }).sort((a, b) => b.img.depth - a.img.depth);
    return hits[0]?.id ?? null;
  }

  downPointers() { return this.input.manager.pointers.filter((p) => p.isDown); }

  // --------------------------------------------------------- input -------
  onDown(p) {
    const downs = this.downPointers();
    if (downs.length >= 2) { this.startPinch(downs); return; }
    if (this.ui()?.blocksPointer(p.x, p.y)) { this.gesture = null; return; }
    const w = this.screenToWorld(p.x, p.y);
    const hit = this.pick(w.x, w.y);
    this.gesture = { id: p.id, sx: p.x, sy: p.y, hit, mode: 'pending', cam0: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY } };
    if (hit && hit === this.moveId) { this.beginDrag(hit, w); return; }
    if (hit) {
      this.gesture.timer = this.time.delayedCall(LONG_PRESS_MS, () => {
        const g = this.gesture;
        if (!g || g.mode !== 'pending' || g.hit !== hit) return;
        if (hit === BEACON.id) {
          g.mode = 'done';
          this.game.events.emit('toast', 'The Beacon is anchored — it can\'t be moved.');
          this.cameras.main.shake(120, 0.002);
          return;
        }
        if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* ignore */ }
        this.enterMoveMode(hit);
        this.beginDrag(hit, this.screenToWorld(this.input.manager.pointers[g.id]?.x ?? g.sx, this.input.manager.pointers[g.id]?.y ?? g.sy));
      });
    }
  }

  startPinch(downs) {
    if (this.gesture?.timer) this.gesture.timer.remove();
    if (this.gesture?.mode === 'drag') this.endDrag(false);
    this.gesture = null;
    const [a, b] = downs;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { a: a.id, b: b.id, d0: Math.max(10, Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y)), z0: this.cameras.main.zoom, w: this.screenToWorld(mid.x, mid.y) };
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
    const moved = Phaser.Math.Distance.Between(p.x, p.y, g.sx, g.sy);
    if (g.mode === 'pending' && moved > TAP_SLOP) {
      g.timer?.remove();
      g.mode = 'pan';
    }
    if (g.mode === 'pan') {
      const cam = this.cameras.main;
      cam.scrollX = g.cam0.x - (p.x - g.sx) / cam.zoom;
      cam.scrollY = g.cam0.y - (p.y - g.sy) / cam.zoom;
      this.clampCamera();
    } else if (g.mode === 'drag') {
      g.lastScreen = { x: p.x, y: p.y };
      this.updateDrag();
    }
  }

  onUp(p) {
    if (this.pinch) {
      if (this.downPointers().length < 2) this.pinch = null;
      this.gesture = null;
      return;
    }
    const g = this.gesture;
    if (!g || p.id !== g.id) return;
    g.timer?.remove();
    if (g.mode === 'pending') this.onTap(g.hit);
    else if (g.mode === 'drag') this.endDrag(true);
    this.gesture = null;
  }

  onTap(hit) {
    if (hit && hit === this.moveId) return;
    if (this.moveId) this.exitMoveMode();
    if (hit) this.select(hit);
    else this.clearSelection(true);
  }

  select(id) {
    this.selectedId = id;
    this.drawOverlay();
    this.game.events.emit('base:select', id);
  }
  clearSelection(notify = false) {
    if (!this.selectedId) return;
    this.selectedId = null;
    this.drawOverlay();
    if (notify) this.game.events.emit('base:deselect');
  }

  // ------------------------------------------------------ move mode -----
  enterMoveMode(id) {
    if (!BUILDINGS[id]) return; // Beacon & unknown ids are immovable
    this.moveId = id;
    this.selectedId = null;
    this.game.events.emit('base:deselect');
    const { img } = this.sprites[id];
    this.tweens.killTweensOf(img);
    img.setAlpha(1);
    this.moveTween = this.tweens.add({ targets: img, alpha: 0.7, duration: 450, yoyo: true, repeat: -1 });
    this.drawOverlay();
    this.game.events.emit('base:moveMode', id);
  }
  exitMoveMode() {
    if (!this.moveId) return;
    if (this.gesture?.mode === 'drag') this.endDrag(true);
    const { img } = this.sprites[this.moveId];
    this.moveTween?.remove(); img.setAlpha(1).clearTint();
    this.moveId = null;
    this.drawOverlay();
    this.game.events.emit('base:moveMode', null);
  }

  beginDrag(id, w) {
    const g = this.gesture;
    if (!g) return;
    g.timer?.remove();
    const b = store.state.buildings[id];
    const iso = worldToIso(w.x, w.y);
    g.mode = 'drag';
    g.grab = { x: iso.gx - b.gx, y: iso.gy - b.gy };
    g.target = { gx: b.gx, gy: b.gy, valid: true };
    g.lastScreen = { x: g.sx, y: g.sy };
    this.sprites[id].img.setDepth(4500);
    this.sprites[id].img.y -= 12; // lift
  }
  updateDrag() {
    const g = this.gesture, id = this.moveId;
    if (!g || g.mode !== 'drag' || !id) return;
    const w = this.screenToWorld(g.lastScreen.x, g.lastScreen.y);
    const iso = worldToIso(w.x, w.y);
    const size = BUILDINGS[id].footprint;
    const gx = Phaser.Math.Clamp(Math.round(iso.gx - g.grab.x), 0, MAP.size - size);
    const gy = Phaser.Math.Clamp(Math.round(iso.gy - g.grab.y), 0, MAP.size - size);
    const valid = store.canPlace(id, gx, gy);
    if (gx !== g.target.gx || gy !== g.target.gy || valid !== g.target.valid) {
      g.target = { gx, gy, valid };
      const a = footprintAnchor(gx, gy, size);
      const { img, label } = this.sprites[id];
      img.setPosition(a.x, a.y - 12);
      label.setPosition(a.x, a.y + 6);
      if (valid) img.clearTint(); else img.setTint(0xff8080);
      this.drawOverlay();
    }
  }
  endDrag(commit) {
    const g = this.gesture, id = this.moveId;
    if (!g || g.mode !== 'drag' || !id) return;
    g.mode = 'done';
    const b = store.state.buildings[id];
    if (commit && g.target.valid) {
      store.moveBuilding(id, g.target.gx, g.target.gy);
    } else if (commit) {
      this.game.events.emit('toast', 'Can\'t place there — needs open platform tiles.');
    }
    const { img } = this.sprites[id];
    img.clearTint();
    this.placeSprite(id, b.gx, b.gy);
    g.target = null;
    this.drawOverlay();
  }

  drawOverlay() {
    const o = this.overlay; o.clear();
    const fp = (gx, gy, size, color, fill = 0.22, line = 3) => {
      const pts = [isoToWorld(gx, gy), isoToWorld(gx + size, gy), isoToWorld(gx + size, gy + size), isoToWorld(gx, gy + size)];
      o.fillStyle(color, fill).fillPoints(pts, true);
      o.lineStyle(line, color, 0.95).strokePoints(pts, true);
    };
    if (this.moveId) {
      // placement grid
      o.lineStyle(1.5, PALETTE.cyan, 0.35);
      for (let gy = MAP.platformMin; gy <= MAP.platformMax; gy++) for (let gx = MAP.platformMin; gx <= MAP.platformMax; gx++) {
        o.strokePoints([isoToWorld(gx, gy), isoToWorld(gx + 1, gy), isoToWorld(gx + 1, gy + 1), isoToWorld(gx, gy + 1)], true);
      }
      fp(BEACON.gx, BEACON.gy, BEACON.footprint, PALETTE.invalid, 0.12, 2);
      for (const f of store.othersFootprints(this.moveId)) fp(f.gx, f.gy, f.size, PALETTE.invalid, 0.12, 2);
      const t = this.gesture?.target;
      const b = store.state.buildings[this.moveId];
      if (t) fp(t.gx, t.gy, BUILDINGS[this.moveId].footprint, t.valid ? PALETTE.valid : PALETTE.invalid, 0.3);
      else fp(b.gx, b.gy, BUILDINGS[this.moveId].footprint, PALETTE.valid, 0.25);
    } else if (this.selectedId) {
      const s = this.selectedId === BEACON.id ? { gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint }
        : { ...store.state.buildings[this.selectedId], size: BUILDINGS[this.selectedId].footprint };
      fp(s.gx, s.gy, s.size, PALETTE.gold, 0.15);
    }
  }

  upgradeFx(id, { before, after }) {
    const img = id === BEACON.id ? this.beaconSprite : this.sprites[id].img;
    img.setTintFill(0xffffff);
    this.time.delayedCall(90, () => img.clearTint());
    this.tweens.add({ targets: img, scaleX: 1.08, scaleY: 1.08, duration: 110, yoyo: true });
    const txt = this.add.text(img.x, img.y - 210, `+${after - before} POWER`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '30px', fontStyle: 'bold', color: PALETTE.textGold, stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(7000);
    this.tweens.add({ targets: txt, y: txt.y - 80, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
    const sp = this.add.particles(img.x, img.y - 80, 'spark', { speed: { min: 80, max: 220 }, lifespan: 700, scale: { start: 1, end: 0 }, tint: [PALETTE.gold, PALETTE.cyan], blendMode: 'ADD', emitting: false }).setDepth(7000);
    sp.explode(40);
    this.time.delayedCall(900, () => sp.destroy());
    this.syncLabels();
  }

  update(_t, dtMs) {
    // orbiting Beacon shards
    this.shardT += dtMs / 1000;
    const c = this.beaconCenter;
    this.shards.forEach((s, i) => {
      const a = this.shardT * 0.9 + (i * Math.PI * 2) / 3;
      s.setPosition(c.x + Math.cos(a) * 95, c.y - 70 + Math.sin(a) * 42);
      s.setDepth(c.y + (Math.sin(a) > 0 ? 80 : -10));
    });
    // Beacon glow intensity follows charge
    this.beaconGlow.setTint(store.state.beacon.charge >= BEACON.maxCharge ? 0xffffff : 0xffd9a0);

    // Safety: gesture left hanging (e.g. pointer released outside canvas)
    if ((this.gesture && this.gesture.mode !== 'done') || this.pinch) {
      if (this.downPointers().length === 0) {
        if (this.gesture?.mode === 'drag') this.endDrag(true);
        this.gesture?.timer?.remove();
        this.gesture = null; this.pinch = null;
      }
    }
    // Edge auto-pan while dragging a building
    const g = this.gesture;
    if (g?.mode === 'drag' && g.lastScreen) {
      const cam = this.cameras.main, s = g.lastScreen;
      const top = 206, bottom = cam.height - 150;
      let vx = 0, vy = 0;
      if (s.x < EDGE_PAN) vx = -1; else if (s.x > cam.width - EDGE_PAN) vx = 1;
      if (s.y < top + EDGE_PAN && s.y > 0) vy = -1; else if (s.y > bottom - EDGE_PAN) vy = 1;
      if (vx || vy) {
        const sp = (dtMs / 1000) * 520 / cam.zoom;
        cam.scrollX += vx * sp; cam.scrollY += vy * sp; this.clampCamera();
        this.updateDrag();
      }
    }
  }
}

