import { MAP, BEACON } from '../config.js';

const HW = MAP.tileW / 2;
const HH = MAP.tileH / 2;

// World offset so the nominal diamond sits in positive space.
export const ORIGIN_X = MAP.size * HW;
export const ORIGIN_Y = 140;

// Top vertex of tile (gx, gy) in world space. Fractional coords are fine.
export function isoToWorld(gx, gy) {
  return { x: ORIGIN_X + (gx - gy) * HW, y: ORIGIN_Y + (gx + gy) * HH };
}

export function worldToIso(x, y) {
  const dx = (x - ORIGIN_X) / HW;
  const dy = (y - ORIGIN_Y) / HH;
  return { gx: (dx + dy) / 2, gy: (dy - dx) / 2 };
}

// Centre of the Beacon's footprint: the middle of the base.
export const BEACON_CENTER = isoToWorld(BEACON.gx + BEACON.footprint / 2, BEACON.gy + BEACON.footprint / 2);
export const BEACON_TILE = { gx: BEACON.gx + BEACON.footprint / 2, gy: BEACON.gy + BEACON.footprint / 2 };

// Painted ground rectangle (world px). The camera never shows anything outside it.
export const GROUND = {
  x: BEACON_CENTER.x - MAP.buildRx - MAP.groundPadX,
  y: BEACON_CENTER.y - MAP.buildRy - MAP.groundPadY,
  w: 2 * (MAP.buildRx + MAP.groundPadX),
  h: 2 * (MAP.buildRy + MAP.groundPadY),
};

// Tile range that can possibly be buildable (bounding box of the ellipse, in tiles).
const R = Math.ceil((MAP.buildRx / HW + MAP.buildRy / HH) / 2) + 1;
export const TILE_RANGE = { min: Math.floor(BEACON_TILE.gx - R), max: Math.ceil(BEACON_TILE.gx + R) };

// Can something stand on tile (gx, gy)? Its centre has to be inside the buildable ellipse.
export function isPlatformTile(gx, gy) {
  const c = isoToWorld(gx + 0.5, gy + 0.5);
  const dx = (c.x - BEACON_CENTER.x) / MAP.buildRx, dy = (c.y - BEACON_CENTER.y) / MAP.buildRy;
  return dx * dx + dy * dy <= 1;
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
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return false;
  for (const [x, y] of footprintTiles(gx, gy, size)) if (!isPlatformTile(x, y)) return false;
  const me = { gx, gy, size };
  if (overlaps(me, { gx: BEACON.gx, gy: BEACON.gy, size: BEACON.footprint })) return false;
  for (const o of others) if (overlaps(me, o)) return false;
  return true;
}

// Closest valid spot to (gx, gy) (by on-screen distance), or null if the base is full.
export function nearestFree(gx, gy, size, others) {
  const want = isoToWorld(gx + size / 2, gy + size / 2);
  let best = null;
  for (let y = TILE_RANGE.min; y <= TILE_RANGE.max; y++) {
    for (let x = TILE_RANGE.min; x <= TILE_RANGE.max; x++) {
      if (!isValidPlacement(x, y, size, others)) continue;
      const c = isoToWorld(x + size / 2, y + size / 2);
      const d = (c.x - want.x) ** 2 + (c.y - want.y) ** 2;
      if (!best || d < best.d) best = { gx: x, gy: y, d };
    }
  }
  return best ? { gx: best.gx, gy: best.gy } : null;
}

// Bottom vertex of a footprint (sprite anchor point) and its depth key.
export function footprintAnchor(gx, gy, size) {
  return isoToWorld(gx + size, gy + size);
}
