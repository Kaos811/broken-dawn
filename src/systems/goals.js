// Stage 14 (after The Ants: Underground Kingdom): a Chapter Goal chain (one always-visible next goal with
// a reward) and Crew Help (ask the base crew to shave time off a running build or research, like TAUK's
// alliance help: each help cuts 1% of what is left, at least 1 min, 5 helps per job). Mixed into the Store.
import { BEACON, TROOP_IDS } from '../config.js';

export const CREW_HELP = { helps: 5, every: 3, pct: 0.01, minSec: 60 };

const lvl = (s, id) => (id === 'beacon' ? s.beacon.level : s.buildings[id]?.level ?? 0);
const troops = (s) => TROOP_IDS.reduce((n, t) => n + (s.troops[t] ?? 0), 0);
const researched = (s) => Object.values(s.research?.levels ?? {}).reduce((a, b) => a + (b || 0), 0);
// go: where the Go button takes you ('beacon' | building id | 'world' | 'troops' | 'armory' | 'archive')
const L = (id, n, name) => ({ text: `Upgrade the ${name} to Lv ${n}`, goal: n, cur: (s) => lvl(s, id), go: id });
export const GOALS = [
  { ...L('commandCenter', 3, 'Command Center'), reward: { energy: 400, su_m5: 1 } },
  { text: 'Have 30 troops', goal: 30, cur: troops, go: 'troops', reward: { energy: 400, su_m5: 1 } },
  { text: 'Raise the Beacon to Lv 3', goal: 3, cur: (s) => s.beacon.level, go: 'beacon', reward: { energy: 600, alloy: 60 } },
  { text: 'Defeat 10 creatures', goal: 10, cur: (s) => s.hunt.kills, go: 'world', reward: { stamina: 20, su_m15: 1 } },
  // stage 16: send a squad to an Alloy node on the World map (GATHER_GOAL_INDEX below must match this slot)
  { text: 'Gather 500 Alloy', goal: 500, cur: (s) => s.hunt.gathered ?? 0, go: 'world', reward: { energy: 800, shards: 40, su_m15: 1 } },
  { ...L('barracks', 4, 'Barracks'), reward: { energy: 800, su_m15: 1 } },
  { text: 'Win a hunt against a Lv 3 creature', goal: 3, cur: (s) => s.hunt.bestKill, go: 'world', reward: { shards: 40, stamina: 20 } },
  { text: 'Recruit 5 times', goal: 5, cur: (s) => s.gacha.total, go: 'armory', reward: { shards: 60, su_m15: 1 } },
  { text: 'Raise the Beacon to Lv 4', goal: 4, cur: (s) => s.beacon.level, go: 'beacon', reward: { energy: 1200, alloy: 120, su_h1: 1 } },
  { text: 'Finish a research level', goal: 1, cur: researched, go: 'archive', reward: { energy: 1000, su_m15: 2 } },
  { ...L('commandCenter', 5, 'Command Center'), reward: { energy: 1500, alloy: 150 } },
  // stage 19: lead or join a rally that kills a Rift Behemoth (RALLY_GOAL_INDEX below must match this slot)
  { text: 'Rally the Rift: defeat a Behemoth', goal: 1, cur: (s) => s.rally?.total ?? 0, go: 'world', reward: { cores: 1, energy: 2000, su_h1: 1 } },
  { text: 'Have 100 troops', goal: 100, cur: troops, go: 'troops', reward: { energy: 1500, su_h1: 1 } },
  { text: 'Defeat 40 creatures', goal: 40, cur: (s) => s.hunt.kills, go: 'world', reward: { stamina: 30, shards: 80 } },
  { text: 'Raise the Beacon to Lv 5', goal: 5, cur: (s) => s.beacon.level, go: 'beacon', reward: { energy: 2500, alloy: 250, su_h1: 1 } },
  { text: 'Win a hunt against a Lv 6 creature', goal: 6, cur: (s) => s.hunt.bestKill, go: 'world', reward: { shards: 100, su_h3: 1 } },
  { text: 'Raise the Beacon to Lv 6', goal: 6, cur: (s) => s.beacon.level, go: 'beacon', reward: { cores: 1, energy: 4000, su_h3: 1 } },
];

export const GATHER_GOAL_INDEX = 4;
export const RALLY_GOAL_INDEX = 11;
export const defaultGoals = () => ({ i: 0 });
export function sanitizeGoals(raw) { const i = Math.floor(Number(raw?.i)); return { i: Number.isFinite(i) ? Math.min(GOALS.length, Math.max(0, i)) : 0 }; }
// v14 migration: skip goals an existing save has already met (no back-pay), stopping at the first open one
export function fastForwardGoals(s) { let i = 0; while (i < GOALS.length && GOALS[i].cur(s) >= GOALS[i].goal) i++; return { i }; }

export const goalMethods = {
  goalsUnlocked() { return !this.tutorialActive(); },
  currentGoal() {
    const i = this.state.goals.i, G = GOALS[i];
    if (!G) return null;
    const cur = Math.min(G.goal, Math.max(0, G.cur(this.state) ?? 0));
    return { i, n: GOALS.length, text: G.text, goal: G.goal, cur, done: cur >= G.goal, reward: G.reward, go: G.go };
  },
  claimGoal() {
    const g = this.currentGoal();
    if (!g) return { ok: false, reason: 'All goals complete' };
    if (!g.done) return { ok: false, reason: 'Not done yet' };
    this.state.goals.i++;
    this.grantBundle(g.reward, 'goals');
    this.save(); this.emit('goalClaimed', g); this.emit('change');
    return { ok: true, reward: g.reward, next: this.currentGoal() };
  },

  // ---- Crew Help ----
  helpJobs() {
    const out = this.state.construction.map((j) => ({ kind: 'build', id: j.id, job: j }));
    if (this.state.research.job) out.push({ kind: 'research', id: this.state.research.job.id, job: this.state.research.job });
    return out;
  },
  helpAskable() { return this.goalsUnlocked() ? this.helpJobs().filter((x) => !x.job.helpReq).length : 0; },
  requestHelp() {
    const list = this.helpJobs().filter((x) => !x.job.helpReq);
    for (const { job } of list) { job.helpReq = true; job.helped = 0; job.helpCd = CREW_HELP.every; }
    if (list.length) { this.save(); this.emit('change'); }
    return { ok: list.length > 0, n: list.length };
  },
  processHelp(dt) {
    for (const x of this.helpJobs()) {
      const j = x.job;
      if (!j.helpReq || j.helped >= CREW_HELP.helps) continue;
      j.helpCd -= dt;
      while (j.helpCd <= 0 && j.helped < CREW_HELP.helps) {
        const left = x.kind === 'build' ? this.constructionLeft(x.id) : this.researchLeft();
        if (!(left > 0)) break;
        const cut = Math.min(left, Math.max(CREW_HELP.minSec, left * CREW_HELP.pct));
        j.helped++; j.helpCd += CREW_HELP.every;
        if (x.kind === 'build') this.speedUpConstruction(x.id, cut); else this.speedUpResearch(cut);
        this.emit('crewHelp', { kind: x.kind, id: x.id, cut, n: j.helped, name: x.kind === 'build' ? (x.id === BEACON.id ? BEACON.name : this.nameOf(x.id)) : 'Research' });
        if (x.kind === 'build' ? !this.constructionJob(x.id) : !this.researchJob()) break;
      }
    }
  },
};
