import Phaser from 'phaser';
import { PALETTE } from '../config.js';

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

// Chamfered sci-fi panel.
export function panelBg(g, x, y, w, h, { fill = 0x10141b, alpha = 0.96, stroke = PALETTE.metalEdge, accent = PALETTE.gold, cut = 16 } = {}) {
  const pts = [
    { x: x + cut, y }, { x: x + w, y }, { x: x + w, y: y + h - cut }, { x: x + w - cut, y: y + h }, { x, y: y + h }, { x, y: y + cut },
  ];
  g.fillStyle(fill, alpha).fillPoints(pts, true);
  g.lineStyle(2, stroke, 0.9).strokePoints(pts, true);
  if (accent != null) { g.lineStyle(3, accent, 1).lineBetween(x + cut, y, x + Math.min(w * 0.35, 160), y); }
}

// Button: returns container with .setEnabled(bool) and .setLabel(str).
export function button(scene, x, y, w, h, label, onClick, { style = 'gold', size = 26 } = {}) {
  const styles = {
    gold: { fill: 0xffb347, fillA: 1, stroke: 0xffd27f, text: '#140d04' },
    cyan: { fill: 0x0f2a30, fillA: 1, stroke: 0x3ff0ff, text: '#3ff0ff' },
    ghost: { fill: 0x161b23, fillA: 1, stroke: 0x56606f, text: '#e8edf3' },
    danger: { fill: 0x3a1015, fillA: 1, stroke: 0xff4d5e, text: '#ff8a95' },
    disabled: { fill: 0x1d222b, fillA: 1, stroke: 0x2e3540, text: '#5d6878' },
  };
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const t = text(scene, 0, 0, label, size, '#fff', { fontStyle: 'bold' }).setOrigin(0.5);
  const hit = scene.add.rectangle(0, 0, w, h, 0x000000, 0.001).setInteractive({ useHandCursor: true });
  c.add([g, t, hit]);
  let enabled = true, current = style, pressed = false;
  const draw = () => {
    const s = styles[enabled ? current : 'disabled'];
    g.clear();
    const cut = 10;
    const pts = [{ x: -w / 2 + cut, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 - cut }, { x: w / 2 - cut, y: h / 2 }, { x: -w / 2, y: h / 2 }, { x: -w / 2, y: -h / 2 + cut }];
    g.fillStyle(s.fill, s.fillA).fillPoints(pts, true);
    g.lineStyle(2, s.stroke, 1).strokePoints(pts, true);
    t.setColor(s.text);
  };
  draw();
  hit.on('pointerdown', () => { pressed = true; c.setScale(0.97); });
  hit.on('pointerout', () => { pressed = false; c.setScale(1); });
  hit.on('pointerup', () => {
    c.setScale(1);
    // defer so handlers can safely destroy this button (e.g. closing a modal)
    if (pressed && enabled) scene.time.delayedCall(0, () => onClick?.());
    pressed = false;
  });
  c.setEnabled = (v) => { enabled = v; draw(); return c; };
  c.setLabel = (s) => { t.setText(s); return c; };
  c.setStyle = (s) => { current = s; draw(); return c; };
  c.hit = hit;
  return c;
}
