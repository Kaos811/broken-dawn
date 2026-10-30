// Builds plain-data armies for the battle resolver. Pure functions of plain state.
import { CREATURES, TROOP_CLASSES, LEADERS, GEAR, GACHA, UPGRADES, BATTLE, SQUADS, typePower } from '../config.js';
import { lineValue } from './battle.js';
import { researchMods } from '../systems/research.js';

const levelScale = (L) => 1 + 0.08 * (L - 1);

function creatureLine(typeId, level, share, target, { boss = false } = {}) {
  const T = CREATURES[typeId];
  const s = levelScale(level); // HP and ATK scale with level; DEF does not
  const base = { type: typeId, label: T.short, hp: T.unit.hp * s, atk: T.unit.atk * s, def: T.unit.def, targets: T.targets, firstStrike: !!T.firstStrike, tags: T.tags, color: T.color };
  const want = target * share * (T.calib ?? 1); // calib: makes displayed Power match real strength
  if (boss) {
    // one big unit: scale its stats so its value matches its share
    const v = lineValue({ ...base, count: 1 });
    const m = want / v;
    return { ...base, label: T.name, count: 1, hp: base.hp * m, atk: base.atk * m };
  }
  const v = lineValue(base);
  return { ...base, count: Math.max(1, Math.round(want / v)) };
}

// A creature's army. Elites (Dusk Wyrm) = 1 boss unit + a Scuttler brood in front.
export function creatureArmy(typeId, level) {
  const T = CREATURES[typeId];
  const P = typePower(typeId, level);
  if (T.elite) {
    const brood = creatureLine(T.brood, level, T.broodShare, P);
    const boss = creatureLine(typeId, level, 1 - T.broodShare, P, { boss: true });
    return { name: T.name, owner: 'npc', kind: 'creature', level, lines: [brood, boss] };
  }
  return { name: T.name, owner: 'npc', kind: 'creature', level, lines: [creatureLine(typeId, level, 1, P)] };
}

export function leaderMult(state, lid) { return 1 + GACHA.starBonus * ((state.leaders?.[lid]?.stars ?? 1) - 1); }
export function gearPct(state, gid) {
  const lv = state.gearLevels?.[gid] ?? 1;
  return Math.round(GEAR[gid].buff.pct * (1 + UPGRADES.gearLevelBonus * (lv - 1)) * 10) / 10;
}

// A squad's army (healthy troops only, as assigned in its formation). Tier stats, leader, gear,
// squad level and research are all baked into plain per-unit numbers here.
export function squadArmy(state, squadId) {
  const sq = state.squads[squadId];
  const rm = researchMods(state);
  const L = sq.leader ? LEADERS[sq.leader] : null;
  const mult = L ? leaderMult(state, sq.leader) : 1;
  const lvl = 1 + BATTLE.squadLevelBonus * (sq.level - 1);
  const lines = sq.lines.map((line, i) => {
    if (!line.type || !(line.count > 0)) return { type: null, label: SQUADS.lineNames[i], count: 0, hp: 1, atk: 0, def: 0, targets: 'front' };
    const base = TROOP_CLASSES[line.type];
    const cls = base.cls; // leader targets + class behaviour go by class, so every tier keeps its role
    const st = {};
    for (const stat of ['hp', 'atk', 'def']) {
      let pct = 0;
      if (L?.buff && L.buff.stat === stat && (L.buff.target === 'all' || L.buff.target === cls)) pct += L.buff.pct * mult;
      if (L?.debuff && L.debuff.stat === stat && (L.debuff.target === 'all' || L.debuff.target === cls)) pct += L.debuff.pct;
      for (const slot of ['armor', 'weapon']) { const g = GEAR[sq[slot]]; if (g && g.buff.stat === stat) pct += gearPct(state, g.id); }
      st[stat] = base[stat] * (1 + pct / 100);
    }
    st.hp *= lvl * rm.combat[cls]; st.atk *= lvl * rm.combat[cls];
    const out = { type: line.type, cls, tier: base.tier, label: base.plural, count: line.count, ...st, targets: 'front', color: base.color, tags: [cls] };
    if (cls === 'sentinel' && i === 0) out.def *= 1 + BATTLE.sentinelFrontDef;
    if (cls === 'bearer') out.bonusVs = { swarm: BATTLE.bearerVsSwarm };
    if (cls === 'voyager') Object.assign(out, { targets: 'weakest', firstStrike: true, crit: BATTLE.voyager.crit, critMult: BATTLE.voyager.critMult, pierce: BATTLE.voyager.pierce });
    return out;
  });
  return { name: `${squadId[0].toUpperCase()}${squadId.slice(1)} Squad`, owner: 'local', kind: 'squad', squadId, lines };
}

// Stage 19: scale an army's line counts (a bot ally mirrors the leader's formation at some % of its Power).
export function scaleArmy(army, f, extra = {}) {
  return { ...army, ...extra, lines: army.lines.map((l) => ({ ...l, count: l.count > 0 ? Math.max(1, Math.round(l.count * f)) : 0 })) };
}
