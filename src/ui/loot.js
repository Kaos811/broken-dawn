// Reward panel that stays until the player presses Collect or Close.
// The tap that opened it cannot dismiss it: the backdrop is not a button, and a
// compatibility mouse click at the claim point is ignored (see syntheticClickFilter).
import { GAME_WIDTH as W, GAME_HEIGHT as H, PALETTE } from '../config.js';
import { text, button, panelBg } from './widgets.js';
import { syntheticClickFilter } from './gesture.js';

export function hideLoot(ui) {
  const c = ui.loot;
  if (!c) return;
  ui.tweens?.killTweensOf?.(c);
  c.destroy();
  if (ui.loot === c) ui.loot = null;
}

// One readable list. `lines` are already formatted ("+300 Energy"). `from` is the
// pointer that claimed, so that same press cannot hit Collect.
export function showLoot(ui, { title = 'Rewards', lines = [], from = null } = {}) {
  hideLoot(ui);
  const shown = lines.map((s) => String(s)).filter(Boolean);
  if (!shown.length) return null;
  const allow = syntheticClickFilter(from);
  const dismiss = (p) => { if (allow(p) === false) return; hideLoot(ui); };
  const c = ui.add.container(0, 0).setDepth(720);
  const dim = ui.add.rectangle(W / 2, H / 2, W, H, 0x020305, 0.78).setInteractive();
  // swallow the press so it does not reach the screen underneath, and do not close
  const stop = (_p, _x, _y, ev) => ev?.stopPropagation?.();
  dim.on('pointerdown', stop);
  dim.on('pointerup', stop);
  const labels = shown.map((s) => text(ui, 0, 0, s, 26, PALETTE.text, { fontStyle: 'bold', wordWrap: { width: 520 }, lineSpacing: 4 }));
  const contentH = labels.reduce((n, t) => n + t.height + 14, 0);
  const w = 640;
  const h = Math.min(H - 80, Math.max(360, 168 + contentH + 110));
  const x = (W - w) / 2;
  const y = Math.max(36, (H - h) / 2);
  const g = ui.add.graphics();
  panelBg(g, x, y, w, h, { fill: 0x0c1118, stroke: PALETTE.gold, accent: PALETTE.cyan });
  const block = ui.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
  block.on('pointerdown', stop);
  block.on('pointerup', stop);
  const titleT = text(ui, x + 36, y + 28, title, 34, '#ffd27f', { fontStyle: 'bold', stroke: '#2e1e06', strokeThickness: 4 });
  if (titleT.width > w - 140) titleT.setScale((w - 140) / titleT.width);
  const sub = text(ui, x + 36, y + 78, 'Yours to keep. Collect when you have read them.', 18, PALETTE.textDim);
  let ly = y + 118;
  labels.forEach((t) => { t.setPosition(x + 48, ly); ly += t.height + 14; });
  const closeX = button(ui, x + w - 40, y + 44, 56, 56, '✕', (p) => dismiss(p), { style: 'ghost', size: 26, allow });
  closeX.chip = 'loot-close';
  const collect = button(ui, x + w / 2, y + h - 58, 280, 72, 'Collect', (p) => dismiss(p), { style: 'gold', size: 26, allow });
  collect.chip = 'loot-collect';
  c.add([dim, g, block, titleT, sub, ...labels, closeX, collect]);
  c.sticky = true;
  c.lootText = shown.join('\n');
  c.alpha = 0;
  ui.tweens.add({ targets: c, alpha: 1, duration: 140 });
  ui.loot = c;
  ui.flushInput?.();
  return c;
}
