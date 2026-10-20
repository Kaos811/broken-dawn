// Stage 8: Daily Missions. Mixed into the Store (see store.js), so `this` is the store.
// Day logic: local calendar days (same dayIndex as the daily login claim). Missions roll over only when
// the day number goes UP, so setting the clock back never gives a second reset. On rollover, finished
// tasks that weren't claimed and chests that were reached but not opened are paid automatically.
import { MISSIONS, STAMINA } from '../config.js';

export const defaultMissions = () => ({ day: null, progress: {}, claimed: [], chests: [] });

// Which mission an action feeds (kind -> task id). 'kill' may also feed 'push' (see track()).
const FEEDS = { daily: 'daily', kill: 'kills', train: 'train', upgradeStart: 'build', researchStart: 'research', shardUp: 'research', heal: 'heal' };

export function sanitizeMissions(raw) {
  const d = defaultMissions();
  if (!raw || typeof raw !== 'object') return d;
  const ids = MISSIONS.tasks.map((t) => t.id), ats = MISSIONS.chests.map((c) => c.at);
  d.day = Number.isFinite(raw.day) ? Math.floor(raw.day) : null;
  for (const t of MISSIONS.tasks) { const v = Math.floor(Number(raw.progress?.[t.id])); if (v > 0) d.progress[t.id] = Math.min(t.goal, v); }
  d.claimed = [...new Set((Array.isArray(raw.claimed) ? raw.claimed : []).filter((id) => ids.includes(id) && (d.progress[id] ?? 0) >= MISSIONS.tasks.find((t) => t.id === id).goal))];
  d.chests = [...new Set((Array.isArray(raw.chests) ? raw.chests : []).filter((a) => ats.includes(a)))];
  return d;
}

export const missionMethods = {
  missionsUnlocked() { return this.state.tutorial.done === true; },

  // Rolls missions over to today if the local day number went up. Returns the auto-paid bundle (or null).
  missionsRoll() {
    const m = this.state.missions, today = this.dayIndex();
    if (m.day === null) { m.day = today; return null; }
    if (today <= m.day) return null; // same day, or the clock went back: keep today's progress
    // pay what was earned but not collected, then start fresh
    const paid = {};
    let pts = this.missionPoints();
    for (const t of this.missionList()) if (t.done && !t.claimed) pts += t.pts;
    for (const c of MISSIONS.chests) if (pts >= c.at && !m.chests.includes(c.at)) addBundle(paid, c.reward(this.state.beacon.level));
    this.state.missions = { ...defaultMissions(), day: today };
    const any = Object.keys(paid).length > 0;
    if (any) this.grantBundle(paid, 'missions');
    this.missionsReport = { paid: any ? paid : null, at: this.clock() };
    this.emit('missionsReset', this.missionsReport);
    this.emit('change');
    return paid;
  },

  // Central activity hook: every counted action in the game calls this (missions now, events in stage 8b).
  track(kind, n = 1, meta = {}) {
    if (!(n > 0)) return;
    this.missionsRoll();
    const m = this.state.missions;
    const bump = (id) => {
      const T = MISSIONS.tasks.find((t) => t.id === id);
      const cur = m.progress[id] ?? 0;
      if (cur >= T.goal) return;
      m.progress[id] = Math.min(T.goal, cur + (id === 'push' ? 1 : n));
      if (m.progress[id] >= T.goal) this.emit('missionDone', id);
    };
    const id = FEEDS[kind];
    if (id) bump(id);
    if (kind === 'kill' && meta.push) bump('push');
    this.trackEvents?.(kind, n, meta);
  },

  missionName(T) { return T.alt && !this.archiveUnlocked() ? T.alt : T.name; },
  missionList() {
    const m = this.state.missions;
    return MISSIONS.tasks.map((T) => {
      const progress = m.progress[T.id] ?? 0;
      return { id: T.id, name: this.missionName(T), goal: T.goal, pts: T.pts, progress, done: progress >= T.goal, claimed: m.claimed.includes(T.id) };
    });
  },
  missionPoints() {
    const m = this.state.missions;
    return MISSIONS.tasks.reduce((a, T) => a + (m.claimed.includes(T.id) ? T.pts : 0), 0);
  },
  missionChests() {
    const pts = this.missionPoints(), m = this.state.missions, L = this.state.beacon.level;
    return MISSIONS.chests.map((c) => ({ at: c.at, tier: c.tier, reward: c.reward(L), reached: pts >= c.at, claimed: m.chests.includes(c.at) }));
  },
  missionsReady() {
    if (!this.missionsUnlocked()) return 0;
    return this.missionList().filter((t) => t.done && !t.claimed).length + this.missionChests().filter((c) => c.reached && !c.claimed).length;
  },
  // Seconds until the next local midnight.
  missionsResetIn(t = this.clock()) {
    const d = new Date(t); d.setHours(24, 0, 0, 0);
    return Math.max(0, (d.getTime() - t) / 1000);
  },
  claimMission(id) {
    this.missionsRoll();
    const t = this.missionList().find((x) => x.id === id);
    if (!t) return { ok: false, reason: 'Unknown mission' };
    if (t.claimed) return { ok: false, reason: 'Already claimed' };
    if (!t.done) return { ok: false, reason: `Not done yet: ${t.progress}/${t.goal}` };
    this.state.missions.claimed.push(id);
    this.save(); this.emit('change');
    return { ok: true, pts: t.pts, points: this.missionPoints() };
  },
  claimChest(at) {
    this.missionsRoll();
    const c = this.missionChests().find((x) => x.at === at);
    if (!c) return { ok: false, reason: 'Unknown chest' };
    if (c.claimed) return { ok: false, reason: 'Already opened' };
    if (!c.reached) return { ok: false, reason: `Reach ${at} activity points first` };
    this.state.missions.chests.push(at);
    this.grantBundle(c.reward, 'missions');
    this.save(); this.emit('change');
    return { ok: true, reward: c.reward, tier: c.tier };
  },
  claimAllMissions() {
    const reward = {};
    let pts = 0;
    for (const t of this.missionList()) if (t.done && !t.claimed) pts += this.claimMission(t.id).pts;
    for (const c of this.missionChests()) if (c.reached && !c.claimed) addBundle(reward, this.claimChest(c.at).reward);
    return { ok: pts > 0 || Object.keys(reward).length > 0, pts, reward };
  },

  // Pays a reward bundle { energy, alloy, shards, stamina, cores, marks }. Cores still go through grantCores.
  grantBundle(b, source = 'other') {
    const s = this.state, r = s.resources;
    if (b.energy) r.energy += b.energy;
    if (b.alloy) r.alloy += b.alloy;
    if (b.shards) r.shards += b.shards;
    if (b.stamina) s.hunt.stamina = Math.min(STAMINA.overCap, s.hunt.stamina + b.stamina);
    if (b.marks) s.events.marks += b.marks;
    if (b.cores) this.grantCores(b.cores, source);
    this.grantItems?.(b);
    return b;
  },
};

export function addBundle(into, b) {
  for (const [k, v] of Object.entries(b ?? {})) if (v) into[k] = (into[k] ?? 0) + v;
  return into;
}
