// Central tuning file. All gameplay numbers live here so later stages can
// rebalance without touching scene code.

// Logical resolution. Designed for portrait 9:16 (720x1280); on taller phones
// (e.g. 19.5:9) the height stretches so the HUD and nav sit at the real screen
// edges instead of letterboxing. Clamped between 9:16 and 9:21.
export const GAME_WIDTH = 720;
const aspect = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerHeight / window.innerWidth : 16 / 9;
export const GAME_HEIGHT = Math.round(GAME_WIDTH * Math.min(21 / 9, Math.max(16 / 9, aspect)));

export const PALETTE = {
  bg: 0x07090d,
  metalDark: 0x1a1f27,
  metal: 0x2a313c,
  metalLight: 0x3b4452,
  metalEdge: 0x56606f,
  rock: 0x2b2420,
  rockDark: 0x1b1613,
  rockLight: 0x3d332c,
  gold: 0xffb347,
  orange: 0xff7a1a,
  cyan: 0x3ff0ff,
  teal: 0x1fb5b0,
  blue: 0x4a8cff,
  valid: 0x4dff9a,
  invalid: 0xff4d5e,
  text: '#e8edf3',
  textDim: '#8a96a8',
  textGold: '#ffb347',
  textCyan: '#3ff0ff',
};

export const MAP = {
  size: 44,          // nominal iso grid (only sets the world origin; buildable area is the ellipse below)
  tileW: 96,         // iso diamond width
  tileH: 48,         // iso diamond height
  // Buildable ground: an ellipse (world px) around the Beacon, taller than wide for portrait phones.
  buildRx: 600,
  buildRy: 820,
  // Painted ground extends this far past the buildable area on each side (camera stays inside it).
  groundPadX: 640,
  groundPadY: 700,
  minZoom: 0.42,
  maxZoom: 1.6,
  startZoom: 0.72,
};

// Beacon: fixed at the centre of the map, never movable.
export const BEACON = {
  id: 'beacon',
  name: 'The Beacon',
  footprint: 4,
  gx: 20,
  gy: 20,
  powerPerLevel: 15,          // counts as the "Beacon Relay" in the power formula
  maxCharge: 100,
  // Charge per second at a given Beacon level (slows as it grows).
  chargePerSec: (level) => 100 / (45 + 30 * (level - 1)),
  upgradeCost: (level) => Math.round(120 * Math.pow(1.85, level - 1)),
  maxLevel: 20,
  description: 'An alien power source of unknown origin. Fully charge it, then spend Energy to raise its level, boost income and unlock higher building levels.',
};

// Movable buildings. powerPerLevel is flat power granted per level.
export const BUILDINGS = {
  commandCenter: {
    id: 'commandCenter',
    name: 'Command Center',
    footprint: 3,
    powerPerLevel: 10,
    baseCost: 50,
    costGrowth: 1.6,
    start: { gx: 11, gy: 11, level: 1 },
    accent: 'gold',
    description: 'Main hub. Oversees Base Power, unlocks the Bravo and Charlie squads, and caps squad levels.',
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    footprint: 3,
    powerPerLevel: 5,
    baseCost: 30,
    costGrowth: 1.55,
    start: { gx: 23, gy: 30, level: 1 },
    accent: 'blue',
    description: 'Trains Sentinels, Bearers and Voyagers side by side, one lane per class. Higher levels give every lane more room and train faster.',
  },
  armory: {
    id: 'armory',
    name: 'Armory',
    footprint: 3,
    powerPerLevel: 0, // not part of the power formula; the Armory hosts recruitment (gacha)
    baseCost: 40,
    costGrowth: 1.6,
    start: { gx: 30, gy: 23, level: 1 },
    accent: 'cyan',
    description: 'Recruitment hub for leaders, armor and weapons. Spend Shards on pulls; equip what you find on your squads.',
  },
  infirmary: {
    id: 'infirmary',
    name: 'Infirmary',
    footprint: 3,
    powerPerLevel: 5,
    baseCost: 35,
    costGrowth: 1.55,
    start: { gx: 19, gy: 12, level: 1 },
    accent: 'green',
    description: 'Treats troops wounded on World hunts. Wounded beyond its capacity die. Healing costs Energy and takes time; higher levels hold more and heal faster.',
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    footprint: 3,
    powerPerLevel: 5,       // only once unsealed (Beacon Lv 3)
    baseCost: 60,
    costGrowth: 1.6,
    start: { gx: 12, gy: 19, level: 1 },
    accent: 'violet',
    unlockBeacon: 3,        // hidden until the Beacon reaches this level, then placed by the player
    description: 'Decodes the Beacon\'s signal into research. One project at a time; its level caps how far each research can go.',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

// Buildings can't be upgraded past Beacon level + this many levels.
export const BUILDING_LEVEL_HEADROOM = 2;

// Building upgrades take time. Applies to the Command Center, Barracks, Armory AND the Beacon.
// Cost is paid up front; level, power and unlocks apply only when the timer finishes.
export const CONSTRUCTION = {
  builders: 1,                       // upgrades that can run at the same time
  // Seconds to upgrade TO a level. Past the table, each level takes `growth`x the previous one,
  // and no single upgrade takes longer than `cap` (stage 10: flattened from x3 per level).
  table: { 2: 10, 3: 30, 4: 120, 5: 360, 6: 1200, 7: 3600, 8: 10800 },
  growth: 1.6,
  cap: 72 * 3600,
  seconds(toLevel) {
    if (toLevel <= 1) return 0;
    const t = this.table[toLevel];
    if (t != null) return t;
    const top = Math.max(...Object.keys(this.table).map(Number));
    return Math.min(this.cap, Math.round(this.table[top] * Math.pow(this.growth, toLevel - top)));
  },
  speedUp: { secondsPerCore: 300 },
};

// Stage 10: speed-ups. Items skip time on construction and research. Any job (construction, research,
// training lane, healing batch) with <= freeSeconds left can be finished for free; any job can be
// finished with Beacon Cores (earned only, never bought).
export const SPEEDUPS = {
  items: [
    { id: 'm1', name: '1m Speed-up', short: '1m', seconds: 60 },
    { id: 'm5', name: '5m Speed-up', short: '5m', seconds: 300 },
    { id: 'm15', name: '15m Speed-up', short: '15m', seconds: 900 },
    { id: 'h1', name: '1h Speed-up', short: '1h', seconds: 3600 },
    { id: 'h3', name: '3h Speed-up', short: '3h', seconds: 10800 },
    { id: 'h8', name: '8h Speed-up', short: '8h', seconds: 28800 },
    { id: 'h24', name: '24h Speed-up', short: '24h', seconds: 86400 },
  ],
  freeSeconds: 300,
  // Core finish for construction + research: 1 Core per 5 min for the first hour, then 1 per 15 min.
  coreCost(secs) {
    secs = Math.max(0, secs);
    if (secs <= 0) return 0;
    if (secs <= 3600) return Math.ceil(secs / 300);
    return 12 + Math.ceil((secs - 3600) / 900);
  },
  // training lanes + healing: 1 Core per 10 min (min 1)
  queueCoreCost(secs) { return secs > 0 ? Math.max(1, Math.ceil(secs / 600)) : 0; },
  confirmAt: 5,              // ask before spending this many Cores or more
  autoWaste: 300,            // Auto-use may overshoot by at most this many seconds
  // reward sources (bundle keys are `su_<id>`)
  login: { su_m15: 1 },      // every daily login claim
  loginStreak: { su_h3: 1, it_res_energy_10k: 1, it_res_alloy_1k: 1 }, // extra on every 7th day in a row (stage 10b: + resource bundles)
  beaconLevel: (lv) => ({ su_h1: 1, it_res_energy_1k: 1, ...(lv % 5 === 0 ? { it_res_shards_100: 1 } : {}), ...(lv === 5 ? { su_h8: 1 } : {}), ...(lv === 10 ? { su_h24: 1 } : {}) }),
  firstUpgrade: { su_m5: 3 }, // one-time, with the first upgrade started (teaches the button)
};
export const SPEEDUP_IDS = SPEEDUPS.items.map((i) => i.id);

export const buildingUpgradeCost = (id, level) => {
  const b = BUILDINGS[id];
  return Math.round(b.baseCost * Math.pow(b.costGrowth, level - 1));
};

// ---------------------------------------------------------------- STAGE 2 --

// Troop classes. hp/atk/def are per-soldier base stats used by stage-3 auto-battle.
// energy = Energy cost per unit; trainSeconds = time per unit at Barracks Lv 1.
// The three classes (T1 base stats). Each class trains in its own Barracks lane.
const CLASS_BASE = {
  sentinel: {
    id: 'sentinel', name: 'Sentinel', plural: 'Sentinels', role: 'Frontline Wall',
    hp: 120, atk: 8, def: 14, energy: 6, trainSeconds: 8,
    color: 0x4a8cff, colorHex: '#4a8cff',
    description: 'Bulky modular armor and a T-visor helmet. Holds the line with an energy shield and a short rifle.',
  },
  bearer: {
    id: 'bearer', name: 'Bearer', plural: 'Bearers', role: 'Main Damage',
    hp: 80, atk: 18, def: 7, energy: 8, trainSeconds: 10,
    color: 0xffb347, colorHex: '#ffb347',
    description: 'Long coats and two-handed weapons. Carries the Beacon\'s light into battle and deals the heavy damage.',
  },
  voyager: {
    id: 'voyager', name: 'Voyager', plural: 'Voyagers', role: 'Scout / Support',
    hp: 65, atk: 13, def: 5, energy: 7, trainSeconds: 9,
    color: 0x3ff0ff, colorHex: '#3ff0ff',
    description: 'Hooded, lightly armored, with glowing cyan eyes. Sniper rifles, dual pistols and a floating Beacon shard.',
  },
};
export const CLASS_IDS = Object.keys(CLASS_BASE);

// ---------------------------------------------------------------- STAGE 4 --
// Troop tiers. Every tier is its own unit id (T1 keeps the class id, so older saves stay valid).
// Stats/costs are derived from the class's T1 numbers with these multipliers.
export const TIERS = {
  1: { label: 'T1', roman: 'I', hpMult: 1, atkMult: 1, defAdd: 0, energyMult: 1, alloy: 0, timeMult: 1, power: 1, healEnergyMult: 1, healTimeMult: 1 },
  2: { label: 'T2', roman: 'II', hpMult: 1.6, atkMult: 1.6, defAdd: 6, energyMult: 2.2, alloy: 2, timeMult: 1.8, power: 2, healEnergyMult: 2, healTimeMult: 1.5 },
  3: { label: 'T3', roman: 'III', hpMult: 2.5, atkMult: 2.5, defAdd: 12, energyMult: 4.5, alloy: 6, timeMult: 3, power: 4, healEnergyMult: 4, healTimeMult: 2.2 },
};
export const MAX_TIER = 3; // T4 later (Barracks Lv 13)
// Promotion (T1->T2, T2->T3): pay the cost difference, takes this share of the higher tier's training time.
export const PROMOTE = { timeShare: 0.6 };
const TIER_NAMES = {
  sentinel: [null, { id: 'sentinel', name: 'Sentinel', plural: 'Sentinels' }, { id: 'bulwark', name: 'Bulwark', plural: 'Bulwarks' }, { id: 'aegis', name: 'Aegis', plural: 'Aegises' }],
  bearer: [null, { id: 'bearer', name: 'Bearer', plural: 'Bearers' }, { id: 'lancer', name: 'Lancer', plural: 'Lancers' }, { id: 'sunbreaker', name: 'Sunbreaker', plural: 'Sunbreakers' }],
  voyager: [null, { id: 'voyager', name: 'Voyager', plural: 'Voyagers' }, { id: 'phantom', name: 'Phantom', plural: 'Phantoms' }, { id: 'riftwalker', name: 'Riftwalker', plural: 'Riftwalkers' }],
};
const TIER_DESC = {
  bulwark: 'Heavier plating and a wider shield. A T2 Sentinel.', aegis: 'A walking fortress wrapped in Beacon light. A T3 Sentinel.',
  lancer: 'Charged lances that punch through hide and chitin. A T2 Bearer.', sunbreaker: 'Carries a shard of the Beacon\'s core as a weapon. A T3 Bearer.',
  phantom: 'Cloaked marksmen that vanish between shots. A T2 Voyager.', riftwalker: 'Steps through small rifts to strike from anywhere. A T3 Voyager.',
};

// TROOP_CLASSES: every UNIT (class x tier), keyed by unit id: { id, cls, tier, name, plural, hp, atk, def, energy, alloy, trainSeconds, power, ... }.
export const TROOP_CLASSES = {};
for (const cls of CLASS_IDS) {
  const B = CLASS_BASE[cls];
  for (let tier = 1; tier <= MAX_TIER; tier++) {
    const T = TIERS[tier], N = TIER_NAMES[cls][tier];
    TROOP_CLASSES[N.id] = {
      ...B, ...N, cls, tier, className: B.name, classPlural: B.plural,
      hp: Math.round(B.hp * T.hpMult * 10) / 10, atk: Math.round(B.atk * T.atkMult * 10) / 10, def: B.def + T.defAdd,
      energy: Math.round(B.energy * T.energyMult), alloy: T.alloy, trainSeconds: Math.round(B.trainSeconds * T.timeMult * 10) / 10,
      power: T.power, description: TIER_DESC[N.id] ?? B.description,
    };
  }
}
export const TROOP_IDS = Object.keys(TROOP_CLASSES);          // all 9 units
export const unitOf = (cls, tier) => TIER_NAMES[cls]?.[tier]?.id ?? null;
export const classOf = (unit) => TROOP_CLASSES[unit]?.cls ?? null;
export const tierOf = (unit) => TROOP_CLASSES[unit]?.tier ?? 1;
export const nextTier = (unit) => unitOf(classOf(unit), tierOf(unit) + 1);

// Troop power: each soldier = 1, +10 per squad level above 1 (summed into Base Power).
// Squad Power (shown per squad) = soldiers in the squad + 10 x squad level.
export const TROOPS = {
  powerPerSoldier: 1,
  powerPerSquadLevel: 10,
  squadIds: ['alpha', 'bravo', 'charlie'],
};

// Training runs in three parallel lanes, one per troop class. Every lane has its own
// timer and its own capacity, and all lanes progress at the same time (online and offline).
export const BARRACKS = {
  // Max units waiting in EACH class lane at a given Barracks level.
  laneCapacity: (level) => 10 + 10 * (level - 1),
  // Training speed multiplier, applied to every lane (unit time = trainSeconds / speed).
  trainSpeed: (level) => 1 + 0.2 * (level - 1),
};

export const SQUADS = {
  alpha: { id: 'alpha', name: 'Alpha', unlockCC: 1 },
  bravo: { id: 'bravo', name: 'Bravo', unlockCC: 3 },
  charlie: { id: 'charlie', name: 'Charlie', unlockCC: 5 },
  lines: 3,                       // formation lines per squad
  lineNames: ['Front', 'Middle', 'Back'],
  // Squad level can't exceed the Command Center level.
  levelUpCost: (level) => ({ energy: Math.round(80 * Math.pow(1.7, level - 1)), alloy: 15 * level }),
};

// Secondary resources.
export const RESOURCES = {
  startShards: 500,
  startAlloy: 0,
  // Shards trickle from the Beacon (modest): 10/h at Beacon Lv 1, +5/h per level.
  // Shards now pay for leader star-ups and gear upgrades, not recruitment.
  shardsPerSec: (beaconLevel) => (10 + 5 * (beaconLevel - 1)) / 3600,
  // Alloy is refined by the Command Center: 72/h per CC level.
  alloyPerSec: (ccLevel) => 0.02 * ccLevel,
};

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY = {
  common: { name: 'Common', color: 0x9aa6b8, hex: '#9aa6b8', dupShards: 2 },
  rare: { name: 'Rare', color: 0x4a8cff, hex: '#6aa2ff', dupShards: 5 },
  epic: { name: 'Epic', color: 0xb05cff, hex: '#c58aff', dupShards: 15 },
  legendary: { name: 'Legendary', color: 0xffb347, hex: '#ffc46b', dupShards: 50 },
};

// Beacon Cores: the premium recruitment currency. Earned only, never bought and never
// generated passively over time. All sources live here.
export const CORES = {
  name: 'Beacon Cores',
  color: 0xff4f7b, hex: '#ff6f93',
  start: 10,                 // new players: exactly one x10 pull
  migrationGrant: 10,        // one-time starter grant for saves from before Cores existed
  daily: { base: 1, streakEvery: 7, streakBonus: 3 }, // 1/day; every 7th consecutive day pays 1 + 3
  beaconLevel: 3,            // one-time reward for each Beacon level reached (Lv 2, 3, ...)
  // One-time first-time milestones. `check(store)` decides when each is claimable.
  milestones: [
    { id: 'firstSquad', name: 'First squad saved', desc: 'Save a formation with at least 1 soldier', cores: 1, check: (st) => Object.values(st.state.squads).some((q) => q.lines.some((l) => l.type && l.count > 0)) },
    { id: 'firstLeader', name: 'Leader in command', desc: 'Assign a leader to a squad', cores: 1, check: (st) => Object.values(st.state.squads).some((q) => q.leader) },
    { id: 'barracks3', name: 'Drill yard', desc: 'Barracks Lv 3', cores: 1, check: (st) => st.state.buildings.barracks.level >= 3 },
    { id: 'cc3', name: 'Chain of command', desc: 'Command Center Lv 3', cores: 2, check: (st) => st.state.buildings.commandCenter.level >= 3 },
    { id: 'troops50', name: 'Garrison', desc: 'Own 50 troops', cores: 2, check: (st) => st.totalTroops() >= 50 },
    { id: 'troops150', name: 'Legion', desc: 'Own 150 troops', cores: 2, check: (st) => st.totalTroops() >= 150 },
  ],
  // Stage 3 hook: store.grantCores(n, 'battle') pays these once auto-battles exist.
  // Stage 3: World hunts. Only the FIRST kill of each creature level pays Cores (Dusk Wyrm elites pay more).
  // Levels 1-20 -> 16 x 1 + 4 x 2 = 24 Cores in total, ever. Normal kills pay 0.
  battle: { victory: 0, firstKill: 1, firstKillElite: 2 },
};

// Shard sinks: leader star-ups (alternative to duplicates) and gear levels.
export const UPGRADES = {
  // Shards to raise a leader from `stars` to `stars + 1`.
  leaderStarCost: (rarity, stars) => ({ common: 40, rare: 80, epic: 160, legendary: 300 }[rarity]) * stars,
  gearMaxLevel: 5,
  gearLevelBonus: 0.2,       // each gear level above 1 adds +20% of the item's base buff
  // Shards to raise a gear item (all copies of it) from `level` to `level + 1`.
  gearLevelCost: (rarity, level) => ({ common: 20, rare: 40, epic: 80, legendary: 150 }[rarity]) * level,
};

export const GACHA = {
  currency: 'cores',
  costX1: 1,                 // Beacon Cores
  costX10: 10,
  rates: { common: 0.60, rare: 0.28, epic: 0.10, legendary: 0.02 },
  pityEpic: 10,        // an Epic or better is guaranteed within this many pulls
  pityLegendary: 60,   // a Legendary is guaranteed within this many pulls
  leaderChance: 0.4,   // share of pulls that are leaders (rest is gear)
  maxStars: 5,
  starBonus: 0.25,     // each extra star adds +25% of the leader's base buff
  historySize: 50,
};

// Leaders. buff/debuff: { stat: 'hp'|'atk'|'def', target: troop id | 'all', pct }.
export const LEADERS = {
  kael: { id: 'kael', name: 'Kael', rarity: 'legendary', affinity: 'bearer', title: 'Lightbringer', buff: { stat: 'atk', target: 'bearer', pct: 25 }, debuff: { stat: 'def', target: 'bearer', pct: -5 } },
  lyra: { id: 'lyra', name: 'Lyra', rarity: 'epic', affinity: 'voyager', title: 'Shardseer', buff: { stat: 'atk', target: 'voyager', pct: 18 } },
  jax: { id: 'jax', name: 'Jax', rarity: 'epic', affinity: 'sentinel', title: 'Iron Bastion', buff: { stat: 'def', target: 'sentinel', pct: 20 } },
  seren: { id: 'seren', name: 'Seren', rarity: 'legendary', affinity: 'voyager', title: 'Void Walker', buff: { stat: 'atk', target: 'all', pct: 12 } },
  vex: { id: 'vex', name: 'Vex', rarity: 'rare', affinity: 'bearer', title: 'Embercoat', buff: { stat: 'atk', target: 'bearer', pct: 15 }, debuff: { stat: 'def', target: 'sentinel', pct: -8 } },
  orin: { id: 'orin', name: 'Orin', rarity: 'rare', affinity: 'sentinel', title: 'Wallbreaker', buff: { stat: 'hp', target: 'sentinel', pct: 12 } },
  nova: { id: 'nova', name: 'Nova', rarity: 'rare', affinity: 'voyager', title: 'Pathfinder', buff: { stat: 'hp', target: 'voyager', pct: 15 } },
  rook: { id: 'rook', name: 'Rook', rarity: 'common', affinity: 'sentinel', title: 'Shieldhand', buff: { stat: 'def', target: 'sentinel', pct: 10 } },
  dax: { id: 'dax', name: 'Dax', rarity: 'common', affinity: 'bearer', title: 'Gunner', buff: { stat: 'atk', target: 'bearer', pct: 8 } },
  mira: { id: 'mira', name: 'Mira', rarity: 'common', affinity: 'voyager', title: 'Scout', buff: { stat: 'atk', target: 'voyager', pct: 8 }, debuff: { stat: 'hp', target: 'voyager', pct: -5 } },
  thane: { id: 'thane', name: 'Thane', rarity: 'common', affinity: 'sentinel', title: 'Drill Sergeant', buff: { stat: 'hp', target: 'all', pct: 4 } },
};
export const LEADER_IDS = Object.keys(LEADERS);

// Gear: one armor + one weapon per squad. buff applies to every soldier in the squad.
export const GEAR = {
  scrapPlating: { id: 'scrapPlating', name: 'Scrap Plating', slot: 'armor', rarity: 'common', buff: { stat: 'def', pct: 5 } },
  pulseCarbine: { id: 'pulseCarbine', name: 'Pulse Carbine', slot: 'weapon', rarity: 'common', buff: { stat: 'atk', pct: 5 } },
  fieldWeave: { id: 'fieldWeave', name: 'Field Weave', slot: 'armor', rarity: 'common', buff: { stat: 'hp', pct: 5 } },
  aegisMesh: { id: 'aegisMesh', name: 'Aegis Mesh', slot: 'armor', rarity: 'rare', buff: { stat: 'def', pct: 10 } },
  arcRifle: { id: 'arcRifle', name: 'Arc Rifle', slot: 'weapon', rarity: 'rare', buff: { stat: 'atk', pct: 10 } },
  wardenShell: { id: 'wardenShell', name: 'Warden Shell', slot: 'armor', rarity: 'epic', buff: { stat: 'hp', pct: 16 } },
  lumenLance: { id: 'lumenLance', name: 'Lumen Lance', slot: 'weapon', rarity: 'epic', buff: { stat: 'atk', pct: 16 } },
  dawnforgedAegis: { id: 'dawnforgedAegis', name: 'Dawnforged Aegis', slot: 'armor', rarity: 'legendary', buff: { stat: 'def', pct: 25 } },
  beaconEdge: { id: 'beaconEdge', name: 'Beacon Edge', slot: 'weapon', rarity: 'legendary', buff: { stat: 'atk', pct: 25 } },
};
export const GEAR_IDS = Object.keys(GEAR);

export const ECONOMY = {
  startEnergy: 60,
  // Energy per second, scales with Beacon level.
  energyPerSec: (beaconLevel) => 1 + 0.75 * (beaconLevel - 1),
  offlineCapSeconds: 8 * 60 * 60, // offline earnings capped at 8 hours (training too)
  offlineRate: 1.0,               // fraction of online rate earned offline
  autosaveMs: 5000,
};

// The key keeps its stage-1 name so existing saves load; the version inside is migrated.
export const SAVE_KEY = 'brokenDawn.save.v1';
export const SAVE_VERSION = 15; // v15: Alloy gathering nodes (stage 16); v14: chapter goals + crew help (stage 14); v13: new-player onboarding (stage 13); v12: painted world map, Citadel at the centre (world regenerated); v11: speed-up items (stage 10); v10: daily missions + events (stage 8); v9: painted Base (bigger map, buildings hidden until unlocked); v8: sound + tutorial; v7: research + troop tiers; v3: parallel training lanes; v4: Beacon Cores, rewards, gear levels; v5: building upgrade timers; v6: World hunts + Infirmary

// ---------------------------------------------------------------- STAGE 3 --

// Infirmary: wounded troops wait here. Beyond capacity, extra wounded die.
// Healing runs one unit at a time through a queue of batches; Energy is paid when a batch is queued.
export const INFIRMARY = {
  capacity: (level) => 30 + 15 * (level - 1),
  healSpeed: (level) => 1 + 0.25 * (level - 1),
  heal: {                                   // per unit at Infirmary Lv 1 (about half of training)
    sentinel: { energy: 3, seconds: 4 },
    bearer: { energy: 4, seconds: 5 },
    voyager: { energy: 3, seconds: 4.5 },
  },
};
// Per-unit heal cost at Infirmary Lv 1 (before research): class base x tier multipliers.
export const healBase = (unit) => {
  const u = TROOP_CLASSES[unit], h = INFIRMARY.heal[u.cls], T = TIERS[u.tier];
  return { energy: h.energy * T.healEnergyMult, seconds: h.seconds * T.healTimeMult };
};

// Casualties after a hunt. The battle sim decides WHERE losses land (front lines take more);
// these rates decide HOW MANY, as a share of the troops sent. Most casualties are wounded, not dead.
export const CASUALTIES = {
  win: { min: 0.10, max: 0.20, deadShare: 0.2 },   // ~10-20% casualties, 80% of them wounded
  loss: { min: 0.35, max: 0.60, deadShare: 0.4 },  // losses hurt much more
  lineWeight: [1.0, 0.6, 0.4],                     // front / middle / back exposure
};

// Stamina gates World attacks.
export const STAMINA = {
  max: 100,
  regenPerHour: 10,
  perAttack: 10,
  dailyBonus: 20,       // added with the daily login claim (may go above max, up to overCap)
  overCap: 200,
};

// World map: square tiles, the player's base at the centre, creature levels rising in rings outward.
export const WORLD = {
  // Stage 12: the Rift Citadel sits at the exact centre; zones get tougher closer to it. Ring min/max are
  // tile distances from the CENTRE; inside a ring the level rises as you move inward.
  size: 86,
  tile: 72,
  centerX: 43, centerY: 43,
  baseX: 43, baseY: 78,     // your base: south edge of the outer (Lv 1-5) zone
  citadelRadius: 5,         // locked stronghold + golden dome (no creatures inside ~6 tiles)
  rings: [
    { min: 29, max: 37, levels: [1, 5], count: 16 },
    { min: 21, max: 28, levels: [6, 10], count: 12 },
    { min: 14, max: 20, levels: [11, 15], count: 9 },
    { min: 7, max: 13, levels: [16, 20], count: 7 },
  ],
  minSpacing: 2.2,          // tiles between creatures
  baseClear: 3,             // tiles kept clear around any player base
  respawnSeconds: 600,      // a killed creature comes back after 10 min, somewhere else in its ring
  march: { base: 5, perTile: 1, max: 60 }, // seconds each way
  maxMarches: 3,            // one per squad
  levelHeadroom: 1,         // you can attack up to (best kill + 1)
  autoMargin: 1.1,          // Auto only picks creatures your squad out-powers by >= 10%
  reportsKept: 12,
  maxLevel: 20,
  minZoom: 0.25, maxZoom: 1.6, startZoom: 0.55,
  bots: 14,                 // seeded neighbour bases (a server replaces these with real players later)
};

// Stage 16 (after The Ants: Underground Kingdom): Alloy nodes on the world map. Send a squad to gather:
// no stamina, no fighting. Capacity = base + per troop; rate scales with troops and node level.
// Nodes near your base are Lv 1, richer ones sit farther out. A drained node regrows in place.
export const GATHER = {
  levels: [ // per node level: total Alloy in the node + distance band (tiles from YOUR base) + count on the map
    { amount: 150, band: [3, 7], count: 3 },
    { amount: 260, band: [7, 11], count: 3 },
    { amount: 400, band: [11, 15], count: 2 },
    { amount: 600, band: [15, 20], count: 2 },
    { amount: 900, band: [20, 26], count: 2 },
  ],
  capBase: 20, capPerTroop: 3,          // Alloy a squad can carry home
  rateBase: 0.08, ratePerTroop: 0.002,  // Alloy per second at a Lv 1 node
  rateLevel: 0.3,                       // +30% gather speed per node level above 1
  regrowSeconds: 1800,                  // a drained node regrows after 30 min
};
export const gatherCap = (troops) => Math.round(GATHER.capBase + GATHER.capPerTroop * Math.max(0, troops));
export const gatherRate = (troops, level) => (GATHER.rateBase + GATHER.ratePerTroop * Math.max(0, troops)) * (1 + GATHER.rateLevel * (Math.max(1, level) - 1));

// Stage 12: player-base look by Beacon level (5 tiers) + seeded neighbour alliances.
export const BASE_TIERS = [
  { min: 1, max: 4, name: 'Outpost' },
  { min: 5, max: 9, name: 'Walled Camp' },
  { min: 10, max: 14, name: 'Fortress' },
  { min: 15, max: 19, name: 'Citadel' },
  { min: 20, max: 20, name: 'Stronghold' },
];
export const baseTier = (lv) => Math.max(0, BASE_TIERS.findIndex((t) => lv >= t.min && lv <= t.max));
export const ALLIANCES = [
  { tag: 'ASH', name: 'Ashen Vow', color: 0xd9483b },
  { tag: 'TDL', name: 'Tidelight', color: 0x2fc4c9 },
  { tag: 'GLD', name: 'Gilded Reach', color: 0xe7b24a },
  { tag: 'VOI', name: 'Void Choir', color: 0x8d5bd6 },
  { tag: 'IRN', name: 'Iron Wake', color: 0x7f93a8 },
];
export const CITADEL = {
  name: 'Rift Citadel',
  body: 'The stronghold at the heart of the Rift, sealed under a golden contested dome.\n\nComing with alliances: once a week the dome falls and alliances fight a war for the Citadel. The holder\'s alliance gets buffs for the week (gather, march speed, training).\n\nZones get tougher the closer you get: Lv 16-20 creatures guard its walls.',
};

// Creature Combat Power by level: ~20 at Lv 1, +20% per level (~640 at Lv 20). Elites x1.25.
export const creaturePower = (level, elite = false) => Math.round(20 * Math.pow(1.2, level - 1) * (elite ? 1.25 : 1));

// Kill rewards (normal kills; elites x1.5). Shards here are a steady but modest source.
export const HUNT_REWARDS = {
  energy: (L) => 30 * L,
  alloy: (L) => 4 * L,
  shards: (L) => 8 + 2 * L,
  eliteMult: 1.5,
};

// Creature types. hp/atk/def are per unit at Lv 1; stats scale x(1 + 0.08 per level).
// targets: which of YOUR lines they hit first. tags drive class counters in the battle sim.
export const CREATURES = {
  scuttler: {
    id: 'scuttler', calib: 1.2, name: 'Husk Scuttlers', short: 'Scuttlers', color: 0xc9a46a, hex: '#d9b47a',
    unit: { hp: 40, atk: 6, def: 2 }, targets: 'front', tags: ['swarm'],
    desc: 'Chittering swarms of hollowed husks. Weak alone, dangerous in numbers. Bearers cut through them (+25% damage).',
  },
  drone: {
    id: 'drone', calib: 0.77, name: 'Rift Drones', short: 'Drones', color: 0x9b7bff, hex: '#b39bff',
    unit: { hp: 45, atk: 9, def: 3 }, targets: 'back', tags: ['flier'],
    desc: 'Fast fliers that slip past the front and strike your BACK line first.',
  },
  hound: {
    id: 'hound', calib: 1.07, name: 'Void Hounds', short: 'Hounds', color: 0x4dd6c1, hex: '#6fe6d3',
    unit: { hp: 70, atk: 11, def: 5 }, targets: 'front', tags: ['fast'], firstStrike: true,
    desc: 'Pack hunters from the dark between stars. They pounce first every round.',
  },
  golem: {
    id: 'golem', calib: 0.74, name: 'Shard Golems', short: 'Golems', color: 0x6aa2ff, hex: '#8ab6ff',
    unit: { hp: 240, atk: 14, def: 32 }, targets: 'front', tags: ['armored'],
    desc: 'Walking crystal. Heavily armored; Voyager shots pierce armor (ignore 50% DEF).',
  },
  wyrm: {
    id: 'wyrm', calib: 0.84, name: 'Dusk Wyrm', short: 'Wyrm', color: 0xff6f3c, hex: '#ff8a5c', elite: true,
    unit: { hp: 900, atk: 40, def: 18 }, targets: 'front', tags: ['elite'], brood: 'scuttler', broodShare: 0.4,
    desc: 'Elite. A great serpent of the dusk with a brood of Scuttlers. Appears at every 5th level and pays double first-kill Cores.',
  },
};
export const CREATURE_IDS = Object.keys(CREATURES);
export const NORMAL_CREATURES = ['scuttler', 'drone', 'hound', 'golem'];

// Battle tuning (see src/world/battle.js).
export const BATTLE = {
  maxRounds: 12,
  defK: 50,                    // damage x defK / (defK + DEF)
  squadLevelBonus: 0.04,       // +4% HP and ATK per squad level above 1
  sentinelFrontDef: 0.2,       // Sentinels in the FRONT line get +20% DEF (shield wall)
  bearerVsSwarm: 0.25,
  voyager: { crit: 0.15, critMult: 1.6, pierce: 0.5 },
  spread: 0.1,                 // +-10% seeded damage roll per volley
};

// ---------------------------------------------------------------- STAGE 4 --
// Research (in the Archive). One project at a time. Every node has levels 1..maxLevel; a node's level
// can't exceed the Archive's level. Costs Energy + Alloy + Shards (never Cores).
// `per` = effect per level (fractions, or flat for stamina numbers). `req` = extra gates.
export const RESEARCH_BRANCHES = [
  { id: 'economy', name: 'Economy', color: 0xffb347, hex: '#ffc46b' },
  { id: 'military', name: 'Military', color: 0xff6f7b, hex: '#ff8a93' },
  { id: 'healing', name: 'Healing', color: 0x4dff9a, hex: '#6dffae' },
  { id: 'world', name: 'World', color: 0x3ff0ff, hex: '#5ff3ff' },
];
export const RESEARCH = {
  // Economy
  energyYield: { branch: 'economy', name: 'Beacon Harmonics', effect: 'energy', per: 0.04, fmt: 'pct', desc: 'Energy income' },
  alloyYield: { branch: 'economy', name: 'Alloy Refining', effect: 'alloy', per: 0.05, fmt: 'pct', desc: 'Alloy income' },
  shardYield: { branch: 'economy', name: 'Shard Resonance', effect: 'shards', per: 0.05, fmt: 'pct', desc: 'Shard income' },
  buildSpeed: { branch: 'economy', name: 'Rapid Assembly', effect: 'build', per: 0.05, fmt: 'pct', desc: 'Building upgrade speed' },
  // Military
  sentinelDrills: { branch: 'military', name: 'Shield Drills', effect: 'combat', cls: 'sentinel', per: 0.03, fmt: 'pct', desc: 'Sentinel-class HP and ATK' },
  bearerDrills: { branch: 'military', name: 'Lance Drills', effect: 'combat', cls: 'bearer', per: 0.03, fmt: 'pct', desc: 'Bearer-class HP and ATK' },
  voyagerDrills: { branch: 'military', name: 'Rift Drills', effect: 'combat', cls: 'voyager', per: 0.03, fmt: 'pct', desc: 'Voyager-class HP and ATK' },
  trainSpeed: { branch: 'military', name: 'Drill Cadence', effect: 'train', per: 0.05, fmt: 'pct', desc: 'Training speed' },
  tier2: { branch: 'military', name: 'Tier II Protocols', effect: 'tier', tier: 2, maxLevel: 1, req: { barracks: 5, archive: 3 },
    cost: { energy: 1500, alloy: 200, shards: 150 }, seconds: 1200, desc: 'Unlocks T2: Bulwark, Lancer, Phantom + promotion' },
  tier3: { branch: 'military', name: 'Tier III Protocols', effect: 'tier', tier: 3, maxLevel: 1, req: { barracks: 9, archive: 5, research: 'tier2' },
    cost: { energy: 8000, alloy: 900, shards: 600 }, seconds: 7200, desc: 'Unlocks T3: Aegis, Sunbreaker, Riftwalker' },
  // Healing
  beds: { branch: 'healing', name: 'Field Cots', effect: 'beds', per: 0.10, fmt: 'pct', desc: 'Infirmary beds' },
  triage: { branch: 'healing', name: 'Triage', effect: 'healSpeed', per: 0.08, fmt: 'pct', desc: 'Healing speed' },
  medSynth: { branch: 'healing', name: 'Med Synthesis', effect: 'healCost', per: 0.05, fmt: 'pctLess', desc: 'Healing Energy cost' },
  stabilizers: { branch: 'healing', name: 'Stabilizers', effect: 'survival', per: 0.05, fmt: 'pctLess', desc: 'Battle deaths (they come back wounded instead)' },
  // World
  staminaCells: { branch: 'world', name: 'Stamina Cells', effect: 'staminaCap', per: 10, fmt: 'flat', desc: 'Max stamina' },
  recovery: { branch: 'world', name: 'Recovery Loop', effect: 'staminaRegen', per: 1, fmt: 'perHour', desc: 'Stamina regen' },
  striders: { branch: 'world', name: 'Rift Striders', effect: 'march', per: 0.05, fmt: 'pct', desc: 'March speed' },
  salvage: { branch: 'world', name: 'Salvage Protocols', effect: 'loot', per: 0.05, fmt: 'pct', desc: 'Hunt rewards (Energy, Alloy, Shards)' },
};
export const RESEARCH_IDS = Object.keys(RESEARCH);
export const RESEARCH_TUNING = {
  maxLevel: 5,
  // cost to research TO level L (normal nodes): 150 E / 20 A / 30 S at Lv 1, x1.7 per level
  cost: (L) => { const g = Math.pow(1.7, L - 1); return { energy: Math.round(150 * g), alloy: Math.round(20 * g), shards: Math.round(30 * g) }; },
  // seconds to research TO level L: 30 s, 2 m, 8 m, 30 m, 2 h, then x3
  seconds: (L) => [0, 30, 120, 480, 1800, 7200][L] ?? 7200 * Math.pow(3, L - 5),
};

// ------------------------------------------------------------------ stage 5 --
// Audio / haptics defaults (saved per device in state.settings). Volumes are 0..1.
export const AUDIO = { music: 0.7, sfx: 0.9, muted: false, haptics: true, crossfade: 0.5, step: 0.1 };
// Idle frame cap: after this long without input (and nothing animating) the game drops to ~30 fps.
export const PERF = { idleMs: 8000, idleFps: 30 };
// First-time tutorial: number of steps and the completion reward.
// Stage 13: the new-player first 10 minutes. Ten action-driven steps narrated by Lyra; HUD parts unlock as
// they're introduced (unlockAt = the step index from which they show). Tutorial-only fast timers.
export const TUTORIAL = {
  steps: 10, reward: { energy: 500, cores: 2 },
  ids: ['story', 'beacon', 'rebuild', 'finish', 'train', 'squad', 'hunt', 'recruit', 'beacon2', 'missions'],
  unlockAt: { troops: 4, items: 4, training: 4, world: 6, armory: 7, cores: 7, squads: 9, more: 9, builder: 9, missions: 9, research: 10, healing: 10, events: 10 },
  fast: { barracks: { 2: 10 }, beacon: { 2: 30 } }, // seconds for upgrades started during the tutorial
  trainSpeed: 3,          // training runs 3x while the tutorial waits on it (10 Sentinels ~13 s)
  firstPull: 'kael',      // the first recruit is guaranteed
  trainGift: { su_m1: 3 },
};

// ---- Stage 8: Daily Missions --------------------------------------------------------------------
// Reset at the player's local midnight. Tasks are counted from real game actions (offline ones too) and
// claimed for activity points; points open the chests. Sum of points is 110, so one task can be skipped.
export const MISSIONS = {
  tasks: [
    { id: 'daily', name: 'Claim the daily reward', goal: 1, pts: 10 },
    { id: 'kills', name: 'Defeat 8 creatures', goal: 8, pts: 20 },
    { id: 'train', name: 'Train or promote 30 troops', goal: 30, pts: 15 },
    { id: 'build', name: 'Start a building upgrade', goal: 1, pts: 15 },
    { id: 'research', name: 'Start a research', alt: 'Raise a leader star or gear level', goal: 1, pts: 15 },
    { id: 'heal', name: 'Heal 10 wounded troops', goal: 10, pts: 15 },
    { id: 'push', name: 'Win a hunt at top level (or 1 below)', goal: 1, pts: 20 },
  ],
  // Activity chests. L = Beacon level. Only the 100-point chest pays a Beacon Core (1 a day).
  chests: [
    { at: 20, tier: 'bronze', reward: (L) => ({ energy: 300 * L, su_m5: 1 }) },
    { at: 40, tier: 'bronze', reward: (L) => ({ alloy: 40 * L, stamina: 10, su_m15: 1 }) },
    { at: 60, tier: 'silver', reward: () => ({ shards: 60, su_m5: 2 }) },
    { at: 80, tier: 'silver', reward: (L) => ({ energy: 600 * L, stamina: 20, su_h1: 1 }) },
    { at: 100, tier: 'gold', reward: () => ({ cores: 1, shards: 100, su_m15: 1 }) },
  ],
};

// ---- Stage 8: Events -----------------------------------------------------------------------------
// A fixed weekly calendar in UTC, so every player sees the same windows (shown in local time). The
// LocalEventService builds the schedule from it; a server-driven service can replace it later.
export const EVENTS = {
  calendar: [
    { type: 'beaconSurge', day: 0, hours: 72 }, // Mon 00:00 -> Thu 00:00 UTC
    { type: 'riftHunt', day: 4, hours: 72 },    // Fri 00:00 -> Mon 00:00 UTC
  ],
  types: {
    beaconSurge: {
      name: 'Beacon Surge', slug: 'beacon-surge', banner: 'banner-beacon-surge', color: 0xffc94a, hex: '#ffd76a',
      blurb: 'Build and research to power up the base.',
      how: ['Building upgrade finished: 100 × new level', 'Research level finished: 80 × new level', 'Troop trained: 2 × its tier'],
      milestones: [500, 1500, 3000, 6000, 10000],
    },
    riftHunt: {
      name: 'Rift Hunt', slug: 'rift-hunt', banner: 'banner-rift-hunt', color: 0xb58cff, hex: '#c9a8ff',
      blurb: 'Creatures pour out of the Rift. Hunt them down.',
      how: ['Creature defeated: 10 × its level', 'Elites (Dusk Wyrms) score double', 'Offline Auto-hunts count too'],
      milestones: [300, 1000, 2000, 3500, 5000],
    },
  },
  // Milestone rewards (same shape for every event). L = Beacon level. 2 Beacon Cores per event at most.
  milestoneRewards: (L) => [
    { energy: 400 * L, alloy: 50 * L, su_m15: 1 },
    { shards: 80, su_m15: 2 },
    { stamina: 30, marks: 10, su_h1: 1 },
    { cores: 1, energy: 1000 * L, su_h3: 1 },
    { cores: 1, shards: 150, marks: 20, su_h8: 1 },
  ],
  marksPer: 50,       // 1 Rift Mark per 50 event points
  keepDays: 21,       // settled event records are dropped after this
  // Rift Exchange: open all week, limits refresh Monday 00:00 UTC.
  shop: [
    { id: 'energy', name: 'Energy crate', price: 20, limit: 5, reward: (L) => ({ energy: 2000 * L }) },
    { id: 'alloy', name: 'Alloy crate', price: 25, limit: 5, reward: (L) => ({ alloy: 250 * L }) },
    { id: 'stamina', name: 'Stamina cell', price: 30, limit: 3, reward: () => ({ stamina: 50 }) },
    { id: 'gear', name: 'Gear upgrade crate', price: 40, limit: 3, reward: () => ({ shards: 200 }) },
    { id: 'core', name: 'Beacon Core', price: 200, limit: 1, reward: () => ({ cores: 1 }) },
    { id: 'su5', name: '5m Speed-up', price: 5, limit: 10, reward: () => ({ su_m5: 1 }) },
    { id: 'su60', name: '1h Speed-up', price: 30, limit: 3, reward: () => ({ su_h1: 1 }) },
    { id: 'su480', name: '8h Speed-up', price: 120, limit: 1, reward: () => ({ su_h8: 1 }) },
  ],
};
