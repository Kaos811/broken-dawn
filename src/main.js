import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE, RES, REDUCED_MOTION } from './config.js';
import { feelOn } from './ui/camfeel.js';
import { installHiDpi } from './hidpi.js';
import { store } from './state/store.js';
import BootScene from './scenes/BootScene.js';
import BaseScene from './scenes/BaseScene.js';
import UIScene from './scenes/UIScene.js';
import WorldScene from './scenes/WorldScene.js';
import { resolveBattle, combatPower } from './world/battle.js';
import { creatureArmy, squadArmy } from './world/armies.js';
import { createWorld, gradientLevel, levelAtTile, dist, BASE_POS, CENTER, seedBotBases } from './world/worldState.js';
import { audio } from './audio/audio.js';
import * as gridMath from './systems/grid.js';
import * as layout from './ui/layout.js';
import { BUILDINGS, BEACON, MAP, TUTORIAL } from './config.js';

store.load();
installHiDpi(Phaser, RES);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.bg,
  // backbuffer at RES x the logical layout (cameras zoom by RES; pointer coordinates stay logical)
  width: Math.round(GAME_WIDTH * RES),
  height: Math.round(GAME_HEIGHT * RES),
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

// Rotation / resize. The layout height is picked from the aspect ratio at load. Mobile Safari's
// toolbars change the visible height by ~80 CSS px as they show and hide while you play; that must
// not reload the game: Scale.FIT refits the canvas (screens scroll inside their own area), so only
// refresh. A real shape change (rotation or a width change) saves and reloads to lay out again.
const viewSize = () => ({ w: window.visualViewport?.width ?? window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight });
const startSize = viewSize();
let relayoutTimer = null;
const onResize = () => {
  game.scale.refresh();
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    game.scale.refresh();
    const v = viewSize();
    const rotated = (v.w > v.h) !== (startSize.w > startSize.h);
    const widthChanged = Math.abs(v.w - startSize.w) > startSize.w * 0.12;
    if (rotated || widthChanged) { store.save(); window.__BD_RELAYOUT = true; location.reload(); }
  }, 400);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);

// Small debug/testing hook (used by the Playwright smoke test).
window.__BD = {
  game,
  store,
  base: () => game.scene.getScene('Base'),
  ui: () => game.scene.getScene('UI'),
  world: () => game.scene.getScene('World'),
  // pure world/battle helpers (tests + debugging)
  dev: { resolveBattle, combatPower, creatureArmy, squadArmy, createWorld, gradientLevel, levelAtTile, dist, BASE_POS, CENTER, seedBotBases },
  // creature / tile -> page (CSS px) coordinates on the World map
  tileToPage(x, y) {
    const s = game.scene.getScene('World').tileToScreen(x, y);
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (s.x / GAME_WIDTH) * r.width, y: r.top + (s.y / GAME_HEIGHT) * r.height };
  },
  tabToPage(id) {
    const ui = game.scene.getScene('UI'); const t = ui.tabs.find((x) => x.id === id);
    if (!t) throw new Error(`no nav tab "${id}" (Settings lives in the More sheet)`);
    return this.gameToPage(t.cx, t.cy);
  },
  // Base grid math for tests: footprint centres / tile centres -> page px (stage 6 map)
  grid: { ...gridMath, BUILDINGS, BEACON, MAP },
  fpToPage(id) {
    const st = id === 'beacon' ? { gx: BEACON.gx, gy: BEACON.gy } : this.base().pos(id);
    const size = id === 'beacon' ? BEACON.footprint : BUILDINGS[id].footprint;
    const w = gridMath.isoToWorld(st.gx + size / 2, st.gy + size / 2);
    return this.worldToPage(w.x, w.y);
  },
  baseTileToPage(gx, gy) { const w = gridMath.isoToWorld(gx + 0.5, gy + 0.5); return this.worldToPage(w.x, w.y); },
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
      if (o.isButton && visible(o)) out.push({ label: o.labelText.rawText ?? o.labelText.text, kind: 'button', enabled: o.isEnabled(), ...toPage(o.hit.getBounds()), meta: o.chip ?? o.step ?? o.trainType ?? o.cancelLane });
      else if (o.zoneName && visible(o)) out.push({ label: o.zoneName, kind: 'zone', enabled: !o.zoneDisabled, ...toPage(o.getBounds()) });
      else if (o.tabLabel && visible(o)) out.push({ label: o.tabLabel, kind: 'tab', enabled: true, ...toPage(o.getBounds()) });
      (o.list ?? []).forEach(walk);
    };
    ui.children.list.forEach(walk);
    return out;
  },
  // Layout check (stage 9c): everything visible and tappable sits on screen, inside the safe area and
  // its own panel, and tap targets don't overlap. Returns a list of human-readable problems.
  layoutIssues() {
    const ui = game.scene.getScene('UI');
    const H = GAME_HEIGHT, Wd = GAME_WIDTH, S = layout.SAFE;
    const vis = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active || p.alpha < 0.05) return false; return true; };
    const inScroll = (o) => { for (let p = o.parentContainer; p; p = p.parentContainer) if (p.isScrollBody) return p.scrollView; return null; };
    const out = [];
    const name = (o) => (o.type === 'Text' ? `"${o.text.replace(/\s+/g, ' ').slice(0, 28)}"` : o.parentContainer?.isButton ? `[${o.parentContainer.labelText.text.slice(0, 20)}]` : o.zoneName ? `<${o.zoneName}>` : o.type);
    const T = 2; // px tolerance
    const inside = (b, r) => b.left >= r.x - T && b.right <= r.x + r.w + T && b.top >= r.y - T && b.bottom <= r.y + r.h + T;
    const check = (root, rect, label) => {
      if (!root || !vis(root)) return;
      const safe = { x: 0, y: S.top, w: Wd, h: H - S.top - S.bottom };
      const items = [], taps = [];
      const walk = (o) => {
        if (!vis(o)) return;
        const isText = o.type === 'Text' && o.text.trim();
        const isTap = o.input?.enabled && !o.noLayoutCheck;
        if (isText || isTap) {
          const b = o.getBounds();
          const big = b.width >= rect.w - 4 && b.height >= rect.h - 4; // dimmers / input blockers
          if (!big && b.width > 0 && b.height > 0) {
            const sv = inScroll(o);
            if (sv) { if (b.left < sv.x - T || b.right > sv.x + sv.width + T) out.push(`${label}: ${name(o)} sticks out of the scroll area sideways`); }
            else {
              if (!inside(b, safe)) out.push(`${label}: ${name(o)} is outside the safe area (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)})`);
              else if (!inside(b, rect)) out.push(`${label}: ${name(o)} leaves its panel (${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)})`);
            }
            if (isTap && (o.parentContainer?.isButton || o.zoneName)) taps.push({ o, b, sv, btn: !!o.parentContainer?.isButton });
          }
        }
        (o.list ?? []).forEach(walk);
      };
      walk(root);
      // tap targets: two buttons must not overlap; a zone may sit fully behind a button (card + action)
      for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
        const A = taps[i].b, B = taps[j].b;
        const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w <= 4 || h <= 4) continue;
        const contains = (P, Q) => P.left <= Q.left + T && P.right >= Q.right - T && P.top <= Q.top + T && P.bottom >= Q.bottom - T;
        if (!(taps[i].btn && taps[j].btn) && (contains(A, B) || contains(B, A))) continue;
        out.push(`${label}: tap targets overlap ${name(taps[i].o)} / ${name(taps[j].o)}`);
      }
    };
    // HUD capsules: the numbers must stay inside their capsule (and on screen)
    for (const [id, key] of [['energy', 'energyText'], ['alloy', 'alloyText'], ['shards', 'shardText'], ['troops', 'troopText']]) {
      const cap = ui.capsules?.[id], t = ui[key];
      if (!cap || !t) continue;
      const b = t.getBounds(), right = id === 'energy' ? ui.rateText.getBounds().left - 4 : cap.x + cap.w - 4;
      if (b.right > right + T || b.right > Wd) out.push(`HUD: "${t.text}" overflows the ${id} capsule`);
    }
    if (ui.reveal) check(ui.reveal, { x: 0, y: S.top, w: Wd, h: H - S.top - S.bottom }, 'reveal');
    else if (ui.modal) check(ui.modal, ui.modal.panelRect ?? { x: 0, y: 0, w: Wd, h: H }, 'modal');
    else {
      if (ui.screen) { const a = ui.area; check(ui.screen.container, { x: a.x, y: a.y, w: a.w, h: a.h }, `screen ${ui.screen.id}`); }
      if (ui.panel?.visible) { const r = ui.panelRect; check(ui.panel, { x: r.x, y: r.y, w: r.width, h: r.height }, 'building panel'); }
      if (ui.worldMode && ui.worldHud) {
        const top = layout.TOP_H, bot = H - layout.NAV_H - layout.HERO_RISE;
        check(ui.worldHud.c, { x: 0, y: top, w: Wd, h: bot - top }, 'world hud');
        if (ui.worldHud.sheet) { const r = ui.worldHud.sheetRect; check(ui.worldHud.sheet, { x: r.x, y: r.y, w: r.width, h: r.height }, 'creature sheet'); }
      }
    }
    return [...new Set(out)];
  },
  // stage 5 test hooks
  audio,
  audioState: () => audio.state(),
  tutorial: () => game.scene.getScene('UI')?.tutorial?.stateForTest(),
  tutorialIds: TUTORIAL.ids,
  layout: () => ({ ...layout }),
  res: RES,
  H: GAME_HEIGHT,
  feel: () => ({ reduced: REDUCED_MOTION, on: feelOn(), flies: game.scene.getScene('UI')?.fx.flies ?? 0, flying: game.scene.getScene('UI')?.fx.flying ?? 0 }),
  perf: () => ({ res: RES, backbuffer: [game.canvas.width, game.canvas.height], capped: !!game.scene.getScene('UI')?.idleCapped, limitRate: game.loop._limitRate, fps: Math.round(game.loop.actualFps), layoutH: GAME_HEIGHT }),
  gameToPage(gx, gy) {
    const r = game.canvas.getBoundingClientRect();
    return { x: r.left + (gx / GAME_WIDTH) * r.width, y: r.top + (gy / GAME_HEIGHT) * r.height };
  },
};
