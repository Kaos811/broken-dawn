// Single source of truth for game state + persistence. Scenes read `store.state`
// and listen for events; they never write localStorage directly.
import {
  BEACON, BUILDINGS, BUILDING_IDS, BUILDING_LEVEL_HEADROOM, ECONOMY,
  SAVE_KEY, SAVE_VERSION, TROOPS, buildingUpgradeCost,
  TROOP_CLASSES, TROOP_IDS, BARRACKS, SQUADS, RESOURCES, GACHA, RARITY, RARITIES,
  LEADERS, LEADER_IDS, GEAR, GEAR_IDS,
} from '../config.js';
import { isValidPlacement } from '../systems/grid.js';
import { basePower, squadPower, squadSoldiers, troopPowerBreakdown } from '../systems/power.js';

const emptyLines = () => Array.from({ length: SQUADS.lines }, () => ({ type: null, count: 0 }));
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
    resources: { energy: ECONOMY.startEnergy, shards: RESOURCES.startShards, alloy: RESOURCES.startAlloy },
    beacon: { level: 1, charge: 0 },
    buildings,
    troops,                 // owned soldiers per class (ready + assigned)
    training: [],           // queue: [{ type, count, progress }] (progress = seconds into current unit)
    squads,
    leaders: {},            // { id: { stars } }
    gear: {},               // { id: count }
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
  s.training = (Array.isArray(raw.training) ? raw.training : [])
    .filter((q) => TROOP_CLASSES[q?.type] && int(q.count) > 0)
    .slice(0, BARRACKS.maxBatches)
    .map((q) => ({ type: q.type, count: int(q.count), progress: Math.max(0, num(q.progress, 0)) }));
  for (const id of LEADER_IDS) if (raw.leaders?.[id]) s.leaders[id] = { stars: Math.min(GACHA.maxStars, Math.max(1, int(raw.leaders[id].stars, 1))) };
  for (const id of GEAR_IDS) { const n = int(raw.gear?.[id]); if (n) s.gear[id] = n; }
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
    if (s.training.length) {
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
  get barracksLevel() { return this.state.buildings.barracks.level; }
  queueCapacity() { return BARRACKS.queueCapacity(this.barracksLevel); }
  queuedUnits() { return this.state.training.reduce((n, q) => n + q.count, 0); }
  queueRoom() { return Math.max(0, this.queueCapacity() - this.queuedUnits()); }
  unitTime(type) { return TROOP_CLASSES[type].trainSeconds / BARRACKS.trainSpeed(this.barracksLevel); }
  maxTrainable(type) {
    return Math.min(this.queueRoom(), Math.floor(this.state.resources.energy / TROOP_CLASSES[type].energy));
  }
  queueSecondsLeft() {
    return this.state.training.reduce((t, q, i) => t + q.count * this.unitTime(q.type) - (i === 0 ? q.progress : 0), 0);
  }

  trainInfo(type, n) {
    const def = TROOP_CLASSES[type];
    if (!def) return { can: false, reason: 'Unknown troop' };
    n = Math.floor(n);
    const cost = n * def.energy;
    let reason = null;
    const tail = this.state.training[this.state.training.length - 1];
    if (this.queueRoom() < 1) reason = 'Training queue is full';
    else if (n < 1) reason = 'Not enough Energy';
    else if (n > this.queueRoom()) reason = `Queue has room for ${this.queueRoom()}`;
    else if (this.state.resources.energy < cost) reason = 'Not enough Energy';
    else if (!(tail && tail.type === type) && this.state.training.length >= BARRACKS.maxBatches) reason = 'Too many batches queued';
    return { can: !reason, reason, cost, n };
  }

  train(type, n) {
    const info = this.trainInfo(type, n);
    if (!info.can) return { ok: false, reason: info.reason };
    this.state.resources.energy -= info.cost;
    const q = this.state.training;
    const tail = q[q.length - 1];
    if (tail && tail.type === type) tail.count += info.n;
    else q.push({ type, count: info.n, progress: 0 });
    this.save();
    this.emit('change');
    return { ok: true, n: info.n, cost: info.cost };
  }

  cancelBatch(index) {
    const q = this.state.training[index];
    if (!q) return { ok: false };
    const refund = q.count * TROOP_CLASSES[q.type].energy;
    this.state.resources.energy += refund;
    this.state.training.splice(index, 1);
    this.save();
    this.emit('change');
    return { ok: true, refund };
  }

  // Advances the queue by dt seconds; returns { type: unitsCompleted }.
  processTraining(dt) {
    const done = {};
    const q = this.state.training;
    while (dt > 0 && q.length) {
      const head = q[0];
      const ut = this.unitTime(head.type);
      const avail = head.progress + dt;
      const n = Math.min(head.count, Math.floor(avail / ut + 1e-9));
      if (n > 0) {
        head.count -= n;
        this.state.troops[head.type] += n;
        done[head.type] = (done[head.type] ?? 0) + n;
        const used = n * ut - head.progress;
        dt -= used;
        head.progress = 0;
        if (head.count <= 0) q.shift();
      } else { head.progress = avail; dt = 0; }
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
        for (const slot of ['armor', 'weapon']) { const g = GEAR[sq[slot]]; if (g && g.buff.stat === stat) pct += g.buff.pct; }
        totals[stat] += base[stat] * line.count * (1 + pct / 100);
      }
    }
    return { hp: Math.round(totals.hp), atk: Math.round(totals.atk), def: Math.round(totals.def) };
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
    const cost = n === 10 ? GACHA.costX10 : GACHA.costX1 * n;
    if (n !== 1 && n !== 10) return { ok: false, reason: 'Pull x1 or x10' };
    if (this.state.resources.shards < cost) return { ok: false, reason: `Need ${cost} Shards` };
    this.state.resources.shards -= cost;
    const results = [];
    for (let i = 0; i < n; i++) results.push(this.pullOne());
    this.save();
    this.emit('pull', results);
    this.emit('change');
    return { ok: true, results, cost };
  }
}

export const store = new Store();
