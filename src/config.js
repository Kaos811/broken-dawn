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
  size: 26,          // grid is size x size iso tiles
  tileW: 96,         // iso diamond width
  tileH: 48,         // iso diamond height
  // Metal platform where buildings may be placed (inclusive grid range).
  platformMin: 7,
  platformMax: 18,
  platformThickness: 22,
  minZoom: 0.4,
  maxZoom: 1.8,
  startZoom: 0.62,
};

// Beacon: fixed at the centre of the map, never movable.
export const BEACON = {
  id: 'beacon',
  name: 'The Beacon',
  footprint: 2,
  gx: 12,
  gy: 12,
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
    footprint: 2,
    powerPerLevel: 10,
    baseCost: 50,
    costGrowth: 1.6,
    start: { gx: 12, gy: 8, level: 1 },
    accent: 'gold',
    description: 'Main hub. Oversees Base Power, unlocks the Bravo and Charlie squads, and caps squad levels.',
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    footprint: 2,
    powerPerLevel: 5,
    baseCost: 30,
    costGrowth: 1.55,
    start: { gx: 8, gy: 12, level: 1 },
    accent: 'blue',
    description: 'Trains Sentinels, Bearers and Voyagers side by side, one lane per class. Higher levels give every lane more room and train faster.',
  },
  armory: {
    id: 'armory',
    name: 'Armory',
    footprint: 2,
    powerPerLevel: 0, // not part of the power formula; the Armory hosts recruitment (gacha)
    baseCost: 40,
    costGrowth: 1.6,
    start: { gx: 16, gy: 16, level: 1 },
    accent: 'cyan',
    description: 'Recruitment hub for leaders, armor and weapons. Spend Shards on pulls; equip what you find on your squads.',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

// Buildings can't be upgraded past Beacon level + this many levels.
export const BUILDING_LEVEL_HEADROOM = 2;

// Building upgrades take time. Applies to the Command Center, Barracks, Armory AND the Beacon.
// Cost is paid up front; level, power and unlocks apply only when the timer finishes.
export const CONSTRUCTION = {
  builders: 1,                       // upgrades that can run at the same time
  // Seconds to upgrade TO a level. Past the table, each level takes `growth`x the previous one.
  table: { 2: 10, 3: 30, 4: 120, 5: 360, 6: 1200 },
  growth: 3,
  seconds(toLevel) {
    if (toLevel <= 1) return 0;
    const t = this.table[toLevel];
    if (t != null) return t;
    const top = Math.max(...Object.keys(this.table).map(Number));
    return this.table[top] * Math.pow(this.growth, toLevel - top);
  },
  // Hook for future Beacon Core speed-ups (no UI yet): store.speedUpConstruction(id, seconds).
  speedUp: { secondsPerCore: 300 },
};

export const buildingUpgradeCost = (id, level) => {
  const b = BUILDINGS[id];
  return Math.round(b.baseCost * Math.pow(b.costGrowth, level - 1));
};

// ---------------------------------------------------------------- STAGE 2 --

// Troop classes. hp/atk/def are per-soldier base stats used by stage-3 auto-battle.
// energy = Energy cost per unit; trainSeconds = time per unit at Barracks Lv 1.
export const TROOP_CLASSES = {
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
export const TROOP_IDS = Object.keys(TROOP_CLASSES);

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
  battle: { victory: 0, firstClear: 1 },
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
export const SAVE_VERSION = 5; // v3: parallel training lanes; v4: Beacon Cores, rewards, gear levels; v5: building upgrade timers
