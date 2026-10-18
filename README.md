# Broken Dawn: Stage 2 (Troops, Squads, Armory)

Broken Dawn is a sci-fi idle base-builder with auto-battle. It's a mobile web game built with
[Phaser 3](https://phaser.io) and [Vite](https://vitejs.dev), and it uses only free, open-source tools.
**Play it:** https://kaos811.github.io/broken-dawn/ (every push to `main` redeploys automatically via GitHub Actions)

Stage 1 built the playable base: a zoomable top-down map around **The Beacon**, with movable buildings,
upgrades, Base Power and passive Energy. Stage 2 adds the army: troop training, squads and formations,
and the Armory with leaders, gear and a recruitment gacha.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173 (with --host, so phones on the same Wi-Fi can open it)
npm run build      # -> dist/ (multi-file) AND broken-dawn.html (single self-contained file)
npm run preview    # serve dist/
npm test           # headless Chromium e2e test (needs a build; CHROME_PATH=/path/to/chrome to override)
                   # `node tests/e2e.mjs --screens` also saves screenshots; ONLY=2 runs just the stage-2 suite
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

## Code layout

```
src/
  main.js              Phaser game config, scene list, window.__BD debug/test hook
  config.js            ALL tuning numbers: power per level, costs, income, map size, zoom, palette
  state/store.js       game state, save/load/migration/offline, upgrades, placement, training,
                       squads, leaders, gear, gacha (seedable RNG), event emitter
  systems/power.js     Base / Building / Troop / Squad power formulas
  art/portraits.js     procedural troop/leader portraits, gear icons, card back (canvas 2D)
  systems/grid.js      iso <-> world math, platform + placement validation
  scenes/BootScene.js  procedural textures (swap for real art later)
  scenes/BaseScene.js  map, camera (pan/pinch/wheel), picking, long-press, drag and snap
  scenes/UIScene.js    HUD, bottom nav, info panel, move banner, screens, overlays, gacha reveal, toasts, game tick
  ui/widgets.js        buttons, panels, number formatting
  ui/screens/          troops.js (Barracks), squads.js (details, edit formation, pickers), armory.js, common.js
tests/e2e.mjs          Playwright (playwright-core + system Chrome) e2e test: stage 1 + stage 2 suites × 2 builds (336 checks)
screens/               screenshots from the test run
```

### Hooks for stage 3
- `store.squadStats(id)` returns each squad's total HP/ATK/DEF with leader and gear buffs applied, ready for auto-battle.
- Per-soldier base stats are in `TROOP_CLASSES`. Squads have three ordered lines (Front/Middle/Back).
- Battle and Maps are placeholders ("Coming in stage 3") in Squad Details and Settings.

## Known gaps

- All art is placeholder (procedural shapes). There's no sound yet.
- The layout height is set when the page loads. Rotating the phone or resizing the window rescales the
  game but doesn't re-layout it, so reload after rotating. It's built for portrait.
- Only tested in headless Chromium with phone emulation (390×844, touch and mouse). It hasn't been tried on a real iPhone or Android device yet.
- Balance numbers are first-pass placeholders. Tune them in `src/config.js`.
- Troops are never lost yet (that comes with battles), so the only Troop Power limit is the per-lane training cap.
- Gear and leader buffs only change squad HP/ATK/DEF (used in stage 3), not Base Power.
- The bundle is about 1.2 MB (330 KB gzipped), almost all of it Phaser.
