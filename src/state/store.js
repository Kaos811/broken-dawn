// Single source of truth for game state + persistence. Scenes read `store.state`
// and listen for events; they never write localStorage directly.
import {
  BEACON, BUILDINGS, BUILDING_IDS, BUILDING_LEVEL_HEADROOM, ECONOMY,
  SAVE_KEY, SAVE_VERSION, TROOPS, buildingUpgradeCost,
  TROOP_CLASSES, TROOP_IDS, BARRACKS, SQUADS, RESOURCES, GACHA, RARITY, RARITIES,
  LEADERS, LEADER_IDS, GEAR, GEAR_IDS, CORES, UPGRADES,
} from '../config.js';
import { isValidPlacement } from '../systems/grid.js';
import { basePower, squadPower, squadSoldiers, troopPowerBreakdown } from '../systems/power.js';

const emptyLines = () => Array.from({ length: SQUADS.lines }, () => ({ type: null, count: 0 }));
const emptyLanes = () => Object.fromEntries(TROOP_IDS.map((t) => [t, { count: 0, progress: 0 }]));
const emptySquad = () => ({ level: 1, lines: emptyLines(), leader: null, armor: null, weapon: null });

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
    gacha: { sinceEpic: 0, sinceLegendary: 0, total: 0, history: [] },
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
    placed.push({ gx: b.gx, gy: b.gy, size });
    s.buildings[id] = b;
  }
  for (const t of TROOP_IDS) s.troops[t] = int(raw.troops?.[t]);
  // Lanes are never trimmed to capacity on load (that would silently delete paid-for units).
  s.training = emptyLanes();
  for (const t of TROOP_IDS) {
    const l = raw.training?.[t];
    const count = int(l?.count);
    s.training[t] = { count, progress: count > 0 ? Math.max(0, num(l?.progress, 0)) : 0 };
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
      if (n > 0) { sq.lines[i] = { type: l.type, count: n }; assigned[l.type] += n; }
    });
    if (s.leaders[r.leader] && !usedLeaders.has(r.leader)) { sq.leader = r.leader; usedLeaders.add(r.leader); }
    for (const slot of ['armor', 'weapon']) {
      const gid = r[slot];
      if (GEAR[gid]?.slot === slot && (usedGear[gid] ?? 0) < (s.gear[gid] ?? 0)) { sq[slot] = gid; usedGear[gid] = (usedGear[gid] ?? 0) + 1; }
    }
    s.squads[id] = sq;
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
    s.resources.energy += ECONOMY.energyPerSec(s.beacon.level) * secs * ECONOMY.offlineRate;
    s.resources.shards += RESOURCES.shardsPerSec(s.beacon.level) * secs * ECONOMY.offlineRate;
    s.resources.alloy += RESOURCES.alloyPerSec(s.buildings.commandCenter.level) * secs * ECONOMY.offlineRate;
    s.beacon.charge = Math.min(BEACON.maxCharge, chargeBefore + BEACON.chargePerSec(s.beacon.level) * secs);
    const trained = this.processTraining(secs);
    this.offlineReport = {
      seconds: secs, capped: elapsed > ECONOMY.offlineCapSeconds,
      energy: s.resources.energy - r0.energy, shards: s.resources.shards - r0.shards, alloy: s.resources.alloy - r0.alloy,
      charge: s.beacon.charge - chargeBefore, trained,
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
    s.resources.energy += ECONOMY.energyPerSec(s.beacon.level) * dt;
    s.resources.shards += RESOURCES.shardsPerSec(s.beacon.level) * dt;
    s.resources.alloy += RESOURCES.alloyPerSec(s.buildings.commandCenter.level) * dt;
    if (s.beacon.charge < BEACON.maxCharge) {
      s.beacon.charge = Math.min(BEACON.maxCharge, s.beacon.charge + BEACON.chargePerSec(s.beacon.level) * dt);
    }
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
  get energyRate() { return ECONOMY.energyPerSec(this.state.beacon.level); }
  get shardRate() { return RESOURCES.shardsPerSec(this.state.beacon.level); }
  get alloyRate() { return RESOURCES.alloyPerSec(this.state.buildings.commandCenter.level); }

  buildingLevelCap() { return this.state.beacon.level + BUILDING_LEVEL_HEADROOM; }

  // ---- Upgrades -------------------------------------------------------
  upgradeInfo(id) {
    const s = this.state;
    if (id === BEACON.id) {
      const level = s.beacon.level;
      const cost = BEACON.upgradeCost(level);
      const charged = s.beacon.charge >= BEACON.maxCharge;
      const maxed = level >= BEACON.maxLevel;
      let reason = null;
      if (maxed) reason = 'Max level';
      else if (!charged) reason = 'Beacon must be fully charged';
      else if (s.resources.energy < cost) reason = 'Not enough Energy';
      return { level, cost, can: !reason, reason };
    }
    const level = s.buildings[id].level;
    const cost = buildingUpgradeCost(id, level);
    let reason = null;
    if (level >= this.buildingLevelCap()) reason = `Raise the Beacon to Lv ${level - BUILDING_LEVEL_HEADROOM + 1} first`;
    else if (s.resources.energy < cost) reason = 'Not enough Energy';
    return { level, cost, can: !reason, reason };
  }

  upgrade(id) {
    const info = this.upgradeInfo(id);
    if (!info.can) return { ok: false, reason: info.reason };
    const before = this.power.total;
    this.state.resources.energy -= info.cost;
    if (id === BEACON.id) { this.state.beacon.level += 1; this.state.beacon.charge = 0; }
    else this.state.buildings[id].level += 1;
    this.save();
    const after = this.power.total;
    this.emit('upgrade', id, { before, after });
    this.emit('change');
    return { ok: true, gained: after - before };
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
  // One lane per troop class. Lanes have their own capacity and timer and all run at once.
  get barracksLevel() { return this.state.buildings.barracks.level; }
  laneCapacity() { return BARRACKS.laneCapacity(this.barracksLevel); }
  lane(type) { return this.state.training[type]; }
  laneRoom(type) { return Math.max(0, this.laneCapacity() - (this.lane(type)?.count ?? 0)); }
  queuedUnits() { return TROOP_IDS.reduce((n, t) => n + this.state.training[t].count, 0); }
  activeLanes() { return TROOP_IDS.filter((t) => this.state.training[t].count > 0); }
  unitTime(type) { return TROOP_CLASSES[type].trainSeconds / BARRACKS.trainSpeed(this.barracksLevel); }
  maxTrainable(type) {
    return Math.min(this.laneRoom(type), Math.floor(this.state.resources.energy / TROOP_CLASSES[type].energy));
  }
  // Seconds until the unit currently in training in this lane finishes (0 if idle).
  laneNextSeconds(type) { const l = this.lane(type); return l.count ? Math.max(0, this.unitTime(type) - l.progress) : 0; }
  // Seconds until this whole lane is done.
  laneSecondsLeft(type) { const l = this.lane(type); return l.count ? Math.max(0, l.count * this.unitTime(type) - l.progress) : 0; }
  // Lanes run in parallel, so everything is done when the slowest lane is.
  trainingSecondsLeft() { return Math.max(0, ...TROOP_IDS.map((t) => this.laneSecondsLeft(t))); }

  trainInfo(type, n) {
    const def = TROOP_CLASSES[type];
    if (!def) return { can: false, reason: 'Unknown troop' };
    n = Math.floor(n);
    const cost = n * def.energy;
    const room = this.laneRoom(type);
    let reason = null;
    if (room < 1) reason = `${def.name} lane is full`;
    else if (n < 1) reason = 'Not enough Energy';
    else if (n > room) reason = `${def.name} lane has room for ${room}`;
    else if (this.state.resources.energy < cost) reason = 'Not enough Energy';
    return { can: !reason, reason, cost, n };
  }

  train(type, n) {
    const info = this.trainInfo(type, n);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.energy -= info.cost;
    const l = this.lane(type);
    if (l.count === 0) l.progress = 0;
    l.count += info.n;
    this.save();
    this.emit('change');
    return { ok: true, n: info.n, cost: info.cost };
  }

  // Cancels everything in one lane (including the unit in progress) for a full Energy refund.
  cancelLane(type) {
    const l = this.lane(type);
    if (!l || l.count < 1) return { ok: false };
    const n = l.count;
    const refund = n * TROOP_CLASSES[type].energy;
    this.state.resources.energy += refund;
    l.count = 0; l.progress = 0;
    this.save();
    this.emit('change');
    return { ok: true, refund, n };
  }

  // Advances every lane by dt seconds, independently; returns { type: unitsCompleted }.
  processTraining(dt) {
    const done = {};
    if (!(dt > 0)) return done;
    for (const t of TROOP_IDS) {
      const l = this.state.training[t];
      if (l.count < 1) continue;
      const ut = this.unitTime(t);
      const avail = l.progress + dt;
      const n = Math.min(l.count, Math.floor(avail / ut + 1e-9));
      l.count -= n;
      l.progress = l.count > 0 ? Math.max(0, avail - n * ut) : 0;
      if (n > 0) { this.state.troops[t] += n; done[t] = n; }
    }
    return done;
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
    const clean = lines.map((l) => (TROOP_CLASSES[l?.type] && Math.floor(l.count) > 0 ? { type: l.type, count: Math.floor(l.count) } : { type: null, count: 0 }));
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
      const base = TROOP_CLASSES[line.type];
      for (const stat of ['hp', 'atk', 'def']) {
        let pct = 0;
        if (L?.buff && L.buff.stat === stat && (L.buff.target === 'all' || L.buff.target === line.type)) pct += L.buff.pct * mult;
        if (L?.debuff && L.debuff.stat === stat && (L.debuff.target === 'all' || L.debuff.target === line.type)) pct += L.debuff.pct;
        for (const slot of ['armor', 'weapon']) { const g = GEAR[sq[slot]]; if (g && g.buff.stat === stat) pct += this.gearBuffPct(g.id); }
        totals[stat] += base[stat] * line.count * (1 + pct / 100);
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
    this.save(); this.emit('change');
    return { ok: true, cores: info.reward, streak: info.streak, bonus: info.reward > CORES.daily.base };
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
}

export const store = new Store();
