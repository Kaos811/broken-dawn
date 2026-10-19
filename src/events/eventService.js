// Stage 8: event schedule. The local service turns a fixed weekly calendar (UTC) into event instances, so
// every player sees the same windows. A server can replace it later (PvP / online leaderboards) by
// implementing the same interface:
//   active(t) -> instance | null      next(t) -> instance       weekId(t) -> 'YYYY-Www'
//   weekEnds(t) -> ms                  report(id, points)  (no-op locally; a server would rank it)
// An instance is { id, type, start, end } with times in epoch ms; ids look like 'rift-hunt-2026-W43'.
import { EVENTS } from '../config.js';

const DAY = 864e5, WEEK = 7 * DAY;
// Monday 00:00 UTC of the ISO week containing t
export function weekStart(t) { const d = Math.floor(t / DAY); const dow = (new Date(d * DAY).getUTCDay() + 6) % 7; return (d - dow) * DAY; }
export function isoWeekId(t) {
  const d = new Date(weekStart(t) + 3 * DAY); // Thursday decides the ISO year
  const y = d.getUTCFullYear(), jan4 = Date.UTC(y, 0, 4);
  const w = 1 + Math.round((weekStart(d.getTime()) - weekStart(jan4)) / WEEK);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export class LocalEventService {
  constructor(calendar = EVENTS.calendar) { this.calendar = calendar; this.remote = false; }
  instancesNear(t) {
    const out = [], w0 = weekStart(t);
    for (let k = -1; k <= 1; k++) {
      const ws = w0 + k * WEEK;
      for (const c of this.calendar) {
        const start = ws + c.day * DAY + (c.hour ?? 0) * 36e5;
        out.push({ id: `${EVENTS.types[c.type].slug}-${isoWeekId(ws)}`, type: c.type, start, end: start + c.hours * 36e5 });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
  active(t) { return this.instancesNear(t).find((e) => e.start <= t && t < e.end) ?? null; }
  next(t) { return this.instancesNear(t).find((e) => e.start > t) ?? null; }
  weekId(t) { return isoWeekId(t); }
  weekEnds(t) { return weekStart(t) + WEEK; }
  report() { /* local: nothing to send */ }
}
