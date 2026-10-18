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
  gameToPage(gx, gy) {
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (gx / GAME_WIDTH) * r.width, y: r.top + (gy / GAME_HEIGHT) * r.height };
  },
};
