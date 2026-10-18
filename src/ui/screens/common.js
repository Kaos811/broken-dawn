import { PALETTE, RARITY, TROOP_CLASSES, LEADERS, GEAR } from '../../config.js';
import { text, panelBg, hexColor } from '../widgets.js';

export const STAT_NAMES = { hp: 'HP', atk: 'ATK', def: 'DEF' };

export function header(ui, c, a, title, sub, accent = PALETTE.gold) {
  const g = ui.add.graphics();
  g.fillStyle(accent, 1).fillRect(24, a.y + 26, 6, 40);
  c.add(g);
  c.add(text(ui, 42, a.y + 20, title, 34, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  const s = text(ui, W_RIGHT, a.y + 30, sub ?? '', 20, PALETTE.textDim).setOrigin(1, 0);
  c.add(s);
  return s;
}
const W_RIGHT = 696;

// Segmented tab row. tabs: [{ id, label, locked? }]
export function tabRow(ui, c, x, y, w, h, tabs, active, onPick) {
  const g = ui.add.graphics();
  c.add(g);
  const tw = w / tabs.length;
  tabs.forEach((t, i) => {
    const on = t.id === active;
    const tx = x + i * tw;
    g.fillStyle(on ? 0x2a2216 : 0x141922, 1).fillRect(tx + 3, y, tw - 6, h);
    g.lineStyle(2, on ? PALETTE.gold : PALETTE.metalEdge, on ? 1 : 0.6).strokeRect(tx + 3, y, tw - 6, h);
    if (on) g.fillStyle(PALETTE.gold, 1).fillRect(tx + 3, y + h - 4, tw - 6, 4);
    const label = text(ui, tx + tw / 2, y + h / 2 - (t.sub ? 9 : 0), t.label, 24, on ? PALETTE.textGold : (t.locked ? '#5d6878' : PALETTE.text), { fontStyle: 'bold' }).setOrigin(0.5);
    c.add(label);
    if (t.sub) c.add(text(ui, tx + tw / 2, y + h / 2 + 14, t.sub, 15, t.locked ? '#5d6878' : PALETTE.textDim).setOrigin(0.5));
    const hit = ui.add.rectangle(tx + tw / 2, y + h / 2, tw, h, 0, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => ui.time.delayedCall(0, () => onPick(t.id)));
    hit.tabLabel = t.label;
    c.add(hit);
  });
}

export function card(ui, c, x, y, w, h, opts = {}) {
  const g = ui.add.graphics();
  panelBg(g, x, y, w, h, { fill: opts.fill ?? 0x12171f, accent: opts.accent ?? null, stroke: opts.stroke ?? PALETTE.metalEdge, cut: opts.cut ?? 12 });
  c.add(g);
  return g;
}

// Invisible tap target.
export function tapZone(ui, c, x, y, w, h, onTap, name) {
  const hit = ui.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive({ useHandCursor: true });
  let down = false;
  hit.on('pointerdown', () => { down = true; });
  hit.on('pointerout', () => { down = false; });
  hit.on('pointerup', () => { if (down) ui.time.delayedCall(0, onTap); down = false; });
  hit.zoneName = name;
  c.add(hit);
  return hit;
}

export function portrait(ui, c, key, x, y, w, frameColor) {
  const img = ui.add.image(x, y, key).setOrigin(0, 0);
  img.setScale(w / img.width);
  c.add(img);
  if (frameColor != null) {
    const g = ui.add.graphics();
    g.lineStyle(3, frameColor, 1).strokeRect(x, y, w, img.height * img.scaleY);
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
export function fmtGearBuff(g) { return `+${g.buff.pct}% squad ${STAT_NAMES[g.buff.stat]}`; }

export function itemName(id) { return LEADERS[id]?.name ?? GEAR[id]?.name ?? id; }
export { hexColor };
