// Stage 8: limited-time events (progress, milestones, Rift Marks, Rift Exchange). Mixed into the Store.
// The schedule itself comes from an EventService (see events/eventService.js).
export const defaultEvents = () => ({ byId: {}, marks: 0, shop: { week: null, bought: {} }, maxSeen: 0 });

const int = (v) => Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
export function sanitizeEvents(raw) {
  const d = defaultEvents();
  if (!raw || typeof raw !== 'object') return d;
  d.marks = int(raw.marks);
  d.maxSeen = int(raw.maxSeen);
  for (const [id, e] of Object.entries(raw.byId ?? {})) {
    if (typeof id !== 'string' || !e || typeof e !== 'object') continue;
    d.byId[id] = { points: int(e.points), marksPaid: int(e.marksPaid), claimed: [...new Set((Array.isArray(e.claimed) ? e.claimed : []).map(int))], settled: e.settled === true };
  }
  if (raw.shop && typeof raw.shop === 'object') {
    d.shop.week = typeof raw.shop.week === 'string' ? raw.shop.week : null;
    for (const [k, v] of Object.entries(raw.shop.bought ?? {})) if (int(v) > 0) d.shop.bought[k] = int(v);
  }
  return d;
}

export const eventMethods = {};
