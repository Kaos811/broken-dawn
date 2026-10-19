import Phaser from 'phaser';
import { MAP, PALETTE, BEACON, BUILDINGS, BUILDING_IDS } from '../config.js';
import { store } from '../state/store.js';
import { isoToWorld, worldToIso, isPlatformTile, footprintAnchor, BEACON_CENTER, GROUND, TILE_RANGE } from '../systems/grid.js';
import { SPRITE, DECO_KEYS } from '../art/baseArt.js';

const LONG_PRESS_MS = 420;
const TAP_SLOP = 10;       // px (screen) before a press becomes a pan/drag
const EDGE_PAN = 80;       // px from screen edge that auto-pans while dragging a building
const HUD_TOP = 186;       // UI top bar height (keep in sync with UIScene TOP_H)
const BAKE = 0.5;          // terrain is baked at half resolution (soft painterly ground, saves GPU memory)
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// ellipse metric around the Beacon: < 1 inside the buildable area
const ell = (x, y) => ((x - BEACON_CENTER.x) / MAP.buildRx) ** 2 + ((y - BEACON_CENTER.y) / MAP.buildRy) ** 2;

export default class BaseScene extends Phaser.Scene {
  constructor() { super('Base'); }

  create() {
    this.input.addPointer(2);
    this.input.setGlobalTopOnly(false); // UI scene blocking is done explicitly via ui.blocksPointer()
    this.cameras.main.setBackgroundColor(0x14110d);
    this.beaconCenter = { ...BEACON_CENTER };

    this.drawGround();
    this.overlay = this.add.graphics().setDepth(2);
    this.gridG = this.add.graphics().setDepth(1.5).setVisible(false);
    this.drawPlacementGrid();
    this.placeDecorations();
    this.createAmbient();
    this.createBeacon();
    this.sprites = {};
    for (const id of BUILDING_IDS) this.createBuilding(id);
    this.syncDecos();

    this.selectedId = null;  // building whose info panel is open
    this.moveId = null;      // building in move (or placement) mode
    this.placeId = null;     // building being placed for the first time (hidden until unlocked)
    this.placeTarget = null;
    this.gesture = null;
    this.pinch = null;

    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(MAP.startZoom, this.minZoom(), MAP.maxZoom));
    cam.centerOn(this.beaconCenter.x, this.beaconCenter.y - 60);
    this.clampCamera();

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
      store.on('upgradeStart', () => this.syncLabels()),
      store.on('upgradeCancel', () => this.syncLabels()),
      store.on('placed', () => this.syncAll()),
      store.on('moved', () => this.syncDecos()),
      store.on('change', () => this.syncLabels()),
    ];
    const ev = this.game.events;
    ev.on('ui:move', (id) => this.enterMoveMode(id), this);
    ev.on('ui:place', (id) => this.enterPlaceMode(id), this);
    ev.on('ui:placeConfirm', () => this.confirmPlace(), this);
    ev.on('ui:moveDone', () => this.exitMoveMode(), this);
    ev.on('ui:panelClosed', () => this.clearSelection(), this);
    ev.on('ui:focusBeacon', () => this.select(BEACON.id), this);
    ev.on('ui:focus', (id) => this.focus(id), this);
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
  }

  ui() { return this.scene.get('UI'); }

  // ------------------------------------------------------------- terrain ---
  // The whole ground (painted soil, compacted base area, flagstone paths, plaza, glowing veins) is
  // baked once into a single half-resolution canvas texture: one draw call, no per-frame cost.
  drawGround() {
    const key = 'ground-baked';
    if (!this.textures.exists(key)) {
      const w = Math.ceil(GROUND.w * BAKE), h = Math.ceil(GROUND.h * BAKE);
      const ct = this.textures.createCanvas(key, w, h);
      const ctx = ct.getContext();
      const rnd = mulberry32(2024);
      const src = this.textures.get('art-ground').getSourceImage();
      const toB = (wx, wy) => ({ x: (wx - GROUND.x) * BAKE, y: (wy - GROUND.y) * BAKE });
      // 1. painted soil: base tiling plus a rotated, larger second layer to break up repetition
      const T = 330;
      for (let y = 0; y < h; y += T) for (let x = 0; x < w; x += T) ctx.drawImage(src, x, y, T, T);
      ctx.globalAlpha = 0.42;
      const T2 = 452;
      for (let y = -T2 / 3; y < h; y += T2) for (let x = -T2 / 2; x < w; x += T2) {
        ctx.save(); ctx.translate(x + T2 / 2, y + T2 / 2); ctx.rotate(((Math.floor(x + y) % 4) * Math.PI) / 2); ctx.drawImage(src, -T2 / 2, -T2 / 2, T2, T2); ctx.restore();
      }
      ctx.globalAlpha = 1;
      const blob = (x, y, r, inner, sx = 1, sy = 1) => {
        ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, inner); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      };
      // 2. large-scale light/dark variation + moss and teal tints
      for (let i = 0; i < 70; i++) blob(rnd() * w, rnd() * h, 80 + rnd() * 200, rnd() < 0.6 ? 'rgba(0,0,0,0.28)' : 'rgba(110,90,60,0.14)', 1, 0.6);
      for (let i = 0; i < 26; i++) blob(rnd() * w, rnd() * h, 50 + rnd() * 110, 'rgba(60,90,40,0.16)', 1, 0.55);
      for (let i = 0; i < 22; i++) blob(rnd() * w, rnd() * h, 30 + rnd() * 80, 'rgba(40,210,200,0.07)', 1, 0.55);
      // 3. compacted, lighter ground over the buildable area
      const c = toB(BEACON_CENTER.x, BEACON_CENTER.y);
      blob(c.x, c.y, MAP.buildRx * BAKE * 1.12, 'rgba(150,125,90,0.22)', 1, MAP.buildRy / MAP.buildRx);
      blob(c.x, c.y, MAP.buildRx * BAKE * 1.25, 'rgba(0,0,0,0)', 1, MAP.buildRy / MAP.buildRx);
      // 4. winding flagstone paths from the plaza out to the edges of the base
      const stones = (pts, width) => {
        // dark path bed first
        ctx.strokeStyle = 'rgba(25,20,15,0.55)'; ctx.lineWidth = width * BAKE * 1.15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach((p, i) => { const b = toB(p.x, p.y); if (i) ctx.lineTo(b.x, b.y); else ctx.moveTo(b.x, b.y); }); ctx.stroke();
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(len / 24);
          const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
          for (let k = 0; k < n; k++) {
            const t = k / n;
            for (let lane = -1; lane <= 1; lane++) {
              if (rnd() < 0.12) continue;
              const off = lane * width * 0.3 + (rnd() - 0.5) * 10;
              const p = toB(a.x + (b.x - a.x) * t + nx * off, a.y + (b.y - a.y) * t + ny * off * 0.6);
              this.flagstone(ctx, p.x, p.y, (9 + rnd() * 6) * BAKE * 2, rnd);
            }
          }
        }
      };
      const C = BEACON_CENTER;
      const curve = (dx, dy, wob) => {
        const pts = [];
        for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push({ x: C.x + dx * t + Math.sin(t * Math.PI * 2) * wob, y: C.y + dy * t + Math.sin(t * Math.PI * 1.5) * wob * 0.4 }); }
        return pts;
      };
      stones(curve(0, -(MAP.buildRy + 260), 70), 92);
      stones(curve(0, MAP.buildRy + 300, -60), 92);
      stones(curve(-(MAP.buildRx + 200), -260, 40), 80);
      stones(curve(MAP.buildRx + 200, -240, -40), 80);
      stones(curve(-(MAP.buildRx + 160), 380, -40), 80);
      stones(curve(MAP.buildRx + 160, 400, 40), 80);
      // 5. flagstone plaza around the Beacon
      for (let ring = 0; ring < 6; ring++) {
        const r = 150 + ring * 34, n = Math.round((Math.PI * 2 * r) / 30);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + ring * 0.3;
          const p = toB(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r * 0.5);
          this.flagstone(ctx, p.x, p.y, (11 + rnd() * 4) * BAKE * 2, rnd, ring === 5 ? 0.75 : 1);
        }
      }
      // 6. glowing veins in the rock (teal cracks)
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) {
        let x = rnd() * w, y = rnd() * h, dir = rnd() * Math.PI * 2;
        ctx.strokeStyle = `rgba(50,220,210,${0.07 + rnd() * 0.08})`; ctx.lineWidth = 1 + rnd() * 1.2;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 9; k++) { dir += (rnd() - 0.5) * 0.9; x += Math.cos(dir) * 14; y += Math.sin(dir) * 7; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      blob(c.x, c.y, 230 * BAKE * 2, 'rgba(255,190,90,0.22)', 1, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      // 7. darken toward the far edges (focus on the base)
      const vg = ctx.createRadialGradient(c.x, c.y, Math.min(w, h) * 0.35, c.x, c.y, Math.max(w, h) * 0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
      ct.refresh();
    }
    this.ground = this.add.image(GROUND.x, GROUND.y, key).setOrigin(0).setScale(1 / BAKE).setDepth(-10);
  }

  flagstone(ctx, x, y, r, rnd, alpha = 1) {
    const n = 5 + Math.floor(rnd() * 3), pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.5; const rr = r * (0.7 + rnd() * 0.35); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.55]); }
    const v = 74 + Math.floor(rnd() * 30);
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
    ctx.strokeStyle = 'rgba(18,14,10,0.75)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,210,0.10)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.15, y - r * 0.15, r * 0.45, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Crystals, alien plants and boulders scattered around the base (never on buildable ground).
  placeDecorations() {
    const rnd = mulberry32(77);
    this.decos = [];
    const pts = [];
    const kinds = [['rock', 0.36], ['plant', 0.34], ['crystal', 0.30]];
    for (let tries = 0; tries < 2600 && pts.length < 150; tries++) {
      const x = GROUND.x + 40 + rnd() * (GROUND.w - 80), y = GROUND.y + 80 + rnd() * (GROUND.h - 80);
      const e = ell(x, y);
      if (e < 1.18) continue;
      // denser near the base edge, sparser far out
      if (rnd() > (e < 1.8 ? 0.95 : 0.45)) continue;
      const minD = e < 1.6 ? 92 : 120;
      if (pts.some((p) => (p.x - x) ** 2 + ((p.y - y) * 1.6) ** 2 < minD * minD)) continue;
      pts.push({ x, y });
    }
    // small details inside the base (pebbles, sprouts, crystal shards): hidden under buildings
    this.innerDecos = [];
    for (let tries = 0; tries < 900 && this.innerDecos.length < 34; tries++) {
      const x = BEACON_CENTER.x + (rnd() - 0.5) * 2 * MAP.buildRx, y = BEACON_CENTER.y + (rnd() - 0.5) * 2 * MAP.buildRy;
      const e = ell(x, y);
      if (e > 0.95 || e < 0.12) continue;
      if (this.innerDecos.some((d) => (d.img.x - x) ** 2 + ((d.img.y - y) * 1.6) ** 2 < 110 * 110)) continue;
      const kind = rnd() < 0.5 ? 'plant' : (rnd() < 0.5 ? 'rock' : 'crystal');
      const s = 0.26 + rnd() * 0.16;
      const img = this.add.image(x, y, DECO_KEYS[kind][Math.floor(rnd() * 4)]).setOrigin(0.5, 0.9).setScale(s * (rnd() < 0.5 ? -1 : 1), s).setDepth(y);
      this.innerDecos.push({ img, iso: worldToIso(x, y) });
    }
    for (const p of pts) {
      let r = rnd(), kind = 'rock';
      for (const [k, w] of kinds) { if (r < w) { kind = k; break; } r -= w; }
      const key = DECO_KEYS[kind][Math.floor(rnd() * 4)];
      const s = (kind === 'rock' ? 0.55 : 0.6) + rnd() * 0.5;
      const img = this.add.image(p.x, p.y, key).setOrigin(0.5, 0.92).setScale(s * (rnd() < 0.5 ? -1 : 1), s).setDepth(p.y);
      if (kind === 'crystal' || (kind === 'plant' && rnd() < 0.5)) {
        const glow = this.add.image(p.x, p.y - 30 * s, 'glow-cyan').setBlendMode(Phaser.BlendModes.ADD).setScale(1.3 * s, 0.8 * s).setAlpha(0.35).setDepth(1);
        if (this.decos.length % 4 === 0) this.tweens.add({ targets: glow, alpha: 0.6, duration: 1600 + rnd() * 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      this.decos.push({ kind, img });
    }
  }

  // Cyan outline of every buildable tile, shown only in move / placement mode (drawn once).
  drawPlacementGrid() {
    const g = this.gridG;
    g.lineStyle(1.5, PALETTE.cyan, 0.28);
    for (let gy = TILE_RANGE.min; gy <= TILE_RANGE.max; gy++) for (let gx = TILE_RANGE.min; gx <= TILE_RANGE.max; gx++) {
      if (!isPlatformTile(gx, gy)) continue;
      g.strokePoints([isoToWorld(gx, gy), isoToWorld(gx + 1, gy), isoToWorld(gx + 1, gy + 1), isoToWorld(gx, gy + 1)], true);
    }
    // soft edge of the buildable area
    g.lineStyle(4, PALETTE.cyan, 0.5).strokeEllipse(BEACON_CENTER.x, BEACON_CENTER.y, MAP.buildRx * 2, MAP.buildRy * 2);
  }

  createAmbient() {
    // drifting embers/spores over the visible ground
    this.add.particles(0, 0, 'spark', {
      x: { min: GROUND.x, max: GROUND.x + GROUND.w }, y: { min: GROUND.y, max: GROUND.y + GROUND.h },
      lifespan: { min: 5000, max: 9000 }, speedY: { min: -16, max: -5 }, speedX: { min: -6, max: 6 },
      scale: { start: 0.5, end: 0 }, alpha: { start: 0.6, end: 0 },
      tint: [PALETTE.gold, PALETTE.cyan, 0x8fffe0], blendMode: 'ADD', frequency: 160, quantity: 1,
    }).setDepth(6000);
  }

  createBeacon() {
    const a = footprintAnchor(BEACON.gx, BEACON.gy, BEACON.footprint);
    const c = this.beaconCenter;
    const sp = SPRITE.beacon;
    this.floorGlow = this.add.image(c.x, c.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(1).setScale(3.2, 1.6).setTint(0xffc870).setAlpha(0.35);
    this.tweens.add({ targets: this.floorGlow, alpha: 0.6, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.beaconSprite = this.add.image(a.x, a.y, 'art-beacon').setOrigin(0.5, sp.oy).setDepth(a.y);
    this.beaconSprite.setScale(sp.w / this.beaconSprite.width);
    const top = a.y - this.beaconSprite.displayHeight * 0.62;
    this.beaconGlow = this.add.image(c.x, top, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(a.y + 1).setScale(1.2).setAlpha(0.55);
    this.tweens.add({ targets: this.beaconGlow, scale: 1.55, alpha: 0.85, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // energy rings: tilted ellipses that slowly pulse, plus orbiting motes (drawn every frame, cheap)
    this.rings = this.add.graphics().setDepth(a.y + 2).setBlendMode(Phaser.BlendModes.ADD);
    this.ringY = top + 20;
    this.shards = [0, 1, 2].map(() => this.add.image(c.x, c.y, 'glow').setTint(0xffd27f).setScale(0.16).setBlendMode(Phaser.BlendModes.ADD).setDepth(a.y + 2));
    this.shardT = 0;
    this.beaconLabel = this.makePlate(true);
    this.beaconSparks = this.add.particles(c.x, top, 'spark', {
      lifespan: 1400, speed: { min: 20, max: 60 }, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [PALETTE.gold, 0xffffff], blendMode: 'ADD', frequency: 140,
    }).setDepth(a.y + 3);
    this.syncBeaconLabel();
  }

  // Name plate with a round level badge, floating under a building.
  makePlate(gold = false) {
    const c = this.add.container(0, 0).setDepth(5000);
    const g = this.add.graphics();
    const lv = this.add.text(0, 0, '1', { fontFamily: FONT, fontSize: '19px', fontStyle: 'bold', color: '#140d04' }).setOrigin(0.5);
    const name = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: gold ? PALETTE.textGold : PALETTE.text, stroke: '#05070a', strokeThickness: 4 }).setOrigin(0, 0.5);
    c.add([g, lv, name]);
    c.plate = { g, lv, name, gold };
    c.setPlate = (title, level, color) => {
      name.setText(title); lv.setText(String(level));
      if (color) name.setColor(color);
      const w = 40 + 8 + name.width, x0 = -w / 2;
      g.clear();
      g.fillStyle(0x05070a, 0.72).fillRoundedRect(x0 + 18, -15, w - 10, 30, 12);
      g.fillStyle(gold ? 0xffd27f : PALETTE.gold, 1).fillCircle(x0 + 18, 0, 19);
      g.lineStyle(3, 0x2a1a06, 1).strokeCircle(x0 + 18, 0, 19);
      g.lineStyle(2, 0xfff0c8, 0.8).strokeCircle(x0 + 18, 0, 15);
      lv.setPosition(x0 + 18, 0);
      name.setPosition(x0 + 46, 0);
    };
    return c;
  }

  createBuilding(id) {
    const sp = SPRITE[id];
    const shadow = this.add.image(0, 0, 'glow').setTint(0x000000).setAlpha(0.55).setDepth(1.2);
    const img = this.add.image(0, 0, `art-${id}`).setOrigin(0.5, sp.oy);
    img.setScale(sp.w / img.width);
    const plate = this.makePlate();
    this.sprites[id] = { img, label: plate.plate.name, plate, shadow };
    const b = store.state.buildings[id];
    this.placeSprite(id, b.gx, b.gy);
    this.syncLabel(id);
  }

  placeSprite(id, gx, gy, lift = 0) {
    const { img, plate, shadow } = this.sprites[id];
    const size = BUILDINGS[id].footprint;
    const a = footprintAnchor(gx, gy, size);
    img.setPosition(a.x, a.y - lift).setDepth(lift ? 4500 : a.y);
    plate.setPosition(a.x, a.y + 4);
    const c = isoToWorld(gx + size / 2, gy + size / 2);
    shadow.setPosition(c.x + 14, c.y + 6).setScale(size * 0.62, size * 0.3);
  }

  // A building is drawn only once it's on the map (or while the player is placing it).
  shown(id) { return store.isPlaced(id) || this.placeId === id; }

  // inner details disappear under buildings (and the Beacon); reappear when a building moves away
  syncDecos() {
    const fps = [{ gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint },
      ...BUILDING_IDS.filter((id) => this.shown(id)).map((id) => ({ ...this.pos(id), size: BUILDINGS[id].footprint }))];
    for (const d of this.innerDecos ?? []) {
      const { gx, gy } = d.iso;
      d.img.setVisible(!fps.some((f) => gx >= f.gx - 0.6 && gx < f.gx + f.size + 0.4 && gy >= f.gy - 0.6 && gy < f.gy + f.size + 0.4));
    }
  }
  syncAll() {
    for (const id of BUILDING_IDS) {
      const b = store.state.buildings[id];
      if (this.placeId === id && this.placeTarget) this.placeSprite(id, this.placeTarget.gx, this.placeTarget.gy);
      else this.placeSprite(id, b.gx, b.gy);
    }
    this.syncLabels();
    this.syncDecos();
  }
  syncLabel(id) {
    const s = this.sprites[id];
    const vis = this.shown(id);
    s.img.setVisible(vis); s.plate.setVisible(vis); s.shadow.setVisible(vis);
    if (!vis) return;
    const busy = id === 'archive' && store.researchJob() ? '  ◆' : '';
    const j = store.constructionJob(id);
    s.plate.setPlate(`${BUILDINGS[id].name}${j ? `  ⬆${j.toLevel}` : ''}${busy}`, store.state.buildings[id].level);
  }
  syncBeaconLabel() {
    const a = footprintAnchor(BEACON.gx, BEACON.gy, BEACON.footprint);
    const j = store.constructionJob(BEACON.id);
    this.beaconLabel.setPosition(a.x, a.y + 4);
    this.beaconLabel.setPlate(`${BEACON.name}${j ? `  ⬆${j.toLevel}` : ''}`, store.state.beacon.level);
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
  // never zoom out past the painted ground
  minZoom() {
    const cam = this.cameras.main;
    return Math.max(MAP.minZoom, cam.width / GROUND.w, cam.height / GROUND.h);
  }
  // Set zoom while keeping world point (wx,wy) under screen point (sx,sy).
  setZoomKeeping(z, wx, wy, sx, sy) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(z, this.minZoom(), MAP.maxZoom));
    const cx = cam.width / 2, cy = cam.height / 2;
    cam.scrollX = wx - cx - (sx - cx) / cam.zoom;
    cam.scrollY = wy - cy - (sy - cy) / cam.zoom;
    this.clampCamera();
  }
  zoomAt(sx, sy, z) { const w = this.screenToWorld(sx, sy); this.setZoomKeeping(z, w.x, w.y, sx, sy); }
  // keep the whole viewport on painted ground (no void at the edges)
  clampCamera() {
    const cam = this.cameras.main;
    const hw = cam.width / 2 / cam.zoom, hh = cam.height / 2 / cam.zoom;
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Phaser.Math.Clamp(v, lo, hi));
    const mx = clamp(cam.scrollX + cam.width / 2, GROUND.x + hw, GROUND.x + GROUND.w - hw);
    const my = clamp(cam.scrollY + cam.height / 2, GROUND.y + hh, GROUND.y + GROUND.h - hh);
    cam.scrollX = mx - cam.width / 2; cam.scrollY = my - cam.height / 2;
  }
  // glide the camera to a building (queue buttons, placement)
  focus(id, ms = 380) {
    const img = id === BEACON.id ? this.beaconSprite : this.sprites[id]?.img;
    if (!img) return;
    const cam = this.cameras.main;
    const hw = cam.width / 2 / cam.zoom, hh = cam.height / 2 / cam.zoom;
    const tx = Phaser.Math.Clamp(img.x, GROUND.x + hw, GROUND.x + GROUND.w - hw);
    const ty = Phaser.Math.Clamp(img.y - img.displayHeight * 0.2 + 120 / cam.zoom, GROUND.y + hh, GROUND.y + GROUND.h - hh);
    if (ms) cam.pan(tx, ty, ms, 'Sine.easeInOut'); else { cam.centerOn(tx, ty); this.clampCamera(); }
  }

  // -------------------------------------------------------- picking ------
  pos(id) {
    if (id === BEACON.id) return { gx: BEACON.gx, gy: BEACON.gy };
    if (id === this.placeId && this.placeTarget) return this.placeTarget;
    return store.state.buildings[id];
  }
  pick(wx, wy) {
    // Prefer footprint hit (exact), then sprite bounds (tall parts), front-most first.
    const iso = worldToIso(wx, wy);
    const all = [...BUILDING_IDS.filter((id) => this.shown(id)).map((id) => ({ id, ...this.pos(id), size: BUILDINGS[id].footprint, img: this.sprites[id].img })),
      { id: BEACON.id, gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint, img: this.beaconSprite }];
    for (const o of all) if (iso.gx >= o.gx && iso.gx < o.gx + o.size && iso.gy >= o.gy && iso.gy < o.gy + o.size) return o.id;
    const hits = all.filter((o) => {
      const r = o.img.getBounds();
      return Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(r.x + r.width * 0.16, r.y + r.height * 0.12, r.width * 0.68, r.height * 0.78), wx, wy);
    }).sort((a, b) => b.img.depth - a.img.depth);
    return hits[0]?.id ?? null;
  }

  downPointers() { return this.input.manager.pointers.filter((p) => p.isDown); }

  // --------------------------------------------------------- input -------
  onDown(p) {
    const downs = this.downPointers();
    if (downs.length >= 2) { this.startPinch(downs); return; }
    if (this.ui()?.blocksPointer(p.x, p.y)) { this.gesture = null; return; }
    this.cameras.main.panEffect.reset();
    const w = this.screenToWorld(p.x, p.y);
    const hit = this.pick(w.x, w.y);
    this.gesture = { id: p.id, sx: p.x, sy: p.y, hit, mode: 'pending', cam0: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY } };
    if (hit && hit === this.moveId) { this.beginDrag(hit, w); return; }
    if (hit && !this.placeId) {
      this.gesture.timer = this.time.delayedCall(LONG_PRESS_MS, () => {
        const g = this.gesture;
        if (!g || g.mode !== 'pending' || g.hit !== hit) return;
        if (hit === BEACON.id) {
          g.mode = 'done';
          this.game.events.emit('toast', 'The Beacon is anchored: it can\'t be moved.');
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
    if (g.mode === 'pending') this.onTap(g.hit, p);
    else if (g.mode === 'drag') this.endDrag(true);
    this.gesture = null;
  }

  onTap(hit, p) {
    if (hit && hit === this.moveId) return;
    if (this.placeId) {
      // placing: a tap on open ground moves the new building there
      const w = this.screenToWorld(p.x, p.y), iso = worldToIso(w.x, w.y), size = BUILDINGS[this.placeId].footprint;
      this.setPlaceTarget(Math.round(iso.gx - size / 2), Math.round(iso.gy - size / 2));
      return;
    }
    if (this.moveId) this.exitMoveMode();
    if (hit) this.select(hit);
    else this.clearSelection(true);
  }

  select(id) {
    if (this.placeId) return;
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
    if (!BUILDINGS[id] || !store.isPlaced(id)) return; // Beacon, unknown and unplaced ids can't be moved
    if (this.placeId) this.exitMoveMode();
    this.moveId = id;
    this.selectedId = null;
    this.game.events.emit('base:deselect');
    this.startPulse(id);
    this.gridG.setVisible(true);
    this.drawOverlay();
    this.game.events.emit('base:moveMode', id);
  }
  startPulse(id) {
    const { img } = this.sprites[id];
    this.tweens.killTweensOf(img);
    img.setAlpha(1);
    this.moveTween = this.tweens.add({ targets: img, alpha: 0.7, duration: 450, yoyo: true, repeat: -1 });
  }
  exitMoveMode() {
    if (!this.moveId) return;
    if (this.gesture?.mode === 'drag') this.endDrag(true);
    const id = this.moveId;
    const { img } = this.sprites[id];
    this.moveTween?.remove(); img.setAlpha(1).clearTint();
    this.moveId = null;
    if (this.placeId) { this.placeId = null; this.placeTarget = null; } // placement postponed: hidden again
    const b = store.state.buildings[id];
    this.placeSprite(id, b.gx, b.gy);
    this.syncLabel(id);
    this.gridG.setVisible(false);
    this.drawOverlay();
    this.game.events.emit('base:moveMode', null);
  }

  // --------------------------------------------- placement (on unlock) -----
  // A newly unlocked building appears at a suggested free spot; the player drags it (or taps the
  // ground) and confirms with Place. Leaving placement keeps it pending (the HUD offers it again).
  enterPlaceMode(id) {
    if (!store.pendingPlacements().includes(id)) return false;
    if (this.moveId) this.exitMoveMode();
    this.clearSelection(true);
    const spot = store.suggestSpot(id);
    if (!spot) { this.game.events.emit('toast', 'No room left: move a building to free some space.'); return false; }
    this.placeId = id; this.moveId = id;
    this.placeTarget = { ...spot, valid: true };
    this.placeSprite(id, spot.gx, spot.gy);
    this.syncLabel(id);
    this.startPulse(id);
    this.gridG.setVisible(true);
    this.drawOverlay();
    this.focus(id, 300);
    this.game.events.emit('base:moveMode', id, { placing: true, valid: true });
    return true;
  }
  setPlaceTarget(gx, gy) {
    if (!this.placeId) return;
    const valid = store.canPlace(this.placeId, gx, gy);
    this.placeTarget = { gx, gy, valid };
    this.placeSprite(this.placeId, gx, gy);
    const { img } = this.sprites[this.placeId];
    if (valid) img.clearTint(); else img.setTint(0xff8080);
    this.drawOverlay();
    this.game.events.emit('base:placeTarget', valid);
  }
  confirmPlace() {
    const id = this.placeId, t = this.placeTarget;
    if (!id || !t) return { ok: false };
    const r = store.placeBuilding(id, t.gx, t.gy);
    if (!r.ok) { this.game.events.emit('toast', r.reason); return r; }
    this.placeId = null; this.placeTarget = null;
    this.moveTween?.remove(); this.sprites[id].img.setAlpha(1).clearTint();
    this.moveId = null;
    this.gridG.setVisible(false);
    this.syncAll();
    this.drawOverlay();
    this.game.events.emit('base:moveMode', null);
    this.builtFx(id);
    return r;
  }
  builtFx(id) {
    const img = this.sprites[id].img;
    this.tweens.add({ targets: img, scaleY: { from: img.scaleY * 0.6, to: img.scaleY }, duration: 380, ease: 'Back.easeOut' });
    const sp = this.add.particles(img.x, img.y - 40, 'spark', { speed: { min: 60, max: 220 }, lifespan: 700, scale: { start: 1, end: 0 }, tint: [PALETTE.cyan, PALETTE.gold, 0xffffff], blendMode: 'ADD', emitting: false }).setDepth(7000);
    sp.explode(50);
    this.time.delayedCall(800, () => sp.destroy());
    this.cameras.main.shake(120, 0.002);
    this.fxCount = (this.fxCount ?? 0) + 1;
  }

  beginDrag(id, w) {
    const g = this.gesture;
    if (!g) return;
    g.timer?.remove();
    const b = this.pos(id);
    const iso = worldToIso(w.x, w.y);
    g.mode = 'drag';
    g.grab = { x: iso.gx - b.gx, y: iso.gy - b.gy };
    g.target = { gx: b.gx, gy: b.gy, valid: this.placeId ? !!this.placeTarget?.valid : true };
    g.lastScreen = { x: g.sx, y: g.sy };
    this.placeSprite(id, b.gx, b.gy, 12); // lift
  }
  updateDrag() {
    const g = this.gesture, id = this.moveId;
    if (!g || g.mode !== 'drag' || !id) return;
    const w = this.screenToWorld(g.lastScreen.x, g.lastScreen.y);
    const iso = worldToIso(w.x, w.y);
    const size = BUILDINGS[id].footprint;
    const gx = Phaser.Math.Clamp(Math.round(iso.gx - g.grab.x), TILE_RANGE.min, TILE_RANGE.max - size);
    const gy = Phaser.Math.Clamp(Math.round(iso.gy - g.grab.y), TILE_RANGE.min, TILE_RANGE.max - size);
    const valid = store.canPlace(id, gx, gy);
    if (gx !== g.target.gx || gy !== g.target.gy || valid !== g.target.valid) {
      g.target = { gx, gy, valid };
      this.placeSprite(id, gx, gy, 12);
      const { img } = this.sprites[id];
      if (valid) img.clearTint(); else img.setTint(0xff8080);
      this.drawOverlay();
    }
  }
  endDrag(commit) {
    const g = this.gesture, id = this.moveId;
    if (!g || g.mode !== 'drag' || !id) return;
    g.mode = 'done';
    if (this.placeId === id) {
      // placement: the dragged spot becomes the proposal; Place confirms it
      this.setPlaceTarget(g.target.gx, g.target.gy);
      g.target = null;
      return;
    }
    const b = store.state.buildings[id];
    if (commit && g.target.valid) {
      store.moveBuilding(id, g.target.gx, g.target.gy);
    } else if (commit) {
      this.game.events.emit('toast', 'Can\'t place there: needs open ground inside the base.');
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
      fp(BEACON.gx, BEACON.gy, BEACON.footprint, PALETTE.invalid, 0.12, 2);
      for (const f of store.othersFootprints(this.moveId)) fp(f.gx, f.gy, f.size, PALETTE.invalid, 0.12, 2);
      const t = this.gesture?.target ?? (this.placeId ? this.placeTarget : null);
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
    const s0x = img.scaleX, s0y = img.scaleY;
    img.setTintFill(0xffffff);
    this.time.delayedCall(90, () => img.clearTint());
    this.tweens.add({ targets: img, scaleX: s0x * 1.08, scaleY: s0y * 1.08, duration: 110, yoyo: true, onComplete: () => img.setScale(s0x, s0y) });
    const txt = this.add.text(img.x, img.y - img.displayHeight * 0.9, `+${after - before} POWER`, {
      fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.textGold, stroke: '#000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(7000);
    this.tweens.add({ targets: txt, y: txt.y - 80, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => txt.destroy() });
    const sp = this.add.particles(img.x, img.y - 80, 'spark', { speed: { min: 80, max: 260 }, lifespan: 800, scale: { start: 1.2, end: 0 }, tint: [PALETTE.gold, PALETTE.cyan, 0xffffff], blendMode: 'ADD', emitting: false }).setDepth(7000);
    sp.explode(60);
    // level-up burst: expanding shockwave ring on the ground + a rising light column
    const ring = this.add.graphics().setDepth(img.depth - 1).setPosition(img.x, img.y - 20);
    ring.lineStyle(6, PALETTE.gold, 1).strokeEllipse(0, 0, 120, 60);
    this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    const col = this.add.image(img.x, img.y - 120, 'glow').setBlendMode('ADD').setTint(PALETTE.gold).setScale(1.2, 3.5).setAlpha(0.85).setDepth(6999);
    this.tweens.add({ targets: col, scaleX: 0.2, alpha: 0, y: col.y - 120, duration: 700, ease: 'Quad.easeIn', onComplete: () => col.destroy() });
    this.cameras.main.shake(140, 0.0025);
    this.fxCount = (this.fxCount ?? 0) + 1;
    this.time.delayedCall(900, () => sp.destroy());
    this.syncLabels();
  }

  // Construction progress bar + countdown floating over each building that's upgrading.
  drawConstruction(dtMs = 16) {
    if (!this.buildFx) {
      this.buildFx = this.add.graphics().setDepth(5600);
      this.buildTexts = {};
      this.scaffolds = {};
      this.weld = this.add.particles(0, 0, 'spark', { speed: { min: 40, max: 150 }, lifespan: 420, gravityY: 380, scale: { start: 0.7, end: 0 }, tint: [0xffffff, PALETTE.gold, 0xffe08a], blendMode: 'ADD', emitting: false }).setDepth(5599);
      this.weldT = 0;
    }
    const g = this.buildFx; g.clear();
    const live = new Set();
    this.weldT += dtMs;
    const weldNow = this.weldT > 260;
    if (weldNow) this.weldT = 0;
    for (const j of store.state.construction) {
      const img = j.id === BEACON.id ? this.beaconSprite : this.sprites[j.id]?.img;
      if (!img || !img.visible) continue;
      live.add(j.id);
      // scaffolding: poles, planks and braces drawn just in front of the building, plus welding sparks
      let sc = this.scaffolds[j.id];
      if (!sc) sc = this.scaffolds[j.id] = this.add.graphics();
      sc.setDepth(img.depth + 0.5).setVisible(true).clear();
      const sw = img.displayWidth * 0.62, sh = img.displayHeight * 0.62, bx = img.x, by = img.y - img.displayHeight * 0.08;
      const xs = [-sw / 2, -sw / 6, sw / 6, sw / 2].map((d) => bx + d);
      sc.lineStyle(4, 0x9a7a4a, 0.95);
      for (const x of xs) sc.lineBetween(x, by, x, by - sh);
      const planks = 4;
      for (let k = 1; k <= planks; k++) {
        const y = by - (sh * k) / planks;
        sc.fillStyle(0x1a1f27, 0.95).fillRect(xs[0] - 6, y - 5, sw + 12, 10);
        for (let x = xs[0] - 6, n = 0; x < xs[3] + 6; x += 16, n++) sc.fillStyle(n % 2 ? 0x141414 : PALETTE.gold, 0.95).fillRect(x, y - 4, Math.min(8, xs[3] + 6 - x), 8);
        sc.lineStyle(2.5, 0x9a7a4a, 0.8);
        for (let p = 0; p < 3; p++) { const a = (k + p) % 2; sc.lineBetween(xs[p], y + (a ? 0 : sh / planks), xs[p + 1], y + (a ? sh / planks : 0)); }
      }
      const blink = Math.sin(this.time.now / 160) > 0;
      sc.fillStyle(blink ? 0xff4d5e : 0x5a1a20, 1).fillCircle(xs[3], by - sh - 8, 6);
      if (weldNow) this.weld.explode(5, bx + (Math.random() - 0.5) * sw, by - Math.random() * sh);
      const w = 180, h = 18, x = img.x - w / 2, y = img.y - img.displayHeight * 0.92;
      const pct = Math.min(1, j.progress / j.total);
      g.fillStyle(0x05070a, 0.92).fillRect(x - 4, y - 4, w + 8, h + 8);
      g.fillStyle(0x1a1f27, 1).fillRect(x, y, w, h);
      g.fillStyle(PALETTE.gold, 1).fillRect(x, y, w * pct, h);
      g.fillStyle(0xffffff, 0.25 + 0.2 * Math.sin(this.time.now / 180)).fillRect(x, y, w * pct, h / 3);
      g.lineStyle(2, PALETTE.gold, 1).strokeRect(x - 4, y - 4, w + 8, h + 8);
      let t = this.buildTexts[j.id];
      if (!t) {
        t = this.buildTexts[j.id] = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: PALETTE.textGold, stroke: '#05070a', strokeThickness: 6 }).setOrigin(0.5, 1).setDepth(5601);
      }
      const left = Math.max(0, Math.ceil(j.total - j.progress));
      const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
      t.setText(`⬆ Lv ${j.toLevel}  ${hh ? `${hh}:${String(mm).padStart(2, '0')}` : mm}:${String(ss).padStart(2, '0')}`).setPosition(img.x, y - 8).setVisible(true);
    }
    for (const [id, t] of Object.entries(this.buildTexts)) if (!live.has(id)) t.setVisible(false);
    for (const [id, sc] of Object.entries(this.scaffolds)) if (!live.has(id) && sc.visible) sc.setVisible(false).clear();
  }

  update(_t, dtMs) {
    this.drawConstruction(dtMs);
    // Beacon energy rings + orbiting motes
    this.shardT += dtMs / 1000;
    const c = this.beaconCenter, ry = this.ringY;
    const r = this.rings; r.clear();
    for (let k = 0; k < 2; k++) {
      const ph = this.shardT * (0.8 + k * 0.35) + k * 1.7;
      const rw = 130 + k * 40 + Math.sin(ph) * 6, rh = 34 + k * 10 + Math.cos(ph) * 4;
      r.lineStyle(3, 0xffc860, 0.28 + 0.18 * Math.sin(ph * 1.3)).strokeEllipse(c.x, ry + k * 34, rw * 2, rh * 2);
    }
    this.shards.forEach((s, i) => {
      const a = this.shardT * 0.9 + (i * Math.PI * 2) / 3;
      s.setPosition(c.x + Math.cos(a) * 150, ry + 14 + Math.sin(a) * 40);
      s.setDepth(this.beaconSprite.depth + (Math.sin(a) > 0 ? 2 : -1));
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
      const top = HUD_TOP + 20, bottom = cam.height - 150;
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
