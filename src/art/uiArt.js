// HUD + bottom-nav icons (v0.6 HUD redesign). Keyed off magenta / green sheets by artwork/process_ui.py.
import navWorld from './ui/nav-world.webp';
import navTroops from './ui/nav-troops.webp';
import navArmory from './ui/nav-armory.webp';
import navSquads from './ui/nav-squads.webp';
import navMore from './ui/nav-more.webp';
import hudBaseEmblem from './ui/hud-base-emblem.webp';
import moreResearch from './ui/more-research.webp';
import moreEvents from './ui/more-events.webp';
import hudEnergy from './ui/hud-energy.webp';
import hudAlloy from './ui/hud-alloy.webp';
import hudShards from './ui/hud-shards.webp';
import hudCore from './ui/hud-core.webp';
import hudPower from './ui/hud-power.webp';
// Stage 8: missions, events, Rift Exchange (artwork/process_stage8.py)
import hudMissions from './ui/hud-missions.webp';
import riftMark from './ui/rift-mark.webp';
import exchange from './ui/exchange.webp';
import hudStamina from './ui/hud-stamina.webp';
import chestBronze from './ui/chest-bronze.webp';
import chestSilver from './ui/chest-silver.webp';
import chestGold from './ui/chest-gold.webp';
import chestBronzeOpen from './ui/chest-bronze-open.webp';
import chestSilverOpen from './ui/chest-silver-open.webp';
import chestGoldOpen from './ui/chest-gold-open.webp';
import bannerBeaconSurge from './ui/banner-beacon-surge.webp';
import bannerRiftHunt from './ui/banner-rift-hunt.webp';
// Stage 9: painted troop figures + Beacon Call recruit banner (tools/process_stage9.py)
import troopSentinel from './ui/troop-sentinel.webp';
import troopBearer from './ui/troop-bearer.webp';
import troopVoyager from './ui/troop-voyager.webp';
import bannerBeaconCall from './ui/banner-beacon-call.webp';
// Stage 9b: painted leader busts + gear icons (tools/process_stage9b.py)
const PAINTED = import.meta.glob(['./ui/leader-*.webp', './ui/gear-*.webp', './ui/item-*.webp', './ui/more-leaders.webp', './ui/ic-*.webp'], { eager: true, import: 'default' });
const paintedUrls = Object.fromEntries(Object.entries(PAINTED).map(([f, url]) => {
  const n = f.slice(5, -5); // leader-kael / gear-arcRifle
  return [n.replace(/^leader-/, 'leaderart-').replace(/^gear-/, 'gearart-'), url];
}));

export const UI_ART_URLS = {
  ...paintedUrls,
  'troop-sentinel': troopSentinel, 'troop-bearer': troopBearer, 'troop-voyager': troopVoyager, 'banner-beacon-call': bannerBeaconCall,
  'nav-world': navWorld, 'nav-troops': navTroops, 'nav-armory': navArmory,
  'nav-squads': navSquads, 'nav-more': navMore,
  'hud-base-emblem': hudBaseEmblem, 'more-research': moreResearch, 'more-events': moreEvents, 'hud-energy': hudEnergy, 'hud-alloy': hudAlloy, 'hud-shards': hudShards,
  'hud-core': hudCore, 'hud-power': hudPower,
  'hud-missions': hudMissions, 'rift-mark': riftMark, 'exchange': exchange, 'hud-stamina': hudStamina, 'chest-bronze': chestBronze, 'chest-silver': chestSilver, 'chest-gold': chestGold, 'chest-bronze-open': chestBronzeOpen, 'chest-silver-open': chestSilverOpen, 'chest-gold-open': chestGoldOpen, 'banner-beacon-surge': bannerBeaconSurge, 'banner-rift-hunt': bannerRiftHunt,
};
