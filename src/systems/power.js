import { BEACON, BUILDINGS, TROOPS } from '../config.js';

export function buildingPower(id, level) {
  if (id === BEACON.id) return BEACON.powerPerLevel * level;
  return (BUILDINGS[id]?.powerPerLevel ?? 0) * level;
}

// Building Power = sum of flat per-level power (Beacon counts as the Beacon Relay).
export function totalBuildingPower(state) {
  let p = buildingPower(BEACON.id, state.beacon.level);
  for (const [id, b] of Object.entries(state.buildings)) p += buildingPower(id, b.level);
  return p;
}

// Troop Power = soldiers (1 each) + 10 per squad level. Empty in stage 1.
export function totalTroopPower(state) {
  let p = 0;
  for (const squad of Object.values(state.squads ?? {})) {
    const soldiers = (squad.members ?? []).reduce((n, m) => n + (m.count ?? 0), 0);
    p += soldiers * TROOPS.powerPerSoldier;
    p += Math.max(0, (squad.level ?? 1) - 1) * TROOPS.powerPerSquadLevel;
  }
  return p;
}

export function basePower(state) {
  const building = totalBuildingPower(state);
  const troop = totalTroopPower(state);
  return { building, troop, total: building + troop };
}
