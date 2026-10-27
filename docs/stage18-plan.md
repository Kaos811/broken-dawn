# Stage 18 plan: an Ants-style world map (no zones, distance gradient, teleport)

Status: **plan only, not built.** Requested by Jason (owner, Oct 27): "get rid of the zones and have the
creatures random, but stronger ones near the citadel and weaker further away. Also being able to teleport,
right now for free. Later we will have teleport items or use a resource to teleport. We need to get the
world map closer to what Ants is like."

## 1. How The Ants: Underground Kingdom does it (research)

| Topic | Ants | Source |
|---|---|---|
| Difficulty layout | No hard zones for hunting. Wild creatures and resource tiles get **stronger toward the centre** ("land of abundance", the big square with the tree). At the map edge, a search for Lv 6+ says *"Target not found near your ant hill"*. Lv 7–8 tiles only sit near the very middle. | r/theantsundergroundkd "Higher level creatures" (2021) |
| Creatures | Scattered at random, each with a level. You have to beat a level before you can attack the next one. The biggest ones (lizards, frogs) need a rally. | levelwinner guide; NamuWiki §2.8 |
| Search | A **search button** on the world map: pick a creature type and level, then it jumps the camera to the nearest match near your hill, or says "Target not found near your ant hill". The searchable level rises as you win. | levelwinner; r/ants thread; same pattern as Map Finder in comparable 4X games |
| Gathering tiles | Have levels; higher ones hold more and take longer. Richer ones sit toward the centre. | levelwinner; Reddit |
| Teleport types | **Advanced (targeted) teleport**: tap an empty tile, Teleport, confirm; costs an item (2,000 Diamonds or alliance-store points, or event drops). **Random teleport**: an item that drops you somewhere random in your region, can land near enemies. **Alliance teleport**: free on joining, lands in alliance territory. **Newbie teleport**: change server, only in the first 3 days, below Queen Lv 5. | Fandom wiki "Advanced Teleport"; Pillar of Gaming guide; appgamer |
| Teleport rules | **No teleporting while troops are out on the map** (they must be home or garrisoned). You can't land on another alliance's territory or an occupied tile. Gated regions need their pass captured first. | Pillar of Gaming; RoK/Ants-style guide video |
| Cooldown | No cooldown documented for normal teleports; the item cost is the limiter. | (none found) |
| Coordinates | Every tile has X:Y coordinates; players share coords; tapping a tile shows them. | general guides |

**What this means for us:** levels come from one smooth gradient by distance to the centre, not bands; creatures spawn
at random; finding targets is done with Search; moving is done with a teleport that costs nothing today but is item-gated later and
needs all marches home.

## 2. Our world map today (v0.12.0, `src/config.js` WORLD, `src/world/worldState.js`, `worldService.js`, `WorldScene.js`)

- **Map:** 86×86 tiles of 72 px. The **Rift Citadel** is at the centre (43,43), locked, with radius 5 and no creatures within about 7 tiles.
- **Your base:** fixed at **(43,78)**, the south edge, about 35 tiles from the centre. `BASE_POS` is a constant used for march times, node
  placement and the tutorial; `sanitizeWorld` forces the base back there on every load.
- **4 hard zones** (`WORLD.rings`, measured as tile distance from the centre):

  | Zone | Distance | Levels | Creatures |
  |---|---|---|---|
  | 1 | 29–37 | 1–5 | 16 |
  | 2 | 21–28 | 6–10 | 12 |
  | 3 | 14–20 | 11–15 | 9 |
  | 4 | 7–13 | 16–20 | 7 |

  Inside a ring the level rises toward the centre (`ringLevel`). Every level in a ring is guaranteed once, and the rest are random.
  Outer rings are **clumped toward your side** of the Citadel (the angle spread is narrow for Zone 1 and about ±54° for Lv 1), so the map is
  not random scatter.
- **Elites:** every 5th level is a Dusk Wyrm. Creature type is otherwise random among 4 normals.
- **Respawn:** a killed creature returns after 10 min, "somewhere else in its ring" (`respawns: [{ring, at}]`). Nothing ever despawns.
- **Drawn on the map:** gold circles at each ring edge (the inner one is red) plus labels **"ZONE n · Lv a–b"**, and two dark
  shadow discs. The attack sheet says **"Zone n"**.
- **Alloy nodes (stage 16):** 12 nodes, Lv 1–5. The level comes from distance **from your base** (bands 3–7 … 20–26 tiles), mostly
  north of the base. A drained node regrows in place after 30 min.
- **Bot bases:** 14 seeded neighbours. The higher the level, the closer to the centre, biased to your side. PvP is refused ("coming with alliances").
- **Marches:** 5 s + 1 s per tile, max 60 s each way. In the tutorial the first hunt is shortened to about 5 s each way. 3 marches max (one per squad).
- **Rules kept as they are:** attack up to best kill + 1 (`levelHeadroom`); Auto attacks only targets it out-powers by 10%.
- **Not present:** teleport, search, coordinates in the UI, a separate "go to my base" button (`focusBase()` exists but is only
  used by code).

## 3. The plan

### 3.1 Remove zones: one smooth difficulty gradient
- Replace `WORLD.rings` with `WORLD.gradient = { inner: 8, outer: 40, minLevel: 1, maxLevel: 20, jitter: 1 }`.
  Level at distance d from the Citadel:
  `L = clamp(round(1 + 19 × (outer − d)/(outer − inner)) + randInt(−jitter…+jitter), 1, 20)`.
  That gives Lv 1–2 at the old base distance, about Lv 10 at d ≈ 24, and Lv 19–20 hugging the dome.
  Elites stay on every 5th level.
- **Random scatter:** spawn points are uniform by area over the whole playable disc (d from 8 up to the map edge), with no bias toward
  your side. Spacing rules stay (`minSpacing`, `baseClear`). The total target is about 60 creatures (up from 44), because the map is no
  longer clumped around you.
- **Density near the player:** a top-up rule keeps at least **6 creatures you're allowed to attack (≤ best kill + 1) within 12
  tiles of your base**, including at least one at your current best level. That keeps hunting close even after a teleport. It
  also covers the tutorial: at least 1 Lv 1 within a short march.
- **Despawn and respawn:** killed creatures respawn after 10 min (as now) at a **random spot anywhere**, with the level
  set by where they land. Untouched creatures **despawn after a random 2–4 h** and respawn elsewhere, so the map shifts like
  Ants. A creature that is targeted by a march never despawns.
- **Visuals:** remove the zone circles and "ZONE n" labels. Keep and soften the darkening toward the Citadel so it reads as a smooth
  gradient (more scorch and fissures inward). The sheet line "Zone n" becomes **"X:… Y:… · N tiles from your base"**.

### 3.2 Alloy nodes on the same gradient
- Node level comes from **distance to the Citadel** (Lv 1 at the edge, Lv 5 near the dome), with random scatter and about 16 nodes.
- Near-player top-up: at least 2 Lv 1–2 nodes within 10 tiles of your base. Regrow stays at 30 min, in place.

### 3.3 Teleport (free for now, priced later)
- **Targeted:** tap an empty tile, then a small tile card appears (coords, "Empty land") with a **Teleport** button, then a confirm
  ("Move your base to X:… Y:…? Free for now."), then the base moves with a gold flash and the camera follows.
- **Random:** a **Random Teleport** button in the world HUD menu (or in the tile card). It picks a free tile in the outer
  half of the map (default) and needs a confirm.
- **Rules** (`store.canTeleport(x, y)` returns `{ ok, reason }`):
  - The tile must be inside the map, with a 2-tile margin from the edge.
  - No landing inside the Citadel dome or its clear ring (d < citadelRadius + 3): "The Citadel is sealed".
  - No landing on or next to any entity: a base within `baseClear`, a creature or node within `minSpacing`: "That spot is occupied".
  - **Not while any march is out** (hunting or gathering): "Recall your squads first" (the Ants rule).
  - Not during the tutorial, until the first hunt is done (keeps onboarding stable).
- **Hook for later costs:** `TELEPORT = { targeted: { cost: null, item: 'teleport' }, random: { cost: null, item: 'teleportRandom' },
  cooldown: 0 }`. `store.teleportCost(kind)` returns null today, and the confirm reads "Free for now". Later it returns an item
  (taken from `items`, which already exists from stage 10) or a resource cost (e.g. Shards), and the same confirm shows
  "Use 1 Teleport" / "Spend N Shards". No UI rework needed.
- **Effects:** the base, its march origin, and the near-player top-ups all follow the new spot. The base keeps its Beacon tier look.
  It saves immediately. A store event `teleport` is emitted for future server sync.

### 3.4 Base position becomes data
- Move `BASE_POS` into world state (`world.base = {x, y}`). Every use (march times, `attackInfo`, the node and creature
  top-ups, `focusBase`, WorldScene) reads `store.basePos()`. `sanitizeWorld` stops forcing (43,78) and only validates the
  spot (it falls back to the nearest free tile if it became invalid).

### 3.5 Search, coordinates, go-home
- **Search button** (magnifier, left side of the world HUD, like Ants). A sheet opens with a creature type (Any, or one of the 4 normals plus Wyrm) and a
  level stepper (1 … best kill + 1), then **Search** jumps the camera to the **nearest matching free creature** to your base and pulses
  a gold marker on it. Tapping it opens the attack sheet. If nothing is within 20 tiles it says "No Lv N creatures near your base. Try
  teleporting closer to the Citadel."
  Nodes are searchable the same way (Alloy, by level).
- **Coordinates:** a small "X:43 Y:78" readout of the tile under the screen centre while panning. Coords also appear on every tile, creature,
  node and base card.
- **Go to my base:** a home button on the world HUD (calls `focusBase()` with the eased camera from stage 17).

### 3.6 Bot bases, map size, camera
- **Bots:** keep 14, scattered randomly with level by the same gradient (strong ones near the centre). They don't move.
  They're also blocked tiles for teleport.
- **Map size:** keep 86×86 for stage 18 (see open decision D2). Camera limits and zoom stay as they are. Search and go-home make the map
  easy to get around.

### 3.7 Save migration (v15 → v16)
- Keep the world **seed**, bot bases, the base spot (43,78 becomes `world.base`), hunt progress (best kill, reports) and stamina.
- **Regenerate creatures and nodes** with the new gradient (same seed, so it's deterministic). Old `ring` fields and ring-based
  `respawns` are dropped and converted to `{ at }`.
- Marches that are out: their target is re-checked. If the creature or node is gone, the existing sanitize rule sends the squad home with
  any gathered Alloy, so no troops are lost.
- A backup of the old save is kept (`SAVE_KEY.backup-v15`, the existing mechanism).

### 3.8 Tests (tests/e2e.mjs, new stage 18 block plus updates)
- Gradient: the mean creature level falls with distance (a monotone check across 5 distance buckets), Lv ≥ 16 only within about 14 tiles,
  Lv 1–2 only beyond about 30, there are no zone labels or rings in the scene, and the sheet shows coords and not "Zone".
- Scatter: creatures are found in all 4 quadrants of the map, there are none inside the dome, and spacing is respected.
- Density: at least 6 attackable creatures within 12 tiles of the base, both at the start and right after a teleport.
- Despawn and respawn: untouched creatures expire within 2–4 h of game time and are replaced, the total count holds, and a targeted
  creature never despawns.
- Teleport:
  - A targeted teleport to an empty tile moves the base, march times are measured from the new spot, and the camera follows.
  - It is refused on an occupied tile, inside the dome, off the map edge, while a march is out, and during the tutorial.
  - A random teleport lands on a valid tile.
  - `teleportCost` is null and the confirm says "Free for now".
  - It persists after a reload.
- Search: finds the nearest matching creature (checked against a brute-force check in Node) and handles "not found". The go-home
  button centres on the base.
- Nodes: the level follows distance to the Citadel, and there is at least 1 Lv 1–2 node within 10 tiles.
- Migration: a v15 save loads as v16 with the same seed, base and bots, the new creatures, troops intact, and a march-out squad sent home.
- Update the stage 12 world checks that assume rings (base at y = 78 stays true for new games; "Lv 1 within a short march" stays) and
  the stage 5 tutorial first hunt (it must still be about 5 s each way).
- New screenshots: stage18-before/after world (zoomed out), teleport confirm, search result.

## 4. Open decisions (recommended default in **bold**)

| # | Decision | Options | Default |
|---|---|---|---|
| D1 | Smooth gradient or soft bands | pure gradient ± jitter / gradient with hidden 1-level steps | **Pure gradient, ±1 level jitter** |
| D2 | Map size | keep 86×86 / grow to ~120×120 | **Keep 86 now** (grow when real players arrive; bigger means emptier) |
| D3 | Creature count | 44 / ~60 / ~80 | **~60** plus the near-player top-up |
| D4 | Untouched creature lifetime | none / 2–4 h / 30–60 min | **2–4 h random** |
| D5 | Teleport cooldown | none / 1 min / 10 min | **None** (cost comes later; add a cooldown only if abused) |
| D6 | Random teleport landing area | anywhere / outer half / near your level band | **Lands where creatures ≤ best kill + 1 are common** (safe for new players) |
| D7 | Teleport while gathering or marching | block / auto-recall | **Block, with a "Recall your squads first" message** (the Ants rule) |
| D8 | Later price | teleport items / Shards / Cores | **Items** (`teleport`, `teleportRandom`) from events/shop, with Cores as a fallback price. Decide when monetisation is designed. |
| D9 | Search level cap | best kill + 1 / any level | **best kill + 1** (matches attack rule; the cap rises as you win) |
| D10 | Bookmarks (saved coords) | now / later | **Later** (search + coords + go-home cover it for now) |
| D11 | Existing saves | regenerate creatures + nodes / keep the old layout | **Regenerate creatures + nodes, keep seed/base/bots/progress** |
| D12 | Can bots be teleport-blocked or moved | static / move occasionally | **Static** |

## 5. Effort (rough)
- World generation, gradient, scatter, despawn and top-ups: **medium**, mostly `worldState.js` and `worldService.js`, with no new art.
- Base position as data plus teleport rules, tile card, confirm and the random teleport: **medium**. This touches the store, WorldScene and
  ui/world.js, and every `BASE_POS` use.
- Search sheet, coordinate readout and go-home button: **small–medium**. It reuses the existing sheet and button widgets.
- Map visuals (remove zones, smooth the gradient): **small**.
- Migration v16 plus about 30–40 new or updated e2e checks: **medium**.
- **Total: about one long overnight session (≈5–7 h including the full suite runs), zero cost**, shipped as v0.13.0.
