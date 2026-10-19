// Vertical scrolling for screens and overlay sheets whose content is taller than the space the
import Phaser from 'phaser';
// phone gives them (short screens such as 375x667 have ~280 game px less height than 390x844).
// Content added after `keep` children of `parent` moves into a masked body container that scrolls
// with drag or wheel. When everything already fits nothing changes (no body, no mask).
import { PALETTE } from '../config.js';

const DRAG_START = 14;

// bottom edge of the visible content in `list` (skips hidden objects and full-screen blockers)
function contentBottom(list, view) {
  let b = -Infinity;
  for (const o of list) {
    if (!o.visible || o.noScrollMeasure) continue;
    const r = o.getBounds?.();
    if (!r || r.height <= 0 || r.height >= view.h * 3) continue;
    b = Math.max(b, r.bottom);
  }
  return b;
}

export function installScrolling(scene) {
  scene.scrollPos = {};
  scene.scroller = null;
  scene.scrollDragged = false;
  let drag = null;
  scene.input.on('pointerdown', (p) => {
    scene.scrollDragged = false;
    const s = scene.scroller;
    if (s && s.body.active && Phaser.Geom.Rectangle.Contains(s.view, p.x, p.y)) drag = { y: p.y, start: s.offset, s };
    else drag = null;
  });
  scene.input.on('pointermove', (p) => {
    if (!drag || !p.isDown || !drag.s.body.active) return;
    const dy = p.y - drag.y;
    if (!scene.scrollDragged && Math.abs(dy) < DRAG_START) return;
    scene.scrollDragged = true;
    drag.s.set(drag.start - dy);
  });
  scene.input.on('pointerup', () => { drag = null; });
  scene.input.on('wheel', (p, objs, dx, dy) => {
    const s = scene.scroller;
    if (s && s.body.active && Phaser.Geom.Rectangle.Contains(s.view, p.x, p.y)) s.set(s.offset + dy);
  });
}

// Make parent's children from index `keep` on scroll inside `view` if they overflow it.
// `key` remembers the offset across re-renders of the same screen. Returns the scroller or null.
export function scrollify(scene, parent, keep, view, key, { pad = 20 } = {}) {
  const moving = parent.list.slice(keep).filter((o) => !o.fixedInScroll);
  const bottom = contentBottom(moving, view);
  const max = Math.ceil(bottom + pad - (view.y + view.h));
  if (max <= 0) { if (scene.scroller?.parent === parent) scene.scroller = null; return null; }
  const body = scene.add.container(0, 0);
  for (const o of moving) { parent.remove(o); body.add(o); }
  parent.addAt(body, keep);
  const mg = scene.make.graphics({}, false).fillRect(view.x, view.y, view.w, view.h);
  body.setMask(mg.createGeometryMask());
  // slim scroll bar on the right edge
  const bar = scene.add.graphics(); bar.fixedInScroll = true; parent.add(bar);
  const rect = new Phaser.Geom.Rectangle(view.x, view.y, view.w, view.h);
  const s = {
    parent, body, view: rect, max, offset: 0, key,
    set(v) {
      s.offset = Phaser.Math.Clamp(Math.round(v), 0, max);
      body.y = -s.offset;
      scene.scrollPos[key] = s.offset;
      const th = Math.max(60, view.h * view.h / (view.h + max)), ty = view.y + (view.h - th) * (s.offset / max);
      bar.clear().fillStyle(0x000000, 0.35).fillRoundedRect(view.x + view.w - 9, view.y + 4, 6, view.h - 8, 3)
        .fillStyle(PALETTE.gold, 0.75).fillRoundedRect(view.x + view.w - 9, ty + 4, 6, th - 8, 3);
    },
  };
  body.isScrollBody = true; body.scrollView = rect;
  parent.once('destroy', () => { mg.destroy(); if (scene.scroller === s) scene.scroller = null; });
  scene.scroller = s;
  s.set(scene.scrollPos[key] ?? 0);
  return s;
}

// a tap that ended a scroll drag must not also press the control under the finger
export const tapAllowed = (scene) => !scene.scrollDragged;
