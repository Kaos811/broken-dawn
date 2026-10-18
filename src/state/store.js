// Single source of truth for game state + persistence. Scenes read `store.state`
// and listen for events; they never write localStorage directly.
import {
  BEACON, BUILDINGS, BUILDING_IDS, BUILDING_LEVEL_HEADROOM, ECONOMY,
  SAVE_KEY, SAVE_VERSION, TROOPS, buildingUpgradeCost,
  TROOP_CLASSES, TROOP_IDS, BARRACKS, SQUADS, RESOURCES, GACHA, RARITY, RARITIES,
  LEADERS, LEADER_IDS, GEAR, GEAR_IDS, CORES, UPGRADES, CONSTRUCTION,
  INFIRMARY, CASUALTIES, STAMINA, WORLD, HUNT_REWARDS, CREATURES, creaturePower, MAP,
  CLASS_IDS, TIERS, MAX_TIER, PROMOTE, RESEARCH, RESEARCH_IDS, RESEARCH_TUNING, healBase, classOf, tierOf, nextTier,
} from '../config.js';
import { researchMods, researchLevel, archiveUnlocked } from '../systems/research.js';
import { isValidPlacement } from '../systems/grid.js';
import { basePower, squadPower, squadSoldiers, troopPowerBreakdown } from '../systems/power.js';
import { LocalWorldService } from '../world/worldService.js';
import { createWorld, sanitizeWorld, dist, marchSeconds, LOCAL_OWNER } from '../world/worldState.js';
import { squadArmy } from '../world/armies.js';
import { combatPower, resolveBattle, odds } from '../world/battle.js';

// Line: { type, count, full } -- `count` = healthy troops in the line now, `full` = the count the formation
// was saved with (casualties lower `count`; healing and Refill bring it back up to `full`).
const emptyLines = () => Array.from({ length: SQUADS.lines }, () => ({ type: null, count: 0, full: 0 }));
// Training lanes: one per CLASS. A lane runs one job type at a time: training `unit`, or (from != null)
// promoting `from` -> `unit`. count = units still queued; progress = seconds into the current one.
const emptyLane = (cls) => ({ count: 0, progress: 0, unit: cls, from: null });
const emptyLanes = () => Object.fromEntries(CLASS_IDS.map((c) => [c, emptyLane(c)]));
const emptyResearch = () => ({ levels: {}, job: null }); // job: { id, toLevel, cost: {energy, alloy, shards}, total, progress }
const emptySquad = () => ({ level: 1, lines: emptyLines(), leader: null, armor: null, weapon: null });
const ORIGINS = [...TROOPS.squadIds, 'reserve'];
const emptyWounded = () => Object.fromEntries(TROOP_IDS.map((t) => [t, Object.fromEntries(ORIGINS.map((o) => [o, 0]))]));
const defaultHunt = () => ({ stamina: STAMINA.max, staminaCarry: 0, auto: false, bestKill: 0, firstKills: [], kills: 0, losses: 0, dead: 0, reports: [], reportSeq: 0 });

function defaultState() {
  const buildings = {};
  for (const id of BUILDING_IDS) {
    const s = BUILDINGS[id].start;
    buildings[id] = { level: s.level, gx: s.gx, gy: s.gy };
  }
  const squads = {};
  for (const id of TROOPS.squadIds) squads[id] = emptySquad();
  const troops = {};
  for (const t of TROOP_IDS) troops[t] = 0;
  return {
    version: SAVE_VERSION,
    resources: { energy: ECONOMY.startEnergy, shards: RESOURCES.startShards, alloy: RESOURCES.startAlloy, cores: CORES.start },
    beacon: { level: 1, charge: 0 },
    buildings,
    troops,                 // owned soldiers per class (ready + assigned)
    training: emptyLanes(), // parallel lanes: { [type]: { count, progress } } (progress = seconds into current unit)
    squads,
    leaders: {},            // { id: { stars } }
    gear: {},               // { id: count }
    gearLevels: {},         // { id: level } (applies to every copy; missing = Lv 1)
    daily: { lastDay: null, streak: 0 },     // daily login reward (local calendar days)
    claims: { beacon: [], milestones: [] },  // one-time Core rewards already claimed
    construction: [],       // running upgrades: [{ id, toLevel, cost, total, progress }] (progress in seconds)
    gacha: { sinceEpic: 0, sinceLegendary: 0, total: 0, history: [] },
    hunt: defaultHunt(),                       // stage 3: player-side hunt progress (stamina, kills, reports)
    infirmary: { wounded: emptyWounded(), queue: [] }, // wounded[type][origin squad] + healing batches
    world: createWorld(),                      // stage 3: shared-world model (entities + marches), see worldService
    research: emptyResearch(),                 // stage 4: Archive research levels + the one running project
    lastSaved: Date.now(),
  };
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(evt, fn) { (this.handlers[evt] ??= new Set()).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.handlers[evt]?.delete(fn); }
  emit(evt, ...args) { this.handlers[evt]?.forEach((fn) => fn(...args)); }
}

function num(v, d) { return Number.isFinite(v) ? v : d; }
const int = (v, d = 0) => Math.max(0, Math.floor(num(v, d)));

// v1 (stage 1) -> v2 (stage 2). Never drops progress: buildings, levels, Energy and
// Beacon carry over; new resources start at their defaults.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const v = num(raw.version, 1);
  if (v < 2) {
    raw = { ...raw };
    raw.resources = { shards: RESOURCES.startShards, alloy: RESOURCES.startAlloy, ...(raw.resources ?? {}) };
    const squads = {};
    for (const id of TROOPS.squadIds) {
      const old = raw.squads?.[id] ?? {};
      const lines = (Array.isArray(old.members) ? old.members : []).slice(0, SQUADS.lines).map((m) => ({ type: m?.type ?? null, count: m?.count ?? 0 }));
      squads[id] = { level: old.level ?? 1, lines, leader: null, armor: null, weapon: null };
    }
    raw.squads = squads;
    raw.version = 2;
  }
  // v2 -> v3: the single sequential queue [{ type, count, progress }] becomes one lane per class.
  // Every queued unit moves into its class lane (counts are summed, nothing is dropped), and the
  // head batch's partial progress carries over to its lane. Energy was paid up front, so it's untouched.
  if (num(raw.version, 1) < 3) {
    raw = { ...raw };
    const lanes = emptyLanes();
    const q = Array.isArray(raw.training) ? raw.training : [];
    q.forEach((b, i) => {
      if (!TROOP_CLASSES[b?.type]) return;
      const n = int(b.count);
      if (n < 1) return;
      lanes[b.type].count += n;
      if (i === 0) lanes[b.type].progress = Math.max(0, num(b.progress, 0));
    });
    raw.training = lanes;
    raw.version = 3;
  }
  // v3 -> v4: Beacon Cores. Existing Shards stay; grant the starter Cores once.
  if (num(raw.version, 1) < 4) {
    raw = { ...raw };
    raw.resources = { ...(raw.resources ?? {}) };
    raw.resources.cores = int(raw.resources.cores) + CORES.migrationGrant;
    raw.version = 4;
  }
  // v4 -> v5: building upgrade timers. Levels reached before timers existed are kept as-is;
  // nothing is under construction yet.
  if (num(raw.version, 1) < 5) {
    raw = { ...raw, construction: [] };
    raw.version = 5;
  }
  // v5 -> v6: World hunts + Infirmary. Everything is kept; the Infirmary is added at Lv 1 (placed on a
  // free spot if its default one is taken), a world is generated, stamina starts full, and each saved
  // formation's current counts become its "full" counts.
  if (num(raw.version, 1) < 6) {
    raw = { ...raw };
    for (const sq of Object.values(raw.squads ?? {})) for (const l of Array.isArray(sq?.lines) ? sq.lines : []) if (l) l.full = l.count;
    raw.version = 6;
  }
  // v6 -> v7: research + troop tiers. Every existing troop is T1 (T1 keeps the class id, so troops,
  // formations, wounded and heal queues carry over untouched). Lanes get their job fields; no research yet.
  if (num(raw.version, 1) < 7) {
    raw = { ...raw };
    const tr = raw.training ?? {};
    raw.training = Object.fromEntries(CLASS_IDS.map((c) => [c, { count: int(tr[c]?.count), progress: num(tr[c]?.progress, 0), unit: c, from: null }]));
    raw.research = emptyResearch();
    raw.version = 7;
  }
  return raw;
}

function sanitize(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  raw = migrate(raw);
  const s = {
    ...d,
    resources: {
      energy: Math.max(0, num(raw.resources?.energy, d.resources.energy)),
      shards: Math.max(0, num(raw.resources?.shards, d.resources.shards)),
      alloy: Math.max(0, num(raw.resources?.alloy, d.resources.alloy)),
      cores: int(raw.resources?.cores, d.resources.cores),
    },
    beacon: {
      level: Math.min(BEACON.maxLevel, Math.max(1, Math.floor(num(raw.beacon?.level, 1)))),
      charge: Math.min(BEACON.maxCharge, Math.max(0, num(raw.beacon?.charge, 0))),
    },
    lastSaved: num(raw.lastSaved, Date.now()),
  };
  const placed = [];
  for (const id of BUILDING_IDS) {
    const r = raw.buildings?.[id];
    const b = {
      level: Math.max(1, Math.floor(num(r?.level, 1))),
      gx: Math.floor(num(r?.gx, d.buildings[id].gx)),
      gy: Math.floor(num(r?.gy, d.buildings[id].gy)),
    };
    const size = BUILDINGS[id].footprint;
    if (!isValidPlacement(b.gx, b.gy, size, placed)) { b.gx = d.buildings[id].gx; b.gy = d.buildings[id].gy; }
    if (!isValidPlacement(b.gx, b.gy, size, placed)) {
      // default spot is taken too (e.g. a new building added to an old save): first free platform spot
      search: for (let gy = MAP.platformMin; gy <= MAP.platformMax; gy++) for (let gx = MAP.platformMin; gx <= MAP.platformMax; gx++) {
        if (isValidPlacement(gx, gy, size, placed)) { b.gx = gx; b.gy = gy; break search; }
      }
    }
    placed.push({ gx: b.gx, gy: b.gy, size });
    s.buildings[id] = b;
  }
  for (const t of TROOP_IDS) s.troops[t] = int(raw.troops?.[t]);
  // Lanes are never trimmed to capacity on load (that would silently delete paid-for units).
  s.training = emptyLanes();
  for (const c of CLASS_IDS) {
    const l = raw.training?.[c];
    const count = int(l?.count);
    const unit = classOf(l?.unit) === c ? l.unit : c;
    const from = l?.from && classOf(l.from) === c && tierOf(l.from) === tierOf(unit) - 1 ? l.from : null;
    s.training[c] = { count, progress: count > 0 ? Math.max(0, num(l?.progress, 0)) : 0, unit, from };
  }
  for (const id of LEADER_IDS) if (raw.leaders?.[id]) s.leaders[id] = { stars: Math.min(GACHA.maxStars, Math.max(1, int(raw.leaders[id].stars, 1))) };
  for (const id of GEAR_IDS) { const n = int(raw.gear?.[id]); if (n) s.gear[id] = n; }
  for (const id of GEAR_IDS) { const lv = Math.min(UPGRADES.gearMaxLevel, int(raw.gearLevels?.[id])); if (lv > 1) s.gearLevels[id] = lv; }
  s.daily = { lastDay: Number.isFinite(raw.daily?.lastDay) ? Math.floor(raw.daily.lastDay) : null, streak: int(raw.daily?.streak) };
  const msIds = new Set(CORES.milestones.map((m) => m.id));
  s.claims = {
    beacon: [...new Set((Array.isArray(raw.claims?.beacon) ? raw.claims.beacon : []).map((l) => Math.floor(l)).filter((l) => l >= 2 && l <= BEACON.maxLevel))],
    milestones: [...new Set((Array.isArray(raw.claims?.milestones) ? raw.claims.milestones : []).filter((id) => msIds.has(id)))],
  };
  const g = raw.gacha ?? {};
  s.gacha = {
    sinceEpic: int(g.sinceEpic), sinceLegendary: int(g.sinceLegendary), total: int(g.total),
    history: (Array.isArray(g.history) ? g.history : []).filter((h) => h && (LEADERS[h.id] || GEAR[h.id])).slice(0, GACHA.historySize),
  };
  // Squads: clamp formations to owned troops, drop unknown leaders/gear, one leader per squad.
  const assigned = Object.fromEntries(TROOP_IDS.map((t) => [t, 0]));
  const usedLeaders = new Set();
  const usedGear = {};
  for (const id of TROOPS.squadIds) {
    const r = raw.squads?.[id] ?? {};
    const sq = emptySquad();
    sq.level = Math.max(1, int(r.level, 1));
    (Array.isArray(r.lines) ? r.lines : []).slice(0, SQUADS.lines).forEach((l, i) => {
      if (!TROOP_CLASSES[l?.type]) return;
      const n = Math.min(int(l.count), s.troops[l.type] - assigned[l.type]);
      const full = Math.max(n, int(l.full, int(l.count)));
      if (n > 0 || full > 0) { sq.lines[i] = { type: l.type, count: Math.max(0, n), full }; assigned[l.type] += Math.max(0, n); }
    });
    if (s.leaders[r.leader] && !usedLeaders.has(r.leader)) { sq.leader = r.leader; usedLeaders.add(r.leader); }
    for (const slot of ['armor', 'weapon']) {
      const gid = r[slot];
      if (GEAR[gid]?.slot === slot && (usedGear[gid] ?? 0) < (s.gear[gid] ?? 0)) { sq[slot] = gid; usedGear[gid] = (usedGear[gid] ?? 0) + 1; }
    }
    s.squads[id] = sq;
  }
  // Construction: valid target, one job per building, at most `builders` jobs; never drops a paid job
  // silently (an invalid one is refunded instead).
  s.construction = [];
  for (const j of (Array.isArray(raw.construction) ? raw.construction : [])) {
    const id = j?.id;
    const cur = id === BEACON.id ? s.beacon.level : s.buildings[id]?.level;
    const cost = Math.max(0, num(j?.cost, 0));
    if (cur == null || s.construction.some((x) => x.id === id) || s.construction.length >= CONSTRUCTION.builders) { s.resources.energy += cost; continue; }
    const total = num(j.total, 0) > 0 ? j.total : CONSTRUCTION.seconds(cur + 1);
    s.construction.push({ id, toLevel: cur + 1, cost, total, progress: Math.min(total, Math.max(0, num(j.progress, 0))) });
  }
  // Stage 3: hunt progress, infirmary, world
  const h = raw.hunt ?? {};
  s.hunt = {
    stamina: Math.min(STAMINA.overCap, Math.max(0, num(h.stamina, STAMINA.max))),
    staminaCarry: Math.max(0, num(h.staminaCarry, 0)),
    auto: h.auto === true,
    bestKill: Math.min(WORLD.maxLevel, int(h.bestKill)),
    firstKills: [...new Set((Array.isArray(h.firstKills) ? h.firstKills : []).map((l) => Math.floor(l)).filter((l) => l >= 1 && l <= WORLD.maxLevel))],
    kills: int(h.kills), losses: int(h.losses), dead: int(h.dead), reportSeq: int(h.reportSeq),
    reports: (Array.isArray(h.reports) ? h.reports : []).filter((r) => r && Array.isArray(r.attacker?.lines) && Array.isArray(r.defender?.lines) && Number.isFinite(r.seed)).slice(0, WORLD.reportsKept),
  };
  s.infirmary = { wounded: emptyWounded(), queue: [] };
  for (const t of TROOP_IDS) for (const o of ORIGINS) s.infirmary.wounded[t][o] = int(raw.infirmary?.wounded?.[t]?.[o]);
  for (const b of Array.isArray(raw.infirmary?.queue) ? raw.infirmary.queue : []) {
    if (!TROOP_CLASSES[b?.type] || !(int(b.count) > 0)) continue;
    const from = Object.fromEntries(ORIGINS.map((o) => [o, int(b.from?.[o])]));
    const sum = ORIGINS.reduce((n, o) => n + from[o], 0);
    from.reserve += Math.max(0, int(b.count) - sum);
    s.infirmary.queue.push({ type: b.type, count: int(b.count), energyPer: Math.max(0, num(b.energyPer, healBase(b.type).energy)), progress: Math.max(0, num(b.progress, 0)), from });
  }
  s.world = sanitizeWorld(raw.world) ?? d.world;
  // Stage 4: research. Levels clamped to each node's max; an invalid running job is refunded.
  s.research = emptyResearch();
  for (const id of RESEARCH_IDS) {
    const lv = Math.min(RESEARCH[id].maxLevel ?? RESEARCH_TUNING.maxLevel, int(raw.research?.levels?.[id]));
    if (lv > 0) s.research.levels[id] = lv;
  }
  const rj = raw.research?.job;
  if (rj && typeof rj === 'object') {
    const cost = { energy: Math.max(0, num(rj.cost?.energy, 0)), alloy: Math.max(0, num(rj.cost?.alloy, 0)), shards: Math.max(0, num(rj.cost?.shards, 0)) };
    const R = RESEARCH[rj.id], cur = s.research.levels[rj.id] ?? 0;
    if (R && rj.toLevel === cur + 1 && cur < (R.maxLevel ?? RESEARCH_TUNING.maxLevel) && num(rj.total, 0) > 0) {
      s.research.job = { id: rj.id, toLevel: rj.toLevel, cost, total: rj.total, progress: Math.min(rj.total, Math.max(0, num(rj.progress, 0))) };
    } else { s.resources.energy += cost.energy; s.resources.alloy += cost.alloy; s.resources.shards += cost.shards; }
  }
  return s;
}

// Small seedable PRNG (mulberry32) so gacha tests are deterministic.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Store extends Emitter {
  constructor() {
    super();
    this.state = defaultState();
    this.offlineReport = null;
    this.migratedFrom = null;
    this.rng = Math.random;
    this.clock = () => Date.now(); // overridable in tests (daily rewards)
    // All world access goes through this service (swap for a remote one for PvP; see README).
    this.world = new LocalWorldService(() => this.state.world, (w) => { this.state.world = w; });
    this.simulating = false;
  }

  setSeed(seed) { this.rng = seed == null ? Math.random : mulberry32(seed); }

  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { raw = null; }
    if (raw && num(raw.version, 1) < SAVE_VERSION) {
      this.migratedFrom = num(raw.version, 1);
      // keep a one-time backup of the old save, just in case
      try { localStorage.setItem(`${SAVE_KEY}.backup-v${this.migratedFrom}`, JSON.stringify(raw)); } catch { /* ignore */ }
    }
    this.state = sanitize(raw);
    if (raw) this.applyOffline();
    this.save();
    return this.state;
  }

  applyOffline() {
    const elapsed = Math.max(0, (Date.now() - this.state.lastSaved) / 1000);
    const secs = Math.min(elapsed, ECONOMY.offlineCapSeconds);
    if (secs < 5) return;
    const s = this.state;
    const r0 = { ...s.resources };
    const chargeBefore = s.beacon.charge;
    s.resources.energy += this.energyRate * secs * ECONOMY.offlineRate;
    s.resources.shards += this.shardRate * secs * ECONOMY.offlineRate;
    s.resources.alloy += this.alloyRate * secs * ECONOMY.offlineRate;
    s.beacon.charge = Math.min(BEACON.maxCharge, chargeBefore + BEACON.chargePerSec(s.beacon.level) * secs);
    const trained = this.processTraining(secs);
    const built = this.processConstruction(secs);
    const researched = this.processResearch(secs);
    const hunts = this.simulateWorld(secs);
    this.offlineReport = {
      seconds: secs, capped: elapsed > ECONOMY.offlineCapSeconds,
      energy: s.resources.energy - r0.energy, shards: s.resources.shards - r0.shards, alloy: s.resources.alloy - r0.alloy,
      charge: s.beacon.charge - chargeBefore, trained, built, researched, hunts,
    };
  }

  save() {
    this.state.lastSaved = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch { /* storage full/blocked */ }
  }

  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    this.state = defaultState();
    this.save();
    this.emit('reset');
    this.emit('change');
  }

  // Called every frame with seconds elapsed.
  tick(dt) {
    const s = this.state;
    s.resources.energy += this.energyRate * dt;
    s.resources.shards += this.shardRate * dt;
    s.resources.alloy += this.alloyRate * dt;
    if (s.beacon.charge < BEACON.maxCharge) {
      s.beacon.charge = Math.min(BEACON.maxCharge, s.beacon.charge + BEACON.chargePerSec(s.beacon.level) * dt);
    }
    if (s.construction.length) this.processConstruction(dt);
    if (s.research.job) this.processResearch(dt);
    this.tickStamina(dt);
    if (s.infirmary.queue.length) { const healed = this.processHealing(dt); if (Object.keys(healed).length) { this.save(); this.emit('healed', healed); this.emit('change'); } }
    this.processWorld(dt);
    if (this.queuedUnits()) {
      const before = this.power.total;
      const done = this.processTraining(dt);
      if (Object.keys(done).length) {
        this.save();
        this.emit('trained', done, { before, after: this.power.total });
        this.emit('change');
      }
    }
  }

  get power() { return basePower(this.state); }
  get troopPower() { return troopPowerBreakdown(this.state); }
  get mods() { return researchMods(this.state); }
  get energyRate() { return ECONOMY.energyPerSec(this.state.beacon.level) * this.mods.energy; }
  get shardRate() { return RESOURCES.shardsPerSec(this.state.beacon.level) * this.mods.shards; }
  get alloyRate() { return RESOURCES.alloyPerSec(this.state.buildings.commandCenter.level) * this.mods.alloy; }

  buildingLevelCap() { return this.state.beacon.level + BUILDING_LEVEL_HEADROOM; }

  // ---- Upgrades (timed construction) ----------------------------------
  levelOf(id) { return id === BEACON.id ? this.state.beacon.level : this.state.buildings[id].level; }
  nameOf(id) { return id === BEACON.id ? BEACON.name : BUILDINGS[id].name; }
  constructionJob(id) { return this.state.construction.find((j) => j.id === id) ?? null; }
  buildersFree() { return Math.max(0, CONSTRUCTION.builders - this.state.construction.length); }
  // Building upgrade time, shortened by Rapid Assembly research.
  buildSeconds(toLevel) { return CONSTRUCTION.seconds(toLevel) / this.mods.build; }
  upgradeSeconds(id) { return this.buildSeconds(this.levelOf(id) + 1); }
  constructionLeft(id) { const j = this.constructionJob(id); return j ? Math.max(0, j.total - j.progress) : 0; }

  upgradeInfo(id) {
    const s = this.state;
    const level = this.levelOf(id);
    const seconds = this.buildSeconds(level + 1);
    const job = this.constructionJob(id);
    let cost, reason = null;
    if (id === BEACON.id) {
      cost = BEACON.upgradeCost(level);
      if (job) reason = `Upgrading to Lv ${job.toLevel}`;
      else if (level >= BEACON.maxLevel) reason = 'Max level';
      else if (s.beacon.charge < BEACON.maxCharge) reason = 'Beacon must be fully charged';
    } else {
      cost = buildingUpgradeCost(id, level);
      if (job) reason = `Upgrading to Lv ${job.toLevel}`;
      else if (BUILDINGS[id].unlockBeacon && s.beacon.level < BUILDINGS[id].unlockBeacon) reason = `Unlocks at Beacon Lv ${BUILDINGS[id].unlockBeacon}`;
      else if (level >= this.buildingLevelCap()) reason = `Raise the Beacon to Lv ${level - BUILDING_LEVEL_HEADROOM + 1} first`;
    }
    if (!reason && this.buildersFree() < 1) {
      const busy = s.construction[0];
      reason = `Builder busy: ${this.nameOf(busy.id)} → Lv ${busy.toLevel}`;
    }
    if (!reason && s.resources.energy < cost) reason = 'Not enough Energy';
    return { level, cost, seconds, can: !reason, reason, job };
  }

  // Starts an upgrade: pays now, finishes after CONSTRUCTION.seconds(level + 1).
  upgrade(id) {
    const info = this.upgradeInfo(id);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.energy -= info.cost;
    if (id === BEACON.id) this.state.beacon.charge = 0; // the full charge is spent to start the upgrade
    this.state.construction.push({ id, toLevel: info.level + 1, cost: info.cost, total: info.seconds, progress: 0 });
    this.save();
    this.emit('upgradeStart', id);
    this.emit('change');
    return { ok: true, started: true, seconds: info.seconds, cost: info.cost, toLevel: info.level + 1 };
  }

  // Cancels a running upgrade: full Energy refund (and the Beacon gets its charge back).
  cancelUpgrade(id) {
    const i = this.state.construction.findIndex((j) => j.id === id);
    if (i < 0) return { ok: false, reason: 'Nothing to cancel' };
    const j = this.state.construction[i];
    this.state.construction.splice(i, 1);
    this.state.resources.energy += j.cost;
    if (id === BEACON.id) this.state.beacon.charge = BEACON.maxCharge;
    this.save();
    this.emit('upgradeCancel', id);
    this.emit('change');
    return { ok: true, refund: j.cost };
  }

  // Hook for future Beacon Core speed-ups (no UI yet): skips `seconds` of a running upgrade.
  speedUpConstruction(id, seconds) {
    const j = this.constructionJob(id);
    if (!j || !(seconds > 0)) return { ok: false };
    this.processConstruction(0, { id, seconds });
    return { ok: true };
  }
  speedUpCoreCost(id) { return Math.ceil(this.constructionLeft(id) / CONSTRUCTION.speedUp.secondsPerCore); }

  // Advances running upgrades; level, power and unlocks apply only here, on completion.
  processConstruction(dt, only = null) {
    const done = [];
    for (const j of [...this.state.construction]) {
      const add = only ? (only.id === j.id ? only.seconds : 0) : dt;
      j.progress += add;
      if (j.progress + 1e-9 < j.total) continue;
      const before = this.power.total;
      if (j.id === BEACON.id) {
        this.state.beacon.level = j.toLevel;
        this.state.hunt.stamina = Math.max(this.state.hunt.stamina, this.staminaMax()); // Beacon level-up refills stamina
      } else this.state.buildings[j.id].level = j.toLevel;
      this.state.construction.splice(this.state.construction.indexOf(j), 1);
      done.push({ id: j.id, level: j.toLevel });
      this.emit('upgrade', j.id, { before, after: this.power.total });
    }
    if (done.length) { this.save(); this.emit('change'); }
    return done;
  }

  // ---- Placement ------------------------------------------------------
  othersFootprints(excludeId) {
    return BUILDING_IDS.filter((id) => id !== excludeId).map((id) => ({
      gx: this.state.buildings[id].gx, gy: this.state.buildings[id].gy, size: BUILDINGS[id].footprint,
    }));
  }

  canPlace(id, gx, gy) {
    if (!BUILDINGS[id]) return false; // the Beacon (or anything unknown) can't be moved
    return isValidPlacement(gx, gy, BUILDINGS[id].footprint, this.othersFootprints(id));
  }

  moveBuilding(id, gx, gy) {
    if (!this.canPlace(id, gx, gy)) return false;
    const b = this.state.buildings[id];
    if (b.gx === gx && b.gy === gy) return true;
    b.gx = gx; b.gy = gy;
    this.save();
    this.emit('moved', id);
    this.emit('change');
    return true;
  }

  // ---- Barracks / training -------------------------------------------
  // One lane per troop CLASS (any tier trains in its class lane). Lanes have their own capacity and
  // timer and all run at once. A lane runs one job at a time: training one unit, or one promotion.
  // `type` arguments are unit ids (T1 unit id = class id, so stage 1-3 calls still work).
  get barracksLevel() { return this.state.buildings.barracks.level; }
  laneCapacity() { return BARRACKS.laneCapacity(this.barracksLevel); }
  lane(type) {
    const cls = classOf(type) ?? type, l = this.state.training[cls];
    if (l && !TROOP_CLASSES[l.unit]) { l.unit = cls; l.from = null; } // tolerate old-shape lanes ({ count, progress })
    return l;
  }
  laneRoom(type) { return Math.max(0, this.laneCapacity() - (this.lane(type)?.count ?? 0)); }
  queuedUnits() { return CLASS_IDS.reduce((n, c) => n + this.state.training[c].count, 0); }
  activeLanes() { return CLASS_IDS.filter((c) => this.state.training[c].count > 0); }
  maxTier() { return this.mods.maxTier; }
  tierUnlocked(tier) { return tier <= this.maxTier(); }
  unitTime(type) { return TROOP_CLASSES[type].trainSeconds / (BARRACKS.trainSpeed(this.barracksLevel) * this.mods.train); }
  promoteTime(toUnit) { return this.unitTime(toUnit) * PROMOTE.timeShare; }
  laneUnitTime(cls) { const l = this.lane(cls); return l.from ? this.promoteTime(l.unit) : this.unitTime(l.unit); }
  trainCost(type) { const u = TROOP_CLASSES[type]; return { energy: u.energy, alloy: u.alloy }; }
  promoteCost(fromUnit) {
    const to = nextTier(fromUnit);
    if (!to) return null;
    const a = TROOP_CLASSES[fromUnit], b = TROOP_CLASSES[to];
    return { energy: Math.max(0, b.energy - a.energy), alloy: Math.max(0, b.alloy - a.alloy) };
  }
  affordable(cost) {
    const r = this.state.resources;
    return Math.min(cost.energy > 0 ? Math.floor(r.energy / cost.energy) : Infinity, cost.alloy > 0 ? Math.floor(r.alloy / cost.alloy) : Infinity);
  }
  // A lane that's busy with a different job can't take this one until it's done (or cancelled).
  laneBusyWith(type, from = null) {
    const l = this.lane(type);
    if (!l || l.count < 1) return null;
    if (l.unit === type && (l.from ?? null) === from) return null;
    return l.from ? `promoting ${l.count} → ${TROOP_CLASSES[l.unit].plural}` : `training ${l.count} ${TROOP_CLASSES[l.unit].plural}`;
  }
  maxTrainable(type) {
    if (!TROOP_CLASSES[type] || !this.tierUnlocked(tierOf(type)) || this.laneBusyWith(type)) return 0;
    return Math.min(this.laneRoom(type), this.affordable(this.trainCost(type)));
  }
  // Seconds until the unit currently in training in this lane finishes (0 if idle).
  laneNextSeconds(type) { const l = this.lane(type); return l.count ? Math.max(0, this.laneUnitTime(type) - l.progress) : 0; }
  // Seconds until this whole lane is done.
  laneSecondsLeft(type) { const l = this.lane(type); return l.count ? Math.max(0, l.count * this.laneUnitTime(type) - l.progress) : 0; }
  // Lanes run in parallel, so everything is done when the slowest lane is.
  trainingSecondsLeft() { return Math.max(0, ...CLASS_IDS.map((c) => this.laneSecondsLeft(c))); }
  tierLockReason(tier) {
    if (this.tierUnlocked(tier)) return null;
    return `Research ${RESEARCH[`tier${tier}`].name} in the Archive`;
  }

  trainInfo(type, n) {
    const def = TROOP_CLASSES[type];
    if (!def) return { can: false, reason: 'Unknown troop' };
    n = Math.floor(n);
    const unit = this.trainCost(type);
    const cost = n * unit.energy, alloy = n * unit.alloy;
    const room = this.laneRoom(type);
    const busy = this.laneBusyWith(type);
    let reason = this.tierLockReason(def.tier);
    if (reason) { /* locked tier */ }
    else if (busy) reason = `${def.className} lane is busy: ${busy}`;
    else if (room < 1) reason = `${def.className} lane is full`;
    else if (n < 1) reason = 'Not enough Energy';
    else if (n > room) reason = `${def.className} lane has room for ${room}`;
    else if (this.state.resources.energy < cost) reason = 'Not enough Energy';
    else if (this.state.resources.alloy < alloy) reason = 'Not enough Alloy';
    return { can: !reason, reason, cost, alloy, n };
  }

  train(type, n) {
    const info = this.trainInfo(type, n);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.energy -= info.cost;
    this.state.resources.alloy -= info.alloy;
    const l = this.lane(type);
    if (l.count === 0) { l.progress = 0; l.unit = type; l.from = null; }
    l.count += info.n;
    this.save();
    this.emit('change');
    return { ok: true, n: info.n, cost: info.cost, alloy: info.alloy };
  }

  // Promotion: ready (unassigned, healthy) troops of `fromUnit` move up one tier. They leave the army
  // when queued and come back as the higher tier one by one. Pays the cost difference.
  maxPromotable(fromUnit) {
    const to = nextTier(fromUnit);
    if (!to || !this.tierUnlocked(tierOf(to)) || this.laneBusyWith(to, fromUnit)) return 0;
    return Math.min(this.readyCount(fromUnit), this.laneRoom(fromUnit), this.affordable(this.promoteCost(fromUnit)));
  }
  promoteInfo(fromUnit, n) {
    const def = TROOP_CLASSES[fromUnit];
    if (!def) return { can: false, reason: 'Unknown troop' };
    const to = nextTier(fromUnit);
    n = Math.floor(n);
    const per = this.promoteCost(fromUnit) ?? { energy: 0, alloy: 0 };
    const cost = n * per.energy, alloy = n * per.alloy;
    const ready = this.readyCount(fromUnit), room = this.laneRoom(fromUnit);
    let reason = null;
    if (!to) reason = `${def.plural} are the top tier`;
    else if ((reason = this.tierLockReason(tierOf(to)))) { /* locked */ }
    else if (this.laneBusyWith(to, fromUnit)) reason = `${def.className} lane is busy: ${this.laneBusyWith(to, fromUnit)}`;
    else if (ready < 1) reason = `No ready ${def.plural} (assigned or wounded troops can't be promoted)`;
    else if (room < 1) reason = `${def.className} lane is full`;
    else if (n < 1) reason = 'Not enough Energy';
    else if (n > ready) reason = `Only ${ready} ready ${def.plural}`;
    else if (n > room) reason = `${def.className} lane has room for ${room}`;
    else if (this.state.resources.energy < cost) reason = 'Not enough Energy';
    else if (this.state.resources.alloy < alloy) reason = 'Not enough Alloy';
    return { can: !reason, reason, cost, alloy, n, to, seconds: to ? this.promoteTime(to) : 0 };
  }
  promote(fromUnit, n) {
    const info = this.promoteInfo(fromUnit, n);
    if (!info.can) return { ok: false, reason: info.reason };
    const before = this.power.total;
    this.state.resources.energy -= info.cost;
    this.state.resources.alloy -= info.alloy;
    this.state.troops[fromUnit] -= info.n;
    const l = this.lane(fromUnit);
    if (l.count === 0) { l.progress = 0; l.unit = info.to; l.from = fromUnit; }
    l.count += info.n;
    this.save();
    this.emit('trainStart', { promote: true, from: fromUnit, to: info.to, n: info.n, before, after: this.power.total });
    this.emit('change');
    return { ok: true, n: info.n, cost: info.cost, alloy: info.alloy, to: info.to };
  }

  // Cancels everything in one lane (including the unit in progress) for a full refund
  // (promotions also give the queued troops back at their old tier).
  cancelLane(type) {
    const l = this.lane(type);
    if (!l || l.count < 1) return { ok: false };
    const n = l.count;
    const per = l.from ? this.promoteCost(l.from) : this.trainCost(l.unit);
    const refund = n * per.energy, alloy = n * per.alloy;
    this.state.resources.energy += refund;
    this.state.resources.alloy += alloy;
    if (l.from) this.state.troops[l.from] += n;
    l.count = 0; l.progress = 0; l.from = null; l.unit = classOf(l.unit);
    this.save();
    this.emit('change');
    return { ok: true, refund, alloy, n };
  }

  // Advances every lane by dt seconds, independently; returns { unit: unitsCompleted }.
  processTraining(dt) {
    const done = {};
    if (!(dt > 0)) return done;
    for (const c of CLASS_IDS) {
      const l = this.lane(c);
      if (l.count < 1) continue;
      const ut = this.laneUnitTime(c);
      const avail = l.progress + dt;
      const n = Math.min(l.count, Math.floor(avail / ut + 1e-9));
      l.count -= n;
      l.progress = l.count > 0 ? Math.max(0, avail - n * ut) : 0;
      if (n > 0) { this.state.troops[l.unit] += n; done[l.unit] = (done[l.unit] ?? 0) + n; }
      if (l.count === 0) l.from = null;
    }
    return done;
  }

  // ---- Research (Archive) --------------------------------------------
  // One project at a time. A node's level can't exceed the Archive's level; tier nodes need Barracks
  // levels too. Costs Energy + Alloy + Shards (never Cores), paid up front; cancel = full refund.
  archiveUnlocked() { return archiveUnlocked(this.state); }
  get archiveLevel() { return this.state.buildings.archive.level; }
  researchLevel(id) { return researchLevel(this.state, id); }
  researchMax(id) { return RESEARCH[id]?.maxLevel ?? RESEARCH_TUNING.maxLevel; }
  researchCost(id, toLevel) { const R = RESEARCH[id]; return R.cost ? { ...R.cost } : RESEARCH_TUNING.cost(toLevel); }
  researchSeconds(id, toLevel) { const R = RESEARCH[id]; return R.seconds ?? RESEARCH_TUNING.seconds(toLevel); }
  researchJob() { return this.state.research.job; }
  researchLeft() { const j = this.researchJob(); return j ? Math.max(0, j.total - j.progress) : 0; }
  researchInfo(id) {
    const R = RESEARCH[id];
    if (!R) return { can: false, reason: 'Unknown research' };
    const level = this.researchLevel(id), max = this.researchMax(id), toLevel = level + 1;
    const cost = this.researchCost(id, Math.min(toLevel, max)), seconds = this.researchSeconds(id, Math.min(toLevel, max));
    const job = this.researchJob(), r = this.state.resources;
    const needArchive = Math.max(toLevel, R.req?.archive ?? 0);
    let reason = null;
    if (!this.archiveUnlocked()) reason = `The Archive unlocks at Beacon Lv ${BUILDINGS.archive.unlockBeacon}`;
    else if (level >= max) reason = 'Fully researched';
    else if (job?.id === id) reason = `Researching Lv ${job.toLevel}`;
    else if (R.req?.research && this.researchLevel(R.req.research) < 1) reason = `Research ${RESEARCH[R.req.research].name} first`;
    else if (R.req?.barracks && this.barracksLevel < R.req.barracks) reason = `Needs Barracks Lv ${R.req.barracks}`;
    else if (this.archiveLevel < needArchive) reason = `Needs Archive Lv ${needArchive}`;
    else if (job) reason = `Archive busy: ${RESEARCH[job.id].name} Lv ${job.toLevel}`;
    else if (r.energy < cost.energy) reason = 'Not enough Energy';
    else if (r.alloy < cost.alloy) reason = 'Not enough Alloy';
    else if (r.shards < cost.shards) reason = 'Not enough Shards';
    return { can: !reason, reason, level, max, toLevel, cost, seconds, job: job?.id === id ? job : null };
  }
  startResearch(id) {
    const info = this.researchInfo(id);
    if (!info.can) return { ok: false, reason: info.reason };
    const r = this.state.resources;
    r.energy -= info.cost.energy; r.alloy -= info.cost.alloy; r.shards -= info.cost.shards;
    this.state.research.job = { id, toLevel: info.toLevel, cost: info.cost, total: info.seconds, progress: 0 };
    this.save(); this.emit('researchStart', id); this.emit('change');
    return { ok: true, seconds: info.seconds, cost: info.cost, toLevel: info.toLevel };
  }
  cancelResearch() {
    const j = this.researchJob();
    if (!j) return { ok: false, reason: 'Nothing to cancel' };
    const r = this.state.resources;
    r.energy += j.cost.energy; r.alloy += j.cost.alloy; r.shards += j.cost.shards;
    this.state.research.job = null;
    this.save(); this.emit('change');
    return { ok: true, refund: j.cost };
  }
  // Hook for future speed-ups (no Cores for research today): skips `seconds` of the running project.
  speedUpResearch(seconds) { if (!this.researchJob() || !(seconds > 0)) return { ok: false }; this.processResearch(seconds); return { ok: true }; }
  processResearch(dt) {
    const j = this.state.research.job;
    if (!j || !(dt > 0)) return [];
    j.progress += dt;
    if (j.progress + 1e-9 < j.total) return [];
    const before = this.power.total;
    this.state.research.levels[j.id] = j.toLevel;
    this.state.research.job = null;
    this.emit('research', j.id, j.toLevel, { before, after: this.power.total });
    this.save(); this.emit('change');
    return [{ id: j.id, level: j.toLevel }];
  }

  // ---- Squads ---------------------------------------------------------
  squadUnlocked(id) { return this.state.buildings.commandCenter.level >= SQUADS[id].unlockCC; }
  assignedCount(type, excludeSquad = null) {
    let n = 0;
    for (const [id, sq] of Object.entries(this.state.squads)) {
      if (id === excludeSquad) continue;
      for (const l of sq.lines) if (l.type === type) n += l.count;
    }
    return n;
  }
  readyCount(type) { return this.state.troops[type] - this.assignedCount(type); }
  // troops of `type` that could go into `squadId` (its own current members count as available)
  availableFor(type, squadId) { return this.state.troops[type] - this.assignedCount(type, squadId); }
  squadPower(id) { return squadPower(this.state.squads[id]); }
  squadSoldiers(id) { return squadSoldiers(this.state.squads[id]); }

  saveFormation(squadId, lines, leader) {
    const sq = this.state.squads[squadId];
    if (!sq) return { ok: false, reason: 'Unknown squad' };
    if (!this.squadUnlocked(squadId)) return { ok: false, reason: `Unlocks at Command Center Lv ${SQUADS[squadId].unlockCC}` };
    if (!Array.isArray(lines) || lines.length !== SQUADS.lines) return { ok: false, reason: 'Bad formation' };
    if (this.squadMarch(squadId)) return { ok: false, reason: `${SQUADS[squadId].name} is out on a march` };
    const clean = lines.map((l) => (TROOP_CLASSES[l?.type] && Math.floor(l.count) > 0 ? { type: l.type, count: Math.floor(l.count), full: Math.floor(l.count) } : { type: null, count: 0, full: 0 }));
    for (const t of TROOP_IDS) {
      const want = clean.reduce((n, l) => n + (l.type === t ? l.count : 0), 0);
      const avail = this.availableFor(t, squadId);
      if (want > avail) return { ok: false, reason: `Only ${avail} ${TROOP_CLASSES[t].plural} available` };
    }
    const before = this.power.total;
    sq.lines = clean;
    if (leader !== undefined) {
      const r = this.assignLeader(leader, squadId, { silent: true });
      if (!r.ok) return r;
    }
    this.save();
    this.emit('squad', squadId, { before, after: this.power.total });
    this.emit('change');
    return { ok: true };
  }

  levelUpInfo(id) {
    const sq = this.state.squads[id];
    const cost = SQUADS.levelUpCost(sq.level);
    const cap = this.state.buildings.commandCenter.level;
    let reason = null;
    if (!this.squadUnlocked(id)) reason = `Unlocks at Command Center Lv ${SQUADS[id].unlockCC}`;
    else if (sq.level >= cap) reason = `Upgrade the Command Center to Lv ${sq.level + 1} first`;
    else if (this.state.resources.energy < cost.energy) reason = 'Not enough Energy';
    else if (this.state.resources.alloy < cost.alloy) reason = 'Not enough Alloy';
    return { can: !reason, reason, cost, level: sq.level, cap };
  }

  levelUpSquad(id) {
    const info = this.levelUpInfo(id);
    if (!info.can) return { ok: false, reason: info.reason };
    const before = this.power.total;
    this.state.resources.energy -= info.cost.energy;
    this.state.resources.alloy -= info.cost.alloy;
    this.state.squads[id].level += 1;
    this.save();
    this.emit('squad', id, { before, after: this.power.total });
    this.emit('change');
    return { ok: true };
  }

  leaderSquad(leaderId) {
    return TROOPS.squadIds.find((id) => this.state.squads[id].leader === leaderId) ?? null;
  }

  // Assign (or with leaderId=null, clear) a squad's leader. A leader leads one squad at a time.
  assignLeader(leaderId, squadId, { silent = false } = {}) {
    const sq = this.state.squads[squadId];
    if (!sq) return { ok: false, reason: 'Unknown squad' };
    if (!this.squadUnlocked(squadId)) return { ok: false, reason: `Unlocks at Command Center Lv ${SQUADS[squadId].unlockCC}` };
    if (leaderId != null && !this.state.leaders[leaderId]) return { ok: false, reason: 'Leader not recruited' };
    if (leaderId != null) for (const s of Object.values(this.state.squads)) if (s.leader === leaderId) s.leader = null;
    sq.leader = leaderId ?? null;
    if (!silent) { this.save(); this.emit('squad', squadId); this.emit('change'); }
    return { ok: true };
  }

  gearFree(gearId, excludeSquad = null) {
    const slot = GEAR[gearId]?.slot;
    if (!slot) return 0;
    let used = 0;
    for (const [id, sq] of Object.entries(this.state.squads)) if (id !== excludeSquad && sq[slot] === gearId) used++;
    return (this.state.gear[gearId] ?? 0) - used;
  }

  equipGear(squadId, slot, gearId) {
    const sq = this.state.squads[squadId];
    if (!sq || !['armor', 'weapon'].includes(slot)) return { ok: false, reason: 'Bad slot' };
    if (!this.squadUnlocked(squadId)) return { ok: false, reason: `Unlocks at Command Center Lv ${SQUADS[squadId].unlockCC}` };
    if (gearId != null) {
      if (GEAR[gearId]?.slot !== slot) return { ok: false, reason: `That isn't ${slot}` };
      if (this.gearFree(gearId, squadId) < 1) return { ok: false, reason: 'All copies are equipped' };
    }
    sq[slot] = gearId ?? null;
    this.save();
    this.emit('squad', squadId);
    this.emit('change');
    return { ok: true };
  }

  leaderMultiplier(leaderId) {
    const stars = this.state.leaders[leaderId]?.stars ?? 1;
    return 1 + GACHA.starBonus * (stars - 1);
  }

  // Per-squad combat stats for stage 3 (and the Squad Details screen).
  squadStats(id) {
    const sq = this.state.squads[id];
    const L = sq.leader ? LEADERS[sq.leader] : null;
    const mult = L ? this.leaderMultiplier(sq.leader) : 1;
    const totals = { hp: 0, atk: 0, def: 0 };
    for (const line of sq.lines) {
      if (!line.type) continue;
      const base = TROOP_CLASSES[line.type], cls = base.cls, rm = this.mods.combat[cls];
      for (const stat of ['hp', 'atk', 'def']) {
        let pct = 0;
        if (L?.buff && L.buff.stat === stat && (L.buff.target === 'all' || L.buff.target === cls)) pct += L.buff.pct * mult;
        if (L?.debuff && L.debuff.stat === stat && (L.debuff.target === 'all' || L.debuff.target === cls)) pct += L.debuff.pct;
        for (const slot of ['armor', 'weapon']) { const g = GEAR[sq[slot]]; if (g && g.buff.stat === stat) pct += this.gearBuffPct(g.id); }
        totals[stat] += base[stat] * line.count * (1 + pct / 100) * (stat === 'def' ? 1 : rm);
      }
    }
    return { hp: Math.round(totals.hp), atk: Math.round(totals.atk), def: Math.round(totals.def) };
  }

  // ---- Beacon Cores (earned only) ---------------------------------------
  pullCost(n) { return n === 10 ? GACHA.costX10 : GACHA.costX1 * n; }
  totalTroops() { return TROOP_IDS.reduce((n, t) => n + this.state.troops[t], 0); }
  // Single entry point for every Core source (daily, Beacon, milestones, stage-3 battles).
  grantCores(n, source = 'other') {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    this.state.resources.cores += n;
    this.emit('cores', n, source);
    return n;
  }
  dayIndex(t = this.clock()) { const d = new Date(t); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
  dailyInfo() {
    const today = this.dayIndex(), dl = this.state.daily;
    const claimed = dl.lastDay === today;
    const streak = claimed ? dl.streak : (dl.lastDay === today - 1 ? dl.streak + 1 : 1); // streak if claimed now
    const D = CORES.daily;
    const reward = D.base + (streak % D.streakEvery === 0 ? D.streakBonus : 0);
    const toBonus = (D.streakEvery - (streak % D.streakEvery)) % D.streakEvery;
    return { claimed, can: !claimed, streak, reward, toBonus };
  }
  claimDaily() {
    const info = this.dailyInfo();
    if (!info.can) return { ok: false, reason: 'Already claimed today. Come back tomorrow.' };
    this.state.daily = { lastDay: this.dayIndex(), streak: info.streak };
    this.grantCores(info.reward, 'daily');
    this.state.hunt.stamina = Math.min(STAMINA.overCap, this.state.hunt.stamina + STAMINA.dailyBonus); // +20 stamina too
    this.save(); this.emit('change');
    return { ok: true, cores: info.reward, streak: info.streak, bonus: info.reward > CORES.daily.base, stamina: STAMINA.dailyBonus };
  }
  beaconRewards() {
    const out = [];
    for (let lv = 2; lv <= this.state.beacon.level; lv++) out.push({ level: lv, cores: CORES.beaconLevel, claimed: this.state.claims.beacon.includes(lv) });
    return out;
  }
  claimBeaconLevel(level) {
    if (!(level >= 2 && level <= this.state.beacon.level)) return { ok: false, reason: `Reach Beacon Lv ${level} first` };
    if (this.state.claims.beacon.includes(level)) return { ok: false, reason: 'Already claimed' };
    this.state.claims.beacon.push(level);
    this.grantCores(CORES.beaconLevel, 'beacon');
    this.save(); this.emit('change');
    return { ok: true, cores: CORES.beaconLevel };
  }
  milestones() {
    return CORES.milestones.map((m) => ({ id: m.id, name: m.name, desc: m.desc, cores: m.cores, done: !!m.check(this), claimed: this.state.claims.milestones.includes(m.id) }));
  }
  claimMilestone(id) {
    const m = CORES.milestones.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'Unknown milestone' };
    if (this.state.claims.milestones.includes(id)) return { ok: false, reason: 'Already claimed' };
    if (!m.check(this)) return { ok: false, reason: `Not done yet: ${m.desc}` };
    this.state.claims.milestones.push(id);
    this.grantCores(m.cores, 'milestone');
    this.save(); this.emit('change');
    return { ok: true, cores: m.cores };
  }
  rewardsReady() {
    return (this.dailyInfo().can ? 1 : 0) + this.beaconRewards().filter((r) => !r.claimed).length + this.milestones().filter((m) => m.done && !m.claimed).length;
  }
  claimAllRewards() {
    let cores = 0;
    if (this.dailyInfo().can) cores += this.claimDaily().cores;
    for (const r of this.beaconRewards()) if (!r.claimed) cores += this.claimBeaconLevel(r.level).cores;
    for (const m of this.milestones()) if (m.done && !m.claimed) cores += this.claimMilestone(m.id).cores;
    return { ok: cores > 0, cores };
  }

  // ---- Shard upgrades: leader stars and gear levels ---------------------
  starUpInfo(lid) {
    const own = this.state.leaders[lid];
    if (!own) return { can: false, reason: 'Leader not recruited' };
    if (own.stars >= GACHA.maxStars) return { can: false, reason: 'Max stars', maxed: true };
    const cost = UPGRADES.leaderStarCost(LEADERS[lid].rarity, own.stars);
    return { can: this.state.resources.shards >= cost, reason: this.state.resources.shards >= cost ? null : `Need ${cost} Shards`, cost };
  }
  starUpLeader(lid) {
    const info = this.starUpInfo(lid);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.shards -= info.cost;
    this.state.leaders[lid].stars += 1;
    this.save(); this.emit('squad', this.leaderSquad(lid)); this.emit('change');
    return { ok: true, stars: this.state.leaders[lid].stars, cost: info.cost };
  }
  gearLevel(gid) { return this.state.gearLevels[gid] ?? 1; }
  gearMultiplier(gid) { return 1 + UPGRADES.gearLevelBonus * (this.gearLevel(gid) - 1); }
  gearBuffPct(gid, level = this.gearLevel(gid)) { return Math.round(GEAR[gid].buff.pct * (1 + UPGRADES.gearLevelBonus * (level - 1)) * 10) / 10; }
  gearUpgradeInfo(gid) {
    if (!GEAR[gid]) return { can: false, reason: 'Unknown gear' };
    if (!this.state.gear[gid]) return { can: false, reason: 'Not owned' };
    const level = this.gearLevel(gid);
    if (level >= UPGRADES.gearMaxLevel) return { can: false, reason: 'Max level', maxed: true, level };
    const cost = UPGRADES.gearLevelCost(GEAR[gid].rarity, level);
    const ok = this.state.resources.shards >= cost;
    return { can: ok, reason: ok ? null : `Need ${cost} Shards`, cost, level };
  }
  upgradeGear(gid) {
    const info = this.gearUpgradeInfo(gid);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.shards -= info.cost;
    this.state.gearLevels[gid] = info.level + 1;
    this.save(); this.emit('change');
    return { ok: true, level: info.level + 1, cost: info.cost };
  }

  // ---- Gacha ----------------------------------------------------------
  rollRarity() {
    const g = this.state.gacha;
    const r = this.rng();
    if (g.sinceLegendary + 1 >= GACHA.pityLegendary) return { rarity: 'legendary', pity: 'legendary' };
    if (g.sinceEpic + 1 >= GACHA.pityEpic) {
      const pL = GACHA.rates.legendary / (GACHA.rates.legendary + GACHA.rates.epic);
      return { rarity: r < pL ? 'legendary' : 'epic', pity: 'epic' };
    }
    let acc = 0;
    for (const rar of [...RARITIES].reverse()) { acc += GACHA.rates[rar]; if (r < acc) return { rarity: rar, pity: null }; }
    return { rarity: 'common', pity: null };
  }

  pullOne() {
    const g = this.state.gacha;
    const { rarity, pity } = this.rollRarity();
    g.total += 1;
    g.sinceEpic = rarity === 'epic' || rarity === 'legendary' ? 0 : g.sinceEpic + 1;
    g.sinceLegendary = rarity === 'legendary' ? 0 : g.sinceLegendary + 1;
    const isLeader = this.rng() < GACHA.leaderChance;
    const pool = (isLeader ? LEADER_IDS.filter((id) => LEADERS[id].rarity === rarity) : GEAR_IDS.filter((id) => GEAR[id].rarity === rarity));
    const id = pool[Math.floor(this.rng() * pool.length) % pool.length];
    const res = { id, kind: isLeader ? 'leader' : 'gear', rarity, pity, at: Date.now() };
    if (isLeader) {
      const owned = this.state.leaders[id];
      if (!owned) { this.state.leaders[id] = { stars: 1 }; res.result = 'new'; }
      else if (owned.stars < GACHA.maxStars) { owned.stars += 1; res.result = 'star'; res.stars = owned.stars; }
      else { res.result = 'shards'; res.refund = RARITY[rarity].dupShards; this.state.resources.shards += res.refund; }
    } else {
      this.state.gear[id] = (this.state.gear[id] ?? 0) + 1;
      res.result = this.state.gear[id] === 1 ? 'new' : 'gear';
      res.count = this.state.gear[id];
    }
    g.history.unshift(res);
    if (g.history.length > GACHA.historySize) g.history.length = GACHA.historySize;
    return res;
  }

  pull(n) {
    const cost = this.pullCost(n);
    if (n !== 1 && n !== 10) return { ok: false, reason: 'Pull x1 or x10' };
    if (this.state.resources.cores < cost) return { ok: false, reason: `Need ${cost} Beacon ${cost === 1 ? 'Core' : 'Cores'}` };
    this.state.resources.cores -= cost;
    const results = [];
    for (let i = 0; i < n; i++) results.push(this.pullOne());
    this.save();
    this.emit('pull', results);
    this.emit('change');
    return { ok: true, results, cost };
  }

  // =================================================================== STAGE 3 ==

  // ---- Infirmary -------------------------------------------------------
  get infirmaryLevel() { return this.state.buildings.infirmary.level; }
  infirmaryCapacity() { return Math.floor(INFIRMARY.capacity(this.infirmaryLevel) * this.mods.beds + 1e-9); }
  healSpeed() { return INFIRMARY.healSpeed(this.infirmaryLevel) * this.mods.healSpeed; }
  // Energy to heal one unit (tier multiplier, Med Synthesis research)
  healEnergy(type) { return Math.round(healBase(type).energy * this.mods.healCost * 100) / 100; }
  woundedPool(type) { return ORIGINS.reduce((n, o) => n + this.state.infirmary.wounded[type][o], 0); }
  woundedQueued(type) { return this.state.infirmary.queue.reduce((n, b) => n + (b.type === type ? b.count : 0), 0); }
  woundedTotal() { return TROOP_IDS.reduce((n, t) => n + this.woundedPool(t) + this.woundedQueued(t), 0); }
  infirmaryFree() { return Math.max(0, this.infirmaryCapacity() - this.woundedTotal()); }
  healUnitTime(type) { return healBase(type).seconds / this.healSpeed(); }
  healQueueSeconds() {
    return this.state.infirmary.queue.reduce((n, b) => n + b.count * this.healUnitTime(b.type), 0) - (this.state.infirmary.queue[0]?.progress ?? 0);
  }
  maxHealable(type) { return Math.min(this.woundedPool(type), Math.floor(this.state.resources.energy / this.healEnergy(type) + 1e-9)); }

  healInfo(type, n) {
    if (!TROOP_CLASSES[type]) return { can: false, reason: 'Unknown troop' };
    n = Math.floor(n);
    const pool = this.woundedPool(type), cost = Math.round(n * this.healEnergy(type) * 100) / 100;
    let reason = null;
    if (pool < 1) reason = `No wounded ${TROOP_CLASSES[type].plural}`;
    else if (n < 1) reason = 'Not enough Energy';
    else if (n > pool) reason = `Only ${pool} wounded`;
    else if (this.state.resources.energy < cost) reason = 'Not enough Energy';
    return { can: !reason, reason, cost, n };
  }

  // Queues n wounded of `type` for healing (Energy paid now). Healed troops rejoin their squad.
  heal(type, n) {
    const info = this.healInfo(type, n);
    if (!info.can) return { ok: false, reason: info.reason };
    const w = this.state.infirmary.wounded[type];
    const from = Object.fromEntries(ORIGINS.map((o) => [o, 0]));
    let left = info.n;
    for (const o of ORIGINS) { const k = Math.min(left, w[o]); w[o] -= k; from[o] += k; left -= k; }
    this.state.resources.energy -= info.cost;
    this.state.infirmary.queue.push({ type, count: info.n, energyPer: this.healEnergy(type), progress: 0, from });
    this.save(); this.emit('change');
    return { ok: true, n: info.n, cost: info.cost };
  }
  healAll() {
    let n = 0, cost = 0;
    for (const t of TROOP_IDS) { const m = this.maxHealable(t); if (m > 0) { const r = this.heal(t, m); if (r.ok) { n += r.n; cost += r.cost; } } }
    return n ? { ok: true, n, cost } : { ok: false, reason: this.woundedTotal() - TROOP_IDS.reduce((k, t) => k + this.woundedQueued(t), 0) > 0 ? 'Not enough Energy' : 'No wounded waiting' };
  }
  // Cancels a healing batch: full Energy refund for every unit not yet healed; they go back to waiting.
  cancelHeal(index) {
    const q = this.state.infirmary.queue, b = q[index];
    if (!b) return { ok: false, reason: 'Nothing to cancel' };
    q.splice(index, 1);
    const refund = b.count * b.energyPer;
    this.state.resources.energy += refund;
    for (const o of ORIGINS) this.state.infirmary.wounded[b.type][o] += b.from[o];
    this.save(); this.emit('change');
    return { ok: true, refund, n: b.count };
  }
  processHealing(dt) {
    const healed = {};
    const q = this.state.infirmary.queue;
    while (dt > 1e-9 && q.length) {
      const b = q[0], ut = this.healUnitTime(b.type), need = ut - b.progress;
      if (dt + 1e-9 < need) { b.progress += dt; break; }
      dt -= need; b.progress = 0; b.count -= 1;
      const origin = ORIGINS.find((o) => b.from[o] > 0) ?? 'reserve';
      if (b.from[origin] > 0) b.from[origin] -= 1;
      this.state.troops[b.type] += 1;
      if (origin !== 'reserve' && !this.squadMarch(origin)) {
        const line = this.state.squads[origin].lines.find((l) => l.type === b.type && l.count < l.full);
        if (line) line.count += 1;
      }
      healed[b.type] = (healed[b.type] ?? 0) + 1;
      if (b.count <= 0) q.shift();
    }
    return healed;
  }

  // ---- Squads in the field --------------------------------------------
  squadMarch(id) { return this.world.marchFor(LOCAL_OWNER, id); }
  squadStatus(id) {
    if (!this.squadUnlocked(id)) return 'locked';
    const m = this.squadMarch(id);
    if (m) return m.phase === 'out' ? 'marching' : 'returning';
    return this.squadSoldiers(id) > 0 || this.refillable(id) > 0 ? 'home' : 'empty';
  }
  refillable(id) {
    const sq = this.state.squads[id];
    const need = {};
    for (const l of sq.lines) if (l.type && l.full > l.count) need[l.type] = (need[l.type] ?? 0) + (l.full - l.count);
    return Object.entries(need).reduce((n, [t, k]) => n + Math.min(k, this.readyCount(t)), 0);
  }
  // Tops lines back up to their saved size from ready (unassigned, healthy) troops.
  refillSquad(id, { silent = false } = {}) {
    if (this.squadMarch(id)) return { ok: false, reason: `${SQUADS[id].name} is out on a march` };
    let added = 0;
    for (const l of this.state.squads[id].lines) {
      if (!l.type || l.full <= l.count) continue;
      const k = Math.min(l.full - l.count, this.readyCount(l.type));
      if (k > 0) { l.count += k; added += k; }
    }
    if (added && !silent) { this.save(); this.emit('squad', id); this.emit('change'); }
    return { ok: added > 0, added, reason: added ? null : 'Nothing to refill' };
  }
  squadArmy(id) { return squadArmy(this.state, id); }
  squadCombatPower(id) { return combatPower(squadArmy(this.state, id)); }

  // ---- Stamina -----------------------------------------------------------
  staminaMax() { return STAMINA.max + this.mods.staminaCap; }
  staminaRegenPerHour() { return STAMINA.regenPerHour + this.mods.staminaRegen; }
  get staminaRegenSeconds() { return 3600 / this.staminaRegenPerHour(); }
  staminaNext() { return this.state.hunt.stamina >= this.staminaMax() ? 0 : Math.max(0, this.staminaRegenSeconds - this.state.hunt.staminaCarry); }
  tickStamina(dt) {
    const h = this.state.hunt, max = this.staminaMax();
    if (h.stamina >= max) { h.staminaCarry = 0; return; }
    h.staminaCarry += dt;
    const per = this.staminaRegenSeconds;
    while (h.staminaCarry + 1e-6 >= per && h.stamina < max) { h.staminaCarry = Math.max(0, h.staminaCarry - per); h.stamina += 1; }
    if (h.stamina >= max) h.staminaCarry = 0;
  }

  // ---- Hunting -------------------------------------------------------------
  maxAttackLevel() { return Math.min(WORLD.maxLevel, this.state.hunt.bestKill + WORLD.levelHeadroom); }
  creatures() { return this.world.entities('creature'); }
  creaturePowerOf(e) { return creaturePower(e.level, !!CREATURES[e.type]?.elite); }
  firstKillCores(level) {
    if (this.state.hunt.firstKills.includes(level)) return 0;
    return level % 5 === 0 ? CORES.battle.firstKillElite : CORES.battle.firstKill;
  }
  killRewards(e) {
    const m = (CREATURES[e.type]?.elite ? HUNT_REWARDS.eliteMult : 1) * this.mods.loot; // Salvage Protocols research
    return { energy: Math.round(HUNT_REWARDS.energy(e.level) * m), alloy: Math.round(HUNT_REWARDS.alloy(e.level) * m), shards: Math.round(HUNT_REWARDS.shards(e.level) * m) };
  }

  attackInfo(squadId, targetId) {
    const t = this.world.get(targetId);
    const out = { can: false, reason: null, target: t, travel: 0, power: 0, enemy: 0 };
    if (!t) { out.reason = 'Target is gone'; return out; }
    out.enemy = this.creaturePowerOf(t);
    if (!this.squadUnlocked(squadId)) out.reason = `Unlocks at Command Center Lv ${SQUADS[squadId].unlockCC}`;
    else if (this.squadMarch(squadId)) out.reason = `${SQUADS[squadId].name} is already out`;
    else if (this.squadSoldiers(squadId) + this.refillable(squadId) < 1) out.reason = `No healthy troops in ${SQUADS[squadId].name}`;
    else if (t.kind === 'creature' && t.level > this.maxAttackLevel()) out.reason = `Defeat a Lv ${t.level - 1} creature first`;
    else if (this.state.hunt.stamina < STAMINA.perAttack) out.reason = `Need ${STAMINA.perAttack} stamina`;
    const speed = this.mods.march; // Rift Striders research
    const c = this.world.canSend({ owner: LOCAL_OWNER, squadId, targetId, speed });
    if (!out.reason && !c.ok) out.reason = c.reason;
    out.travel = c.travel ?? marchSeconds(dist(t, { x: WORLD.baseX, y: WORLD.baseY })) / speed;
    // power if it marched now (after refill)
    const sq = this.state.squads[squadId];
    const saved = sq.lines.map((l) => l.count);
    if (!this.squadMarch(squadId)) for (const l of sq.lines) if (l.type && l.full > l.count) l.count += Math.min(l.full - l.count, this.readyCount(l.type));
    out.power = this.squadCombatPower(squadId);
    sq.lines.forEach((l, i) => { l.count = saved[i]; });
    out.odds = odds(out.power, out.enemy);
    out.can = !out.reason;
    return out;
  }

  // Sends a squad (healthy troops only, refilled to its saved formation first) to attack a target.
  attack(squadId, targetId, { auto = false } = {}) {
    const info = this.attackInfo(squadId, targetId);
    if (!info.can) return { ok: false, reason: info.reason };
    this.refillSquad(squadId, { silent: true });
    const army = squadArmy(this.state, squadId);
    const r = this.world.sendMarch({ owner: LOCAL_OWNER, squadId, army, targetId, speed: this.mods.march, meta: { auto, power: info.power, enemy: info.enemy, stamina: STAMINA.perAttack } });
    if (!r.ok) return r;
    this.state.hunt.stamina -= STAMINA.perAttack;
    if (!this.simulating) { this.save(); this.emit('march', r.march); this.emit('change'); }
    return { ok: true, march: r.march, travel: info.travel };
  }
  recall(squadId) {
    const m = this.squadMarch(squadId);
    if (!m) return { ok: false, reason: 'Not out' };
    const r = this.world.recallMarch(m.id);
    if (!r.ok) return r;
    this.state.hunt.stamina = Math.min(STAMINA.overCap, this.state.hunt.stamina + (m.meta?.stamina ?? 0)); // refund
    this.save(); this.emit('change');
    return { ok: true };
  }
  setAuto(on) { this.state.hunt.auto = !!on; this.save(); this.emit('change'); if (on) this.autoStep(); return this.state.hunt.auto; }

  // Auto mode: every idle squad attacks the highest-level creature it out-powers by >= 10%, nearest first.
  autoPick(squadId) {
    const sq = this.state.squads[squadId];
    const saved = sq.lines.map((l) => l.count);
    for (const l of sq.lines) if (l.type && l.full > l.count) l.count += Math.min(l.full - l.count, this.readyCount(l.type));
    const power = this.squadCombatPower(squadId);
    sq.lines.forEach((l, i) => { l.count = saved[i]; });
    if (power <= 0) return null;
    const home = { x: WORLD.baseX, y: WORLD.baseY }, maxL = this.maxAttackLevel();
    const ok = this.creatures().filter((e) => !e.busy && e.level <= maxL && power >= WORLD.autoMargin * this.creaturePowerOf(e));
    ok.sort((a, b) => b.level - a.level || dist(a, home) - dist(b, home));
    return ok[0] ?? null;
  }
  autoStep() {
    if (!this.state.hunt.auto) return 0;
    let sent = 0;
    for (const id of TROOPS.squadIds) {
      if (this.state.hunt.stamina < STAMINA.perAttack) break;
      if (!this.squadUnlocked(id) || this.squadMarch(id)) continue;
      const t = this.autoPick(id);
      if (t && this.attack(id, t.id, { auto: true }).ok) sent++;
    }
    return sent;
  }

  processWorld(dt) {
    const events = this.world.tick(dt);
    for (const ev of events) {
      if (ev.type === 'battle') this.onBattle(ev);
      else if (ev.type === 'home' && !this.simulating) this.emit('marchHome', ev.march);
    }
    const sent = this.autoStep();
    if ((events.length || sent) && !this.simulating) { this.save(); this.emit('change'); }
    return events;
  }

  // Casualties: the sim decides where losses land; CASUALTIES rates decide how many.
  applyCasualties(squadId, army, result, win) {
    const C = win ? CASUALTIES.win : CASUALTIES.loss;
    const sq = this.state.squads[squadId];
    const sent = army.lines.map((l, i) => (l.type && sq.lines[i]?.type === l.type ? Math.min(l.count, sq.lines[i].count) : 0));
    const total = sent.reduce((a, b) => a + b, 0);
    const out = { dead: {}, wounded: {}, overflow: 0, total: 0 };
    if (!total) return out;
    const simRate = result.fallen.A.reduce((a, b) => a + b, 0) / Math.max(1, army.lines.reduce((n, l) => n + (l.count || 0), 0));
    const n = Math.min(total, Math.round(total * Math.min(C.max, Math.max(C.min, simRate))));
    // largest-remainder split by exposure
    const w = sent.map((k, i) => (k ? (result.fallen.A[i] ?? 0) + k * CASUALTIES.lineWeight[i] * 0.5 : 0));
    const ws = w.reduce((a, b) => a + b, 0) || 1;
    const raw = w.map((x) => (x / ws) * n);
    const take = raw.map((x, i) => Math.min(sent[i], Math.floor(x)));
    let left = n - take.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
    for (let pass = 0; left > 0 && pass < 3; pass++) for (const { i } of order) if (left > 0 && take[i] < sent[i]) { take[i]++; left--; }
    // dead share is rounded on the TOTAL (so small fights still lose someone now and then), front lines first
    const deadPer = take.map(() => 0);
    let deadLeft = Math.round(n * C.deadShare * this.mods.survival); // Stabilizers research: fewer deaths, more wounded
    for (let pass = 0; deadLeft > 0 && pass < n; pass++) for (let i = 0; i < take.length && deadLeft > 0; i++) if (deadPer[i] < take[i]) { deadPer[i]++; deadLeft--; }
    let free = this.infirmaryFree();
    take.forEach((k, i) => {
      if (!k) return;
      const t = sq.lines[i].type;
      const dead = deadPer[i], hurt = k - dead;
      const admitted = Math.min(hurt, free); free -= admitted;
      const overflow = hurt - admitted;
      sq.lines[i].count -= k;
      this.state.troops[t] -= k;
      this.state.infirmary.wounded[t][squadId] += admitted;
      out.dead[t] = (out.dead[t] ?? 0) + dead + overflow;
      out.wounded[t] = (out.wounded[t] ?? 0) + admitted;
      out.overflow += overflow;
    });
    out.total = n;
    out.deadTotal = Object.values(out.dead).reduce((a, b) => a + b, 0);
    out.woundedTotal = Object.values(out.wounded).reduce((a, b) => a + b, 0);
    this.state.hunt.dead += out.deadTotal;
    return out;
  }

  onBattle({ march, target, defender, result }) {
    const h = this.state.hunt;
    const win = result.winner === 'attacker';
    const before = this.power.total;
    const casualties = this.applyCasualties(march.squadId, march.army, result, win);
    const loot = { energy: 0, alloy: 0, shards: 0, cores: 0 };
    let firstKill = false;
    if (win && target.kind === 'creature') {
      Object.assign(loot, this.killRewards(target));
      this.state.resources.energy += loot.energy; this.state.resources.alloy += loot.alloy; this.state.resources.shards += loot.shards;
      const fk = this.firstKillCores(target.level);
      if (fk > 0) { h.firstKills.push(target.level); loot.cores = this.grantCores(fk, 'battle'); firstKill = true; }
      h.bestKill = Math.max(h.bestKill, target.level);
      h.kills += 1;
    } else h.losses += 1;
    const report = {
      id: `r${++h.reportSeq}`, at: Date.now(), squadId: march.squadId, win, seed: result.seed, rounds: result.rounds,
      target: { id: target.id, kind: target.kind, type: target.type, level: target.level, x: target.x, y: target.y },
      power: { squad: march.meta?.power ?? combatPower(march.army), enemy: march.meta?.enemy ?? 0 },
      attacker: march.army, defender, casualties, loot, firstKill, auto: !!march.meta?.auto, offline: this.simulating,
    };
    h.reports.unshift(report);
    if (h.reports.length > WORLD.reportsKept) h.reports.length = WORLD.reportsKept;
    const acc = this.simAcc;
    if (acc) {
      acc.fights++; if (win) acc.wins++;
      for (const k of ['energy', 'alloy', 'shards', 'cores']) acc[k] += loot[k];
      acc.dead += casualties.deadTotal ?? 0; acc.wounded += casualties.woundedTotal ?? 0;
    }
    if (!this.simulating) this.emit('hunt', report, { before, after: this.power.total });
    return report;
  }
  // Re-runs the (deterministic) battle of a stored report for the replay.
  replayOf(report) { return resolveBattle(report.attacker, report.defender, report.seed); }

  // Offline: healing, stamina, marches, respawns and Auto all advance together in 5 s steps.
  simulateWorld(secs) {
    const healed = {};
    const acc = this.simAcc = { fights: 0, wins: 0, energy: 0, alloy: 0, shards: 0, cores: 0, dead: 0, wounded: 0, healed };
    this.simulating = true;
    try {
      for (let t = 0; t < secs; t += 5) {
        const dt = Math.min(5, secs - t);
        for (const [k, v] of Object.entries(this.processHealing(dt))) healed[k] = (healed[k] ?? 0) + v;
        this.tickStamina(dt);
        this.processWorld(dt);
      }
    } finally { this.simulating = false; this.simAcc = null; }
    return acc;
  }
}

export const store = new Store();
