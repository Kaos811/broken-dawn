import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE } from './config.js';
import { store } from './state/store.js';
import BootScene from './scenes/BootScene.js';
import BaseScene from './scenes/BaseScene.js';
import UIScene from './scenes/UIScene.js';

store.load();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.bg,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 3, mouse: { preventDefaultWheel: true } },
  render: { antialias: true, roundPixels: false },
  disableContextMenu: true,
  scene: [BootScene, BaseScene, UIScene],
});

// Small debug/testing hook (used by the Playwright smoke test).
window.__BD = {
  game,
  store,
  base: () => game.scene.getScene('Base'),
  ui: () => game.scene.getScene('UI'),
  // world point -> page (CSS px) coordinates
  worldToPage(wx, wy) {
    const s = game.scene.getScene('Base').worldToScreen(wx, wy);
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (s.x / GAME_WIDTH) * r.width, y: r.top + (s.y / GAME_HEIGHT) * r.height };
  },
  // Visible UI controls (buttons / tap zones / tabs) for tests: [{ label, x, y, enabled }] in page px.
  controls() {
    const ui = game.scene.getScene('UI');
    const out = [];
    const r = game.canvas.getBoundingClientRect();
    const visible = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active) return false; return true; };
    const toPage = (b) => ({ x: r.left + ((b.centerX) / GAME_WIDTH) * r.width, y: r.top + ((b.centerY) / GAME_HEIGHT) * r.height });
    const walk = (o) => {
      if (o.isButton && visible(o)) out.push({ label: o.labelText.text, kind: 'button', enabled: o.isEnabled(), ...toPage(o.hit.getBounds()), meta: o.chip ?? o.step ?? o.trainType ?? o.cancelLane });
      else if (o.zoneName && visible(o)) out.push({ label: o.zoneName, kind: 'zone', enabled: true, ...toPage(o.getBounds()) });
      else if (o.tabLabel && visible(o)) out.push({ label: o.tabLabel, kind: 'tab', enabled: true, ...toPage(o.getBounds()) });
      (o.list ?? []).forEach(walk);
    };
    ui.children.list.forEach(walk);
    return out;
  },
  gameToPage(gx, gy) {
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (gx / GAME_WIDTH) * r.width, y: r.top + (gy / GAME_HEIGHT) * r.height };
  },
};
