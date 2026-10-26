// Stage 9 painted UI skin: pure Graphics helpers shared by every screen (no Text, no store).
// Gold-and-teal look of the stage 7/8 HUD: ornate gold frames, gradient bodies, glossy buttons,
// state-coloured row cards, glossy progress bars, red count badges and small vector glyphs.
import { PALETTE } from '../config.js';

export const SKIN = {
  gold: 0xffb347, goldHi: 0xffe2a6, goldMid: 0xd9922e, goldDk: 0x6b4a16, goldDeep: 0x2e1e06,
  teal: 0x1fb5b0, tealHi: 0x8ff8f2, tealDk: 0x0a4a4e, cyan: 0x3ff0ff,
  steel: 0x56606f, steelHi: 0x9aa6b6, steelDk: 0x1a1f27,
  green: 0x4dff9a, red: 0xff4d5e, badge: 0xe0263c, badgeRim: 0xffd0d6,
  bodyTop: 0x18202a, bodyBot: 0x0a0d12, rowTop: 0x1b232e, rowBot: 0x0d1117,
};

// Octagon-ish chamfered rectangle (all four corners cut).
export function oct(x, y, w, h, cut) {
  const c = Math.max(0, Math.min(cut, w / 2, h / 2));
  return [
    { x: x + c, y }, { x: x + w - c, y }, { x: x + w, y: y + c }, { x: x + w, y: y + h - c },
    { x: x + w - c, y: y + h }, { x: x + c, y: y + h }, { x, y: y + h - c }, { x, y: y + c },
  ];
}

const lerpC = (a, b, t) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
export { lerpC };

// Ornate gold frame (overlays, sheets, panels). rim: 'gold' or a colour for a tinted metal rim.
export function drawFrame(g, x, y, w, h, { cut = 16, top = SKIN.bodyTop, bot = SKIN.bodyBot, alpha = 0.97, rim = 'gold', shadow = true, studs = true } = {}) {
  if (shadow) g.fillStyle(0x000000, 0.45).fillPoints(oct(x + 4, y + 8, w, h, cut), true);
  g.fillStyle(0x020305, 1).fillPoints(oct(x - 3, y - 3, w + 6, h + 6, cut + 1), true);
  if (rim === 'gold') {
    g.fillStyle(SKIN.goldDk, 1).fillPoints(oct(x - 1, y - 1, w + 2, h + 2, cut), true);
    g.fillGradientStyle(SKIN.goldHi, SKIN.goldHi, SKIN.goldMid, SKIN.goldMid, 1, 1, 1, 1).fillPoints(oct(x, y, w, h, cut), true);
    g.fillStyle(SKIN.goldDeep, 1).fillPoints(oct(x + 3, y + 3, w - 6, h - 6, cut - 1), true);
  } else {
    g.fillStyle(lerpC(rim, 0x000000, 0.55), 1).fillPoints(oct(x - 1, y - 1, w + 2, h + 2, cut), true);
    g.fillStyle(rim, 1).fillPoints(oct(x, y, w, h, cut), true);
    g.fillStyle(0x05070a, 1).fillPoints(oct(x + 2.5, y + 2.5, w - 5, h - 5, cut - 1), true);
  }
  g.fillGradientStyle(top, top, bot, bot, alpha, alpha, alpha, alpha).fillPoints(oct(x + 5, y + 5, w - 10, h - 10, cut - 2), true);
  g.fillStyle(0xffffff, 0.035).fillRect(x + cut, y + 6, w - cut * 2, Math.min(60, h * 0.25));
  g.lineStyle(1, rim === 'gold' ? SKIN.goldHi : rim, 0.22).strokePoints(oct(x + 9, y + 9, w - 18, h - 18, cut - 4), true);
  if (studs && rim === 'gold' && w > 120) {
    for (const [sx, sy] of [[x + w / 2, y], [x + w / 2, y + h]]) diamond(g, sx, sy, 9, SKIN.gold, SKIN.goldHi);
    for (const [sx, sy] of [[x + cut / 2, y + cut / 2], [x + w - cut / 2, y + cut / 2], [x + cut / 2, y + h - cut / 2], [x + w - cut / 2, y + h - cut / 2]]) {
      g.fillStyle(SKIN.goldDeep, 1).fillCircle(sx, sy, 4.5);
      g.fillStyle(SKIN.goldHi, 1).fillCircle(sx, sy, 2.5);
    }
  }
}

export function diamond(g, x, y, r, fill = SKIN.gold, hi = SKIN.goldHi) {
  g.fillStyle(0x000000, 0.5).fillPoints([{ x, y: y - r - 1 }, { x: x + r + 1, y }, { x, y: y + r + 1 }, { x: x - r - 1, y }], true);
  g.fillStyle(fill, 1).fillPoints([{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }], true);
  g.fillStyle(hi, 0.9).fillPoints([{ x, y: y - r }, { x: x + r, y }, { x, y: y - r * 0.15 }, { x: x - r, y }], true);
}

// Row card with a state: 'ready' (gold glow), 'progress' (teal), 'done' (dim), 'locked' (dark),
// 'normal' (steel) or 'selected' (bright gold). color overrides the border; accent adds a top stub.
export function drawCard(g, x, y, w, h, { state = 'normal', color = null, accent = null, cut = 10, fill = null, glow = null } = {}) {
  const locked = state === 'locked', done = state === 'done';
  const border = color ?? { ready: SKIN.gold, selected: SKIN.gold, progress: SKIN.teal, done: 0x2e3540, locked: 0x262c35, normal: SKIN.steel }[state] ?? SKIN.steel;
  const top = fill ?? (locked ? 0x11151b : done ? 0x141920 : SKIN.rowTop), bot = locked ? 0x07090c : SKIN.rowBot;
  if (state === 'ready' || state === 'selected' || glow) g.lineStyle(6, glow ?? SKIN.gold, 0.16).strokePoints(oct(x - 2, y - 2, w + 4, h + 4, cut + 1), true);
  g.fillStyle(0x000000, 0.35).fillPoints(oct(x + 2, y + 4, w, h, cut), true);
  g.fillGradientStyle(top, top, bot, bot, 0.97, 0.97, 0.97, 0.97).fillPoints(oct(x, y, w, h, cut), true);
  g.fillStyle(0xffffff, locked ? 0.015 : 0.04).fillRect(x + cut, y + 2, w - cut * 2, Math.min(h * 0.38, 40));
  g.lineStyle(state === 'selected' ? 3 : 2, border, locked || done ? 0.7 : 0.95).strokePoints(oct(x, y, w, h, cut), true);
  g.lineStyle(1, 0xffffff, locked ? 0.03 : 0.07).lineBetween(x + cut, y + 3, x + w - cut, y + 3);
  if (accent != null) {
    g.fillStyle(accent, 1).fillPoints([{ x: x + cut, y }, { x: x + Math.min(w * 0.3, 120), y }, { x: x + Math.min(w * 0.3, 120) - 4, y: y + 4 }, { x: x + cut + 3, y: y + 4 }], true);
  }
}

// Glossy progress bar: dark trough, gradient fill, gloss line. color2 = optional secondary marker.
export function drawBar(g, x, y, w, h, frac, { color = SKIN.teal, trough = 0x05070a, rim = 0x2e3540 } = {}) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const r = Math.min(h / 2, 6);
  g.fillStyle(trough, 1).fillRoundedRect(x, y, w, h, r);
  g.fillStyle(0x000000, 0.5).fillRect(x + 2, y + 1, w - 4, Math.max(1, h * 0.25));
  if (f > 0) {
    const fw = Math.max(h, (w - 2) * f);
    const hi = lerpC(color, 0xffffff, 0.45), lo = lerpC(color, 0x000000, 0.3);
    g.fillGradientStyle(hi, hi, lo, lo, 1, 1, 1, 1).fillRoundedRect(x + 1, y + 1, fw, h - 2, Math.max(1, r - 1));
    g.fillStyle(0xffffff, 0.28).fillRect(x + 1 + r, y + 2, Math.max(0, fw - r * 2), Math.max(1, h * 0.22));
    if (f < 1) g.fillStyle(0xffffff, 0.75).fillRect(x + fw - 1, y + 1, 2, h - 2);
  }
  g.lineStyle(1.5, rim, 1).strokeRoundedRect(x, y, w, h, r);
}

export function drawBadge(g, x, y, r = 14) {
  g.fillStyle(0x000000, 0.45).fillCircle(x + 1, y + 2, r + 1);
  g.fillStyle(SKIN.badge, 1).fillCircle(x, y, r);
  g.fillStyle(0xffffff, 0.25).fillEllipse(x, y - r * 0.4, r * 1.2, r * 0.6);
  g.lineStyle(2, SKIN.badgeRim, 0.95).strokeCircle(x, y, r);
}

// Small vector glyphs for stat rows (s = half size).
// Stage 15: painted icons (src/art/ui/ic-*.webp) replace the drawn glyphs when the texture is loaded.
const GLYPH_ART = { clock: 'ic-clock', speed: 'ic-clock', beds: 'ic-beds', heal: 'ic-beds', squad: 'ic-squad', troops: 'ic-squad', def: 'ic-def', shield: 'ic-def', atk: 'ic-atk', sword: 'ic-atk', hp: 'ic-hp', lock: 'ic-lock', star: 'ic-star' };
const GLYPH_SCALE = { atk: 2.5, sword: 2.5, lock: 2.4, star: 2.3 };
export function paintedGlyph(g, kind, x, y, s, color) {
  let key = GLYPH_ART[kind];
  if (kind === 'star' && color !== SKIN.gold && color !== 0x3fd9d2) key = 'ic-star-empty';
  const scene = g.scene;
  if (!key || !scene?.textures?.exists(key)) return false;
  const img = scene.add.image(x + (g.x || 0), y + (g.y || 0), key);
  img.setDisplaySize(s * (GLYPH_SCALE[kind] ?? 2.3), s * (GLYPH_SCALE[kind] ?? 2.3));
  if (kind === 'lock' && color !== undefined && color !== SKIN.gold) img.setTint(0xe6e9ef);
  const attach = () => {
    if (!img.scene || !g.scene) return;
    const c = g.parentContainer;
    if (c) { if (img.parentContainer !== c) { scene.children.remove(img); c.addAt(img, c.getIndex(g) + 1); } }
    else img.setDepth(g.depth).setScrollFactor(g.scrollFactorX, g.scrollFactorY);
    img.setVisible(true);
  };
  if (g.parentContainer) attach(); else { img.setVisible(false); scene.events.once('postupdate', attach); }
  g.once('destroy', () => img.destroy());
  (g.paintedIcons ??= []).push(img);
  return true;
}
export function glyph(g, kind, x, y, s = 14, color = SKIN.gold) {
  if (paintedGlyph(g, kind, x, y, s, color)) return;
  const hi = lerpC(color, 0xffffff, 0.5);
  g.lineStyle(Math.max(2, s * 0.2), color, 1);
  switch (kind) {
    case 'clock': g.fillStyle(0x0b0e13, 1).fillCircle(x, y, s); g.strokeCircle(x, y, s); g.lineBetween(x, y, x, y - s * 0.6); g.lineBetween(x, y, x + s * 0.5, y + s * 0.2); break;
    case 'speed': for (const d of [-0.45, 0.25]) g.strokePoints([{ x: x + s * d - s * 0.3, y: y - s * 0.7 }, { x: x + s * d + s * 0.35, y }, { x: x + s * d - s * 0.3, y: y + s * 0.7 }], false); break;
    case 'lanes': for (const d of [-0.6, 0, 0.6]) { g.fillStyle(color, 1).fillRect(x - s, y + d * s - s * 0.13, s * 2, s * 0.26); } break;
    case 'cap': g.fillStyle(color, 1).fillPoints([{ x: x - s, y: y + s * 0.5 }, { x: x - s * 0.8, y: y - s * 0.6 }, { x: x - s * 0.3, y: y - s * 0.05 }, { x, y: y - s * 0.8 }, { x: x + s * 0.3, y: y - s * 0.05 }, { x: x + s * 0.8, y: y - s * 0.6 }, { x: x + s, y: y + s * 0.5 }], true); g.fillStyle(hi, 1).fillRect(x - s, y + s * 0.55, s * 2, s * 0.3); break;
    case 'heal': case 'beds': g.fillStyle(color, 1).fillRect(x - s * 0.3, y - s, s * 0.6, s * 2).fillRect(x - s, y - s * 0.3, s * 2, s * 0.6); g.fillStyle(0xffffff, 0.35).fillRect(x - s * 0.3, y - s, s * 0.6, s * 0.4); break;
    case 'squad': for (const d of [-0.5, 0.15]) g.strokePoints([{ x: x - s, y: y + s * d + s * 0.35 }, { x, y: y + s * d - s * 0.35 }, { x: x + s, y: y + s * d + s * 0.35 }], false); break;
    case 'research': g.strokeEllipse(x, y, s * 2.2, s * 0.9); g.strokeCircle(x, y, s * 0.8); g.fillStyle(hi, 1).fillCircle(x, y, s * 0.3); break;
    case 'bolt': case 'charge': g.fillStyle(color, 1).fillPoints([{ x: x + s * 0.2, y: y - s }, { x: x - s * 0.6, y: y + s * 0.15 }, { x: x - s * 0.05, y: y + s * 0.15 }, { x: x - s * 0.25, y: y + s }, { x: x + s * 0.6, y: y - s * 0.2 }, { x: x + s * 0.05, y: y - s * 0.2 }], true); break;
    case 'anchor': g.strokeCircle(x, y - s * 0.6, s * 0.3); g.lineBetween(x, y - s * 0.3, x, y + s); g.beginPath(); g.arc(x, y + s * 0.2, s * 0.8, 0.15 * Math.PI, 0.85 * Math.PI); g.strokePath(); break;
    case 'shield': case 'def': g.fillStyle(color, 1).fillPoints([{ x: x - s * 0.8, y: y - s * 0.8 }, { x: x + s * 0.8, y: y - s * 0.8 }, { x: x + s * 0.8, y: y }, { x, y: y + s }, { x: x - s * 0.8, y }], true); g.fillStyle(0xffffff, 0.3).fillPoints([{ x: x - s * 0.8, y: y - s * 0.8 }, { x, y: y - s * 0.8 }, { x, y: y + s }, { x: x - s * 0.8, y }], true); break;
    case 'sword': case 'atk': g.lineStyle(Math.max(2, s * 0.22), color, 1).lineBetween(x - s * 0.7, y + s * 0.7, x + s * 0.8, y - s * 0.8); g.lineBetween(x - s * 0.75, y + s * 0.15, x - s * 0.15, y + s * 0.75); g.fillStyle(hi, 1).fillCircle(x - s * 0.8, y + s * 0.8, s * 0.2); break;
    case 'hp': g.fillStyle(color, 1).fillCircle(x - s * 0.42, y - s * 0.25, s * 0.5).fillCircle(x + s * 0.42, y - s * 0.25, s * 0.5).fillTriangle(x - s * 0.9, y - s * 0.05, x + s * 0.9, y - s * 0.05, x, y + s * 0.9); break;
    case 'lock': g.fillStyle(color, 1).fillRoundedRect(x - s * 0.75, y - s * 0.1, s * 1.5, s * 1.1, s * 0.2); g.beginPath(); g.arc(x, y - s * 0.15, s * 0.5, Math.PI, 0); g.strokePath(); break;
    case 'move': for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) g.fillStyle(color, 1).fillTriangle(x + dx * s, y + dy * s, x + dx * s * 0.45 - dy * s * 0.35, y + dy * s * 0.45 + dx * s * 0.35, x + dx * s * 0.45 + dy * s * 0.35, y + dy * s * 0.45 - dx * s * 0.35); g.lineBetween(x - s * 0.5, y, x + s * 0.5, y); g.lineBetween(x, y - s * 0.5, x, y + s * 0.5); break;
    case 'star': { const pts = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? s * 0.45 : s; const a = -Math.PI / 2 + (k * Math.PI) / 5; pts.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) }); } g.fillStyle(color, 1).fillPoints(pts, true); break; }
    case 'up': g.fillStyle(0x0b2a17, 1).fillCircle(x, y, s); g.fillStyle(SKIN.green, 1).fillTriangle(x, y - s * 0.65, x + s * 0.6, y + s * 0.05, x - s * 0.6, y + s * 0.05).fillRect(x - s * 0.25, y, s * 0.5, s * 0.6); break;
    case 'troops': g.fillStyle(color, 1).fillCircle(x, y - s * 0.45, s * 0.38).fillRoundedRect(x - s * 0.7, y, s * 1.4, s * 0.9, s * 0.3); break;
    default: diamond(g, x, y, s * 0.7, color, hi);
  }
}

// Glossy button skins, baked per style + size by widgets.button.
export const BUTTON_STYLES = {
  gold: { top: 0xffe08a, mid: 0xffb347, bot: 0xc9761a, rim: 0x5a3a0c, edge: 0xfff0c2, text: '#2a1703', shadow: '#ffe7b0' },
  cyan: { top: 0x3fd9d2, mid: 0x1a9c98, bot: 0x0b5a5d, rim: 0x06282b, edge: 0x9ffcf6, text: '#f2ffff', shadow: '#06343a' },
  ghost: { top: 0x5a6472, mid: 0x323a45, bot: 0x161b22, rim: 0x05070a, edge: 0xa8b4c4, text: '#eef2f7', shadow: '#000000' },
  danger: { top: 0xd2475a, mid: 0x9a1f30, bot: 0x55101a, rim: 0x220508, edge: 0xffb3bd, text: '#fff1f3', shadow: '#2a0408' },
  disabled: { top: 0x2a313b, mid: 0x1f252d, bot: 0x14181e, rim: 0x05070a, edge: 0x3b4452, text: '#6b7584', shadow: '#000000' },
};

export function drawButtonSkin(g, w, h, style) {
  const s = BUTTON_STYLES[style] ?? BUTTON_STYLES.ghost;
  const cut = Math.min(12, h * 0.24), x = 3, y = 2, bw = w - 6, bh = h - 7;
  g.fillStyle(0x000000, 0.45).fillPoints(oct(x + 1, y + 4, bw, bh, cut), true);       // drop shadow
  g.fillStyle(s.rim, 1).fillPoints(oct(x - 2, y - 2, bw + 4, bh + 4, cut + 1), true);   // dark rim
  g.fillStyle(s.edge, style === 'disabled' ? 0.35 : 0.9).fillPoints(oct(x, y, bw, bh, cut), true); // bright bevel
  g.fillGradientStyle(s.top, s.top, s.mid, s.mid, 1, 1, 1, 1).fillRect(x + 2, y + 2, bw - 4, (bh - 4) * 0.5);
  g.fillGradientStyle(s.mid, s.mid, s.bot, s.bot, 1, 1, 1, 1).fillRect(x + 2, y + 2 + (bh - 4) * 0.5, bw - 4, (bh - 4) * 0.5);
  // re-cut the body corners (gradient rects are square)
  g.fillStyle(s.edge, style === 'disabled' ? 0.35 : 0.9);
  const c2 = cut - 1;
  g.fillTriangle(x + 2, y + 2, x + 2 + c2, y + 2, x + 2, y + 2 + c2).fillTriangle(x + bw - 2, y + 2, x + bw - 2 - c2, y + 2, x + bw - 2, y + 2 + c2);
  g.fillTriangle(x + 2, y + bh - 2, x + 2 + c2, y + bh - 2, x + 2, y + bh - 2 - c2).fillTriangle(x + bw - 2, y + bh - 2, x + bw - 2 - c2, y + bh - 2, x + bw - 2, y + bh - 2 - c2);
  if (style !== 'disabled') {
    g.fillStyle(0xffffff, style === 'gold' ? 0.32 : 0.16).fillRect(x + cut, y + 4, bw - cut * 2, Math.max(2, bh * 0.2)); // gloss
    g.fillStyle(0x000000, 0.18).fillRect(x + cut, y + bh - 6, bw - cut * 2, 3);
  }
}

// Bake a Graphics drawing into a reusable texture (RenderTexture keeps WebGL gradients).
export function bake(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  const rt = scene.make.renderTexture({ x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) }, false);
  rt.draw(g);
  rt.saveTexture(key);
  g.destroy();
  return key;
}

export const TIER_TINT = { 1: 0xffffff, 2: 0xd6f6ff, 3: 0xffe9c4 };
export const TIER_RIM = { 1: 0x8a6a3a, 2: 0x3fd9d2, 3: 0xffcf5a };
void PALETTE;
