// Stage 20: Ants-style map labels.
// LevelTag: a small dark rounded level box (thin gold rim) + the name in clean light Source Sans 3 with a soft
// shadow, no pill. Locked = a drawn padlock in a grey box; busy = small crossed swords. BasePlate: a round gold
// level medal over "(TAG)Name". Both are Containers the WorldScene zoom-fits like its old plaques.
import Phaser from 'phaser';
import { FONT } from './fonts.js';

const SHADOW = (t) => t.setShadow(0, 1.5, '#000000', 5, false, true);
const BOX_H = 28;

export class LevelTag extends Phaser.GameObjects.Container {
  constructor(scene, x, y, o = {}) {
    super(scene, x, y);
    scene.add.existing(this);
    this.g = scene.add.graphics();
    this.lvT = SHADOW(scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '21px', fontStyle: '600', color: '#ffffff' }).setOrigin(0.5));
    this.nameT = SHADOW(scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${o.size ?? 22}px`, fontStyle: '600', color: '#f4efe4' }).setOrigin(0, 0.5));
    this.add([this.g, this.lvT, this.nameT]);
    this.setDepth(o.depth ?? 41);
    this.st = { lv: null, name: null, color: null, locked: false, busy: false };
  }
  // the test-facing string mirrors the old plaque text
  get text() { const s = this.st; return `${s.locked ? '🔒 ' : ''}${s.busy ? '⚔ ' : ''}Lv ${s.lv} ${s.name}`; }
  get rawText() { return this.text; }
  set(lv, name, { color = '#f4efe4', locked = false, busy = false } = {}) {
    const s = this.st;
    if (s.lv === lv && s.name === name && s.color === color && s.locked === locked && s.busy === busy) return this;
    Object.assign(s, { lv, name, color, locked, busy });
    this.lvT.setText(String(lv)).setColor(locked ? '#c9cfd8' : '#ffffff');
    this.nameT.setText(name).setColor(color);
    const lockW = locked ? 15 : 0, swordW = busy ? 15 : 0;
    const bw = Math.max(30, this.lvT.width + 12 + lockW + swordW), gap = 7;
    const total = bw + gap + this.nameT.width, x0 = -total / 2;
    const g = this.g.clear();
    g.fillStyle(locked ? 0x2a2e35 : 0x0d0f12, 0.88).fillRoundedRect(x0, -BOX_H / 2, bw, BOX_H, 5);
    g.lineStyle(1, locked ? 0x8d96a3 : 0xc9a45a, 0.6).strokeRoundedRect(x0, -BOX_H / 2, bw, BOX_H, 5);
    let cx = x0 + 6;
    if (locked) { drawLock(g, cx + 5, 0); cx += lockW; }
    if (busy) { drawSwords(g, cx + 5, 0); cx += swordW; }
    this.lvT.setPosition(cx + (x0 + bw - 6 - cx) / 2, 0);
    this.nameT.setPosition(x0 + bw + gap, 0);
    this.setSize(total, BOX_H);
    return this;
  }
  setColor(c) { return this.set(this.st.lv, this.st.name, { ...this.st, color: c }); }
}

// a small padlock: grey body + shackle (drawn, so it never depends on emoji fonts)
export function drawLock(g, x, y) {
  g.lineStyle(2, 0xd5dbe3, 1); g.beginPath(); g.arc(x, y - 2, 3.6, Math.PI, 0); g.strokePath();
  g.lineBetween(x - 3.6, y - 2, x - 3.6, y); g.lineBetween(x + 3.6, y - 2, x + 3.6, y);
  g.fillStyle(0xd5dbe3, 1).fillRoundedRect(x - 5.5, y - 0.5, 11, 8, 1.5);
  g.fillStyle(0x2a2e35, 1).fillRect(x - 0.8, y + 2, 1.6, 3);
}
function drawSwords(g, x, y) {
  g.lineStyle(2, 0xffc86a, 1);
  g.lineBetween(x - 5, y - 6, x + 5, y + 6); g.lineBetween(x + 5, y - 6, x - 5, y + 6);
  g.lineStyle(2, 0xffe9b0, 1); g.lineBetween(x - 6, y + 3, x - 2, y + 7); g.lineBetween(x + 6, y + 3, x + 2, y + 7);
}

export class BasePlate extends Phaser.GameObjects.Container {
  constructor(scene, x, y, o = {}) {
    super(scene, x, y);
    scene.add.existing(this);
    this.medal = scene.add.graphics();
    this.lvT = SHADOW(scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '19px', fontStyle: '700', color: '#ffe9b0' }).setOrigin(0.5));
    this.strip = scene.add.graphics();
    this.tagT = SHADOW(scene.add.text(0, 36, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: '#6fe3ff' }).setOrigin(0, 0.5));
    this.nameT = SHADOW(scene.add.text(0, 36, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '600', color: '#f4efe4' }).setOrigin(0, 0.5));
    this.add([this.strip, this.medal, this.lvT, this.tagT, this.nameT]);
    this.setDepth(o.depth ?? 41);
    const m = this.medal; // round gold medal, dark-teal face, thin teal inner ring
    m.fillStyle(0x000000, 0.35).fillCircle(0, 2, 19);
    m.fillStyle(0xb8862c, 1).fillCircle(0, 0, 18);
    m.fillStyle(0xf3d27a, 1).fillCircle(0, -1, 15.5);
    m.fillStyle(0x1a2a2e, 1).fillCircle(0, 0, 13);
    m.lineStyle(1.5, 0x46d6c8, 0.9).strokeCircle(0, 0, 13);
  }
  get text() { return `${this.tagT.text}${this.nameT.text}`; }
  get rawText() { return this.text; }
  set(lv, tag, name, { mine = false } = {}) {
    this.lvT.setText(String(lv));
    this.tagT.setText(tag ? `(${tag})` : '');
    this.nameT.setText(name).setColor(mine ? '#f3d27a' : '#f4efe4');
    const w = this.tagT.width + this.nameT.width;
    this.tagT.x = -w / 2; this.nameT.x = -w / 2 + this.tagT.width;
    this.strip.clear().fillStyle(0x07090d, 0.45).fillRoundedRect(-w / 2 - 10, 36 - 14, w + 20, 28, 14);
    this.setSize(Math.max(w + 20, 38), 64);
    return this;
  }
}
