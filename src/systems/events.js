// Stage 8: limited-time events (points, milestones, Rift Marks) and the Rift Exchange. Mixed into the Store.
// The schedule comes from `this.eventService` (events/eventService.js). Time is the latest clock reading
// ever seen (state.events.maxSeen), so setting the device clock back can't reopen an ended event.
import { EVENTS } from '../config.js';
import { addBundle } from './missions.js';

export const defaultEvents = () => ({ byId: {}, marks: 0, shop: { week: null, bought: {} }, maxSeen: 0 });

const int = (v) => Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
export function sanitizeEvents(raw) {
  const d = defaultEvents();
  if (!raw || typeof raw !== 'object') return d;
  d.marks = int(raw.marks);
  d.maxSeen = int(raw.maxSeen);
  for (const [id, e] of Object.entries(raw.byId ?? {})) {
    if (typeof id !== 'string' || !e || typeof e !== 'object' || !EVENTS.types[e.type]) continue;
    const n = EVENTS.types[e.type].milestones.length;
    d.byId[id] = { type: e.type, start: int(e.start), end: int(e.end), points: int(e.points), marksPaid: int(e.marksPaid), claimed: [...new Set((Array.isArray(e.claimed) ? e.claimed : []).map(int).filter((i) => i < n))], settled: e.settled === true };
  }
  if (raw.shop && typeof raw.shop === 'object') {
    d.shop.week = typeof raw.shop.week === 'string' ? raw.shop.week : null;
    for (const [k, v] of Object.entries(raw.shop.bought ?? {})) if (EVENTS.shop.some((s) => s.id === k) && int(v) > 0) d.shop.bought[k] = int(v);
  }
  return d;
}

// Points an action scores in an event of `type`.
export function eventScore(type, kind, n, meta) {
  if (type === 'beaconSurge') {
    if (kind === 'upgradeDone') return 100 * (meta.level ?? 1);
    if (kind === 'researchDone') return 80 * (meta.level ?? 1);
    if (kind === 'train') return 2 * (meta.tier ?? 1) * n;
  }
  if (type === 'riftHunt' && kind === 'kill') return 10 * (meta.level ?? 1) * (meta.elite ? 2 : 1);
  return 0;
}

export const eventMethods = {
  eventsNow() { return Math.max(this.clock(), this.state.events.maxSeen); },
  eventRecord(inst, create = false) {
    const E = this.state.events;
    if (!E.byId[inst.id] && create) E.byId[inst.id] = { type: inst.type, start: inst.start, end: inst.end, points: 0, marksPaid: 0, claimed: [], settled: false };
    return E.byId[inst.id] ?? null;
  },
  liveEvent() { return this.eventService.active(this.eventsNow()); },
  nextEvent() { return this.eventService.next(this.eventsNow()); },
  eventInfo(inst) {
    if (!inst) return null;
    const def = EVENTS.types[inst.type], rec = this.eventRecord(inst) ?? { points: 0, claimed: [], marksPaid: 0 };
    const rewards = EVENTS.milestoneRewards(this.state.beacon.level), now = this.eventsNow();
    return {
      ...inst, def, points: rec.points, marksPaid: rec.marksPaid, live: inst.start <= now && now < inst.end,
      endsIn: Math.max(0, (inst.end - now) / 1000), startsIn: Math.max(0, (inst.start - now) / 1000),
      milestones: def.milestones.map((at, i) => ({ i, at, reward: rewards[i], reached: rec.points >= at, claimed: rec.claimed.includes(i) })),
    };
  },
  // Activity hook (called from track()): scores the live event and pays Rift Marks as points accrue.
  trackEvents(kind, n, meta) {
    const inst = this.liveEvent();
    if (!inst) return;
    const pts = eventScore(inst.type, kind, n, meta);
    if (!(pts > 0)) return;
    const rec = this.eventRecord(inst, true);
    rec.points += pts;
    const due = Math.floor(rec.points / EVENTS.marksPer) - rec.marksPaid;
    if (due > 0) { rec.marksPaid += due; this.state.events.marks += due; }
    this.eventService.report(inst.id, rec.points);
    this.emit('eventPoints', inst.id, pts, rec.points);
  },
  claimEventMilestone(id, i) {
    const rec = this.state.events.byId[id];
    if (!rec) return { ok: false, reason: 'No points in this event yet' };
    if (rec.settled) return { ok: false, reason: 'This event has ended' };
    const at = EVENTS.types[rec.type].milestones[i];
    if (at == null) return { ok: false, reason: 'Unknown milestone' };
    if (rec.claimed.includes(i)) return { ok: false, reason: 'Already claimed' };
    if (rec.points < at) return { ok: false, reason: `Reach ${at} points first` };
    rec.claimed.push(i);
    const reward = EVENTS.milestoneRewards(this.state.beacon.level)[i];
    this.grantBundle(reward, 'event');
    this.save(); this.emit('change');
    return { ok: true, reward };
  },
  eventsReady() {
    if (!this.missionsUnlocked()) return 0;
    const info = this.eventInfo(this.liveEvent());
    return info ? info.milestones.filter((m) => m.reached && !m.claimed).length : 0;
  },
  // Once a second: remember the latest time seen, settle ended events (auto-pay), refresh the shop week.
  eventsTick() {
    const E = this.state.events, t = this.clock();
    if (t > E.maxSeen) E.maxSeen = t;
    const now = this.eventsNow();
    for (const [id, rec] of Object.entries(E.byId)) {
      if (rec.settled) { if (now - rec.end > EVENTS.keepDays * 864e5) delete E.byId[id]; continue; }
      if (now < rec.end) continue;
      const paid = {}, rewards = EVENTS.milestoneRewards(this.state.beacon.level);
      EVENTS.types[rec.type].milestones.forEach((at, i) => { if (rec.points >= at && !rec.claimed.includes(i)) { rec.claimed.push(i); addBundle(paid, rewards[i]); } });
      rec.settled = true;
      if (Object.keys(paid).length) this.grantBundle(paid, 'event');
      (this.eventSummaries ??= []).push({ id, type: rec.type, points: rec.points, paid: Object.keys(paid).length ? paid : null });
      this.emit('eventEnded', id);
      this.save();
    }
    const wk = this.eventService.weekId(now);
    if (E.shop.week !== wk) E.shop = { week: wk, bought: {} };
  },

  // ---- Rift Exchange ----
  shopItems() {
    this.eventsTick();
    const E = this.state.events, L = this.state.beacon.level;
    return EVENTS.shop.map((it) => {
      const bought = E.shop.bought[it.id] ?? 0, left = it.limit - bought;
      const reason = left <= 0 ? 'Sold out this week' : (E.marks < it.price ? `Need ${it.price} Rift Marks` : null);
      return { id: it.id, name: it.name, price: it.price, limit: it.limit, bought, left, reward: it.reward(L), can: !reason, reason };
    });
  },
  shopRefreshIn() { return Math.max(0, (this.eventService.weekEnds(this.eventsNow()) - this.eventsNow()) / 1000); },
  buyShopItem(id) {
    const it = this.shopItems().find((x) => x.id === id);
    if (!it) return { ok: false, reason: 'Unknown item' };
    if (!it.can) return { ok: false, reason: it.reason };
    const E = this.state.events;
    E.marks -= it.price;
    E.shop.bought[id] = it.bought + 1;
    this.grantBundle(it.reward, 'exchange');
    this.save(); this.emit('change');
    return { ok: true, reward: it.reward, marks: E.marks };
  },
};
