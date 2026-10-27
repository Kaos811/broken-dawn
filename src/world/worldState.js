// Generic world model: a flat list of ENTITIES (creatures, player bases) with positions and owners,
// plus MARCHES moving between them. Plain JSON so it can be saved locally today and served by a
// shared backend later (see README "PvP path"). No Phaser, no store.
import { WORLD, CREATURES, NORMAL_CREATURES, creaturePower, ALLIANCES, GATHER } from '../config.js';
import { mulberry32, hashSeed } from './battle.js';

export const LOCAL_OWNER = 'local';
export const BASE_ID = 'base-local';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const marchSeconds = (d) => Math.min(WORLD.march.max, WORLD.march.base + WORLD.march.perTile * d);
export const BASE_POS = { x: WORLD.baseX, y: WORLD.baseY };
export const CENTER = { x: WORLD.centerX, y: WORLD.centerY };
export const CITADEL_ID = 'citadel';
const BASE_ANGLE = Math.atan2(WORLD.baseY - WORLD.centerY, WORLD.baseX - WORLD.centerX);

// Level for a spot in `ring` at distance d from the CENTRE: rises as you move inward (stage 12).
export function ringLevel(ring, d) {
  const R = WORLD.rings[ring];
  const span = R.levels[1] - R.levels[0] + 1;
  const k = Math.floor(((R.max + 1 - d) / (R.max - R.min + 1)) * span);
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
      hi = R.max + 1 - k * w - 0.01; lo = R.max + 1 - (k + 1) * w;
    }
    const r = Math.sqrt(lo * lo + rng() * (hi * hi - lo * lo));
    // outer zones gather on your side of the Citadel so low levels stay a short march away
    const spread = ring === 0 ? (forceLevel === 1 ? 0.12 : forceLevel != null ? 0.3 : 1.1) : ring === 1 ? 1.5 : 2;
    const a = BASE_ANGLE + (rng() - 0.5) * Math.PI * spread;
    const x = Math.round(CENTER.x + Math.cos(a) * r), y = Math.round(CENTER.y + Math.sin(a) * r);
    if (x < 1 || y < 1 || x > WORLD.size - 2 || y > WORLD.size - 2) continue;
    const d = dist({ x, y }, CENTER);
    if (d < R.min || d >= R.max + 1) continue;
    const level = ringLevel(ring, d);
    if (forceLevel != null && level !== forceLevel) continue;
    if (others.some((e) => dist(e, { x, y }) < (e.kind === 'creature' || e.kind === 'node' ? WORLD.minSpacing : WORLD.baseClear))) continue;
    const type = isElite(level) ? 'wyrm' : NORMAL_CREATURES[Math.floor(rng() * NORMAL_CREATURES.length) % NORMAL_CREATURES.length];
    const e = { id: `c${world.nextId++}`, kind: 'creature', owner: 'npc', x, y, ring, level, type, busy: null };
    others.push(e);
    return e;
  }
  return null;
}

// ---- player bases (stage 12). Today the neighbours are seeded bots; a shared server would return real
// players in exactly this shape: { id, kind: 'base', owner, name, level, tag, color, power, x, y }.
const BOT_NAMES = ['Vexa', 'Korrin', 'Maldrek', 'Sable', 'Thorne', 'Ysolde', 'Grimm', 'Orsk', 'Lyra', 'Draven', 'Hollis', 'Rook', 'Nyx', 'Bram', 'Cassia', 'Ferro', 'Ilka', 'Jett'];
const BOT_SUFFIX = ['Holdfast', 'Bastion', 'Keep', 'Watch', 'Spire', 'Hollow', 'Gate', 'Reach'];
export const basePowerFor = (level, r) => Math.round(1200 * Math.pow(1.32, level - 1) * (0.85 + r * 0.3));
export function seedBotBases(seed, count = WORLD.bots) {
  const rng = mulberry32(hashSeed(seed >>> 0, 'bots'));
  const out = [];
  const taken = [BASE_POS];
  for (let i = 0, tries = 0; out.length < count && tries < 2000; tries++) {
    // mostly in the outer zones, a few braver ones deeper in; higher level = closer to the centre
    const level = Math.max(1, Math.min(20, Math.round(1 + Math.pow(rng(), 1.6) * 21)));
    const r = Math.max(10, Math.min(36, 36 - (level - 1) * 1.2 + (rng() - 0.5) * 6));
    // bias toward your side of the map so neighbours are actually nearby
    const a = Math.PI / 2 + (rng() - 0.5) * Math.PI * (out.length < count * 0.6 ? 0.9 : 2);
    const x = Math.round(CENTER.x + Math.cos(a) * r), y = Math.round(CENTER.y + Math.sin(a) * r);
    if (x < 2 || y < 2 || x > WORLD.size - 3 || y > WORLD.size - 3) continue;
    if (taken.some((p) => dist(p, { x, y }) < 5)) continue;
    taken.push({ x, y });
    const al = rng() < 0.85 ? ALLIANCES[Math.floor(rng() * ALLIANCES.length)] : null;
    const name = `${BOT_NAMES[(i * 7 + Math.floor(rng() * BOT_NAMES.length)) % BOT_NAMES.length]}'s ${BOT_SUFFIX[Math.floor(rng() * BOT_SUFFIX.length)]}`;
    out.push({ id: `bot-${i}`, kind: 'base', owner: `bot:${i}`, bot: true, name, level, tag: al?.tag ?? null, color: al?.color ?? 0x8a96a8, power: basePowerFor(level, rng()), x, y });
    i++;
  }
  return out;
}

// ---- Alloy nodes (stage 16). Shape a server would also return: { id, kind: 'node', res, level, amount, max, x, y,
// busy, regrowAt }. Level is set by distance from YOUR base (close = Lv 1 and safe, farther = richer).
export const NODE_LEVELS = GATHER.levels.length;
export const nodeMax = (L) => GATHER.levels[Math.max(1, Math.min(NODE_LEVELS, L)) - 1].amount;
export function spawnNode(world, level) {
  const G = GATHER.levels[level - 1];
  const rng = nextRng(world, 'node');
  for (let tries = 0; tries < 400; tries++) {
    const r = G.band[0] + rng() * (G.band[1] - G.band[0]);
    // mostly toward the map (north of the base), never off the south edge
    const a = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.25;
    const x = Math.round(WORLD.baseX + Math.cos(a) * r), y = Math.round(WORLD.baseY + Math.sin(a) * r);
    if (x < 2 || y < 2 || x > WORLD.size - 3 || y > WORLD.size - 3) continue;
    if (dist({ x, y }, CENTER) < WORLD.citadelRadius + 3) continue;
    if (world.entities.some((e) => dist(e, { x, y }) < (e.kind === 'citadel' ? WORLD.baseClear : e.kind === 'base' ? WORLD.baseClear + (e.owner === LOCAL_OWNER ? 0 : 1.2) : WORLD.minSpacing + 0.3))) continue;
    const e = { id: `n${world.nextId++}`, kind: 'node', owner: 'npc', res: 'alloy', level, amount: G.amount, max: G.amount, x, y, busy: null, regrowAt: 0 };
    world.entities.push(e);
    return e;
  }
  return null;
}
export function seedNodes(world) {
  GATHER.levels.forEach((G, i) => { for (let k = 0; k < G.count; k++) spawnNode(world, i + 1); });
}

export function createWorld(seed = (Math.random() * 2 ** 31) >>> 0) {
  const world = { seed, rngCursor: 0, nextId: 1, clock: 0, entities: [], respawns: [], marches: [] };
  world.entities.push({ id: BASE_ID, kind: 'base', owner: LOCAL_OWNER, name: 'Your Base', x: WORLD.baseX, y: WORLD.baseY });
  world.entities.push({ id: CITADEL_ID, kind: 'citadel', owner: 'neutral', name: 'Rift Citadel', locked: true, x: CENTER.x, y: CENTER.y });
  world.entities.push(...seedBotBases(seed));
  WORLD.rings.forEach((R, ring) => {
    // every level of the ring appears at least once, the rest are random
    for (let L = R.levels[0]; L <= R.levels[1]; L++) spawnCreature(world, ring, L);
    for (let k = R.levels[1] - R.levels[0] + 1; k < R.count; k++) spawnCreature(world, ring);
  });
  seedNodes(world);
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
      const b = e.bot
        ? { id: String(e.id), kind: 'base', owner: String(e.owner), bot: true, name: String(e.name ?? 'Base'), level: Math.max(1, Math.min(20, Math.floor(n(e.level, 1)))), tag: typeof e.tag === 'string' ? e.tag : null, color: n(e.color, 0x8a96a8), power: Math.max(0, n(e.power, 0)), x: n(e.x, 0), y: n(e.y, 0) }
        : { id: String(e.id), kind: 'base', owner: String(e.owner ?? LOCAL_OWNER), name: String(e.name ?? 'Base'), x: n(e.x, WORLD.baseX), y: n(e.y, WORLD.baseY) };
      if (b.id === BASE_ID) { b.x = WORLD.baseX; b.y = WORLD.baseY; }
      out.entities.push(b);
      ids.add(e.id);
    } else if (e.kind === 'node' && e.level >= 1 && e.level <= NODE_LEVELS) {
      const L = Math.floor(e.level), max = nodeMax(L);
      out.entities.push({ id: String(e.id), kind: 'node', owner: 'npc', res: 'alloy', level: L, amount: Math.min(max, Math.max(0, n(e.amount, max))), max, x: n(e.x, 0), y: n(e.y, 0), busy: null, regrowAt: Math.max(0, n(e.regrowAt, 0)) });
      const nd = out.entities[out.entities.length - 1];
      if (nd.amount < 1 && !nd.regrowAt) nd.regrowAt = out.clock + GATHER.regrowSeconds;
      ids.add(e.id);
    } else if (e.kind === 'citadel') {
      out.entities.push({ id: CITADEL_ID, kind: 'citadel', owner: 'neutral', name: 'Rift Citadel', locked: true, x: CENTER.x, y: CENTER.y });
      ids.add(e.id);
    }
  }
  if (!out.entities.some((e) => e.id === BASE_ID)) out.entities.unshift({ id: BASE_ID, kind: 'base', owner: LOCAL_OWNER, name: 'Your Base', x: WORLD.baseX, y: WORLD.baseY });
  if (!ids.has(CITADEL_ID)) out.entities.push({ id: CITADEL_ID, kind: 'citadel', owner: 'neutral', name: 'Rift Citadel', locked: true, x: CENTER.x, y: CENTER.y });
  if (!out.entities.some((e) => e.bot)) out.entities.push(...seedBotBases(out.seed));
  for (const r of Array.isArray(w.respawns) ? w.respawns : []) if (WORLD.rings[r?.ring] && Number.isFinite(r.at)) out.respawns.push({ ring: r.ring, at: r.at });
  for (const m of Array.isArray(w.marches) ? w.marches : []) {
    if (!m || !['out', 'back', 'gather'].includes(m.phase) || !m.army || !Array.isArray(m.army.lines)) continue;
    const t = out.entities.find((e) => e.id === m.targetId);
    if ((m.phase === 'out' || m.phase === 'gather') && !t) { m.phase = 'back'; m.t = 0; } // target vanished: just come home
    if (t && (m.phase === 'out' || m.phase === 'gather')) t.busy = m.id;
    const g = m.gather ? { gather: { cap: Math.max(1, n(m.gather.cap, 1)), rate: Math.max(0, n(m.gather.rate, 0)), load: Math.max(0, n(m.gather.load, 0)), level: Math.max(1, Math.floor(n(m.gather.level, 1))) } } : {};
    out.marches.push({ ...m, ...g, t: Math.max(0, n(m.t, 0)), travel: Math.max(0.1, n(m.travel, 5)), back: Math.max(0.1, n(m.back, n(m.travel, 5))) });
  }
  // top up anything that went missing (e.g. a creature lost to a bad save)
  WORLD.rings.forEach((R, ring) => {
    const have = out.entities.filter((e) => e.kind === 'creature' && e.ring === ring).length + out.respawns.filter((r) => r.ring === ring).length;
    for (let k = have; k < R.count; k++) spawnCreature(out, ring);
  });
  // v15: older saves have no Alloy nodes yet; seed them around the base
  if (!out.entities.some((e) => e.kind === 'node')) seedNodes(out);
  return out;
}
