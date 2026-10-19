import { audio } from '../../audio/audio.js';
import { PALETTE, RARITY, TROOP_CLASSES, LEADERS, GEAR } from '../../config.js';
import { text, panelBg, hexColor } from '../widgets.js';
import { SKIN, drawFrame, drawCard, diamond, oct, lerpC } from '../skin.js';
export { sectionHeader, statLine, priceTag, badge, tile } from '../kit.js';
import { store } from '../../state/store.js';

export const STAT_NAMES = { hp: 'HP', atk: 'ATK', def: 'DEF' };

// Screen header plaque (stage 9): gold-framed title bar with optional painted building art fading in
// on the right. Same signature as before plus opts.art; returns the right-hand sub Text.
export function header(ui, c, a, title, sub, accent = PALETTE.gold, opts = {}) {
  const x = 12, y = a.y + 6, w = 696, h = 66;
  const g = ui.add.graphics(); c.add(g);
  drawFrame(g, x, y, w, h, { cut: 12, top: 0x1d2430, bot: 0x0a0d12, studs: false });
  if (opts.art && ui.textures.exists(opts.art)) {
    const img = ui.add.image(x + w - 8, y + h / 2, opts.art).setOrigin(1, 0.5);
    const sc = (w * 0.55) / img.width; img.setScale(sc);
    const vis = (h - 10) / sc;
    img.setCrop(0, Math.max(0, img.height * 0.32 - vis / 2), img.width, vis).setAlpha(0.5);
    img.y = y + h / 2 - (Math.max(0, img.height * 0.32 - vis / 2) + vis / 2 - img.height / 2) * sc;
    c.add(img);
    const fade = ui.add.graphics();
    fade.fillGradientStyle(0x0d1117, 0x0d1117, 0x0d1117, 0x0d1117, 1, 0, 1, 0).fillRect(x + w * 0.42, y + 5, w * 0.36, h - 10);
    fade.fillStyle(0x0d1117, 1).fillRect(x + 5, y + 5, w * 0.42 - 5, h - 10);
    c.add(fade);
  }
  const gem = ui.add.graphics(); c.add(gem);
  diamond(gem, x + 26, y + h / 2, 9, accent, lerpC(accent, 0xffffff, 0.55));
  c.add(text(ui, x + 44, y + h / 2, title, 34, '#ffd27f', { fontStyle: 'bold', letterSpacing: 3, stroke: '#2e1e06', strokeThickness: 4 }).setOrigin(0, 0.5));
  const s = text(ui, W_RIGHT, y + h / 2, sub ?? '', 19, '#c9d2de', { stroke: '#05070a', strokeThickness: 4 }).setOrigin(1, 0.5);
  c.add(s);
  return s;
}
const W_RIGHT = 692;

// Segmented tab row (stage 9: metal tabs, the active one a gold-framed plaque). tabs: [{ id, label, sub?, locked? }]
export function tabRow(ui, c, x, y, w, h, tabs, active, onPick) {
  const g = ui.add.graphics();
  c.add(g);
  const tw = w / tabs.length;
  tabs.forEach((t, i) => {
    const on = t.id === active;
    const tx = x + i * tw + 3, ww = tw - 6;
    g.fillStyle(0x000000, 0.4).fillPoints(oct(tx + 1, y + 3, ww, h, 8), true);
    if (on) {
      g.fillStyle(SKIN.goldDk, 1).fillPoints(oct(tx - 1, y - 1, ww + 2, h + 2, 9), true);
      g.fillGradientStyle(SKIN.goldHi, SKIN.goldHi, SKIN.goldMid, SKIN.goldMid, 1, 1, 1, 1).fillPoints(oct(tx, y, ww, h, 8), true);
      g.fillGradientStyle(0x4a3412, 0x4a3412, 0x1c1306, 0x1c1306, 1, 1, 1, 1).fillPoints(oct(tx + 3, y + 3, ww - 6, h - 6, 6), true);
      g.fillStyle(0xffffff, 0.08).fillRect(tx + 8, y + 4, ww - 16, h * 0.3);
    } else {
      g.fillGradientStyle(0x2a313b, 0x2a313b, 0x10141a, 0x10141a, 1, 1, 1, 1).fillPoints(oct(tx, y, ww, h, 8), true);
      g.lineStyle(1.5, SKIN.steel, 0.8).strokePoints(oct(tx, y, ww, h, 8), true);
      g.lineStyle(1, 0xffffff, 0.08).lineBetween(tx + 8, y + 2, tx + ww - 8, y + 2);
    }
    const label = text(ui, tx + ww / 2, y + h / 2 - (t.sub ? 9 : 0), t.label, 24, on ? '#ffe2a6' : (t.locked ? '#5d6878' : PALETTE.text), { fontStyle: 'bold' }).setOrigin(0.5);
    if (on) label.setShadow(0, 2, '#000000', 2, false, true);
    c.add(label);
    if (t.sub) c.add(text(ui, tx + ww / 2, y + h / 2 + 14, t.sub, 15, on ? '#e8c27a' : (t.locked ? '#5d6878' : PALETTE.textDim)).setOrigin(0.5));
    const hit = ui.add.rectangle(tx + ww / 2, y + h / 2, ww, Math.max(h, 80), 0, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => ui.time.delayedCall(0, () => onPick(t.id)));
    hit.tabLabel = t.label;
    c.add(hit);
  });
}

// Row card (stage 9). opts: state ('normal' | 'ready' | 'progress' | 'done' | 'locked' | 'selected'),
// stroke (border colour override), accent (top stub), fill, cut.
export function card(ui, c, x, y, w, h, opts = {}) {
  const g = ui.add.graphics();
  drawCard(g, x, y, w, h, { state: opts.state ?? 'normal', color: opts.stroke ?? null, accent: opts.accent ?? null, cut: opts.cut ?? 10, fill: opts.fill ?? null, glow: opts.glow ?? null });
  c.add(g);
  return g;
}

// Invisible tap target.
export function tapZone(ui, c, x, y, w, h, onTap, name) {
  const hit = ui.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive({ useHandCursor: true });
  let down = false;
  hit.on('pointerdown', () => { down = true; });
  hit.on('pointerout', () => { down = false; });
  hit.on('pointerup', () => { if (down && !ui.scrollDragged) { audio.play(hit.zoneDisabled ? 'error' : 'tap'); ui.time.delayedCall(0, onTap); } down = false; });
  hit.zoneName = name;
  hit.zoneDisabled = false;
  c.add(hit);
  return hit;
}

export function portrait(ui, c, key, x, y, w, frameColor) {
  const img = ui.add.image(x, y, key).setOrigin(0, 0);
  img.setScale(w / img.width);
  const h = img.height * img.scaleY;
  const g0 = ui.add.graphics();
  g0.fillStyle(0x000000, 0.45).fillRect(x + 2, y + 4, w, h);
  c.add(g0);
  c.add(img);
  if (frameColor != null) {
    const g = ui.add.graphics();
    g.lineStyle(3, lerpC(frameColor, 0x000000, 0.5), 1).strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    g.lineStyle(2, frameColor, 1).strokeRect(x, y, w, h);
    g.lineStyle(1, 0xffffff, 0.25).strokeRect(x + 3, y + 3, w - 6, h - 6);
    c.add(g);
  }
  return img;
}

export function rarityHex(r) { return RARITY[r].hex; }
export function classHex(t) { return TROOP_CLASSES[t].colorHex; }

export function fmtBuff(b, mult = 1) {
  if (!b) return '';
  const pct = Math.round(b.pct * mult * 10) / 10;
  const who = b.target === 'all' || !b.target ? 'all troops' : TROOP_CLASSES[b.target].name;
  return `${pct > 0 ? '+' : ''}${pct}% ${who} ${STAT_NAMES[b.stat]}`;
}
// Includes the gear's Shard upgrade level (Lv 1 = base buff).
export function fmtGearBuff(g) { const lv = store.gearLevel(g.id); return `+${store.gearBuffPct(g.id)}% squad ${STAT_NAMES[g.buff.stat]}${lv > 1 ? `  (Lv ${lv})` : ''}`; }

export function itemName(id) { return LEADERS[id]?.name ?? GEAR[id]?.name ?? id; }
export { hexColor };
