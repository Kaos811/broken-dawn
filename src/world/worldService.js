// WorldService: the ONLY thing the game talks to about the shared world (entities, marches, battles).
//
// Today: LocalWorldService keeps the world inside the local save and resolves battles on-device.
// Later (PvP): a RemoteWorldService with the SAME methods can talk to a shared backend
// (Supabase / Firebase): entities + marches live in server tables, the server runs resolveBattle()
// (src/world/battle.js is pure and deterministic) and pushes events back. Other players' bases are
// just entities with kind 'base' and a different owner, so they show up as targets automatically.
// See README "PvP path".
//
// Interface
//   snapshot()                         -> world (read-only use)
//   entities(kind?) / get(id)          -> entities
//   marches(owner?) / marchFor(owner, squadId)
//   canSend({ owner, squadId, targetId }) -> { ok, reason?, travel }
//   sendMarch({ owner, squadId, army, targetId, meta }) -> { ok, march?, reason? }
//   recallMarch(marchId)               -> { ok }
//   tick(dt)                           -> events: [{ type: 'battle', march, target, defender, result }
//                                                 | { type: 'home', march } | { type: 'respawn', entity }]
import { WORLD, CREATURES } from '../config.js';
import { resolveBattle, hashSeed } from './battle.js';
import { creatureArmy } from './armies.js';
import { createWorld, spawnCreature, dist, marchSeconds, BASE_ID } from './worldState.js';

export class LocalWorldService {
  // getWorld/setWorld read/write the plain world object stored in the save.
  constructor(getWorld, setWorld) { this.getWorld = getWorld; this.setWorld = setWorld; }

  get w() {
    let w = this.getWorld();
    if (!w) { w = createWorld(); this.setWorld(w); }
    return w;
  }
  snapshot() { return this.w; }
  entities(kind) { return kind ? this.w.entities.filter((e) => e.kind === kind) : this.w.entities; }
  get(id) { return this.w.entities.find((e) => e.id === id) ?? null; }
  marches(owner) { return owner ? this.w.marches.filter((m) => m.owner === owner) : this.w.marches; }
  marchFor(owner, squadId) { return this.w.marches.find((m) => m.owner === owner && m.squadId === squadId) ?? null; }
  homeOf(owner) { return this.w.entities.find((e) => e.kind === 'base' && e.owner === owner) ?? this.get(BASE_ID); }

  // Defender army for any target entity. A shared server would load a player's defense here.
  defenderArmy(target) {
    if (target.kind === 'creature') return creatureArmy(target.type, target.level);
    return { name: target.name ?? 'Base', owner: target.owner, kind: 'base', lines: target.defense?.lines ?? [] };
  }

  // speed: march speed multiplier from the sender's research (plain number; a server would look it up).
  canSend({ owner, squadId, targetId, speed = 1 }) {
    const t = this.get(targetId);
    if (!t) return { ok: false, reason: 'Target is gone' };
    if (t.owner === owner) return { ok: false, reason: 'That\'s your own base' };
    if (t.busy) return { ok: false, reason: 'Another squad is already on its way there' };
    if (this.marchFor(owner, squadId)) return { ok: false, reason: 'That squad is already out' };
    if (this.marches(owner).length >= WORLD.maxMarches) return { ok: false, reason: 'All march slots are busy' };
    const home = this.homeOf(owner);
    return { ok: true, travel: marchSeconds(dist(home, t)) / Math.max(0.1, speed), home, target: t };
  }

  sendMarch({ owner, squadId, army, targetId, speed = 1, meta = {} }) {
    const c = this.canSend({ owner, squadId, targetId, speed });
    if (!c.ok) return c;
    const w = this.w;
    const m = {
      id: `m${w.nextId++}`, owner, squadId, targetId, phase: 'out', t: 0, travel: c.travel, back: c.travel,
      from: { x: c.home.x, y: c.home.y }, to: { x: c.target.x, y: c.target.y }, army, meta,
    };
    c.target.busy = m.id;
    w.marches.push(m);
    return { ok: true, march: m };
  }

  // Turn an outgoing march around (it takes as long to come back as it has been out).
  recallMarch(id) {
    const m = this.w.marches.find((x) => x.id === id);
    if (!m || m.phase !== 'out') return { ok: false, reason: 'Already heading home' };
    const t = this.get(m.targetId);
    if (t && t.busy === m.id) t.busy = null;
    m.phase = 'back'; m.back = Math.max(0.1, m.t); m.t = 0; m.recalled = true;
    return { ok: true, march: m };
  }

  tick(dt) {
    const w = this.w, events = [];
    if (!(dt > 0)) return events;
    w.clock += dt;
    for (const m of [...w.marches]) {
      m.t += dt;
      if (m.phase === 'out' && m.t >= m.travel) {
        const target = this.get(m.targetId);
        const over = m.t - m.travel;
        if (target) {
          const defender = this.defenderArmy(target);
          const seed = hashSeed(w.seed, m.id, target.id);
          const result = resolveBattle(m.army, defender, seed);
          target.busy = null;
          if (result.winner === 'attacker' && target.kind === 'creature') {
            w.entities.splice(w.entities.indexOf(target), 1);
            w.respawns.push({ ring: target.ring, at: w.clock + WORLD.respawnSeconds });
          }
          events.push({ type: 'battle', march: m, target: { ...target }, defender, result });
        }
        m.phase = 'back'; m.t = over;
      }
      if (m.phase === 'back' && m.t >= m.back) {
        w.marches.splice(w.marches.indexOf(m), 1);
        events.push({ type: 'home', march: m });
      }
    }
    for (const r of [...w.respawns]) {
      if (w.clock < r.at) continue;
      w.respawns.splice(w.respawns.indexOf(r), 1);
      const e = spawnCreature(w, r.ring);
      if (e) events.push({ type: 'respawn', entity: e });
      else w.respawns.push({ ring: r.ring, at: w.clock + 30 }); // no room right now, try again soon
    }
    return events;
  }
}
export { CREATURES };
