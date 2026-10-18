import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE } from './config.js';
import { store } from './state/store.js';
import BootScene from './scenes/BootScene.js';
import BaseScene from './scenes/BaseScene.js';
import UIScene from './scenes/UIScene.js';
import WorldScene from './scenes/WorldScene.js';
import { resolveBattle, combatPower } from './world/battle.js';
import { creatureArmy, squadArmy } from './world/armies.js';
import { createWorld, ringLevel, dist } from './world/worldState.js';
import { audio } from './audio/audio.js';

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
  // An fps limiter far above the display rate costs nothing; it lets the UI drop to ~30 fps when idle.
  fps: { limit: 240 },
  scene: [BootScene, BaseScene, WorldScene, UIScene],
});

// Loading screen: fade it out once the UI scene is up.
export function hideLoader() {
  const el = document.getElementById('boot');
  if (!el || el.classList.contains('done')) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 400);
}
const waitUi = setInterval(() => { if (game.scene.getScene('UI')?.panel) { clearInterval(waitUi); hideLoader(); } }, 50);

// Rotation / resize: the layout height is picked from the aspect ratio at load. If it changes a lot
// (phone rotated, window resized), save and reload so everything is laid out for the new shape.
const layoutH = () => Math.round(GAME_WIDTH * Math.min(21 / 9, Math.max(16 / 9, window.innerHeight / Math.max(1, window.innerWidth))));
let relayoutTimer = null;
const onResize = () => {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    if (Math.abs(layoutH() - GAME_HEIGHT) > 60) { store.save(); window.__BD_RELAYOUT = true; location.reload(); }
  }, 600);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// Small debug/testing hook (used by the Playwright smoke test).
window.__BD = {
  game,
  store,
  base: () => game.scene.getScene('Base'),
  ui: () => game.scene.getScene('UI'),
  world: () => game.scene.getScene('World'),
  // pure world/battle helpers (tests + debugging)
  dev: { resolveBattle, combatPower, creatureArmy, squadArmy, createWorld, ringLevel, dist },
  // creature / tile -> page (CSS px) coordinates on the World map
  tileToPage(x, y) {
    const s = game.scene.getScene('World').tileToScreen(x, y);
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (s.x / GAME_WIDTH) * r.width, y: r.top + (s.y / GAME_HEIGHT) * r.height };
  },
  tabToPage(id) {
    const ui = game.scene.getScene('UI'); const t = ui.tabs.find((x) => x.id === id);
    return this.gameToPage(t.cx, GAME_HEIGHT - 65);
  },
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
      else if (o.zoneName && visible(o)) out.push({ label: o.zoneName, kind: 'zone', enabled: !o.zoneDisabled, ...toPage(o.getBounds()) });
      else if (o.tabLabel && visible(o)) out.push({ label: o.tabLabel, kind: 'tab', enabled: true, ...toPage(o.getBounds()) });
      (o.list ?? []).forEach(walk);
    };
    ui.children.list.forEach(walk);
    return out;
  },
  // stage 5 test hooks
  audio,
  audioState: () => audio.state(),
  tutorial: () => game.scene.getScene('UI')?.tutorial?.stateForTest(),
  perf: () => ({ capped: !!game.scene.getScene('UI')?.idleCapped, limitRate: game.loop._limitRate, fps: Math.round(game.loop.actualFps), layoutH: GAME_HEIGHT }),
  gameToPage(gx, gy) {
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (gx / GAME_WIDTH) * r.width, y: r.top + (gy / GAME_HEIGHT) * r.height };
  },
};
