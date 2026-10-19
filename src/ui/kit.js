// Stage 9 shared UI components (text + graphics). Every screen builds on these so one restyle applies
// everywhere: section headers, stat lines (label a → b with an up arrow), price tags, portrait tiles,
// badges, screen header plaque. Pure drawing lives in skin.js.
import { PALETTE } from '../config.js';
import { text } from './widgets.js';
import { SKIN, drawCard, drawBar, drawBadge, glyph, diamond, lerpC, TIER_RIM } from './skin.js';

export { SKIN, drawCard, drawBar, drawBadge, glyph, diamond };

// Caps section label with a diamond and a fading gold rule. Returns the label Text (direct child of c).
export function sectionHeader(ui, c, x, y, label, { w = 688 - (x - 16), color = PALETTE.textGold, size = 18, right = null, rightColor = PALETTE.textDim, rule = 0xffb347 } = {}) {
  const g = ui.add.graphics(); c.add(g);
  diamond(g, x + 7, y + size * 0.62, 6, rule, lerpC(rule, 0xffffff, 0.5));
  const t = text(ui, x + 20, y, label, size, color, { fontStyle: 'bold', letterSpacing: 2.5 });
  c.add(t);
  let r = null;
  if (right != null) { r = text(ui, x + w, y + 2, right, size - 2, rightColor).setOrigin(1, 0); c.add(r); }
  const x0 = x + 30 + t.width, x1 = (r ? x + w - r.width - 14 : x + w);
  const ry = y + size * 0.62;
  if (x1 > x0 + 10) {
    const seg = (x1 - x0) / 4;
    for (let k = 0; k < 4; k++) g.lineStyle(2, rule, 0.55 - k * 0.12).lineBetween(x0 + k * seg, ry, x0 + (k + 1) * seg, ry);
  }
  t.rightText = r;
  return t;
}

// Stat line: a row card with an icon, a label and "a → b" (b in green with an up arrow when it rises).
// Returns { set({ label, a, b, up, note }) } so panels can refresh it in place.
export function statLine(ui, c, x, y, w, h, { icon = null, glyphKind = 'diamond', glyphColor = SKIN.gold, label = '', a = '', b = null, up = null, size = 21 } = {}) {
  const g = ui.add.graphics(); c.add(g);
  drawCard(g, x, y, w, h, { cut: 8 });
  const ix = x + 30, iy = y + h / 2;
  if (icon) { const im = ui.add.image(ix, iy, icon); im.setScale((h - 14) / Math.max(im.width, im.height)); c.add(im); }
  else { const gg = ui.add.graphics(); glyph(gg, glyphKind, ix, iy, Math.min(15, h * 0.3), glyphColor); c.add(gg); }
  const L = text(ui, x + 60, iy, '', size, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  const A = text(ui, 0, iy, '', size, PALETTE.text).setOrigin(0, 0.5);
  const arrow = text(ui, 0, iy, '→', size, PALETTE.textDim).setOrigin(0, 0.5);
  const B = text(ui, 0, iy, '', size, '#7dffb0', { fontStyle: 'bold' }).setOrigin(0, 0.5);
  const upG = ui.add.graphics();
  c.add([L, A, arrow, B, upG]);
  const right = x + w - 18;
  const api = {
    set(o = {}) {
      const lab = o.label ?? label, av = String(o.a ?? a), bv = o.b === undefined ? b : o.b, isUp = o.up === undefined ? up : o.up;
      L.setText(lab);
      const hasB = bv != null && bv !== '';
      const arrowW = 34, upW = isUp ? 36 : 0;
      B.setText(hasB ? String(bv) : '').setVisible(hasB);
      arrow.setVisible(hasB);
      A.setText(av);
      let cx = right - upW;
      if (hasB) { B.setX(cx - B.width); cx -= B.width + arrowW; arrow.setX(cx + 8); }
      A.setX(cx - A.width).setColor(hasB ? PALETTE.textDim : PALETTE.text);
      // keep the label clear of the values: shrink it if needed
      const room = A.x - L.x - 12;
      L.setScale(L.width > room && L.width > 0 ? Math.max(0.6, room / L.width) : 1);
      upG.clear();
      if (isUp) glyph(upG, 'up', right - 13, y + h / 2, 13);
      return api;
    },
  };
  api.set();
  api.g = g;
  return api;
}

// Price tag: a dark pill with a painted icon (or glyph) and an amount. Returns { t, set(str, ok) }.
export function priceTag(ui, c, x, y, { icon = 'hud-energy', glyphKind = null, label = '', w = null, h = 48, ok = true, size = 22 } = {}) {
  const g = ui.add.graphics(); c.add(g);
  const t = text(ui, x + h + 4, y + h / 2, label, size, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  let im = null;
  if (icon && !glyphKind) { im = ui.add.image(x + h / 2 + 4, y + h / 2, icon); im.setScale((h - 8) / Math.max(im.width, im.height)); }
  const gg = ui.add.graphics();
  if (glyphKind) glyph(gg, glyphKind, x + h / 2 + 4, y + h / 2, h * 0.28, SKIN.gold);
  c.add([t, gg, ...(im ? [im] : [])]);
  const draw = () => {
    const ww = w ?? (t.width + h + 24);
    g.clear();
    g.fillStyle(0x000000, 0.4).fillRoundedRect(x + 1, y + 3, ww, h, h / 2);
    g.fillGradientStyle(0x1b222c, 0x1b222c, 0x07090d, 0x07090d, 1, 1, 1, 1).fillRoundedRect(x, y, ww, h, h / 2);
    g.lineStyle(1.5, ok ? SKIN.goldDk : 0x7a2430, 1).strokeRoundedRect(x, y, ww, h, h / 2);
    g.lineStyle(1, 0xffffff, 0.08).lineBetween(x + h / 2, y + 2, x + ww - h / 2, y + 2);
  };
  const api = { t, g, set(str, okv = ok) { ok = okv; t.setText(str).setColor(ok ? PALETTE.text : '#ff8a95'); draw(); return api; },
    setVisible(v) { for (const o of [t, g, gg, im]) o?.setVisible(v); return api; } };
  api.set(label, ok);
  return api;
}

// Count badge (red circle with a number). Returns the Text (empty hides it).
export function badge(ui, c, x, y, n, r = 14) {
  const g = ui.add.graphics(); c.add(g);
  const t = text(ui, x, y, '', r + 2, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5);
  c.add(t);
  const api = { g, t, set(v) { g.clear(); t.setText(v ? String(v) : ''); if (v) drawBadge(g, x, y, r); return api; } };
  return api.set(n);
}

// Portrait / icon tile: rarity- or tier-coloured bevelled frame around a texture, optional stars,
// lock overlay, corner tag and dimming. Returns { img, g }.
export function tile(ui, c, key, x, y, w, h, { rim = SKIN.steel, stars = null, maxStars = 5, lock = false, dim = false, tag = null, tagColor = PALETTE.textGold, fit = 'width', imgH = null, tint = null, bg = null } = {}) {
  const g = ui.add.graphics(); c.add(g);
  const top = bg ?? lerpC(rim, 0x10141b, 0.78);
  g.fillStyle(0x000000, 0.4).fillRect(x + 2, y + 4, w, h);
  g.fillStyle(lerpC(rim, 0x000000, 0.6), 1).fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillGradientStyle(top, top, 0x07090d, 0x07090d, 1, 1, 1, 1).fillRect(x, y, w, h);
  let img = null;
  if (key) {
    const ih = imgH ?? h;
    // origin (0,0) + explicit offsets: Phaser draws a crop relative to the frame's top-left, so a
    // centred origin shifted the visible part (heads / item tops were cut off in the Squads slots)
    img = ui.add.image(0, 0, key).setOrigin(0, 0);
    const iw = img.width, ihh = img.height, bw = w - 6, bh = ih - 6;
    const sc = fit === 'height' ? bh / ihh : fit === 'cover' ? Math.max(bw / iw, bh / ihh) : fit === 'contain' ? Math.min(bw / iw, bh / ihh) : bw / iw;
    img.setScale(sc);
    const visW = Math.min(iw, bw / sc), visH = Math.min(ihh, bh / sc);
    const cx = (iw - visW) / 2; // centre horizontally, keep the top (heads) when cropping vertically
    if (visW < iw - 0.5 || visH < ihh - 0.5) img.setCrop(cx, 0, visW, visH);
    img.setPosition(x + 3 + (bw - visW * sc) / 2 - cx * sc, y + 3 + (fit === 'contain' ? (bh - visH * sc) / 2 : 0));
    if (dim) img.setTint(0x1c2028); else if (tint) img.setTint(tint);
    c.add(img);
  }
  const fg = ui.add.graphics(); c.add(fg);
  fg.lineStyle(3, rim, dim ? 0.45 : 1).strokeRect(x, y, w, h);
  fg.lineStyle(1, lerpC(rim, 0xffffff, 0.5), dim ? 0.15 : 0.5).strokeRect(x + 3, y + 3, w - 6, h - 6);
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) fg.fillStyle(rim, dim ? 0.5 : 1).fillRect(cx - 4, cy - 4, 8, 8);
  if (stars != null) {
    const s = Math.min(9, (w - 16) / (maxStars * 2.4));
    const sx = x + w / 2 - ((maxStars - 1) * s * 2.3) / 2;
    fg.fillStyle(0x000000, 0.55).fillRect(x + 3, y + h - s * 2 - 10, w - 6, s * 2 + 7);
    for (let k = 0; k < maxStars; k++) glyph(fg, 'star', sx + k * s * 2.3, y + h - s - 6, s, k < stars ? SKIN.gold : 0x3b4452);
  }
  if (lock) {
    fg.fillStyle(0x05070b, 0.55).fillRect(x + 2, y + 2, w - 4, h - 4);
    fg.fillStyle(0x0b0e13, 0.9).fillCircle(x + w / 2, y + h / 2, 22);
    fg.lineStyle(2, 0x6b7280, 1).strokeCircle(x + w / 2, y + h / 2, 22);
    glyph(fg, 'lock', x + w / 2, y + h / 2, 12, 0xc9ced8);
  }
  if (tag) {
    const tt = text(ui, x + w - 8, y + 8, tag, 14, tagColor, { fontStyle: 'bold' }).setOrigin(1, 0);
    fg.fillStyle(0x07090d, 0.9).fillRect(tt.x - tt.width - 6, y + 6, tt.width + 10, 20);
    fg.lineStyle(1, SKIN.goldDk, 1).strokeRect(tt.x - tt.width - 6, y + 6, tt.width + 10, 20);
    c.add(tt);
  }
  return { img, g, fg };
}

// Troop figure in a frame: painted full-body art (troop-<class>) with a tier rim + tint.
export function troopArtKey(type, TROOP_CLASSES) { return `troop-${TROOP_CLASSES[type].cls}`; }
export { TIER_RIM };
