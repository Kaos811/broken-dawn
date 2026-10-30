// Generic world model: a flat list of ENTITIES (creatures, player bases) with positions and owners,
// plus MARCHES moving between them. Plain JSON so it can be saved locally today and served by a
// shared backend later (see README "PvP path"). No Phaser, no store.
import { WORLD, CREATURES, NORMAL_CREATURES, typePower, ALLIANCES, GATHER, RALLY } from '../config.js';
import { mulberry32, hashSeed } from './battle.js';

export const LOCAL_OWNER = 'local';
export const BASE_ID = 'base-local';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const marchSeconds = (d) => Math.min(WORLD.march.max, WORLD.march.base + WORLD.march.perTile * d);
export const BASE_POS = { x: WORLD.baseX, y: WORLD.baseY }; // where a NEW base starts (stage 18: the live one moves)
export const CENTER = { x: WORLD.centerX, y: WORLD.centerY };
export const CITADEL_ID = 'citadel';
const clampL = (L) => Math.max(1, Math.min(WORLD.maxLevel, L));
export const isElite = (L) => L % 5 === 0;
export const homeOf = (world) => world.entities.find((e) => e.id === BASE_ID) ?? BASE_POS;

// Stage 18: smooth level gradient by distance from the Citadel (no zones). Returns a fractional level.
export function gradientLevel(d) {
  const G = WORLD.gradient;
  return Math.max(1, Math.min(WORLD.maxLevel, 1 + (WORLD.maxLevel - 1) * (G.outer - d) / (G.outer - G.inner)));
}
export const levelAtTile = (x, y) => clampL(Math.round(gradientLevel(dist({ x, y }, CENTER))));

function nextRng(world, tag) { world.rngCursor = (world.rngCursor ?? 0) + 1; return mulberry32(hashSeed(world.seed, tag, world.rngCursor)); }

// Is (x,y) a free spot for a creature / node (inside the map, outside the dome, spaced from everything)?
export function freeSpot(world, x, y, spacing = WORLD.minSpacing) {
  if (x < 1 || y < 1 || x > WORLD.size - 2 || y > WORLD.size - 2) return false;
  if (dist({ x, y }, CENTER) < WORLD.citadelRadius + 2) return false;
  return !world.entities.some((e) => dist(e, { x, y }) < (e.kind === 'creature' || e.kind === 'node' ? spacing : e.kind === 'citadel' ? WORLD.citadelRadius + 2 : WORLD.baseClear));
}
const lifetime = (world, rng) => world.clock + WORLD.lifetime[0] + rng() * (WORLD.lifetime[1] - WORLD.lifetime[0]);

// Place a creature at a random free spot. Default: uniform over the whole map, level from the gradient
// (+-jitter). opts.near {x,y} + opts.radius: somewhere near that point instead. opts.maxLevel caps the
// level (near-base top-ups for weaker players), opts.level forces one exact level. Returns the entity or null.
export function spawnCreature(world, opts = {}) {
  const { near = null, radius = WORLD.near.radius, maxLevel = null, level: want = null, minDist = 0 } = opts;
  const rng = nextRng(world, 'spawn');
  const J = WORLD.gradient.jitter;
  for (let tries = 0; tries < 400; tries++) {
    let x, y;
    if (near) { const a = rng() * Math.PI * 2, r = Math.max(minDist, Math.sqrt(rng()) * radius); x = Math.round(near.x + Math.cos(a) * r); y = Math.round(near.y + Math.sin(a) * r); }
    else { x = 1 + Math.floor(rng() * (WORLD.size - 2)); y = 1 + Math.floor(rng() * (WORLD.size - 2)); }
    if (!freeSpot(world, x, y)) continue;
    const g = Math.round(gradientLevel(dist({ x, y }, CENTER)));
    let level;
    if (want != null) {
      if (Math.abs(g - want) > J && !(near && maxLevel != null)) continue;
      level = want;
    } else {
      level = clampL(g + Math.floor(rng() * (2 * J + 1)) - J);
      if (maxLevel != null && level > maxLevel) level = clampL(maxLevel - Math.floor(rng() * 3));
    }
    const type = isElite(level) ? 'wyrm' : NORMAL_CREATURES[Math.floor(rng() * NORMAL_CREATURES.length) % NORMAL_CREATURES.length];
    const e = { id: `c${world.nextId++}`, kind: 'creature', owner: 'npc', x, y, level, type, busy: null, expires: lifetime(world, rng) };
    world.entities.push(e);
    return e;
  }
  return null;
}

// The near-base guarantee: >= WORLD.near.count creatures you can attack (level <= maxL) within
// WORLD.near.radius of `home`, including one at maxL and (while maxL <= 2) one Lv 1. Returns spawned ones.
export function ensureNearCreatures(world, home, maxL) {
  const R = WORLD.near.radius, out = [];
  const near = () => world.entities.filter((e) => e.kind === 'creature' && !CREATURES[e.type]?.rallyOnly && e.level <= maxL && dist(e, home) <= R);
  const push = (e) => { if (e) out.push(e); return e; };
  if (maxL <= 2 && !near().some((e) => e.level === 1)) push(spawnCreature(world, { near: home, radius: 7.25, minDist: 3, level: 1, maxLevel: 1 }));
  if (!near().some((e) => e.level === maxL)) push(spawnCreature(world, { near: home, radius: R - 0.75, minDist: 3, level: maxL, maxLevel: maxL }));
  for (let k = near().length, guard = 0; k < WORLD.near.count && guard < 20; guard++) { if (push(spawnCreature(world, { near: home, radius: R - 0.75, minDist: 3, maxLevel: maxL }))) k++; }
  return out;
}

// ---- player bases (stage 12). Today the neighbours are seeded bots; a shared server would return real
// players in exactly this shape: { id, kind: 'base', owner, name, level, tag, color, power, x, y }.
const BOT_NAMES = ['Vexa', 'Korrin', 'Maldrek', 'Sable', 'Thorne', 'Ysolde', 'Grimm', 'Orsk', 'Lyra', 'Draven', 'Hollis', 'Rook', 'Nyx', 'Bram', 'Cassia', 'Ferro', 'Ilka', 'Jett'];
const BOT_SUFFIX = ['Holdfast', 'Bastion', 'Keep', 'Watch', 'Spire', 'Hollow', 'Gate', 'Reach'];
export const basePowerFor = (level, r) => Math.round(1200 * Math.pow(1.32, level - 1) * (0.85 + r * 0.3));
export function seedBotBases(seed, count = WORLD.bots, avoid = [BASE_POS]) {
  const rng = mulberry32(hashSeed(seed >>> 0, 'bots'));
  const out = [];
  const taken = [...avoid];
  for (let i = 0, tries = 0; out.length < count && tries < 4000; tries++) {
    // stage 18: anywhere on the map; stronger bots tend to live closer to the Citadel (same gradient)
    const x = 3 + Math.floor(rng() * (WORLD.size - 6)), y = 3 + Math.floor(rng() * (WORLD.size - 6));
    const d = dist({ x, y }, CENTER);
    if (d < WORLD.citadelRadius + 4) continue;
    if (taken.some((p) => dist(p, { x, y }) < 5)) continue;
    taken.push({ x, y });
    const level = clampL(Math.round(gradientLevel(d)) + Math.floor(rng() * 5) - 2);
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
// Stage 18: node level follows the Citadel gradient too (5 levels over the same span).
export const nodeLevelAt = (x, y) => Math.max(1, Math.min(NODE_LEVELS, Math.ceil((gradientLevel(dist({ x, y }, CENTER)) / WORLD.maxLevel) * NODE_LEVELS)));
export function spawnNode(world, level, opts = {}) {
  const G = GATHER.levels[level - 1];
  const { near = null, radius = GATHER.near.radius } = opts;
  const rng = nextRng(world, 'node');
  for (let tries = 0; tries < 600; tries++) {
    let x, y;
    if (near) { const a = rng() * Math.PI * 2, r = 3 + Math.sqrt(rng()) * (radius - 3); x = Math.round(near.x + Math.cos(a) * r); y = Math.round(near.y + Math.sin(a) * r); }
    else { x = 2 + Math.floor(rng() * (WORLD.size - 4)); y = 2 + Math.floor(rng() * (WORLD.size - 4)); }
    if (x < 2 || y < 2 || x > WORLD.size - 3 || y > WORLD.size - 3) continue;
    if (dist({ x, y }, CENTER) < WORLD.citadelRadius + 3) continue;
    if (!near && nodeLevelAt(x, y) !== level) continue;
    if (world.entities.some((e) => dist(e, { x, y }) < (e.kind === 'citadel' ? WORLD.baseClear : e.kind === 'base' ? WORLD.baseClear + (e.owner === LOCAL_OWNER ? 0 : 1.2) : WORLD.minSpacing + 0.3))) continue;
    const e = { id: `n${world.nextId++}`, kind: 'node', owner: 'npc', res: 'alloy', level, amount: G.amount, max: G.amount, x, y, busy: null, regrowAt: 0 };
    world.entities.push(e);
    return e;
  }
  return null;
}
export function ensureNearNodes(world, home) {
  const N = GATHER.near, out = [];
  const have = () => world.entities.filter((e) => e.kind === 'node' && e.level <= N.maxLevel && dist(e, home) <= N.radius).length;
  for (let k = have(), guard = 0; k < N.count && guard < 8; guard++) { const e = spawnNode(world, 1 + (k % N.maxLevel), { near: home }); if (e) { out.push(e); k++; } }
  return out;
}
export function seedNodes(world) {
  GATHER.levels.forEach((G, i) => { for (let k = 0; k < G.count; k++) spawnNode(world, i + 1); });
  ensureNearNodes(world, homeOf(world));
}

// Fresh world. `base` keeps an existing base position (save migration); default = the new-player spot.
export function createWorld(seed = (Math.random() * 2 ** 31) >>> 0, base = BASE_POS) {
  const world = { seed, rngCursor: 0, nextId: 1, clock: 0, entities: [], respawns: [], marches: [], rallies: [], bossAt: {} };
  world.entities.push({ id: BASE_ID, kind: 'base', owner: LOCAL_OWNER, name: 'Your Base', x: base.x, y: base.y });
  world.entities.push({ id: CITADEL_ID, kind: 'citadel', owner: 'neutral', name: 'Rift Citadel', locked: true, x: CENTER.x, y: CENTER.y });
  world.entities.push(...seedBotBases(seed, WORLD.bots, [base]));
  seedNodes(world);
  // every level appears at least once (so search always has something to find), the rest at random
  for (let L = 1; L <= WORLD.maxLevel; L++) spawnCreature(world, { level: L });
  ensureNearCreatures(world, base, 1);
  while (world.entities.filter((e) => e.kind === 'creature').length < WORLD.creatures) if (!spawnCreature(world)) break;
  ensureBehemoths(world); // stage 19
  return world;
}

export const creatureInfo = (e) => ({ ...CREATURES[e.type], level: e.level, power: typePower(e.type, e.level) });

// ---- stage 19: Rift Behemoths (rally-only world bosses). One per RALLY level on the map at a time.
export const isBoss = (e) => e?.kind === 'creature' && !!CREATURES[e.type]?.rallyOnly;
export function spawnBehemoth(world, level) {
  const rng = nextRng(world, 'boss');
  for (let tries = 0; tries < 800; tries++) {
    let x, y;
    if (level > WORLD.maxLevel) { // Lv 25: only right outside the Citadel dome
      const a = rng() * Math.PI * 2, r = WORLD.citadelRadius + 2.5 + rng() * 4;
      x = Math.round(CENTER.x + Math.cos(a) * r); y = Math.round(CENTER.y + Math.sin(a) * r);
    } else { x = 2 + Math.floor(rng() * (WORLD.size - 4)); y = 2 + Math.floor(rng() * (WORLD.size - 4)); }
    if (!freeSpot(world, x, y, WORLD.minSpacing + 0.8)) continue;
    if (level <= WORLD.maxLevel && Math.abs(gradientLevel(dist({ x, y }, CENTER)) - level) > 1.5) continue;
    const e = { id: `c${world.nextId++}`, kind: 'creature', owner: 'npc', x, y, level, type: 'behemoth', busy: null, expires: world.clock + RALLY.lifetime };
    world.entities.push(e);
    return e;
  }
  return null;
}
// Any Behemoth level missing (and past its respawn time) gets a fresh one. Returns the spawned entities.
export function ensureBehemoths(world) {
  const out = [];
  world.bossAt = world.bossAt ?? {};
  for (const L of RALLY.levels) {
    if (world.entities.some((e) => e.type === 'behemoth' && e.level === L)) continue;
    if ((world.bossAt[L] ?? 0) > world.clock) continue;
    const e = spawnBehemoth(world, L);
    if (e) { out.push(e); delete world.bossAt[L]; } else world.bossAt[L] = world.clock + 30;
  }
  return out;
}

// Validates + repairs a loaded world. Returns null if it's unusable (caller regenerates).
export function sanitizeWorld(w) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.entities)) return null;
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  const out = {
    seed: n(w.seed, 1) >>> 0, rngCursor: Math.max(0, Math.floor(n(w.rngCursor, 0))), nextId: Math.max(1, Math.floor(n(w.nextId, 1))), clock: Math.max(0, n(w.clock, 0)),
    entities: [], respawns: [], marches: [], rallies: [], bossAt: {},
  };
  for (const L of RALLY.levels) if (Number.isFinite(w.bossAt?.[L])) out.bossAt[L] = w.bossAt[L];
  const ids = new Set();
  for (const e of w.entities) {
    if (!e || ids.has(e.id)) continue;
    if (e.kind === 'creature' && CREATURES[e.type] && (CREATURES[e.type].rallyOnly ? RALLY.levels.includes(e.level) : e.level >= 1 && e.level <= WORLD.maxLevel)) {
      out.entities.push({ id: String(e.id), kind: 'creature', owner: 'npc', x: n(e.x, 0), y: n(e.y, 0), level: Math.floor(e.level), type: e.type, busy: null, expires: n(e.expires, out.clock + WORLD.lifetime[0]) });
      ids.add(e.id);
    } else if (e.kind === 'base') {
      const b = e.bot
        ? { id: String(e.id), kind: 'base', owner: String(e.owner), bot: true, name: String(e.name ?? 'Base'), level: Math.max(1, Math.min(20, Math.floor(n(e.level, 1)))), tag: typeof e.tag === 'string' ? e.tag : null, color: n(e.color, 0x8a96a8), power: Math.max(0, n(e.power, 0)), x: n(e.x, 0), y: n(e.y, 0) }
        : { id: String(e.id), kind: 'base', owner: String(e.owner ?? LOCAL_OWNER), name: String(e.name ?? 'Base'), x: n(e.x, WORLD.baseX), y: n(e.y, WORLD.baseY) };
      if (b.id === BASE_ID && !(b.x >= 0 && b.y >= 0 && b.x < WORLD.size && b.y < WORLD.size)) { b.x = WORLD.baseX; b.y = WORLD.baseY; }
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
  for (const r of Array.isArray(w.respawns) ? w.respawns : []) if (Number.isFinite(r?.at)) out.respawns.push({ at: r.at });
  for (const m of Array.isArray(w.marches) ? w.marches : []) {
    if (!m || !['out', 'back', 'gather', 'rally'].includes(m.phase) || !m.army || !Array.isArray(m.army.lines)) continue;
    const t = out.entities.find((e) => e.id === m.targetId);
    if ((m.phase === 'out' || m.phase === 'gather') && !t) { m.phase = 'back'; m.t = 0; } // target vanished: just come home
    if (m.phase === 'rally' && !(t && Array.isArray(w.rallies) && w.rallies.some((r) => r?.marchId === m.id))) continue; // orphaned rally: drop (squad is home)
    if (t && (m.phase === 'out' || m.phase === 'gather' || m.phase === 'rally')) t.busy = m.id;
    const g = m.gather ? { gather: { cap: Math.max(1, n(m.gather.cap, 1)), rate: Math.max(0, n(m.gather.rate, 0)), load: Math.max(0, n(m.gather.load, 0)), level: Math.max(1, Math.floor(n(m.gather.level, 1))) } } : {};
    out.marches.push({ ...m, ...g, t: Math.max(0, n(m.t, 0)), travel: Math.max(0.1, n(m.travel, 5)), back: Math.max(0.1, n(m.back, n(m.travel, 5))) });
  }
  for (const r of Array.isArray(w.rallies) ? w.rallies : []) {
    const m = out.marches.find((x) => x.id === r?.marchId);
    if (!m || !Array.isArray(r.members) || !Number.isFinite(r.launchAt)) continue;
    out.rallies.push({ ...r, members: r.members.filter((x) => x && Array.isArray(x.army?.lines)), plan: Array.isArray(r.plan) ? r.plan : [] });
  }
  if (!out.entities.some((e) => e.type === 'behemoth')) ensureBehemoths(out);
  // top up anything that went missing (e.g. a creature lost to a bad save)
  for (let k = out.entities.filter((e) => e.kind === 'creature' && !isBoss(e)).length + out.respawns.length; k < WORLD.creatures; k++) spawnCreature(out);
  if (!out.entities.some((e) => e.kind === 'node')) seedNodes(out);
  return out;
}
