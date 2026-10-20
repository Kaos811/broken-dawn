# Broken Dawn: Stage 6 (Painted Base & New HUD)

Broken Dawn is a sci-fi idle base-builder with auto-battle. It's a mobile web game built with
[Phaser 3](https://phaser.io) and [Vite](https://vitejs.dev), and it uses only free, open-source tools.
**Play it:** https://kaos811.github.io/broken-dawn/ (every push to `main` redeploys automatically via GitHub Actions)

Stage 1 built the playable base: a zoomable top-down map around **The Beacon**, with movable buildings,
upgrades, Base Power and passive Energy. Stage 2 adds the army: troop training, squads and formations,
and the Armory with leaders, gear and a recruitment gacha. Stage 3 adds a separate **World Map**: creatures by level
in rings around your base, squad marches and auto-battles, troop losses with an **Infirmary**, stamina, and an
**Auto** hunt mode that keeps going while you're offline. Stage 4 adds the **Archive** research tree (Economy,
Military, Healing and World branches) and **troop tiers** T1–T3, with promotion in the Barracks. Stage 5 adds
**sound** (generated music + effects), **polish** (juice, transitions, loading screen, rotation re-layout) and a
skippable 8-step **tutorial** for new players. Stage 6 redesigns the base: a full-screen **painted** map bigger
than the screen, painted building art, buildings that stay **hidden until unlocked** (then you place them), and a
new HUD with commander avatar, left **queue** buttons and right **quick** buttons.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173 (with --host, so phones on the same Wi-Fi can open it)
npm run build      # -> dist/ (multi-file) AND broken-dawn.html (single self-contained file)
npm run preview    # serve dist/
npm test           # headless Chromium e2e test (needs a build; CHROME_PATH=/path/to/chrome to override)
                   # `node tests/e2e.mjs --screens` also saves screenshots; ONLY=1…7 runs one suite, QUICK=1 skips the dist/ pass
```

`broken-dawn.html` has everything inlined, so you can open it directly from disk or host it
anywhere, including GitHub Pages. `dist/` is the standard build for static hosting.

## Controls (touch first, mouse works too)

| Action | Touch | Mouse |
|---|---|---|
| Pan map | drag empty ground (or quick-swipe anywhere) | drag |
| Zoom | pinch (0.42x, or whatever fills the screen, up to 1.6x) | wheel |
| Building info | tap a building | click |
| Move a building | **long-press** it, then drag. Or tap it, press **Move**, then drag | same |
| Finish moving | tap empty ground or **Done** | same |

Pans and moves don't get mixed up: a quick swipe that starts on a building still pans the map.
A building only follows your finger after a long-press (0.42 s) or after you choose **Move**.
While you're moving one, the placement grid appears, blocked tiles show red, and the target footprint
turns green or red. Buildings snap to the iso grid, must sit fully inside the base area, and can't
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
- **Bottom nav:** Base / Troops / Armory / Squads / Settings (stage 1; see the v0.6.0 redesign below: Settings now lives
  under More). Settings has **Reset Save**, which asks for confirmation.
- **Layout:** designed for portrait 9:16 (720×1280 logical). On taller phones (19.5:9 and up) the height stretches so the HUD and
  nav sit at the real screen edges.

## Building upgrade timers

Upgrading any building (Command Center, Barracks, Armory **and the Beacon**) now takes time (`CONSTRUCTION` in `src/config.js`):

| Upgrade to | Lv 2 | Lv 3 | Lv 4 | Lv 5 | Lv 6 | Lv 7 | Lv 8 | Lv 9 | Lv 10 | Lv 11 | Lv 12 | Lv 13 | Lv 14 | Lv 15–20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Time | 10 s | 30 s | 2 min | 6 min | 20 min | 1 h | 3 h | 4h 48m | 7h 41m | 12h 17m | 19h 40m | 31h 27m | 50h 20m | 72 h (cap) |

(Stage 10: ×1.6 per level after Lv 8, no single upgrade over 72 h. Before that it was ×3 per level, which made Lv 12+ take weeks. Rapid Assembly research still shortens all of these.)

- **One builder** (`CONSTRUCTION.builders = 1`): only one upgrade runs at a time; the others say "Builder busy".
- The Energy cost is **paid up front**. The Beacon still needs a full charge to start, and starting spends it.
- **Cancel** (the panel's Upgrade button turns into *Cancel · refund N*) gives a **full refund** (the Beacon also gets its charge back).
- The new level, its power and its unlocks (lane capacity, squad caps, building cap, Beacon Core reward) apply **only when the timer finishes**.
- Timers keep running offline (same 8 h cap as income); the welcome-back toast lists upgrades that finished.
- A gold progress bar and countdown float over the building on the map, and the info panel shows the time left with a bar.
- Speed-ups: see Stage 10 below.
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

## Stage 4: Research & troop tiers

### Archive (research)
- **Archive** is a new building (violet spire, default tile 8,8). It is **sealed until Beacon Lv 3**: it sits on the
  map greyed out with a 🔒 label, gives no Power, and can't be upgraded or used. Once unsealed it gives +5 Power per level
  and upgrades like any other building.
- **One research slot.** Tap the Archive → **Research** to open the tree. Research runs in real time, offline too,
  and can be cancelled for a full refund. A ◆ marker shows on the Archive while a project runs.
- **Node level ≤ Archive level.** Every node has Lv 1–5. Costs are 150 Energy / 20 Alloy / 30 Shards × 1.7 per level,
  and times are 30 s, 2 m, 8 m, 30 m, 2 h. Research uses no Cores. Research doesn't add Base Power; it changes stats.

| Branch | Node | Effect per level |
|---|---|---|
| Economy | Beacon Harmonics / Alloy Refining / Shard Resonance | Energy +4% / Alloy +5% / Shards +5% income |
| Economy | Rapid Assembly | building upgrade speed +5% |
| Military | Shield / Lance / Rift Drills | Sentinel / Bearer / Voyager-class HP and ATK +3% (all tiers of that class) |
| Military | Drill Cadence | training speed +5% |
| Military | Tier II Protocols (1 level) | unlocks T2 + promotion. Needs Barracks Lv 5 + Archive Lv 3. 1,500 E / 200 A / 150 S, 20 m |
| Military | Tier III Protocols (1 level) | unlocks T3. Needs Barracks Lv 9 + Archive Lv 5 + Tier II. 8,000 E / 900 A / 600 S, 2 h |
| Healing | Field Cots / Triage | Infirmary beds +10% / heal speed +8% |
| Healing | Med Synthesis / Stabilizers | heal cost −5% / share of losses that die −5% |
| World | Stamina Cells / Recovery Loop | stamina cap +10 / regen +1 per hour |
| World | Rift Striders / Salvage Protocols | march speed +5% / hunt rewards +5% |

Speed bonuses divide the time by (1 + bonus). All bonuses come from one pure function, `researchMods(state)` in
`src/systems/research.js`. Production, build/train timers, the Infirmary, stamina, marches, loot and combat stats
all read from it, both live and in the offline simulation.

### Troop tiers
Each tier is its own unit, so every tier has its own count, wounded pool and portrait (tier chevrons on the badge).
T1 keeps the old class id (`sentinel`, `bearer`, `voyager`), so old saves and formations keep working.

| Class | T1 | T2 | T3 |
|---|---|---|---|
| Frontline Wall | Sentinel | Bulwark | Aegis |
| Main Damage | Bearer | Lancer | Sunbreaker |
| Scout / Support | Voyager | Phantom | Riftwalker |

| Tier | HP / ATK | DEF | Energy cost | Alloy | Train time | Power | Heal cost / time |
|---|---|---|---|---|---|---|---|
| T1 | ×1 | +0 | ×1 | 0 | ×1 | 1 | ×1 / ×1 |
| T2 | ×1.6 | +6 | ×2.2 | 2 | ×1.8 | 2 | ×2 / ×1.5 |
| T3 | ×2.5 | +12 | ×4.5 | 6 | ×3 | 4 | ×4 / ×2.2 |

- **Barracks:** each class card has T1/T2/T3 buttons (🔒 until researched). Train any unlocked tier directly, or
  **Promote** ready troops one tier up (T1→T2, T2→T3). Promotion costs the difference in cost and takes 60% of the
  higher tier's train time. Promoted troops leave your army while they're queued, so Troop Power dips until they
  finish. Cancelling refunds the cost and gives the troops back. There's one lane per class and one job per lane
  (train or promote).
- **Leaders are locked to one squad:** a leader leading another squad shows greyed out with "🔒 In Bravo" in the
  picker and can't be picked, and `store.assignLeader` rejects it (no silent steal). Unassign it there first. A squad
  can always clear or swap its own leader. Gear was already locked per copy (`gearFree`).
- **Formations:** one unit per line. Pick the class, then the tier (T1/T2/T3 chips) for that line.
- **Battle:** class behaviour (the Sentinel front wall, leader targeting) follows the class, not the tier, so T2/T3
  fight like their T1 class but with bigger stats. The army stays plain data (`{ type, cls, tier, tags, count, hp,
  atk, def }`) and `resolveBattle` is unchanged and deterministic, so PvP stays a drop-in.
- **Saves (v7):** v6 saves migrate automatically, and the old save is kept as `brokenDawn.save.v1.backup-v6`.
  The Archive is added (sealed or Lv 1), research starts empty, and Barracks lanes gain a unit field.
  Invalid or impossible research/lane jobs are refunded on load.

## Stage 5: Sound, polish & tutorial

### Sound (no audio files)
- Everything you hear is synthesized at runtime with WebAudio (`src/audio/audio.js`): no downloads, nothing to
  license, and about 10 KB of code. Sound effects are small jsfxr-style recipes; music is a tiny step sequencer.
- **Music per screen**, crossfading over 0.5 s: calm detuned pads + bells on the **Base**, arpeggios + light
  drums on the **World map**, full drums + bass during a **battle replay**.
- **Effects:** button taps (and a dull "nope" on disabled buttons), screen open, build start, level-up, training,
  research done, per-card recruit reveal (bigger for Epic/Legendary), march out, hits/crits in replays,
  victory/defeat, healing, rewards/Cores, toasts. Bursts are de-duplicated so offline catch-up stays quiet.
- **Settings:** Music and Effects volume (10% steps), Mute, and Haptics. Defaults: music 70%, effects 90%,
  haptics on. Saved per device.
- **Browser rules:** audio starts on the first tap (mobile autoplay unlock) and the context is suspended while
  the page is hidden, then resumed.
- **Haptics** use `navigator.vibrate` where supported (Android Chrome; iOS Safari ignores it): button taps,
  level-ups, Epic+ reveals, crits, tutorial steps.

### Polish
- **Buttons** squash on press and spring back; floating numbers pop for rewards, Cores and troop power.
- **Level-ups:** spark burst, ground shockwave ring, light column and a small camera shake.
- **Construction:** buildings being upgraded get scaffolding (poles, hazard-striped planks, braces, a blinking
  beacon) with welding sparks, on top of the countdown bar.
- **Battle replay:** hit numbers pop in (crits bigger), impact sparks, row flashes, kill flashes on icons,
  camera shake on crits/big kills, round counter pulse, a victory burst and an Energy pop-up. Speed 1x/2x/4x + Skip.
- **Report card:** rewards count up, with +Energy / +Core pop-ups for fresh reports.
- **Transitions:** screens fade in (no sliding, so taps always land on what's drawn); Base ↔ World fades.
- **Loading screen** (pure CSS, in `index.html`) until the game is ready; it never blocks input.
- **Squads** now label both numbers: **Squad Power · Base** (feeds Base Power) and **Combat Power · Hunts**.
- **Rotation:** if the screen shape changes a lot (phone rotated, window resized), the game saves and reloads
  itself after 0.6 s so it's laid out for the new shape.
- **Phones:** after 8 s without input (and nothing animating) the game drops to ~30 fps; any tap restores full rate.
- **Text overlap sweep:** the stage 5 test walks every screen and overlay and fails if any two labels overlap or
  a label runs under a button.

### Tutorial (new players)
Eight action-driven steps, each advancing only when you actually do it, with a coach card and a pulsing gold
pointer (the camera glides to off-screen buildings):

1. **Beacon:** tap it. 2. **Build:** tap the Barracks, then Upgrade. 3. **Train:** Troops → x10 Sentinels.
4. **Squad:** Squads → Edit Formation → Max → Save (the first batch is rushed for you). 5. **Recruit:** Armory → Pull x1.
6. **Hunt:** World → tap a creature → Attack. 7. **Infirmary:** open it from the Base. 8. **Research:** tap the Research queue button (left column).

- If a step could get stuck it tops you up quietly (Energy for the upgrade/training, a Core for the pull,
  stamina for the hunt). Finishing pays **+500 Energy and +2 Beacon Cores** once.
- **Skip** on every step; **Replay Tutorial** in Settings.
- **Saves (v8, stage 5):** v7 saves migrate automatically (backup `brokenDawn.save.v1.backup-v7`), get the default audio
  settings, and have the tutorial marked **done**, so existing players aren't interrupted; they get a one-time
  toast pointing to Replay in Settings. New games start the tutorial.

## Stage 6: Painted base & new HUD

- **Full-screen base:** a 44×44 iso map (ground 2480×3040 px, ~6× the screen) that always fills the screen. You
  can't zoom or pan past the painted ground, so there's no void. Terrain (painted ground tile, flagstone paths, a
  compacted base area, a glowing plaza round the Beacon, a vignette) is baked once into a half-res texture.
  Painted crystals, plants and rocks are scattered outside the base, with small details inside that hide under buildings.
- **Painted art:** Command Center, Barracks, Armory, Infirmary, Archive and the Beacon are painted sprites. All
  art is 20 WebP files, about 0.5 MB in total, in `src/art/base/` (see `src/art/baseArt.js`). The source JPGs were keyed off
  their magenta backgrounds, despilled, cropped and resized by `artwork/process.py` (outside the repo).
- **Buildings:** each has a name plate with a round level badge, construction scaffolding and an upgrade
  progress bar. Tap one to open its panel. They're still movable (long-press, or **Move**) with grid snapping
  and collision. The Beacon (4×4) stays fixed at the centre.
- **Hidden until unlocked:** the Archive doesn't exist on the map until Beacon Lv 3. When the upgrade finishes,
  a toast says it's unlocked and the game enters **placement mode** at a suggested free spot. Drag it (or tap
  the ground) to choose a spot, then **Place**. **Later** puts it away, and a "🏗 New: build the Archive" chip
  waits under the top bar.
- **HUD:**
  - Top bar: commander avatar (tap for the Power breakdown) with a Beacon-level badge, **Power**, the Beacon
    pill, and resource counters.
  - Left column: queue buttons **Builder**, **Research**, **Training** and **Healing**, each with a live timer
    and a progress ring. Each one jumps to the right building or screen.
  - Right column (stage 6): Hunt, Rewards, Armory, Events. The v0.6.0 HUD redesign (below) moved these into
    the World tab, the Cores **+**, the Armory tab and the More sheet.
- **Tutorial:** step 8 is now "tap the Research button". Before Beacon Lv 3 it explains where research comes from.
- **Saves (v9):** v8 saves migrate automatically (backup `brokenDawn.save.v1.backup-v8`). Buildings on their
  old default tiles move to the new defaults. Moved buildings keep their direction from the Beacon (scaled
  ×1.75 to the bigger map), and any that end up on an invalid spot snap to the nearest free one. An Archive that's
  already unlocked stays placed; a locked one is hidden.

## v0.6.0: HUD & nav redesign

Built from the approved mockup and adapted for portrait phones.

- **Top HUD:** commander portrait in a gold ring with the commander-level badge (tap it for the Power
  breakdown), a gold beveled **Power** plaque with a shield, and a **Beacon Cores** pill on the right whose
  **+** opens the rewards (a red badge counts rewards ready to claim). Beacon level and charge sit in a small
  gauge under the portrait; tap it to jump to the Beacon. Below that is a slim row of glass resource capsules:
  Energy (with its rate), Alloy, Shards and Troops. Tap a capsule for a tooltip that says where the resource
  comes from.
- **Bottom nav:** a sculpted gunmetal bar with gold filigree and illustrated icons. Tabs: **World** (planet globe),
  **Troops**, [**Base** emblem, the large centre button: a gold medallion with a glowing beacon fortress],
  **Armory**, **Squads**, **More**. The game opens on Base. The active tab is raised and glows gold; the Base
  emblem lights up instead.
- **Red badges:**
  - Troops: troops trained or healed since you last looked.
  - Armory: **!** when your Cores can buy at least one recruit.
  - More: rewards ready to claim.
  - Base (on the emblem): a building waiting to be placed.
- **More** opens a sheet with Settings, Rewards, Power, Leaders, Research and Events (coming soon). Research and Events
  have illustrated icons (holographic flask orb, gold star medallion); the left-column Research queue button
  uses the same flask orb. The nav stays usable while the sheet is open.
- **Safe areas:** with `viewport-fit=cover`, the HUD and nav grow by the notch and home-indicator insets
  (`src/ui/layout.js`). Tested at 390×844 (with and without insets), 360×640, 375×667 and 430×932.
- **Art:** 12 WebP icons (~77 KB) in `src/art/ui/`. They were keyed from the magenta (nav) and green (HUD)
  sheets by `artwork/process_ui.py` (outside the repo). The HUD and nav chrome is drawn once and baked into
  textures.

## Stage 8 (v0.7.0): Daily Missions & Events

Built from the approved plan (`docs/stage8-plan.md`). Save **v10**: v9 saves migrate automatically (today's
missions start fresh, nothing back-dated, backup `brokenDawn.save.v1.backup-v9`).

### Daily Missions
- **Missions** button (clipboard) on the right edge, after the tutorial. It shows activity points (`35/100`) and a
  red badge for tasks and chests ready to claim. A one-time pointer shows it to you right after the tutorial.
- 7 tasks, counted from real actions (offline ones count toward the day you come back):

  | Task | Points |
  |------|--------|
  | Claim the daily reward | 10 |
  | Defeat 8 creatures (offline Auto-hunts count) | 20 |
  | Train or promote 30 troops (counted when they finish) | 15 |
  | Start a building upgrade | 15 |
  | Start a research (before the Archive: raise a leader star or gear level) | 15 |
  | Heal 10 wounded troops | 15 |
  | Win a hunt at your top level (or 1 below) | 20 |

- Claim a task to bank its points. **Activity chests** (L = Beacon level):
  - 20 (bronze): Energy 300×L
  - 40 (bronze): Alloy 40×L + Stamina 10
  - 60 (silver): Shards 60
  - 80 (silver): Energy 600×L + Stamina 20
  - 100 (gold): **1 Beacon Core** + Shards 100
- Each task has a **Go** button that jumps to where it's done.
- **Reset at local midnight.** If midnight passes while playing, missions reset with a toast. Finished tasks and
  reached chests that weren't claimed are **paid automatically**. Missions reset only when the day number goes up,
  so setting the clock back never resets twice. A DST change shifts midnight but never counts a day twice.

### Events
- `src/events/eventService.js`: `LocalEventService` turns a fixed **weekly UTC calendar** into event instances
  (`beacon-surge-2026-W43`), so every player sees the same windows, shown in local time. A server-driven service can
  replace it (same `active / next / weekId / weekEnds / report` interface) for PvP and online leaderboards.
- **Beacon Surge**, Mon 00:00 to Thu 00:00 UTC:
  - Building upgrade finished: 100 × new level.
  - Research level finished: 80 × new level.
  - Troop trained: 2 × its tier.
  - Milestones at 500 / 1,500 / 3,000 / 6,000 / 10,000.
- **Rift Hunt**, Fri 00:00 to Mon 00:00 UTC:
  - Creature defeated: 10 × its level (elites ×2, offline Auto-hunts count).
  - Milestones at 300 / 1,000 / 2,000 / 3,500 / 5,000.
- **Thursday** is a rest day: the Event button counts down to the next event.
- **Milestone rewards** (every event):
  - Energy 400×L + Alloy 50×L
  - Shards 80
  - Stamina 30 + 10 Marks
  - **1 Core** + Energy 1,000×L
  - **1 Core** + Shards 150 + 20 Marks
- **Rift Marks:** +1 per 50 event points, paid as you score.
- **When an event ends:** reached but unclaimed milestones are paid automatically, with a summary popup.
- **Clock safety:** event time is the latest clock reading the save has seen, so setting the clock back can't
  reopen an ended event.
- **Where it shows:**
  - The right-edge **Event** button: the Events star medallion, the live event's name, a countdown, and a badge for
    milestones ready to claim. It gets a one-time pointer the first time an event is live.
  - **More → Events** (no longer "coming soon") opens the **Events hub**: banner, countdown, points and Marks, how
    to score, the milestone track, the next event (local time), and the Exchange.
- **Rift Exchange** (open all week, limits refresh Monday 00:00 UTC):

  | Item | Price | Limit/week | Reward |
  |------|-------|-----------|--------|
  | Energy crate | 20 | 5 | 2,000×L Energy |
  | Alloy crate | 25 | 5 | 250×L Alloy |
  | Stamina cell | 30 | 3 | +50 Stamina |
  | Gear upgrade crate | 40 | 3 | 200 Shards |
  | Beacon Core | 200 | 1 | 1 Core |

### Balance (Beacon Cores stay scarce)
- **A fully active week = 22 Cores:**
  - Daily login: 10.
  - Missions: 7 (only the 100-point chest pays one).
  - Events: 4 (2 per event, milestones 4 and 5).
  - Exchange: 1.

  This was ~10 before stage 8. The stage 8 test plays a simulated week and checks every Core source.
- A casual player who fills half the chests and reaches event milestone 3 gets ~10–12. Gacha pity is unchanged.
- **Rift Marks:** an active hunter earns ~150 a week from Rift Hunt alone. Heavy builders can earn more in Beacon
  Surge (100 × level per upgrade adds up). Extra Marks only buy resource crates (weekly limits): the Core stays
  capped at 1 a week.
- Every number is in `src/config.js` (`MISSIONS`, `EVENTS`). Every Core still goes through `grantCores(n, source)`
  (sources `missions`, `event`, `exchange`).

### Art
- Painted icons, keyed off green by `tools/process_stage8.py`:
  - Missions clipboard
  - Rift Mark coin
  - Exchange stall
  - Stamina orb (now also in the World HUD instead of the drawn bolt)
  - Bronze, silver and gold chests, each closed and open
  - Two event banners, cropped to 3:1 and darkened on the left for the title

## Stage 10 (v0.8.0): Speed-ups

Plan: `docs/stage10-plan.md`. Config: `SPEEDUPS` in `src/config.js`; logic: `src/systems/speedups.js` (mixed into the store); UI: `src/ui/speedups.js`.

- **Items:** 1m, 5m, 15m, 1h, 3h, 8h, 24h. Stack, never expire. Work on **construction and research only**.
- **Free finish:** any timer (construction, research, a training lane, the healing queue) with **5:00 or less** left finishes free. The panel button turns gold **Free**; the Builder/Research side timers read FREE.
- **Core finish:** construction/research 1 Core per 5 min for the first hour, then 1 per 15 min (8 h = 40); training/healing 1 per 10 min (min 1). A confirm appears at **5+ Cores**. Cores are still earned only.
- **Picker** (Speed Up button on the building panel and the Archive project): live countdown, **Auto-use** (fewest items that cover the time, at most 5 min wasted, with a preview), one row per item with Use / Use ×N, and Finish now (Free or N Cores).
- Barracks: tap a busy lane to finish it (its timer turns gold when it's free). Infirmary: **Finish** on the healing queue. Both offer Free/Core only.
- **More → Items:** the inventory.
- **Sources:** daily mission chests (20: 5m · 40: 15m · 60: 2× 5m · 80: 1h · 100: 15m), daily login 15m (+3h on every 7th day in a row), event milestones (15m · 2× 15m · 1h · 3h · 8h, both events), Rift Exchange (5m ×10 for 5 Marks, 1h ×3 for 30, 8h ×1 for 120, weekly), Beacon level rewards (1h each, +8h at Lv 5, +24h at Lv 10), and 3× 5m with the first upgrade.
- **Save v11:** adds an empty inventory. Running timers stay valid: progress is kept, and a running upgrade's total only shrinks to the new flatter time (never grows). The v10 save is kept as `brokenDawn.save.v1.backup-v10`.
- **Icons:** clean placeholder hourglass tiles drawn in the gold/teal kit (`su-icon-<id>`). Painted art can replace them by loading textures `item-su-m1` … `item-su-h24`.
- Tests: `ONLY=10 npm test`; layout of the picker, Items, lane finish and the upgrading panel is in the stage 9c 6-size check. Screens: `screens/stage10-*.png` (`node tools/shots10.mjs`).

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
  systems/research.js  research levels, Archive seal, researchMods() (every research bonus in one pure function)
  art/baseArt.js       painted base art (WebP imports, sprite sizes/origins); art/base/*.webp
  art/uiArt.js         HUD + nav icons; art/ui/*.webp
  ui/layout.js         HUD/nav sizes + safe-area insets
  art/portraits.js     procedural troop/leader portraits, gear icons, card back (canvas 2D)
  systems/grid.js      iso <-> world math, platform + placement validation
  scenes/BootScene.js  procedural textures + preload of the painted base art
  scenes/BaseScene.js  baked painted terrain, decorations, camera (pan/pinch/wheel), picking, long-press, drag, placement
  scenes/WorldScene.js World Map: zones, creatures, marches, battle fx, pan/pinch/wheel, tap-to-select
  scenes/UIScene.js    HUD, bottom nav, info panel, move banner, screens, overlays, gacha reveal, toasts, game tick
  ui/world.js          World HUD (stamina, Auto, Reports, squad chips), creature sheet, report card, replay player
  art/creatures.js     procedural creature / world-base / march textures
  ui/stage8.js         Missions + Event buttons (right edge), Daily Missions screen, Events hub, Rift Exchange, event summaries, one-time pointers
  systems/missions.js  daily missions (store mixin): track() hook, local-midnight roll-over + auto-pay, chests, grantBundle
  systems/events.js    events (store mixin): scoring, milestones, Rift Marks, settlement, Rift Exchange
  events/eventService.js weekly UTC event calendar (LocalEventService; swap for a server-driven one)
  ui/widgets.js        buttons (with press juice + click sound), panels, number formatting
  audio/audio.js       WebAudio engine: synthesized SFX recipes, generated per-screen music, crossfade, unlock, haptics
  tutorial/tutorial.js 8-step guided tutorial: coach card, pointer, step detection, assists, skip/replay
  ui/screens/          archive.js (research tree), troops.js (Barracks, tiers, promote), squads.js (details, edit formation, pickers), armory.js, infirmary.js, common.js
tests/e2e.mjs          Playwright (playwright-core + system Chrome) e2e test: stage 1–8 suites × 2 builds (1070 checks)
screens/               screenshots from the test run
```

### Hooks for what's next
- PvP: see **PvP path** above. Player bases are already world entities with an owner.
- Balance knobs for hunts are all in `src/config.js`: `WORLD`, `CREATURES` (incl. per-type `calib`), `BATTLE`,
  `CASUALTIES`, `INFIRMARY`, `STAMINA`, `HUNT_REWARDS`, `CORES.battle`, and for stage 4 `RESEARCH`,
  `RESEARCH_TUNING`, `TIERS`, `PROMOTE`, for stage 5 `AUDIO`, `PERF`, `TUTORIAL`, and for stage 8 `MISSIONS`, `EVENTS`.
- Events online: implement the `LocalEventService` interface against a server (`report(id, points)` for rankings).

## Known gaps

- Base art is painted. World map creatures, portraits and icons are still procedural. Music and sound effects are generated (synth), not recorded.
- Rotation re-layout works by saving and reloading the page (about a second). It's built for portrait; landscape
  works but is letterboxed.
- Haptics do nothing on iPhones (Safari has no `navigator.vibrate`).
- Only tested in headless Chromium with phone emulation (390×844, touch and mouse). It hasn't been tried on a real iPhone or Android device yet.
- Balance numbers are first-pass placeholders. Tune them in `src/config.js`.
- Gear and leader buffs only change squad HP/ATK/DEF (and so World combat power), not Base Power.
- Wins always cost at least 10% casualties, even against a creature far weaker than the squad.
- Offline Auto only starts new marches with the stamina you had plus what regenerated (capped at 8 h), so a
  long absence yields at most about 8–10 hunts. Rewards are credited at battle time, not when the squad gets home.
- The world map is local to this device. Nothing is shared between players yet (see PvP path).
- Only one research slot, and research can't be sped up with Cores yet (`store.speedUpResearch` exists as a hook).
- Tier Power (1/2/4) feeds Troop Power; research bonuses don't show up in Base Power.
- The JS bundle is about 1.4 MB (≈400 KB gzipped), almost all of it Phaser. Stage 6 adds ~0.5 MB of WebP art
  (separate files in `dist/`, inlined as base64 in `broken-dawn.html`, which is ~2.1 MB).
