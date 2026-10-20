// Stage 10: speed-up items, free finish and Core finish. Mixed into the Store (`this` is the store).
// Jobs are addressed as { kind, id }: kind 'build' (id = building id), 'research', 'lane' (id = class),
// 'heal' (the whole healing queue). Items only work on 'build' and 'research'.
import { SPEEDUPS, SPEEDUP_IDS } from '../config.js';

export const emptySpeedups = () => Object.fromEntries(SPEEDUP_IDS.map((id) => [id, 0]));
export function sanitizeSpeedups(raw) {
  const d = emptySpeedups();
  for (const id of SPEEDUP_IDS) { const v = Math.floor(Number(raw?.[id])); if (v > 0) d[id] = v; }
  return d;
}
export const itemDef = (id) => SPEEDUPS.items.find((i) => i.id === id);

// Fewest items (biggest first) covering `left` without overshooting by more than `waste`
// (if that's impossible, uses everything that fits and tops up with the smallest item that covers the rest).
export function planAuto(left, inv, waste = SPEEDUPS.autoWaste) {
  const items = [...SPEEDUPS.items].sort((a, b) => b.seconds - a.seconds);
  const use = {}; let rem = Math.ceil(left);
  for (const it of items) {
    let n = Math.min(inv[it.id] ?? 0, Math.floor((rem + waste) / it.seconds));
    if (n > 0) { use[it.id] = n; rem -= n * it.seconds; }
    if (rem <= 0) break;
  }
  if (rem > 0) {
    const top = [...items].reverse().find((it) => (inv[it.id] ?? 0) - (use[it.id] ?? 0) > 0 && it.seconds >= rem);
    if (top) { use[top.id] = (use[top.id] ?? 0) + 1; rem -= top.seconds; }
  }
  const secs = Object.entries(use).reduce((s, [id, n]) => s + itemDef(id).seconds * n, 0);
  return { use, seconds: secs, covers: rem <= 0, count: Object.values(use).reduce((a, b) => a + b, 0) };
}

export const speedupMethods = {
  itemCount(id) { return this.state.items?.[id] ?? 0; },
  itemsTotal() { return SPEEDUP_IDS.reduce((n, id) => n + this.itemCount(id), 0); },
  grantItems(bundle) {
    for (const [k, v] of Object.entries(bundle ?? {})) {
      if (!k.startsWith('su_') || !(v > 0)) continue;
      const id = k.slice(3);
      if (SPEEDUP_IDS.includes(id)) this.state.items[id] += Math.floor(v);
    }
  },
  jobLeft(job) {
    if (!job) return 0;
    if (job.kind === 'build') return this.constructionLeft(job.id);
    if (job.kind === 'research') return this.researchLeft();
    if (job.kind === 'lane') return this.laneSecondsLeft(job.id);
    if (job.kind === 'heal') return this.healQueueSeconds();
    return 0;
  },
  jobActive(job) {
    if (job?.kind === 'build') return !!this.constructionJob(job.id);
    if (job?.kind === 'research') return !!this.researchJob();
    if (job?.kind === 'lane') return (this.lane(job.id)?.count ?? 0) > 0;
    if (job?.kind === 'heal') return this.state.infirmary.queue.length > 0;
    return false;
  },
  itemsAllowed(job) { return job?.kind === 'build' || job?.kind === 'research'; },
  canFreeFinish(job) { return this.jobActive(job) && this.jobLeft(job) <= SPEEDUPS.freeSeconds + 1e-6; },
  finishCoreCost(job) {
    const left = this.jobLeft(job);
    return this.itemsAllowed(job) ? SPEEDUPS.coreCost(left) : SPEEDUPS.queueCoreCost(left);
  },
  // skips `secs` on a job (all of it when secs = Infinity)
  skipJob(job, secs) {
    const left = this.jobLeft(job);
    if (job.kind === 'build') return this.speedUpConstruction(job.id, Math.min(secs, left + 1e-3)).ok;
    if (job.kind === 'research') return this.speedUpResearch(Math.min(secs, left + 1e-3)).ok;
    if (job.kind === 'lane') {
      const l = this.lane(job.id); if (!l?.count) return false;
      this.processTrainingOnly(job.id, this.laneSecondsLeft(job.id) + 1e-3); return true;
    }
    if (job.kind === 'heal') { if (!this.state.infirmary.queue.length) return false; this.processHealing(this.healQueueSeconds() + 1e-3); return true; }
    return false;
  },
  useSpeedups(job, use) {
    if (!this.itemsAllowed(job)) return { ok: false, reason: 'Speed-ups work on construction and research' };
    if (!this.jobActive(job)) return { ok: false, reason: 'Nothing running' };
    let secs = 0, n = 0;
    for (const [id, k] of Object.entries(use ?? {})) {
      const def = itemDef(id);
      if (!def || !(k > 0)) continue;
      if (this.itemCount(id) < k) return { ok: false, reason: `Not enough ${def.name}s` };
      secs += def.seconds * k; n += k;
    }
    if (!n) return { ok: false, reason: 'Pick a speed-up' };
    for (const [id, k] of Object.entries(use)) if (k > 0 && itemDef(id)) this.state.items[id] -= k;
    const before = this.jobLeft(job);
    this.skipJob(job, secs);
    this.track?.('speedup', n);
    this.save(); this.emit('speedup', job, secs); this.emit('change');
    return { ok: true, seconds: secs, used: n, finished: !this.jobActive(job) || before <= secs };
  },
  autoUseSpeedups(job) {
    const plan = planAuto(this.jobLeft(job), this.state.items);
    if (!plan.count) return { ok: false, reason: 'No speed-ups' };
    return { ...this.useSpeedups(job, plan.use), plan };
  },
  freeFinish(job) {
    if (!this.canFreeFinish(job)) return { ok: false, reason: `Free when ${Math.round(SPEEDUPS.freeSeconds / 60)} min or less is left` };
    this.skipJob(job, Infinity);
    this.save(); this.emit('speedup', job, 0); this.emit('change');
    return { ok: true, free: true };
  },
  coreFinish(job) {
    if (!this.jobActive(job)) return { ok: false, reason: 'Nothing running' };
    if (this.canFreeFinish(job)) return this.freeFinish(job);
    const cost = this.finishCoreCost(job);
    if (this.state.resources.cores < cost) return { ok: false, reason: `Needs ${cost} Beacon Cores` };
    this.state.resources.cores -= cost;
    this.skipJob(job, Infinity);
    this.save(); this.emit('speedup', job, 0); this.emit('change');
    return { ok: true, cores: cost };
  },
};
