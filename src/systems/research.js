// Research effects as plain numbers derived from plain state. PURE (no store / Phaser), so the
// same code builds armies on a server for PvP and stays deterministic.
import { RESEARCH, RESEARCH_IDS, BEACON, BUILDINGS, CLASS_IDS } from '../config.js';

export const researchLevel = (state, id) => Math.max(0, Math.floor(state?.research?.levels?.[id] ?? 0));
export const archiveUnlocked = (state) => (state?.beacon?.level ?? 1) >= BUILDINGS.archive.unlockBeacon;

// { energy, alloy, shards, build, train, loot, march, healSpeed: multipliers (>= 1);
//   healCost, survival: multipliers (<= 1); beds: multiplier; staminaCap, staminaRegen: flat adds;
//   combat: { [class]: multiplier for HP and ATK }; maxTier }
export function researchMods(state) {
  const L = (id) => researchLevel(state, id);
  const up = (id) => 1 + RESEARCH[id].per * L(id);
  const down = (id) => Math.max(0, 1 - RESEARCH[id].per * L(id));
  const combat = {};
  for (const id of RESEARCH_IDS) if (RESEARCH[id].effect === 'combat') combat[RESEARCH[id].cls] = up(id);
  for (const c of CLASS_IDS) combat[c] ??= 1;
  return {
    energy: up('energyYield'), alloy: up('alloyYield'), shards: up('shardYield'), build: up('buildSpeed'),
    train: up('trainSpeed'), combat,
    beds: up('beds'), healSpeed: up('triage'), healCost: down('medSynth'), survival: down('stabilizers'),
    staminaCap: RESEARCH.staminaCells.per * L('staminaCells'), staminaRegen: RESEARCH.recovery.per * L('recovery'),
    march: up('striders'), loot: up('salvage'),
    maxTier: L('tier3') > 0 ? 3 : L('tier2') > 0 ? 2 : 1,
  };
}

// Text for one node's effect at a level, e.g. "+12%", "−10%", "+20", "+2/h".
export function researchEffectText(id, level) {
  const R = RESEARCH[id];
  if (R.effect === 'tier') return level > 0 ? 'Unlocked' : 'Locked';
  const v = R.per * level;
  if (R.fmt === 'pct') return `+${Math.round(v * 100)}%`;
  if (R.fmt === 'pctLess') return `−${Math.round(v * 100)}%`;
  if (R.fmt === 'perHour') return `+${v}/h`;
  return `+${v}`;
}
export { BEACON };
