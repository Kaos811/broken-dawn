# Broken Dawn: Stage 1 (Base View)

Broken Dawn is a sci-fi idle base-builder with auto-battle. It's a mobile web game built with
[Phaser 3](https://phaser.io) and [Vite](https://vitejs.dev), and it uses only free, open-source tools.
Stage 1 is the playable base: a zoomable top-down map built around **The Beacon**, with buildings you can move,
upgrades, Base Power, and passive Energy income.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173 (with --host, so phones on the same Wi-Fi can open it)
npm run build      # -> dist/ (multi-file) AND broken-dawn-stage1.html (single self-contained file)
npm run preview    # serve dist/
npm test           # headless Chromium smoke test (needs a build; CHROME_PATH=/path/to/chrome to override)
```

`broken-dawn-stage1.html` has everything inlined, so you can open it directly from disk or host it
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

## Code layout

```
src/
  main.js              Phaser game config, scene list, window.__BD debug/test hook
  config.js            ALL tuning numbers: power per level, costs, income, map size, zoom, palette
  state/store.js       game state, save/load/offline, upgrades, placement rules, event emitter
  systems/power.js     Base / Building / Troop power formulas
  systems/grid.js      iso <-> world math, platform + placement validation
  scenes/BootScene.js  procedural textures (swap for real art later)
  scenes/BaseScene.js  map, camera (pan/pinch/wheel), picking, long-press, drag and snap
  scenes/UIScene.js    HUD, bottom nav, info panel, move banner, modals, toasts, game tick
  ui/widgets.js        buttons, panels, number formatting
tests/e2e.mjs          Playwright (playwright-core + system Chrome) smoke test, 45 checks × 2 builds
screens/               screenshots from the test run
```

### Hooks for stages 2 and 3
- `state.troops` and `state.squads` (`alpha/bravo/charlie: { level, members: [{ type, count }] }`) already exist
  in saves, and `totalTroopPower()` already counts them, so filling them in updates Base Power automatically.
- New tabs: replace the "Coming in stage 2" branch in `UIScene.onTab()` with new scenes.
- New buildings: add an entry to `BUILDINGS` in `config.js` and a texture in `BootScene`.

## Known gaps

- All art is placeholder (procedural shapes). There's no sound yet.
- The layout height is set when the page loads. Rotating the phone or resizing the window rescales the
  game but doesn't re-layout it, so reload after rotating. It's built for portrait.
- Only tested in headless Chromium with phone emulation (390×844, touch and mouse). It hasn't been tried on a real iPhone or Android device yet.
- Balance numbers are first-pass placeholders. Tune them in `src/config.js`.
- The bundle is about 1.2 MB (330 KB gzipped), almost all of it Phaser.
