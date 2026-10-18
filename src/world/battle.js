// Deterministic, seeded auto-battle resolver. PURE: plain data in, plain data out, no store/Phaser
// imports beyond tuning numbers, so the exact same code can run on a server (PvP) or in a test.
//
// Army = { name, owner, kind, lines: [Line] } where lines[0] is the FRONT row.
// Line = { type, label, count, hp, atk, def, targets: 'front'|'back'|'weakest', firstStrike?, crit?,
//          critMult?, pierce?, bonusVs?: { tag: pct }, tags?: [], color? }  (hp/atk/def are PER UNIT,
//          already including leader/gear/level buffs).
//
// resolveBattle(attacker, defender, seed) -> {
//   winner: 'attacker' | 'defender', rounds, seed,
//   start: { A: [counts], D: [counts] }, end: { A: [...], D: [...] }, fallen: { A: [...], D: [...] },
//   hp: { A: { start: [], end: [] }, D: {...} },
//   events: [{ r, phase, side: 'A'|'D', from, to, dmg, kills, crit }]   // enough for a visual replay
// }
import { BATTLE } from '../config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small string/number hash -> 32-bit seed.
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// Combat Power: a single number that tracks fight strength (linear in troop count).
export function lineValue(l) {
  const ehp = l.hp * (1 + l.def / BATTLE.defK);
  let atk = l.atk;
  if (l.crit) atk *= 1 + l.crit * ((l.critMult ?? 1.5) - 1);
  if (l.firstStrike) atk *= 1.1;
  return Math.sqrt(Math.max(0, ehp * atk)) / 10;
}
export function combatPower(army) {
  return Math.round((army?.lines ?? []).reduce((n, l) => n + (l.count > 0 ? l.count * lineValue(l) : 0), 0));
}

const aliveOf = (s) => (s.pool <= 1e-9 ? 0 : Math.ceil(s.pool / s.hp - 1e-9));

function pickTarget(lines, rule) {
  const alive = lines.map((s, i) => ({ s, i })).filter((x) => x.s.pool > 1e-9);
  if (!alive.length) return -1;
  if (rule === 'back') return alive[alive.length - 1].i;
  if (rule === 'weakest') return alive.reduce((b, x) => (x.s.pool < b.s.pool ? x : b)).i;
  return alive[0].i;
}

export function resolveBattle(attacker, defender, seed = 1) {
  const rng = mulberry32(seed);
  const mk = (army) => army.lines.map((l) => ({ ...l, pool: Math.max(0, l.count) * l.hp, count0: Math.max(0, l.count) }));
  const side = { A: mk(attacker), D: mk(defender) };
  const other = { A: 'D', D: 'A' };
  const events = [];
  const hpStart = { A: side.A.map((s) => s.pool), D: side.D.map((s) => s.pool) };
  const dead = (k) => side[k].every((s) => s.pool <= 1e-9);
  let r = 0;
  for (r = 1; r <= BATTLE.maxRounds && !dead('A') && !dead('D'); r++) {
    for (const phase of [1, 2]) {
      // Everyone in a phase fires based on who was alive when the phase started (simultaneous).
      const volleys = [];
      for (const k of ['A', 'D']) {
        side[k].forEach((s, i) => {
          if (!!s.firstStrike !== (phase === 1)) return;
          const alive = aliveOf(s);
          if (alive > 0) volleys.push({ k, i, s, alive });
        });
      }
      for (const v of volleys) {
        const foes = side[other[v.k]];
        let ti = pickTarget(foes, v.s.targets);
        if (ti < 0) break;
        const crit = !!v.s.crit && rng() < v.s.crit;
        const roll = 1 - BATTLE.spread + rng() * 2 * BATTLE.spread;
        let raw = v.alive * v.s.atk * roll * (crit ? (v.s.critMult ?? 1.5) : 1);
        // spill damage onward if the target line is wiped out
        while (raw > 1e-9 && ti >= 0) {
          const t = foes[ti];
          let bonus = 0;
          for (const tag of t.tags ?? []) bonus += v.s.bonusVs?.[tag] ?? 0;
          const def = t.def * (1 - (v.s.pierce ?? 0));
          const mult = (1 + bonus) * BATTLE.defK / (BATTLE.defK + def);
          const dmg = raw * mult;
          const before = aliveOf(t);
          const take = Math.min(dmg, t.pool);
          t.pool -= take;
          if (t.pool < 1e-6) t.pool = 0;
          events.push({ r, phase, side: v.k, from: v.i, to: ti, dmg: Math.round(take), kills: before - aliveOf(t), crit });
          raw -= take / mult;
          ti = t.pool <= 0 ? pickTarget(foes, v.s.targets) : -1;
        }
      }
      if (dead('A') || dead('D')) break;
    }
  }
  const rounds = Math.min(r, BATTLE.maxRounds);
  const counts = (k) => side[k].map((s) => aliveOf(s));
  const end = { A: counts('A'), D: counts('D') };
  return {
    winner: dead('D') && !dead('A') ? 'attacker' : 'defender',
    rounds, seed,
    start: { A: side.A.map((s) => s.count0), D: side.D.map((s) => s.count0) },
    end,
    fallen: { A: side.A.map((s, i) => s.count0 - end.A[i]), D: side.D.map((s, i) => s.count0 - end.D[i]) },
    hp: { A: { start: hpStart.A, end: side.A.map((s) => s.pool) }, D: { start: hpStart.D, end: side.D.map((s) => s.pool) } },
    events,
  };
}

// Simple win estimate from Combat Power (UI only; the real result comes from resolveBattle).
export function odds(atkPower, defPower) {
  const r = defPower > 0 ? atkPower / defPower : 9;
  if (r >= 1.3) return { label: 'Favored', color: '#4dff9a', ratio: r };
  if (r >= 1.1) return { label: 'Likely win', color: '#b6f36a', ratio: r };
  if (r >= 0.9) return { label: 'Even fight', color: '#ffb347', ratio: r };
  return { label: 'Risky', color: '#ff6f7b', ratio: r };
}
