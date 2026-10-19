// Painted Base art (stage 6). Generated in the approved concept style, background-keyed to
// transparent webp, sized for phones (see tools in README). Vite bundles these as asset URLs
// (inlined as data URLs in the single-file build).
import commandCenter from './base/commandCenter.webp';
import barracks from './base/barracks.webp';
import armory from './base/armory.webp';
import infirmary from './base/infirmary.webp';
import archive from './base/archive.webp';
import beacon from './base/beacon.webp';
import ground from './base/ground.webp';
import avatar from './base/avatar.webp';
import crystals0 from './base/crystals0.webp';
import crystals1 from './base/crystals1.webp';
import crystals2 from './base/crystals2.webp';
import crystals3 from './base/crystals3.webp';
import plants0 from './base/plants0.webp';
import plants1 from './base/plants1.webp';
import plants2 from './base/plants2.webp';
import plants3 from './base/plants3.webp';
import rocks0 from './base/rocks0.webp';
import rocks1 from './base/rocks1.webp';
import rocks2 from './base/rocks2.webp';
import rocks3 from './base/rocks3.webp';

export const ART_URLS = {
  'art-commandCenter': commandCenter, 'art-barracks': barracks, 'art-armory': armory, 'art-infirmary': infirmary,
  'art-archive': archive, 'art-beacon': beacon, 'art-ground': ground, 'art-avatar': avatar,
  'deco-crystal0': crystals0, 'deco-crystal1': crystals1, 'deco-crystal2': crystals2, 'deco-crystal3': crystals3,
  'deco-plant0': plants0, 'deco-plant1': plants1, 'deco-plant2': plants2, 'deco-plant3': plants3,
  'deco-rock0': rocks0, 'deco-rock1': rocks1, 'deco-rock2': rocks2, 'deco-rock3': rocks3,
};

// How each building sprite sits on its footprint: displayed width (world px) and the vertical
// origin (fraction of the image height where the footprint's bottom corner lands).
export const SPRITE = {
  commandCenter: { w: 318, oy: 0.985 },
  barracks: { w: 330, oy: 0.985 },
  armory: { w: 312, oy: 0.985 },
  infirmary: { w: 292, oy: 0.985 },
  archive: { w: 322, oy: 0.975 },
  beacon: { w: 420, oy: 0.975 },
};

export const DECO_KEYS = {
  crystal: ['deco-crystal0', 'deco-crystal1', 'deco-crystal2', 'deco-crystal3'],
  plant: ['deco-plant0', 'deco-plant1', 'deco-plant2', 'deco-plant3'],
  rock: ['deco-rock0', 'deco-rock1', 'deco-rock2', 'deco-rock3'],
};
