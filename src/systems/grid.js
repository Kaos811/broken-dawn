import { MAP, BEACON } from '../config.js';

const HW = MAP.tileW / 2;
const HH = MAP.tileH / 2;

// World offset so the whole diamond sits in positive space.
export const ORIGIN_X = MAP.size * HW;
export const ORIGIN_Y = 140; // headroom for tall buildings at the top edge

export const WORLD_W = MAP.size * MAP.tileW;
export const WORLD_H = MAP.size * MAP.tileH + ORIGIN_Y + 120;

// Top vertex of tile (gx, gy) in world space. Fractional coords are fine.
export function isoToWorld(gx, gy) {
  return { x: ORIGIN_X + (gx - gy) * HW, y: ORIGIN_Y + (gx + gy) * HH };
}

export function worldToIso(x, y) {
  const dx = (x - ORIGIN_X) / HW;
  const dy = (y - ORIGIN_Y) / HH;
  return { gx: (dx + dy) / 2, gy: (dy - dx) / 2 };
}

export function isPlatformTile(gx, gy) {
  return gx >= MAP.platformMin && gx <= MAP.platformMax && gy >= MAP.platformMin && gy <= MAP.platformMax;
}

export function footprintTiles(gx, gy, size) {
  const t = [];
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) t.push([gx + i, gy + j]);
  return t;
}

function overlaps(a, b) {
  return a.gx < b.gx + b.size && b.gx < a.gx + a.size && a.gy < b.gy + b.size && b.gy < a.gy + a.size;
}

// Is a footprint at (gx,gy) valid? `others` = [{gx,gy,size}] excluding the mover.
export function isValidPlacement(gx, gy, size, others) {
  for (const [x, y] of footprintTiles(gx, gy, size)) if (!isPlatformTile(x, y)) return false;
  const me = { gx, gy, size };
  if (overlaps(me, { gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint })) return false;
  for (const o of others) if (overlaps(me, o)) return false;
  return true;
}

// Bottom vertex of a footprint (sprite anchor point) and its depth key.
export function footprintAnchor(gx, gy, size) {
  return isoToWorld(gx + size, gy + size);
}
