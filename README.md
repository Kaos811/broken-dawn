# Broken Dawn: Stage 3 (World Map Hunts)

Broken Dawn is a sci-fi idle base-builder with auto-battle. It's a mobile web game built with
[Phaser 3](https://phaser.io) and [Vite](https://vitejs.dev), and it uses only free, open-source tools.
**Play it:** https://kaos811.github.io/broken-dawn/ (every push to `main` redeploys automatically via GitHub Actions)

Stage 1 built the playable base: a zoomable top-down map around **The Beacon**, with movable buildings,
upgrades, Base Power and passive Energy. Stage 2 adds the army: troop training, squads and formations,
and the Armory with leaders, gear and a recruitment gacha. Stage 3 adds a separate **World Map**: creatures by level
in rings around your base, squad marches and auto-battles, troop losses with an **Infirmary**, stamina, and an
**Auto** hunt mode that keeps going while you're offline.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173 (with --host, so phones on the same Wi-Fi can open it)
npm run build      # -> dist/ (multi-file) AND broken-dawn.html (single self-contained file)
npm run preview    # serve dist/
npm test           # headless Chromium e2e test (needs a build; CHROME_PATH=/path/to/chrome to override)
                   # `node tests/e2e.mjs --screens` also saves screenshots; ONLY=1|2|3 runs one suite, QUICK=1 skips the dist/ pass
```

`broken-dawn.html` has everything inlined, so you can open it directly from disk or host it
anywhere, including GitHub Pages. `dist/` is the standard build for static hosting.

## Controls (touch first, mouse works too)

| Action | Touch | Mouse |
|---|---|---|
| Pan map | drag empty ground (or quick-swipe anywhere) | drag |
| Zoom | pinch (clamped 0.4x to 1.8x) | wheel |
| Building info | tap a building | click |
| Move a building | **long-press** it, then drag. Or tap it, press **Move**, then drag | same |
| Finish moving | tap empty ground or **Done** | same |

Pans and moves don't get mixed up: a quick swipe that starts on a building still pans the map.
A building only follows your finger after a long-press (0.42 s) or after you choose **Move**.
While you're moving one, the placement grid appears, blocked tiles show red, and the target footprint
turns green or red. Buildings snap to the iso grid, must sit fully on the metal platform, and can't
overlap each other or the Beacon. An invalid drop snaps back. Dragging near a screen edge auto-pans the map.
The Beacon is anchored: long-pressing it just shows "can't be moved".

## What's built

- **Map:** 26×26 isometric grid (2496 px wide, bigger than the screen). A 12×12 metal platform with a gold
  hazard trim and visible thickness sits in the middle, fading into rocky alien terrain with rocks,
  craters and cyan crystals, and a cliff edge around it. Animations: the Beacon's glow pulses, shards orbit it, sparks rise
  from it, energy pulses run along the cyan conduits, and embers drift across the map.
- **The Beacon:** fixed at the centre. It has a level and a charge meter, and charge fills on its own over time.
  To upgrade it you need **full charge plus Energy**. Each upgrade raises Energy income and the building level cap
  (buildings can go up to Beacon level + 2).
- **Command Center, Barracks, Armory:** procedural placeholder art in the palette, each labelled with its
  name and level. Tapping one opens an info panel with name, level, power contribution (now → next), level
  cap, cost, **Upgrade** and **Move**.
- **Power:** `Base Power = Building Power + Troop Power`. Command Center gives +10/level, Barracks +5/level, and the
  Beacon (counted as the Beacon Relay) +15/level. Armory gives 0 for now. Troop Power is wired up (soldiers ×1 plus
  10 per squad level above 1) and reads 0 until stage 2. The HUD shows both parts.
- **Economy:** Energy accrues at `1 + 0.75 × (Beacon level − 1)` per second. Building upgrade costs grow
  geometrically.
- **Save:** localStorage (`brokenDawn.save.v1`) stores building positions, levels, Energy, Beacon level and charge,
  plus troop and squad stubs. It autosaves every 5 s, after every move or upgrade, and when the tab is hidden. Saves are
  sanitized on load. Offline earnings (Energy and charge) are applied on reload, capped at 8 h, with a
  "welcome back" toast.
- **Bottom nav:** Base / Troops / Armory / Squads / Settings. Troops, Armory and Squads show "Coming in stage 2".
  Settings has **Reset Save**, which asks for confirmation.
- **Layout:** designed for portrait 9:16 (720×1280 logical). On taller phones (19.5:9 and up) the height stretches so the HUD and
  nav sit at the real screen edges.

## Building upgrade timers

Upgrading any building (Command Center, Barracks, Armory **and the Beacon**) now takes time (`CONSTRUCTION` in `src/config.js`):

| Upgrade to | Lv 2 | Lv 3 | Lv 4 | Lv 5 | Lv 6 | Lv 7 | Lv 8 | Lv 9 | then |
|---|---|---|---|---|---|---|---|---|---|
| Time | 10 s | 30 s | 2 min | 6 min | 20 min | 1 h | 3 h | 9 h | ×3 per level |

- **One builder** (`CONSTRUCTION.builders = 1`): only one upgrade runs at a time; the others say "Builder busy".
- The Energy cost is **paid up front**. The Beacon still needs a full charge to start, and starting spends it.
- **Cancel** (the panel's Upgrade button turns into *Cancel · refund N*) gives a **full refund** (the Beacon also gets its charge back).
- The new level, its power and its unlocks (lane capacity, squad caps, building cap, Beacon Core reward) apply **only when the timer finishes**.
- Timers keep running offline (same 8 h cap as income); the welcome-back toast lists upgrades that finished.
- A gold progress bar and countdown float over the building on the map, and the info panel shows the time left with a bar.
- Speed-up hook for later (no UI yet): `store.speedUpConstruction(id, seconds)` and `store.speedUpCoreCost(id)` (`CONSTRUCTION.speedUp.secondsPerCore = 300`).
- Save version 5: older saves keep their levels with nothing under construction; the v4 save is kept as `brokenDawn.save.v1.backup-v4`.

## Stage 2: what's built

All numbers live in `src/config.js` (`TROOP_CLASSES`, `BARRACKS`, `SQUADS`, `RESOURCES`, `CORES`, `UPGRADES`, `GACHA`, `LEADERS`, `GEAR`).

- **Troop classes** (procedural portraits in `src/art/portraits.js`):

  | Class | Role | HP | ATK | DEF | Energy | Time (Barracks Lv 1) |
  |---|---|---|---|---|---|---|
  | Sentinel | Frontline wall: T-visor, energy shield, short rifle | 120 | 8 | 14 | 6 | 8 s |
  | Bearer | Main damage: long coat, two-handed weapon, Beacon light | 80 | 18 | 7 | 8 | 10 s |
  | Voyager | Scout/support: hood, cyan eyes, sniper, floating shard | 65 | 13 | 5 | 7 | 9 s |
- **Barracks** (Troops tab, or tap the Barracks → **Train**): **three parallel training lanes**, one per class.
  Sentinels, Bearers and Voyagers all train at the same time, each lane with its own timer, so 10 of each finish in
  the time of the slowest lane (83 s at Lv 2), not the sum (225 s). Each lane holds `10 + 10 × (level − 1)` units
  (its own capacity, not shared), and the speed multiplier `1 + 0.2 × (level − 1)` applies to every lane.
  x1 / x10 / Max (Max = what fits in that class's lane and what you can afford). Energy is paid up front. The
  **Training Lanes** card shows each lane's count, a progress bar, a next-unit timer and an all-done timer, plus
  ✕ to cancel that lane for a full refund (including the unit in progress). Lanes keep running offline
  (same 8 h cap as income). Cards show Ready / Assigned / Owned.
- **Power:** each trained soldier adds 1 Troop Power (assigned or not), plus 10 per squad level above 1.
  `Base Power = Building Power + Troop Power`. The HUD shows both parts; tap the Base Power pill for the full breakdown.
- **Squads** (Squads tab, or tap the Command Center → **Squads**): Alpha is open from the start, Bravo unlocks at Command Center Lv 3,
  Charlie at Lv 5. Squad Details shows power, level, leader, armor, weapon, the 3 formation lines (Front/Middle/Back)
  and the squad's HP/ATK/DEF with buffs applied. **Edit Formation** picks a troop type and count per line, capped at
  your unassigned troops, plus an optional leader. `Squad Power = soldiers + 10 × squad level`. Level-up costs
  `80 × 1.7^(L−1)` Energy + `15 × L` Alloy and is capped at the Command Center level. **Battle** says "Coming in stage 3".
- **Beacon Cores (premium, earned only):** the only currency for recruitment. Cores are never sold and never trickle in
  over time (not online, not offline). New players start with **10** (one x10 pull). Sources (all in `CORES`):
  - **Daily login:** 1 Core per day; every 7th consecutive day pays 1 + 3 = **4**. Missing a day resets the streak.
    Days are local calendar days. A full 7-day streak = 10 Cores.
  - **Beacon level-ups:** **3** Cores for each Beacon level reached (Lv 2, 3, ...), claimable once per level.
  - **First-time milestones** (once each, 9 Cores total): First squad saved (1), Leader in command (1), Barracks Lv 3 (1),
    Command Center Lv 3 (2), Own 50 troops (2), Own 150 troops (2).
  - **Stage 3 hook:** `store.grantCores(n, 'battle')` is the single entry point for every source; `CORES.battle` holds
    placeholder battle rewards.
  Rewards are claimed in the **Beacon Core Rewards** panel: tap the pink Cores counter in the HUD (a red dot means
  something is ready) or **Rewards** in Recruitment. It shows the 7-day streak track, Beacon level rewards, every
  milestone with its status, and **Claim all**.
- **Shards:** start at 500 and now trickle in modestly from the Beacon (10/h at Lv 1, +5/h per level; was 40 + 20).
  They no longer buy pulls. Instead they pay for **leader star-ups** (an alternative to duplicates:
  `40 / 80 / 160 / 300 × current stars` for Common / Rare / Epic / Legendary, up to 5★) and **gear levels**
  (Lv 1 → 5, each level adds +20% of the item's base buff, e.g. Arc Rifle +10% → +12% at Lv 2; costs
  `20 / 40 / 80 / 150 × current level`, applies to every copy). Duplicate leaders past 5★ still give Shards.
- **Alloy** is refined by the Command Center (72/h per CC level). Shards and Alloy accrue offline.
- **Armory** (Armory tab, or tap the Armory → **Recruit**), with three tabs:
  - **Recruitment:** pull x1 = **1 Beacon Core**, x10 = **10 Cores** (pity unchanged). A "How to earn Beacon Cores" panel sits under the pull buttons. Rates are Common 60%, Rare 28%, Epic 10%, Legendary 2%. Pity: an Epic or better within 10
    pulls, a Legendary within 60. 40% of pulls are leaders, 60% gear. There's a card-flip reveal with rarity colors (Epic and Legendary burst)
    and a history of the last 50 recruits. A duplicate leader adds a star (max 5★, each star adds 25% of the base buff), and past 5★
    it converts to Shards (2/5/15/50 by rarity).
  - **Leaders:** a collection grid (unrecruited leaders appear dimmed) with rarity, class affinity, buff and debuff, stars and the squad they lead.
    Tap one for details and to assign it to Alpha, Bravo or Charlie. A leader leads one squad at a time.
    The 11 leaders are Kael and Seren (Legendary), Lyra and Jax (Epic), Vex, Orin and Nova (Rare), and Rook, Dax, Mira and Thane (Common).
  - **Gear:** your inventory, 9 items (armor and weapons, +5% to +25% HP, ATK or DEF). Each squad holds one armor and one weapon.
    Each copy can be equipped once.
- **Saves (v4):** Beacon Cores bumped the save to version 4. Existing Shards stay, every older save gets a one-time
  grant of 10 Cores, and the v3 save is kept as `brokenDawn.save.v1.backup-v3`. Claimed rewards, the login streak and
  gear levels are saved, so nothing can be claimed twice.
- **Saves (v3):** parallel lanes bumped the save to version 3. A v2 save's sequential queue is migrated into the
  lanes: every queued unit moves to its class lane (batches of the same class are summed), the batch that was in
  progress keeps its progress, and Energy, troops and everything else carry over. The v2 save is kept as
  `brokenDawn.save.v1.backup-v2`.
- **Saves (v2):** the save version went from 1 to 2 and migrates automatically. Buildings, levels, Energy and the Beacon carry over,
  and the old save is kept as `brokenDawn.save.v1.backup-v1`. Loaded saves are sanitized: formations are clamped to the troops you own,
  and unknown leaders or gear are dropped.

## Stage 3: World Map hunts

Tap **World** in the bottom nav. The base view sleeps and the World Map takes over (drag to pan, pinch or wheel to zoom 0.25x–1.6x).

- **Map:** a 64×64-tile world with your base in the middle. 40 creatures sit in 4 rings: Zone 1 Lv 1–5 (12 creatures),
  Zone 2 Lv 6–10 (11), Zone 3 Lv 11–15 (9) and Zone 4 Lv 16–20 (8). Level rises with distance, every level 1–20 is
  always present, and a killed creature respawns somewhere in its ring after 10 minutes.
- **Creatures:** Husk Scuttlers (swarm, front line), Rift Drones (hit your back line), Void Hounds (strike first),
  Shard Golems (heavy armor) and a **Dusk Wyrm** elite (boss plus Scuttler brood) on every 5th level.
  Shown power is `20 × 1.2^(Lv−1)`, ×1.25 for elites.
- **Attacking:** tap a creature to open its sheet. It shows your power against its power, your odds, travel time,
  rewards and an attack button per squad. You can attack up to one level above your best kill.
  Each attack costs 10 stamina. The squad first refills its formation from ready reserve troops, marches out
  (5 s + 1 s per tile, max 60 s), auto-battles on arrival, then marches home. Up to 3 squads can be out at once.
  Tap a squad chip that's out to **Recall** it, which refunds its stamina.
- **Battle report + replay:** every fight produces a report card with power, rewards and casualties per class.
  **▶ Watch Replay** re-runs the same seeded battle volley by volley, with HP bars, tracers and damage numbers,
  at 1x/2x/4x speed with Skip. The last 12 reports are in **Reports**.
- **Rewards:** 30 Energy, 4 Alloy and 8 + 2 Shards per level (elites ×1.5). The first kill of each level grants
  Beacon Cores through `grantCores(n, 'battle')`: 1 Core, or 2 for a Wyrm, so 24 Cores across Lv 1–20.
- **Troop losses:** a win costs 10–20% of the troops sent (about 80% wounded, 20% dead). A loss costs 35–60%
  (60/40). The front line takes the most. Dead troops are gone and must be retrained in the Barracks.
  Wounded troops go to the **Infirmary**. Any wounded beyond its free beds die.
- **Infirmary (new building):** you can place and move it, and you upgrade it with the normal timer and single
  builder. It adds +5 Power per level. Beds: 30 + 15 per level. Heal speed: ×(1 + 0.25 per level).
  Healing costs Energy and time per troop: Sentinel 3 E / 4 s, Bearer 4 E / 5 s, Voyager 3 E / 4.5 s.
  It has a queue with progress bars, and ✕ cancels a batch with a full refund. Healed troops rejoin their own
  squad line if that squad is home; otherwise they go to reserve. Healing also runs while you're offline.
- **Healthy troops only:** a squad marches with the troops it actually has. **Refill +n** on the Squads screen,
  or any attack, tops lines back up to the saved formation from reserve. You can't edit a formation while its squad is out.
  The old "losing squad rests 60 s" rule is gone; losses replace it.
- **Stamina:** caps at 100, regenerates 10 per hour, and each attack costs 10. You get +20 from the daily login
  claim, and a Beacon level-up refills it.
- **Auto:** the **AUTO** toggle in the World HUD sends every idle squad at the highest-level creature it
  out-powers by at least 10% (nearest first), until stamina runs out. It stays armed and resumes when stamina
  refills. It keeps hunting **offline**: on load the game simulates the time away in 5 s steps (up to the 8 h
  offline cap), covering marches, battles, casualties, healing and stamina, and the welcome-back toast summarizes the hunts.
- **Saves (v6):** v5 saves migrate automatically, and the old save is kept as `brokenDawn.save.v1.backup-v5`.
  The Infirmary is added on its default tile, or on the first free spot if that tile is taken. Formation lines
  record their saved size, a world is generated, and stamina starts full.

### PvP path (how this goes multiplayer later)

Everything runs locally today, but the world is built to move to a server without rewriting the game:

1. **One generic world state** (`src/world/worldState.js`) holds plain-JSON `entities`, each with `{ id, kind:
   'creature' | 'base', owner, x, y, ... }`, plus `marches` `{ id, owner, squadId, army, from, to, targetId, phase,
   t, travel }`. Creatures belong to `'world'` and your base belongs to `'local'`. Another player's base is just
   another entity with a different owner.
2. **A deterministic, pure battle resolver** (`src/world/battle.js`) has no Phaser, no store and no `Math.random`.
   `resolveBattle(attackerArmy, defenderArmy, seed)` takes plain-data armies (`src/world/armies.js` builds them
   from a squad or a creature) and a seed (`hashSeed(world.seed, march.id, target.id)`). The same inputs always
   give the same result, so a server can compute a fight once and every client can replay it identically.
3. **A world service boundary** (`src/world/worldService.js`): the game only talks to `store.world`, a
   `LocalWorldService` with `entities() / get() / marches() / marchFor() / canSend() / sendMarch() / recallMarch() /
   tick(dt) → events / defenderArmy()`. For PvP, swap in a `RemoteWorldService` with the same methods, backed by a
   server or realtime DB (e.g. Supabase or Firebase): `sendMarch` becomes a request, `tick` becomes a subscription
   that yields the same `battle / home / respawn` events, and the server runs `resolveBattle` with the stored seed
   to stay authoritative. Attacking a player base is `sendMarch` at an entity with `kind: 'base'`;
   `defenderArmy()` already dispatches on the entity kind.
4. **Rewards and casualties stay client-side** in `store.onBattle` (they react to `battle` events), so they need no
   change. For anti-cheat, the server would grant them instead.

## Code layout

```
src/
  main.js              Phaser game config, scene list, window.__BD debug/test hook
  config.js            ALL tuning numbers: power per level, costs, income, map size, zoom, palette
  state/store.js       game state, save/load/migration/offline, upgrades, placement, training,
                       squads, leaders, gear, gacha (seedable RNG), hunts, infirmary, stamina, auto + offline sim
  world/worldState.js  generic world entities + marches, ring generation, respawn spawning (plain JSON)
  world/battle.js      pure deterministic seeded battle resolver + combat power + odds
  world/armies.js      plain-data armies from squads (leader/gear/level buffs) and creatures
  world/worldService.js LocalWorldService: the single boundary for world logic (swap for a remote one for PvP)
  systems/power.js     Base / Building / Troop / Squad power formulas
  art/portraits.js     procedural troop/leader portraits, gear icons, card back (canvas 2D)
  systems/grid.js      iso <-> world math, platform + placement validation
  scenes/BootScene.js  procedural textures (swap for real art later)
  scenes/BaseScene.js  map, camera (pan/pinch/wheel), picking, long-press, drag and snap
  scenes/WorldScene.js World Map: zones, creatures, marches, battle fx, pan/pinch/wheel, tap-to-select
  scenes/UIScene.js    HUD, bottom nav, info panel, move banner, screens, overlays, gacha reveal, toasts, game tick
  ui/world.js          World HUD (stamina, Auto, Reports, squad chips), creature sheet, report card, replay player
  art/creatures.js     procedural creature / world-base / march textures
  ui/widgets.js        buttons, panels, number formatting
  ui/screens/          troops.js (Barracks), squads.js (details, edit formation, pickers), armory.js, infirmary.js, common.js
tests/e2e.mjs          Playwright (playwright-core + system Chrome) e2e test: stage 1, 2 and 3 suites × 2 builds (484 checks)
screens/               screenshots from the test run
```

### Hooks for what's next
- PvP: see **PvP path** above. Player bases are already world entities with an owner.
- Balance knobs for hunts are all in `src/config.js`: `WORLD`, `CREATURES` (incl. per-type `calib`), `BATTLE`,
  `CASUALTIES`, `INFIRMARY`, `STAMINA`, `HUNT_REWARDS`, `CORES.battle`.

## Known gaps

- All art is placeholder (procedural shapes). There's no sound yet.
- The layout height is set when the page loads. Rotating the phone or resizing the window rescales the
  game but doesn't re-layout it, so reload after rotating. It's built for portrait.
- Only tested in headless Chromium with phone emulation (390×844, touch and mouse). It hasn't been tried on a real iPhone or Android device yet.
- Balance numbers are first-pass placeholders. Tune them in `src/config.js`.
- Gear and leader buffs only change squad HP/ATK/DEF (and so World combat power), not Base Power.
- The Squads screen shows two numbers: the stage 2 "Squad Power" (soldiers + level) and the stage 3 "Combat Power"
  used on the World Map. Only Combat Power decides hunts.
- Wins always cost at least 10% casualties, even against a creature far weaker than the squad.
- Offline Auto only starts new marches with the stamina you had plus what regenerated (capped at 8 h), so a
  long absence yields at most about 8–10 hunts. Rewards are credited at battle time, not when the squad gets home.
- The world map is local to this device. Nothing is shared between players yet (see PvP path).
- The bundle is about 1.2 MB (330 KB gzipped), almost all of it Phaser.
