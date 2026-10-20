// Stage 10b: data-driven item registry. Every inventory item is one entry here; the store keeps counts in
// state.items[id] and the Items screen (More → Items) lists them by `section`. To add a new kind:
//   1. add entries with { id, section, name, icon, desc, use? }   (`use(store, n)` makes it usable from Items)
//   2. pay it in reward bundles as `it_<id>: n` (speed-ups also accept the older `su_<id>` keys)
// Icons: painted art is loaded as texture `icon` when present (src/art/ui/<icon>.webp), otherwise the UI
// draws a clean placeholder in the gold/teal kit.
import { SPEEDUPS } from '../config.js';

export const ITEM_SECTIONS = [
  { id: 'speedup', name: 'Speed-ups', empty: 'No speed-ups yet. Earn them from daily mission chests, the daily login, events and the Rift Exchange.' },
  { id: 'resource', name: 'Resources', empty: 'No resource bundles yet. Bundles come from the 7-day login streak and Beacon level rewards. Use them any time to add their resources.' },
  { id: 'other', name: 'Other', empty: 'Nothing here yet. New kinds of items will show up in this section.' },
];

const fmtK = (n) => (n >= 1000 ? `${n / 1000}K` : `${n}`);
const RES_NAME = { energy: 'Energy', alloy: 'Alloy', shards: 'Shards' };
const resBundle = (res, amount) => ({
  id: `res_${res}_${fmtK(amount).toLowerCase()}`, section: 'resource', res, amount,
  name: `${fmtK(amount)} ${RES_NAME[res]}`, short: fmtK(amount), icon: `item-res-${res}`, fallbackIcon: `hud-${res}`,
  desc: `Adds ${amount.toLocaleString('en-US')} ${RES_NAME[res]}.`,
  use(store, n) { store.state.resources[res] += amount * n; return { [res]: amount * n }; },
});

export const ITEMS = [
  ...SPEEDUPS.items.map((s) => ({ id: s.id, section: 'speedup', name: s.name, short: s.short, seconds: s.seconds, icon: `item-su-${s.id}`, desc: `Skips ${s.short} on a building upgrade or research.` })),
  resBundle('energy', 1000), resBundle('energy', 10000),
  resBundle('alloy', 1000), resBundle('alloy', 10000),
  resBundle('shards', 100), resBundle('shards', 1000),
];
export const ITEM_IDS = ITEMS.map((i) => i.id);
export const itemById = (id) => ITEMS.find((i) => i.id === id);
// bundle key -> item id ('it_res_energy_1k', or the stage 10 'su_h1')
export const bundleItemId = (k) => (k.startsWith('it_') ? k.slice(3) : k.startsWith('su_') ? k.slice(3) : null);
