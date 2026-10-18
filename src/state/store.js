// Single source of truth for game state + persistence. Scenes read `store.state`
// and listen for events; they never write localStorage directly.
import {
  BEACON, BUILDINGS, BUILDING_IDS, BUILDING_LEVEL_HEADROOM, ECONOMY,
  SAVE_KEY, SAVE_VERSION, TROOPS, buildingUpgradeCost,
} from '../config.js';
import { isValidPlacement } from '../systems/grid.js';
import { basePower } from '../systems/power.js';

function defaultState() {
  const buildings = {};
  for (const id of BUILDING_IDS) {
    const s = BUILDINGS[id].start;
    buildings[id] = { level: s.level, gx: s.gx, gy: s.gy };
  }
  const squads = {};
  for (const id of TROOPS.squadIds) squads[id] = { level: 1, members: [] }; // stage 2
  return {
    version: SAVE_VERSION,
    resources: { energy: ECONOMY.startEnergy },
    beacon: { level: 1, charge: 0 },
    buildings,
    troops: {},   // stage 2: { sentinel: n, bearer: n, voyager: n }
    squads,
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

function sanitize(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const s = {
    ...d,
    resources: { energy: Math.max(0, num(raw.resources?.energy, d.resources.energy)) },
    beacon: {
      level: Math.min(BEACON.maxLevel, Math.max(1, Math.floor(num(raw.beacon?.level, 1)))),
      charge: Math.min(BEACON.maxCharge, Math.max(0, num(raw.beacon?.charge, 0))),
    },
    troops: raw.troops && typeof raw.troops === 'object' ? raw.troops : {},
    squads: raw.squads && typeof raw.squads === 'object' ? { ...d.squads, ...raw.squads } : d.squads,
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
  return s;
}

class Store extends Emitter {
  constructor() {
    super();
    this.state = defaultState();
    this.offlineReport = null;
    this._dirty = false;
  }

  load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { raw = null; }
    this.state = sanitize(raw);
    if (raw) this.applyOffline();
    this.save();
    return this.state;
  }

  applyOffline() {
    const elapsed = Math.max(0, (Date.now() - this.state.lastSaved) / 1000);
    const secs = Math.min(elapsed, ECONOMY.offlineCapSeconds);
    if (secs < 5) return;
    const energy = ECONOMY.energyPerSec(this.state.beacon.level) * secs * ECONOMY.offlineRate;
    const chargeBefore = this.state.beacon.charge;
    this.state.resources.energy += energy;
    this.state.beacon.charge = Math.min(BEACON.maxCharge, chargeBefore + BEACON.chargePerSec(this.state.beacon.level) * secs);
    this.offlineReport = { seconds: secs, capped: elapsed > ECONOMY.offlineCapSeconds, energy, charge: this.state.beacon.charge - chargeBefore };
  }

  save() {
    this.state.lastSaved = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch { /* storage full/blocked */ }
    this._dirty = false;
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
    if (s.beacon.charge < BEACON.maxCharge) {
      s.beacon.charge = Math.min(BEACON.maxCharge, s.beacon.charge + BEACON.chargePerSec(s.beacon.level) * dt);
    }
  }

  get power() { return basePower(this.state); }
  get energyRate() { return ECONOMY.energyPerSec(this.state.beacon.level); }

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
}

export const store = new Store();
