# Stage 19 plan: Rallies (v0.14.0, save v17)

Plan only, not built yet. Zero cost: it all runs on the device, with no server and no new paid art.

## 1. How rallies work in Ants: Underground Kingdom (reference)
- **Starting one:** the leader taps a rally target (lizards, or event bosses such as Bunny and Frog) and picks a wait timer of **1, 5, 10, 30 or 60 min**. Players mostly pick 1 min for easy targets and 5 min for tough ones.
- **Joining:** alliance members join with one of their march troops while the timer runs. The leader sees the joiners and can kick them.
  - There are 4 join slots, and a 5th unlocks at Alliance Center Lv 11.
  - The Rally Center caps the size of each march, and the Troop Tunnel gives the whole rally an attack bonus.
- **NPC fallback:** if no one joins, a **support NPC joins in the last ~3 seconds**. It is strong enough to kill about a Lv 5 lizard. This is exactly our "bot allies" idea.
- **March and battle:** when the timer ends, all troops march together from the leader's base at the speed of the slowest march. There is one combined battle, then each march returns home on its own.
- **Costs and limits:** leading or joining a lizard rally costs **20 stamina**, with a cap of **10 lizard rallies a day**. The first lizard of the day pays bonus rewards scaled to its level.
- **Rewards:** each participant gets their own kill rewards (speed-ups and resources). In addition, every member of the alliance gets a **"Normal Gift" trophy** whose tier follows the lizard's level (Lv 1, 5, 10, 15, 20 → Primary … Supreme). Higher tiers are more likely to give speed-ups.
- **Rally-only targets:** lizards can't be solo-hunted; you must rally them.

Sources: theantsforum.allstarunion.com (rally timer poll, Jul 2024), the r/SwagBucks Ants guide (lizards: 20 stamina, 10/day, NPC joins last 3 s, Alliance Center Lv 11 → 5th slot), and the Ants fandom wiki "Gifts" page (lizard trophy tiers).

## 2. What we have today (code audit)
- **Creatures** (`config.js` CREATURES):
  - There are 4 normal types plus the **Dusk Wyrm**, an elite with a Scuttler brood (broodShare 0.4) that spawns at every 5th level (`isElite` in worldState.js).
  - Power is `creaturePower(L, elite)`, with elites ×1.25. Rewards are HUNT_REWARDS with eliteMult 1.5, and the first kill of each level pays Cores (Wyrm levels 2).
- **Squads:** there are 3 squads (Alpha, Bravo, Charlie, unlocked at CC 1/3/5), each with 3 lines (Front, Middle, Back). `squadArmy(state, id)` builds the army, and `WORLD.maxMarches` is 3.
- **Marches:** `LocalWorldService.sendMarch` → march `{phase out|gather|back, travel, army, meta}`.
  - `tick()` resolves the battle on arrival with the pure, seeded `resolveBattle(attacker, defender, seed)`.
  - Then `store.onBattle` applies casualties (wounded → Infirmary), loot, first-kill Cores, a report and the replay.
- **Stamina:** STAMINA has max 100, regen 10/h, 10 per attack and a daily bonus of 20. Research adds cap and regen.
- **Bots:** `seedBotBases` places about N bot bases on the gradient. Each has a level, alliance tag, colour and power, and stronger bots sit closer to the Citadel.
  - Bots are display and profile targets only. PvP is blocked ("PvP coming with alliances").
- **WorldService** is already the single swap point for a future server (the header documents a RemoteWorldService with the same methods).
- **Save:** version 16, migrations in `store.migrate`. Chapter goals and hints exist (stage 14).

## 3. Design

### 3.1 Rally targets
- **Elite Dusk Wyrms (Lv 5/10/15/20)** become **rally-or-solo**: you can still solo them as today, but a rally is the intended way.
- **New rally-only boss: "Rift Behemoth"** at **Lv 5, 10, 15, 20, 25**, with power ≈ `creaturePower(L,true) × 4`.
  - Lv 25 sits only in the ring around the Citadel, the hardest spot on the gradient.
  - The other levels spawn on the gradient like elites, at most **1 per level band on the map**, each lasting **2 h**.
  - Its battle stats come from a new CREATURES entry `behemoth` (`rallyOnly: true`, tags `['elite','boss']`, a brood of hounds).
  - Solo attacks are refused with "Rally required: start a rally".
- Bosses appear in search, which gets a filter toggle for "Rally targets".

### 3.2 Starting a rally
Tap the boss (or a Wyrm) → card → **Start rally** → rally sheet:
- **Squad:** pick one of your idle squads (the leader's march).
- **Timer:** **1, 5 or 10 min** (default 5). We drop 30/60, since nobody waits that long in a single-player game. In dev, `__BD_TEST.fast` shrinks the timers.
- **Cost:** **20 stamina** (Ants parity). It is charged when the rally starts and refunded if you cancel before the timer ends.
- **Limit:** **5 rallies a day** (resets with the daily reset). The first rally of the day gets a bonus chest.
- The boss is marked `busy` while the rally gathers, so it won't despawn.

### 3.3 Bot allies joining over time
- There are **4 join slots** (Ants parity). Bots are drawn from the seeded bot bases nearby: the same names, alliance tag and colour, so they already exist on the map.
- **Join schedule:** joins follow a seeded schedule across the timer, front-loaded: roughly the 1st bot at 15% of the timer, the 2nd at 40%, the 3rd at 65% and the 4th at 85%.
  - A short timer yields fewer bots: **1 min → 2 bots, 5 min → 3, 10 min → 4**.
  - This makes the timer a real trade-off: wait longer for a stronger rally.
- **Bot strength scales to the player:** each bot ≈ **55–85% of the leader's squad power** (seeded per bot). The army is built from the leader's unlocked troop tiers with a matching lineup, so the combined power is about 2.6–3.7× the leader.
- **Tuning target:** a Lv-L Behemoth is about **70% win odds** for a player whose best solo kill is around L–2 with a 10 min rally. That keeps rallies feeling like "punching above your weight".
- **"Last-second support"** (Ants NPC parity): if fewer than 2 bots joined, a **Rift Warden NPC** joins at T-3 s at 60% of the leader's power, so a rally is never hopeless.
- Bots don't take casualties that matter to you: their losses are cosmetic and appear only in the report.

### 3.4 Combined march and battle
- When the timer ends, the rally leaves from **your base** (the rally point) and marches at the **slowest member's speed**. In practice that is your march speed, since bots have no research. Joiners walk to your base first; this shows as lines on the map.
- **Battle:** a single `resolveBattle(combinedArmy, boss, seed)`.
  - The combined army merges each line across members: Front with Front, and so on.
  - `battle.js` gets an additive `mergeArmies(armies)` helper. It stays pure, with no change to how existing battles resolve.
- **Casualties** are split back to each member in proportion to the troops they contributed per line. Your share runs through the existing `applyCasualties`, so wounded go to the Infirmary.
- **Report and replay:** one rally report. It reuses the battle replay with a "Rally" header and a contributions table: member, power, troops sent, losses and damage share.

### 3.5 Rewards, split and goals
- **Leader:** gets full kill rewards for the boss level (HUNT_REWARDS × boss multiplier 2.5) **plus a Rally Trophy**. The trophy tier follows the level, mirroring the Ants trophies:

  | Boss level | Trophy |
  | --- | --- |
  | 5 | Bronze |
  | 10 | Silver |
  | 15 | Gold |
  | 20 | Rift |
  | 25 | Dawn |

  - A trophy opens to speed-ups or resources, using our existing su_* items and chest loot.
  - It's a 50/50 roll like Ants, with higher tiers weighted toward speed-ups.
- **The split** is shown, not paid: bots "take" their share in the report for flavour. You keep the full leader share, because only you are real. Once real players exist, each joiner gets the joiner share, which is 60% of the leader's.
- **Cores:** first rally kill of each boss level gives **+3 Cores** (5 levels → 15 Cores in total), a new sink-free source like first kills.
- **Chapter goal:** "Rally the Rift" (first successful rally) gives 3 Cores and a speed-up. It's added to the stage-14 chapter goals for a chapter whose CC requirement is about 5.
- **Tutorial hint:** shown the first time a Behemoth is in view: "Too big to fight alone. Start a rally and allies will join."
- **Events and missions:** add a daily mission "Join or lead 1 rally" and an event score for rally kills.

### 3.6 UI
- **Boss card:** level, power and recommended rally power, plus a **Start rally** button (or "Rally required").
- **Rally panel** (bottom sheet, same frame as the squad picker):
  - a circular countdown;
  - 5 slots showing you plus 4 others, each with a crest and alliance tag, the bot's name, its power, and joining/marching/arrived status;
  - a live **combined power vs. boss power** bar with odds (reusing `odds()`);
  - **Launch now** (only once at least one ally has arrived) and **Cancel**.
- **On the map:**
  - a pulsing rally banner over your base;
  - thin dotted **march lines** from each joining bot base to yours, in the bot's colour;
  - then one thick combined line to the boss;
  - a small rally icon on the boss while it is targeted.
- **HUD chip:** "Rally 3:12 · 3/4 joined". Tapping it reopens the panel.

### 3.7 WorldService hook (bots now, players later)
New methods are added to LocalWorldService and documented in the interface header, so a RemoteWorldService can implement them on a server:
```
canRally({ owner, squadId, targetId })            -> { ok, reason?, cost }
startRally({ owner, squadId, army, targetId, wait }) -> { ok, rally }
joinRally({ rallyId, owner, squadId, army })        -> { ok }     // bots call this today; players later
leaveRally / cancelRally(rallyId)                    -> { ok }
rallies(owner?)                                      -> [{ id, leader, targetId, endsAt, slots, members[], phase }]
tick(dt) events += { type: 'rallyJoin', rally, member } | { type: 'rallyLaunch', rally } | { type: 'rallyBattle', rally, result, shares }
```
- **Bot allies** live in a separate `BotRallyAgent` (src/world/rallyBots.js). It is the only code that "plays" bots, and it calls `joinRally` on the seeded schedule.
- **Server later:** delete the agent and let real alliance members call `joinRally`. A server runs the same pure `resolveBattle` and `mergeArmies`.

### 3.8 Save v17 and migration
- `state.world.rallies: []` holds active rallies with their absolute clock times, so they survive reloads and **simulate offline**. The existing 5 s offline loop then launches and resolves them.
- `state.rally = { day, today: 0, trophies: {}, firstKills: [], total: 0 }`.
- Behemoth entities are spawned into existing worlds on migration (seeded), with no world regeneration. Existing marches are untouched.
- Backup of the v16 save follows the existing backup-on-migrate pattern.

### 3.9 Tests (new "stage 19" block in tests/e2e.mjs, about 35 checks)
- **Migration and spawning:** v16 → v17 migration keeps everything and adds rallies and Behemoths; the Lv 25 boss sits only next to the Citadel.
- **Starting and cancelling:**
  - solo attack on a Behemoth is refused;
  - start-rally charges 20 stamina;
  - the daily limit of 5 is enforced;
  - cancel refunds stamina.
- **Bot joins:** the deterministic join schedule gives 1/5/10 min → 2/3/4 bots; bot power lands within 55–85% of the leader's power; the Rift Warden steps in.
- **Battle and rewards:**
  - the combined battle is deterministic (same seed, same result);
  - casualties only touch your troops, and your wounded go to the Infirmary;
  - rewards and trophy tier match the boss level;
  - first-rally Cores are paid only once;
  - the chapter goal and the hint fire.
- **Resilience:** a reload mid-rally resumes the timer; offline simulation launches and resolves the rally.
- **UI and performance:** the panel fits at 375×667, march lines render, the replay shows the contributions table, there are no page errors, and the FPS sample stays within the stage-18 budget.
- **Regression:** the whole existing suite must stay green, at 1268 checks today.

### 3.10 Art (minimal, painterly gold and teal)
- **Behemoth sprite:** one painted creature on magenta, keyed with the same keylib pipeline. Generated with the built-in image tool at no cost, or failing that a recoloured and upscaled Dusk Wyrm variant as a stopgap.
- **Rally banner/icon:** painted on one small sheet, with a gold frame and teal pennant.
- Trophy icons: 5 tiers on one sheet (or tinted variants of one chest).
- March lines and the countdown are code-drawn. Nothing clean or 3D.

## 4. Open decisions (recommended defaults in **bold**)
1. **Timer options:** **1 / 5 / 10 min**, or full Ants parity with 30 and 60 min added.
2. **Stamina cost:** **20 per rally**, versus 10 like a normal attack.
3. **Daily rally limit:** **5**, versus Ants' 10.
4. **Behemoth as a new rally-only boss, with Wyrms staying soliable**, versus making Wyrms rally-only.
5. **Bot power at 55–85% of the leader** (≈3× combined), so rallies are about 2 levels above your solo level.
6. **Rift Warden NPC fallback at T-3 s: yes.**
7. **Rewards:** **leader keeps full rewards; bots' share shown only in the report**, versus splitting even with bots.
8. **First-rally Cores of +3 per boss level (15 total).** This is a small economy change: it raises lifetime Cores from 24 to 39.
9. **Leader-only for now**, versus also letting you *join* bot-led rallies, which is a stage 19b candidate and adds +1 day.
10. **Behemoth art:** **generated painted sprite**, versus a recoloured Wyrm stopgap.

## 5. Effort estimate (about 4–5 working days of agent time)
| Part | Est. |
| --- | --- |
| Config, Behemoth entity, spawning, v17 migration | 0.5 d |
| WorldService rally API, mergeArmies, BotRallyAgent, offline simulation | 1 d |
| Store: costs, limits, casualty split, rewards, trophies, Cores, goal, hint, mission | 0.75 d |
| UI: boss card, rally panel, HUD chip, map banner and march lines, report table | 1 d |
| Art: Behemoth, rally icon, trophies (key + atlas) | 0.5 d |
| Tests (~35) + full suite + fixes + deploy + screens/stage19-*.png | 0.75–1 d |
