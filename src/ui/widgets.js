import Phaser from 'phaser';
import { PALETTE } from '../config.js';
import { audio } from '../audio/audio.js';
import { SKIN, drawFrame, lerpC, bake, drawButtonSkin, BUTTON_STYLES } from './skin.js';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function text(scene, x, y, str, size = 24, color = PALETTE.text, opts = {}) {
  return scene.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, ...opts });
}

export function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(2)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}

export function fmtDuration(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// Ornate panel frame (stage 9 skin). Same signature as before: a non-default stroke tints the rim,
// a non-gold accent adds a coloured stub on the top edge.
export function panelBg(g, x, y, w, h, { fill = null, alpha = 0.97, stroke = PALETTE.metalEdge, accent = PALETTE.gold, cut = 16 } = {}) {
  const rim = stroke === PALETTE.metalEdge || stroke === PALETTE.gold ? 'gold' : stroke;
  drawFrame(g, x, y, w, h, { cut, alpha, rim, top: fill != null ? lerpC(fill, 0xffffff, 0.06) : SKIN.bodyTop, bot: fill ?? SKIN.bodyBot });
  if (accent != null && accent !== PALETTE.gold) {
    g.fillStyle(accent, 1).fillPoints([{ x: x + cut + 6, y: y + 5 }, { x: x + Math.min(w * 0.35, 160), y: y + 5 }, { x: x + Math.min(w * 0.35, 160) - 5, y: y + 10 }, { x: x + cut + 10, y: y + 10 }], true);
  }
}

// Glossy button (baked skin per style + size). Returns a container with .setEnabled(bool), .setLabel(str),
// .setStyle(style). Styles: gold (primary), cyan (teal secondary), ghost (metal), danger, disabled.
// The hit area is at least 80 game px (about 44 CSS px on a phone) in each direction, centred on the button.
export const MIN_TAP = 80;
export function button(scene, x, y, w, h, label, onClick, { style = 'gold', size = 26 } = {}) {
  const c = scene.add.container(x, y);
  const W = Math.round(w), Hh = Math.round(h);
  const skin = scene.add.image(0, 1, '__DEFAULT').setOrigin(0.5);
  const t = text(scene, 0, -1, label, size, '#fff', { fontStyle: 'bold' }).setOrigin(0.5);
  // visual-size rect (bounds match the drawn button) with a padded input area of at least MIN_TAP
  const TW = Math.max(W, MIN_TAP), TH = Math.max(Hh, MIN_TAP);
  const hit = scene.add.rectangle(0, 0, W, Hh, 0x000000, 0.001)
    .setInteractive({ hitArea: new Phaser.Geom.Rectangle((W - TW) / 2, (Hh - TH) / 2, TW, TH), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
  c.add([skin, t, hit]);
  let enabled = true, current = style, pressed = false;
  const draw = () => {
    const st = enabled ? current : 'disabled';
    const s = BUTTON_STYLES[st] ?? BUTTON_STYLES.ghost;
    const key = bake(scene, `btn-${st}-${W}x${Hh}`, W, Hh + 4, (g) => drawButtonSkin(g, W, Hh + 4, st));
    skin.setTexture(key);
    t.setColor(s.text).setShadow(0, st === 'gold' ? 1 : 2, s.shadow, 0, false, true);
  };
  const fit = () => { const max = W - 20; t.setScale(t.width > max ? max / t.width : 1); };
  draw(); fit();
  // juice: squash on press, springy release, click sound + a light haptic tick
  const springTo = (s, ms, ease) => { if (!c.active) return; scene.tweens.killTweensOf(c); scene.tweens.add({ targets: c, scale: s, duration: ms, ease }); };
  hit.on('pointerdown', () => {
    pressed = true; springTo(0.93, 70, 'Quad.easeOut');
    if (enabled) { audio.play('tap'); audio.haptic(8); } else audio.play('error');
  });
  hit.on('pointerout', () => { pressed = false; springTo(1, 120, 'Quad.easeOut'); });
  hit.on('pointerup', () => {
    springTo(1, 220, 'Back.easeOut');
    // defer so handlers can safely destroy this button (e.g. closing a modal)
    if (pressed && enabled && !scene.scrollDragged) scene.time.delayedCall(0, () => onClick?.());
    pressed = false;
  });
  c.setEnabled = (v) => { if (enabled !== !!v) { enabled = !!v; draw(); } return c; };
  c.setLabel = (s) => { if (t.text !== s) { t.setText(s); fit(); } return c; };
  c.setStyle = (s) => { if (current !== s) { current = s; draw(); } return c; };
  c.hit = hit;
  c.isButton = true;
  c.labelText = t;
  c.skin = skin;
  c.isEnabled = () => enabled;
  return c;
}

// Small text chip / pill (non-interactive background box).
export function pill(scene, g, x, y, w, h, color = 0x3b4452, alpha = 1, fill = 0x141922) {
  g.fillStyle(fill, alpha).fillRoundedRect(x, y, w, h, Math.min(10, h / 2));
  g.lineStyle(2, color, 1).strokeRoundedRect(x, y, w, h, Math.min(10, h / 2));
}

export function hexColor(n) { return `#${n.toString(16).padStart(6, '0')}`; }

export function fmtClock(s) {
  s = Math.max(0, Math.ceil(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
