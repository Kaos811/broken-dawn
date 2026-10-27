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
//   bases() / citadel()                -> player-base entities { id, owner, name, level, tag, color, power, x, y }
//                                         (stage 12: neighbours are seeded bots; a server returns real players)
//   entities(kind?) / get(id)          -> entities
//   marches(owner?) / marchFor(owner, squadId)
//   canSend({ owner, squadId, targetId }) -> { ok, reason?, travel }
//   sendMarch({ owner, squadId, army, targetId, meta }) -> { ok, march?, reason? }
//   recallMarch(marchId)               -> { ok }
//   tick(dt)                           -> events: [{ type: 'battle', march, target, defender, result }
//                                                 | { type: 'home', march } | { type: 'respawn', entity }
//                                                 | { type: 'gatherStart' | 'gatherDone', march, node } | { type: 'regrow', entity }]
//   nodes()                            -> Alloy nodes { id, level, amount, max, busy, regrowAt, x, y } (stage 16)
//   sendMarch({ ..., gather: { troops } }) to a node: march goes 'out' -> 'gather' -> 'back' and carries
//                                         march.gather.load home (capacity + rate from config gatherCap/gatherRate)
import { WORLD, CREATURES, GATHER, gatherCap, gatherRate } from '../config.js';
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
  bases() { return this.entities('base'); }
  nodes() { return this.entities('node'); }
  citadel() { return this.w.entities.find((e) => e.kind === 'citadel') ?? null; }
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
    if (t.kind === 'citadel') return { ok: false, reason: 'The Rift Citadel is sealed: alliance war is coming with alliances' };
    if (t.kind === 'base') return { ok: false, reason: 'PvP coming with alliances' };
    if (t.kind === 'node' && !(t.amount >= 1)) return { ok: false, reason: 'This node is drained: it regrows soon' };
    if (t.busy) return { ok: false, reason: t.kind === 'node' ? 'Another squad is gathering here' : 'Another squad is already on its way there' };
    if (this.marchFor(owner, squadId)) return { ok: false, reason: 'That squad is already out' };
    if (this.marches(owner).length >= WORLD.maxMarches) return { ok: false, reason: 'All march slots are busy' };
    const home = this.homeOf(owner);
    return { ok: true, travel: marchSeconds(dist(home, t)) / Math.max(0.1, speed), home, target: t };
  }

  sendMarch({ owner, squadId, army, targetId, speed = 1, meta = {}, gather = null }) {
    const c = this.canSend({ owner, squadId, targetId, speed });
    if (!c.ok) return c;
    if ((c.target.kind === 'node') !== !!gather) return { ok: false, reason: c.target.kind === 'node' ? 'Send a squad to gather here' : 'Nothing to gather there' };
    const w = this.w;
    const m = {
      id: `m${w.nextId++}`, owner, squadId, targetId, phase: 'out', t: 0, travel: c.travel, back: c.travel,
      from: { x: c.home.x, y: c.home.y }, to: { x: c.target.x, y: c.target.y }, army, meta,
    };
    if (gather) m.gather = { cap: gatherCap(gather.troops), rate: gatherRate(gather.troops, c.target.level), load: 0, level: c.target.level };
    c.target.busy = m.id;
    w.marches.push(m);
    return { ok: true, march: m };
  }

  // Turn an outgoing march around (it takes as long to come back as it has been out). A gathering squad
  // packs up and brings home whatever it has gathered so far.
  recallMarch(id) {
    const m = this.w.marches.find((x) => x.id === id);
    if (!m || (m.phase !== 'out' && m.phase !== 'gather')) return { ok: false, reason: 'Already heading home' };
    const t = this.get(m.targetId);
    if (t && t.busy === m.id) t.busy = null;
    m.back = m.phase === 'gather' ? m.travel : Math.max(0.1, m.t);
    m.phase = 'back'; m.t = 0; m.recalled = true;
    return { ok: true, march: m };
  }

  tick(dt) {
    const w = this.w, events = [];
    if (!(dt > 0)) return events;
    w.clock += dt;
    for (const m of [...w.marches]) {
      m.t += dt;
      let gdt = m.phase === 'gather' ? dt : 0;
      if (m.phase === 'out' && m.t >= m.travel && m.gather) {
        const node = this.get(m.targetId);
        gdt = m.t - m.travel; m.t = gdt;
        if (node && node.kind === 'node' && node.amount >= 1) { m.phase = 'gather'; events.push({ type: 'gatherStart', march: m, node }); }
        else { if (node && node.busy === m.id) node.busy = null; m.phase = 'back'; }
      }
      if (m.phase === 'gather') {
        const node = this.get(m.targetId), g = m.gather;
        const take = node ? Math.min(g.rate * gdt, g.cap - g.load, node.amount) : 0;
        if (take > 0) { g.load += take; node.amount -= take; }
        if (!node || g.load >= g.cap - 1e-6 || node.amount < 1e-6) {
          if (node) {
            node.busy = null;
            if (node.amount < 1) { node.amount = 0; node.regrowAt = w.clock + GATHER.regrowSeconds; }
          }
          g.load = Math.min(g.cap, g.load);
          m.phase = 'back'; m.t = 0; m.back = m.travel;
          events.push({ type: 'gatherDone', march: m, node: node ? { ...node } : null });
        }
      }
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
    for (const e of w.entities) {
      if (e.kind !== 'node' || e.amount >= 1 || e.busy || !(e.regrowAt > 0) || w.clock < e.regrowAt) continue;
      e.amount = e.max; e.regrowAt = 0;
      events.push({ type: 'regrow', entity: e });
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
