// Stage 19: BotRallyAgent. Today the allies who join your rally are the seeded neighbour bots; a shared
// server would replace this with real players pressing "Join". Pure + seeded: the same rally always gets
// the same allies at the same times with the same Power.
import { RALLY } from '../config.js';
import { mulberry32, hashSeed } from './battle.js';
import { dist } from './worldState.js';

export const BotRallyAgent = {
  // Who joins, when (absolute world clock) and how strong (fraction of the leader's Power).
  plan(world, rally, home) {
    const n = RALLY.allies[rally.timer] ?? (rally.timer >= 600 ? 4 : rally.timer >= 300 ? 3 : 2);
    const bots = world.entities.filter((e) => e.kind === 'base' && e.bot).sort((a, b) => dist(a, home) - dist(b, home)).slice(0, Math.min(n, RALLY.slots));
    return bots.map((b, i) => {
      const rng = mulberry32(hashSeed(world.seed, rally.id, b.id));
      const [lo, hi] = RALLY.allyPower;
      return { botId: b.id, at: rally.start + rally.duration * RALLY.joinAt[i], frac: Math.round((lo + rng() * (hi - lo)) * 100) / 100 };
    });
  },
};
