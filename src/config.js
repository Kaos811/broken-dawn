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
    description: 'Main hub. Oversees the base and its total Base Power.',
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
    description: 'Trains Sentinels, Bearers and Voyagers. (Troop training arrives in stage 2.)',
  },
  armory: {
    id: 'armory',
    name: 'Armory',
    footprint: 2,
    powerPerLevel: 0, // not part of the stage-1 power formula; gacha arrives in stage 2
    baseCost: 40,
    costGrowth: 1.6,
    start: { gx: 16, gy: 16, level: 1 },
    accent: 'cyan',
    description: 'Recruitment hub for leaders, armor and weapons. (Gacha arrives in stage 2.)',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

// Buildings can't be upgraded past Beacon level + this many levels.
export const BUILDING_LEVEL_HEADROOM = 2;

export const buildingUpgradeCost = (id, level) => {
  const b = BUILDINGS[id];
  return Math.round(b.baseCost * Math.pow(b.costGrowth, level - 1));
};

// Troop power (wired up for stage 2): each soldier = 1, +10 per squad level.
export const TROOPS = {
  powerPerSoldier: 1,
  powerPerSquadLevel: 10,
  squadIds: ['alpha', 'bravo', 'charlie'],
};

export const ECONOMY = {
  startEnergy: 60,
  // Energy per second, scales with Beacon level.
  energyPerSec: (beaconLevel) => 1 + 0.75 * (beaconLevel - 1),
  offlineCapSeconds: 8 * 60 * 60, // offline earnings capped at 8 hours
  offlineRate: 1.0,               // fraction of online rate earned offline
  autosaveMs: 5000,
};

export const SAVE_KEY = 'brokenDawn.save.v1';
export const SAVE_VERSION = 1;
