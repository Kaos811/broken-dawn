import Phaser from 'phaser';
import { PALETTE, MAP } from '../config.js';
import { makePortraitTextures } from '../art/portraits.js';

// Generates all placeholder art procedurally (no external assets), so the
// single-file build stays self-contained. Swap these keys for real art later.

export const TEX = { W: 240, H: 300, CX: 104, BOTTOM: 290 }; // building texture layout

function shade(color, f) {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const k = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return Phaser.Display.Color.GetColor(k(c.red), k(c.green), k(c.blue));
}

// Draw an iso prism whose ground diamond is centred at (cx, cy).
function prism(g, cx, cy, hw, hh, h, top, opts = {}) {
  const left = opts.left ?? shade(top, 0.62);
  const right = opts.right ?? shade(top, 0.82);
  const T = [cx, cy - hh], R = [cx + hw, cy], B = [cx, cy + hh], L = [cx - hw, cy];
  g.fillStyle(left, 1);
  g.fillPoints([{ x: L[0], y: L[1] }, { x: B[0], y: B[1] }, { x: B[0], y: B[1] - h }, { x: L[0], y: L[1] - h }], true);
  g.fillStyle(right, 1);
  g.fillPoints([{ x: B[0], y: B[1] }, { x: R[0], y: R[1] }, { x: R[0], y: R[1] - h }, { x: B[0], y: B[1] - h }], true);
  g.fillStyle(top, 1);
  g.fillPoints([{ x: T[0], y: T[1] - h }, { x: R[0], y: R[1] - h }, { x: B[0], y: B[1] - h }, { x: L[0], y: L[1] - h }], true);
  // crisp edges
  g.lineStyle(1.5, shade(top, 1.35), 0.9);
  g.strokePoints([{ x: L[0], y: L[1] - h }, { x: T[0], y: T[1] - h }, { x: R[0], y: R[1] - h }], false);
  g.lineStyle(1, 0x000000, 0.35);
  g.lineBetween(B[0], B[1], B[0], B[1] - h);
  return { cx, topY: cy - h, hw, hh, h, cy };
}

// Glowing accent line along the left/right faces of a prism at height fraction k.
function faceStrip(g, p, k, color, side = 'both') {
  const y = (yy) => yy - p.h * k;
  const L = [p.cx - p.hw, y(p.cy)], B = [p.cx, y(p.cy + p.hh)], R = [p.cx + p.hw, y(p.cy)];
  for (const [w, a] of [[7, 0.18], [3, 1]]) {
    g.lineStyle(w, color, a);
    if (side !== 'right') g.lineBetween(L[0] + 6, L[1] + 3, B[0] - 2, B[1] - 1);
    if (side !== 'left') g.lineBetween(B[0] + 2, B[1] - 1, R[0] - 6, R[1] + 3);
  }
}

function glowDot(g, x, y, r, color) {
  g.fillStyle(color, 0.15); g.fillCircle(x, y, r * 3);
  g.fillStyle(color, 0.35); g.fillCircle(x, y, r * 1.8);
  g.fillStyle(color, 1); g.fillCircle(x, y, r);
  g.fillStyle(0xffffff, 0.9); g.fillCircle(x, y, r * 0.45);
}

function groundShadow(g, cx, cy, hw, hh) {
  g.fillStyle(0x000000, 0.38);
  g.fillPoints([{ x: cx + 14, y: cy - hh + 4 }, { x: cx + hw + 26, y: cy + 4 }, { x: cx + 14, y: cy + hh + 10 }, { x: cx - hw + 10, y: cy + 6 }], true);
}

export default class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    this.makeSoftTextures();
    makePortraitTextures(this);
    this.makeBuilding('tex-commandCenter', (g, c) => {
      const base = prism(g, c.x, c.y, 88, 44, 14, PALETTE.metalDark);
      faceStrip(g, base, 0.5, PALETTE.gold);
      const body = prism(g, c.x, c.y - 14, 70, 35, 62, PALETTE.metalLight);
      faceStrip(g, body, 0.35, PALETTE.gold);
      faceStrip(g, body, 0.8, PALETTE.orange, 'left');
      const tier = prism(g, c.x, c.y - 76, 42, 21, 34, PALETTE.metal);
      faceStrip(g, tier, 0.5, PALETTE.gold);
      // window band
      g.fillStyle(PALETTE.gold, 0.85);
      for (let i = 0; i < 4; i++) g.fillRect(c.x + 10 + i * 13, c.y - 14 - 30 - i * 6.5 + 18, 7, 9);
      // antenna + dish
      const ty = tier.topY;
      g.lineStyle(4, PALETTE.metalEdge, 1); g.lineBetween(c.x, ty, c.x, ty - 58);
      g.lineStyle(2, PALETTE.gold, 1); g.lineBetween(c.x - 18, ty - 30, c.x + 18, ty - 38);
      glowDot(g, c.x, ty - 60, 5, PALETTE.gold);
      g.fillStyle(PALETTE.metalEdge, 1); g.fillEllipse(c.x - 24, ty - 6, 26, 12);
    });
    this.makeBuilding('tex-barracks', (g, c) => {
      const base = prism(g, c.x, c.y, 90, 45, 10, PALETTE.metalDark);
      faceStrip(g, base, 0.5, PALETTE.blue);
      const body = prism(g, c.x, c.y - 10, 80, 40, 46, PALETTE.metal);
      faceStrip(g, body, 0.3, PALETTE.blue);
      faceStrip(g, body, 0.72, PALETTE.blue);
      // roof vents
      prism(g, c.x - 26, c.y - 56 + 2, 18, 9, 14, PALETTE.metalLight);
      prism(g, c.x + 22, c.y - 56 + 2, 18, 9, 14, PALETTE.metalLight);
      prism(g, c.x, c.y - 56 + 18, 16, 8, 10, PALETTE.metalLight);
      // door on right face
      g.fillStyle(0x0b0f16, 1);
      g.fillPoints([{ x: c.x + 28, y: c.y + 30 - 10 }, { x: c.x + 52, y: c.y + 18 - 10 }, { x: c.x + 52, y: c.y - 14 - 10 }, { x: c.x + 28, y: c.y - 2 - 10 }], true);
      g.lineStyle(2, PALETTE.blue, 1);
      g.strokePoints([{ x: c.x + 28, y: c.y + 30 - 10 }, { x: c.x + 52, y: c.y + 18 - 10 }, { x: c.x + 52, y: c.y - 14 - 10 }, { x: c.x + 28, y: c.y - 2 - 10 }], true);
      glowDot(g, c.x - 60, c.y - 60, 3.5, PALETTE.blue);
    });
    this.makeBuilding('tex-armory', (g, c) => {
      const base = prism(g, c.x, c.y, 86, 43, 12, PALETTE.metalDark);
      faceStrip(g, base, 0.5, PALETTE.teal);
      const body = prism(g, c.x, c.y - 12, 64, 32, 54, PALETTE.metalLight, { top: PALETTE.metal });
      faceStrip(g, body, 0.25, PALETTE.cyan);
      faceStrip(g, body, 0.75, PALETTE.teal);
      // hex chevrons on left face
      g.lineStyle(3, PALETTE.cyan, 0.9);
      g.strokeTriangle(c.x - 44, c.y - 30, c.x - 30, c.y - 22, c.x - 30, c.y - 40);
      // floating crystal
      const top = body.topY - 20;
      g.fillStyle(PALETTE.cyan, 0.18); g.fillCircle(c.x, top - 22, 34);
      g.fillStyle(PALETTE.teal, 1);
      g.fillPoints([{ x: c.x, y: top - 62 }, { x: c.x + 16, y: top - 24 }, { x: c.x, y: top + 6 }, { x: c.x - 16, y: top - 24 }], true);
      g.fillStyle(PALETTE.cyan, 1);
      g.fillPoints([{ x: c.x, y: top - 62 }, { x: c.x + 16, y: top - 24 }, { x: c.x, y: top - 20 }], true);
      g.fillStyle(0xffffff, 0.8);
      g.fillPoints([{ x: c.x, y: top - 56 }, { x: c.x + 6, y: top - 30 }, { x: c.x, y: top - 28 }], true);
      // pedestal
      g.fillStyle(PALETTE.metalEdge, 1); g.fillEllipse(c.x, body.topY + 2, 44, 20);
      g.fillStyle(PALETTE.cyan, 0.7); g.fillEllipse(c.x, body.topY + 2, 28, 12);
    });
    this.makeBuilding('tex-beacon', (g, c) => {
      const base = prism(g, c.x, c.y, 92, 46, 16, PALETTE.metalDark);
      faceStrip(g, base, 0.5, PALETTE.orange);
      const ring = prism(g, c.x, c.y - 16, 66, 33, 18, PALETTE.metal);
      faceStrip(g, ring, 0.5, PALETTE.gold);
      const p1 = prism(g, c.x, c.y - 34, 30, 15, 70, PALETTE.metalLight);
      faceStrip(g, p1, 0.2, PALETTE.gold); faceStrip(g, p1, 0.55, PALETTE.orange); faceStrip(g, p1, 0.9, PALETTE.gold);
      // claws holding the core
      g.lineStyle(6, PALETTE.metalEdge, 1);
      const ty = p1.topY;
      g.lineBetween(c.x - 26, ty + 6, c.x - 18, ty - 40);
      g.lineBetween(c.x + 26, ty + 6, c.x + 18, ty - 40);
      g.lineBetween(c.x, ty + 14, c.x, ty - 10);
      // core
      glowDot(g, c.x, ty - 44, 16, PALETTE.gold);
      g.fillStyle(PALETTE.orange, 1); g.fillCircle(c.x, ty - 44, 11);
      g.fillStyle(0xfff1c9, 1); g.fillCircle(c.x - 3, ty - 47, 6);
    });

    this.scene.start('Base');
    this.scene.launch('UI');
  }

  makeBuilding(key, drawFn) {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const center = { x: TEX.CX, y: TEX.BOTTOM - MAP.tileH }; // ground diamond centre of a 2x2 footprint
    groundShadow(g, center.x, center.y, MAP.tileW, MAP.tileH);
    drawFn(g, center);
    g.generateTexture(key, TEX.W, TEX.H);
    g.destroy();
  }

  makeSoftTextures() {
    const radial = (key, size, stops) => {
      const tex = this.textures.createCanvas(key, size, size);
      const ctx = tex.getContext();
      const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [o, c] of stops) grd.addColorStop(o, c);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, size, size);
      tex.refresh();
    };
    radial('glow', 256, [[0, 'rgba(255,220,150,1)'], [0.25, 'rgba(255,170,60,0.55)'], [0.6, 'rgba(255,122,26,0.15)'], [1, 'rgba(255,122,26,0)']]);
    radial('glow-cyan', 128, [[0, 'rgba(200,255,255,1)'], [0.3, 'rgba(63,240,255,0.5)'], [1, 'rgba(63,240,255,0)']]);
    radial('spark', 16, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
  }
}
