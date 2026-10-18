// Generic world model: a flat list of ENTITIES (creatures, player bases) with positions and owners,
// plus MARCHES moving between them. Plain JSON so it can be saved locally today and served by a
// shared backend later (see README "PvP path"). No Phaser, no store.
import { WORLD, CREATURES, NORMAL_CREATURES, creaturePower } from '../config.js';
import { mulberry32, hashSeed } from './battle.js';

export const LOCAL_OWNER = 'local';
export const BASE_ID = 'base-local';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const marchSeconds = (d) => Math.min(WORLD.march.max, WORLD.march.base + WORLD.march.perTile * d);
export const BASE_POS = { x: WORLD.baseX, y: WORLD.baseY };

export function ringLevel(ring, d) {
  const R = WORLD.rings[ring];
  const span = R.levels[1] - R.levels[0] + 1;
  const k = Math.floor(((d - R.min) / (R.max - R.min + 1)) * span);
  return Math.max(R.levels[0], Math.min(R.levels[1], R.levels[0] + k));
}
export const ringOfLevel = (L) => WORLD.rings.findIndex((r) => L >= r.levels[0] && L <= r.levels[1]);
export const isElite = (L) => L % 5 === 0;

function nextRng(world, tag) { world.rngCursor = (world.rngCursor ?? 0) + 1; return mulberry32(hashSeed(world.seed, tag, world.rngCursor)); }

// Place a creature in `ring`, optionally forcing a level. Returns the entity or null.
export function spawnCreature(world, ring, forceLevel = null) {
  const R = WORLD.rings[ring];
  const rng = nextRng(world, 'spawn');
  const others = world.entities;
  for (let tries = 0; tries < 300; tries++) {
    let lo = R.min, hi = R.max + 0.99;
    if (forceLevel != null) {
      const span = R.levels[1] - R.levels[0] + 1, w = (R.max - R.min + 1) / span, k = forceLevel - R.levels[0];
      lo = R.min + k * w; hi = R.min + (k + 1) * w - 0.01;
    }
    const r = Math.sqrt(lo * lo + rng() * (hi * hi - lo * lo));
    const a = rng() * Math.PI * 2;
    const x = Math.round(WORLD.baseX + Math.cos(a) * r), y = Math.round(WORLD.baseY + Math.sin(a) * r);
    if (x < 1 || y < 1 || x > WORLD.size - 2 || y > WORLD.size - 2) continue;
    const d = dist({ x, y }, BASE_POS);
    if (d < R.min || d >= R.max + 1) continue;
    const level = ringLevel(ring, d);
    if (forceLevel != null && level !== forceLevel) continue;
    if (others.some((e) => dist(e, { x, y }) < WORLD.minSpacing)) continue;
    const type = isElite(level) ? 'wyrm' : NORMAL_CREATURES[Math.floor(rng() * NORMAL_CREATURES.length) % NORMAL_CREATURES.length];
    const e = { id: `c${world.nextId++}`, kind: 'creature', owner: 'npc', x, y, ring, level, type, busy: null };
    others.push(e);
    return e;
  }
  return null;
}

export function createWorld(seed = (Math.random() * 2 ** 31) >>> 0) {
  const world = { seed, rngCursor: 0, nextId: 1, clock: 0, entities: [], respawns: [], marches: [] };
  world.entities.push({ id: BASE_ID, kind: 'base', owner: LOCAL_OWNER, name: 'Your Base', x: WORLD.baseX, y: WORLD.baseY });
  WORLD.rings.forEach((R, ring) => {
    // every level of the ring appears at least once, the rest are random
    for (let L = R.levels[0]; L <= R.levels[1]; L++) spawnCreature(world, ring, L);
    for (let k = R.levels[1] - R.levels[0] + 1; k < R.count; k++) spawnCreature(world, ring);
  });
  return world;
}

export const creatureInfo = (e) => ({ ...CREATURES[e.type], level: e.level, power: creaturePower(e.level, !!CREATURES[e.type].elite) });

// Validates + repairs a loaded world. Returns null if it's unusable (caller regenerates).
export function sanitizeWorld(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.entities)) return null;
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  const out = {
    seed: n(w.seed, 1) >>> 0, rngCursor: Math.max(0, Math.floor(n(w.rngCursor, 0))), nextId: Math.max(1, Math.floor(n(w.nextId, 1))), clock: Math.max(0, n(w.clock, 0)),
    entities: [], respawns: [], marches: [],
  };
  const ids = new Set();
  for (const e of w.entities) {
    if (!e || ids.has(e.id)) continue;
    if (e.kind === 'creature' && CREATURES[e.type] && e.level >= 1 && e.level <= WORLD.maxLevel) {
      out.entities.push({ id: String(e.id), kind: 'creature', owner: 'npc', x: n(e.x, 0), y: n(e.y, 0), ring: ringOfLevel(e.level), level: Math.floor(e.level), type: e.type, busy: null });
      ids.add(e.id);
    } else if (e.kind === 'base') {
      out.entities.push({ id: String(e.id), kind: 'base', owner: String(e.owner ?? LOCAL_OWNER), name: String(e.name ?? 'Base'), x: n(e.x, WORLD.baseX), y: n(e.y, WORLD.baseY) });
      ids.add(e.id);
    }
  }
  if (!out.entities.some((e) => e.id === BASE_ID)) out.entities.unshift({ id: BASE_ID, kind: 'base', owner: LOCAL_OWNER, name: 'Your Base', x: WORLD.baseX, y: WORLD.baseY });
  for (const r of Array.isArray(w.respawns) ? w.respawns : []) if (WORLD.rings[r?.ring] && Number.isFinite(r.at)) out.respawns.push({ ring: r.ring, at: r.at });
  for (const m of Array.isArray(w.marches) ? w.marches : []) {
    if (!m || !['out', 'back'].includes(m.phase) || !m.army || !Array.isArray(m.army.lines)) continue;
    const t = out.entities.find((e) => e.id === m.targetId);
    if (m.phase === 'out' && !t) { m.phase = 'back'; m.t = 0; } // target vanished: just come home
    if (t && m.phase === 'out') t.busy = m.id;
    out.marches.push({ ...m, t: Math.max(0, n(m.t, 0)), travel: Math.max(0.1, n(m.travel, 5)), back: Math.max(0.1, n(m.back, n(m.travel, 5))) });
  }
  // top up anything that went missing (e.g. a creature lost to a bad save)
  WORLD.rings.forEach((R, ring) => {
    const have = out.entities.filter((e) => e.kind === 'creature' && e.ring === ring).length + out.respawns.filter((r) => r.ring === ring).length;
    for (let k = have; k < R.count; k++) spawnCreature(out, ring);
  });
  return out;
}
