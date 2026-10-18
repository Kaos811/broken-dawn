import { BEACON, BUILDINGS, TROOPS, TROOP_IDS, TROOP_CLASSES } from '../config.js';

export function buildingPower(id, level) {
  if (id === BEACON.id) return BEACON.powerPerLevel * level;
  return (BUILDINGS[id]?.powerPerLevel ?? 0) * level;
}

// Building Power = sum of flat per-level power (Beacon counts as the Beacon Relay).
export function totalBuildingPower(state) {
  let p = buildingPower(BEACON.id, state.beacon.level);
  for (const [id, b] of Object.entries(state.buildings)) {
    if (BUILDINGS[id]?.unlockBeacon && state.beacon.level < BUILDINGS[id].unlockBeacon) continue; // sealed (Archive)
    p += buildingPower(id, b.level);
  }
  return p;
}

export function totalSoldiers(state) {
  return TROOP_IDS.reduce((n, t) => n + (state.troops?.[t] ?? 0), 0);
}
// Soldier power: T1 = 1, T2 = 2, T3 = 4 per soldier.
export function soldierPower(state) {
  return TROOP_IDS.reduce((n, t) => n + (state.troops?.[t] ?? 0) * TROOP_CLASSES[t].power, 0);
}

export function squadSoldiers(squad) {
  return (squad?.lines ?? []).reduce((n, l) => n + (l.type ? l.count ?? 0 : 0), 0);
}

// Squad Power = soldiers in the squad + 10 x squad level.
export function squadPower(squad) {
  return squadSoldiers(squad) * TROOPS.powerPerSoldier + (squad?.level ?? 1) * TROOPS.powerPerSquadLevel;
}

// Troop Power = every trained soldier (1 each for T1, 2 for T2, 4 for T3; assigned or not) + 10 per squad level above 1.
export function troopPowerBreakdown(state) {
  const soldiers = soldierPower(state) * TROOPS.powerPerSoldier;
  let levels = 0;
  for (const squad of Object.values(state.squads ?? {})) levels += Math.max(0, (squad.level ?? 1) - 1) * TROOPS.powerPerSquadLevel;
  return { soldiers, levels, total: soldiers + levels };
}

export function totalTroopPower(state) { return troopPowerBreakdown(state).total; }

export function basePower(state) {
  const building = totalBuildingPower(state);
  const troop = totalTroopPower(state);
  return { building, troop, total: building + troop };
}
