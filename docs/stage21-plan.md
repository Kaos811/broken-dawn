# Stage 21 plan: living creatures on the World map

Plan only, not built yet. Zero cost: Phaser 3, the existing painted look, and new top-down parts generated with free tools (same key-and-despill pipeline as the creature mockup). Nothing paid.

This follows the v3 creature-motion mockup (`mockup/creature-anim`, commit `6df1ece`), which Jason approved as the direction: painted parts, a stepping gait with planted feet, roaming around the lair, and a readable attack lunge. It is still a mockup. This plan is how we bring that into the real game on `main` (v0.15.0, `24f6d98`).

Stage 20 already landed on `main` as natural creature scale, contact shadows, Ants-style level tags, and a whole-sprite breathing squash (`idlePose` in `WorldScene.js`). The later 20b/20c experiments (cutting parts out of the existing angled paintings, mesh/rope warps, and a blocky 3D sheet) were never merged and are superseded by this plan. We will not cut apart the current ¾-view sprites.

## 1. Goal and what "done" looks like

At **390×844 portrait**, every creature on the World map should look alive, in Broken Dawn's painted gold-and-teal style, in the spirit of Ants: Underground Kingdom.

**Done means:**

- A reusable rig (parts + IK legs + gait + idle + lunge) drives creatures in `WorldScene`, replacing the flat `cr-<type>` sprite and its breathing squash.
- Creatures that walk **roam near their lair** (pauses, turns, depth sorting). They do not change their logical tile, so marches, spacing, and saves stay as they are.
- When the player attacks, the target **faces the incoming squad and lunges** as the march arrives. The existing battle, report, and rewards are unchanged.
- All six types currently in the game use the system (see §3). Until a type has art and a rig, it keeps today's flat sprite.
- About **60 creatures** stay on the map. Mid-range phones hold 60 fps at the default zoom. Far-away or zoomed-out creatures fall back to a still (or softly breathing) billboard.
- `prefers-reduced-motion` (already wired as `REDUCED_MOTION`) freezes or soft-breathes; no gait, roam, or lunge.
- The First hunt tutorial still works: the pointer can find the creature, and the copy "A Scuttler is right outside" is true.
- Each stage ships with a preview link. **Nothing merges without Jason's yes.**

## 2. What we have today (code audit)

- **Types** (`src/config.js` `CREATURES`): Husk Scuttler, Rift Drone, Void Hound, Shard Golem, Dusk Wyrm (elite, every 5th level, Scuttler brood), Rift Behemoth (rally-only world boss).
- **Map:** `WORLD.creatures = 60`, plus a few near-base top-ups (cap in tests: 60–70). Spacing is 2.2 tiles (about 158 px). A killed creature respawns elsewhere in 10 min.
- **Drawing** (`WorldScene.syncAll`): a faded lair under a single `cr-<type>` image (`CR_W` 90–160 px, Behemoth 300), a contact shadow, and a `LevelTag` just below the feet. Drones are drawn 16 px up. Behemoths get a teal additive shimmer.
- **Motion:** `animateIdle()` runs only for on-screen creatures. It squashes the whole sprite (hover for Drones, a tiny weight-shift for Scuttlers and Hounds, a coil sway for Wyrms). That is what looked like a sticker in the mockup comparison.
- **Tapping:** `pick()` uses the **entity tile**, within about 60 px — not the sprite. If a creature roams farther than that, taps will miss unless we change `pick()`.
- **Attacks:** `store` → `WorldService.sendMarch`. The creature is marked `busy`. On arrival, `resolveBattle` runs and `WorldScene.battleFx` plays. The sprite itself never lunges.
- **Tutorial** (`src/tutorial/tutorial.js`, First hunt): the card says *"A Scuttler is right outside."* The near-base guarantee in `worldState.js` only spawns **some Lv 1** within 7.25 tiles; the type is random among the four normals. `creatureTarget()` pans to `s.img` and asks the player to tap it, then Attack.
- **Reduced motion:** OS `prefers-reduced-motion` (or `__BD_TEST.reducedMotion`) skips `animateIdle()`. There is no in-game toggle yet.
- **Art:** one 256×256 (Behemoth 512) ¾-view WebP per type, loaded in `BootScene.js`. Fine as a zoomed-out billboard; not usable as rig parts.

### 2.1 Conflicts with the unmerged tutorial PRs

PR2 (walkthrough pacing, `cursor/walkthrough-reward-pacing-910f`) and PR3 (tutorial test mode, `cursor/tutorial-test-mode-5405`) are **still open and must not be merged as part of this work.**

| | Touches WorldScene? | Touches the hunt / Scuttler? |
|---|---|---|
| **PR2** | No | Same First-hunt copy. Does not change spawn or `WorldScene`. Low risk. |
| **PR3** | Yes: `focusTile(x, y, zoom, bias = 120)` only | Rewrites `creatureTarget()`: it closes an open sheet, zooms so the creature sits in a safe band, skips Behemoths, and reads **`s.img.x` / `s.img.y`**. |

**Rules for this work:**

- Keep a stable **`s.img` anchor** at the creature's *visual* position (a transparent 1×1 or the body sprite) so PR3's pointer and any other `s.img` hooks keep working.
- Do not overwrite PR3's `focusTile` bias when we rebase.
- A "guaranteed nearby Scuttler" for the First hunt is a small `worldState.js` change. Neither PR touches that file, so it can land here (recommended in Stage A) or with the walkthrough. It makes the existing tutorial line true, and it matches the walkthrough mockup's guaranteed Scuttler fight.
- **Do not open a PR to `main` until Jason has decided on PR2/PR3**, then rebase this work on top of whatever he merged.

## 3. Architecture

### 3.1 Reusable rig module

Port the v3 mockup (`creature.js` + per-type config) into the game, for example:

- `src/world/creatureRig.js` — shared runtime: planted-foot stepping, two-bone IK, gait-driven bob and sway, shell lag / head lead, idle (breathe, glance, antenna twitch, leg shuffle), lunge (crouch, snap, recoil), and visual roaming around a home point.
- `src/world/rigs/<type>.js` — per-type config: part list, bone lengths, gait (8-leg bug, 4-leg walk, hover, segmented chain), roam style, lunge style, on-map scale (`CR_W`).
- `src/art/world/creatures/<type>/` — keyed WebP parts (plus the existing `cr-<type>.webp` kept as the far LOD / fallback).

`WorldScene` does not contain gait math. It creates a rig, ticks it, and tears it down.

### 3.2 Plug-in to WorldScene

Behind a flag at first (`?creatures=rig` or `__BD_TEST.creatures = 'rig'`), defaulting to **on for any type that has a rig** once Jason has said yes to Stage A.

In `syncAll`:

- If the type has a rig, build it and hide (or never add) the flat `cr-<type>` as the close-up body.
- Always keep `s.img` as the visual anchor, `s.lair` and `s.shadow` as today, and `s.badge` as the level tag.
- `s.rig.destroy()` when the entity leaves the map (kill, cull-from-map, reset).

In `animateIdle` (rename to `animateCreatures`):

- Off-screen: hide the rig, skip the tick (same cull window we use now).
- On-screen and close: tick the full rig.
- On-screen but far / zoomed out: show the still `cr-<type>` billboard (soft breathe only). See §6.
- Reduced motion: billboard, no roam or lunge.

### 3.3 Roaming (visual only)

- The entity's **`e.x, e.y` tile never changes** while it roams. Marches, attack range, spacing, respawn, and the save file all keep using the lair tile. No migration.
- Visual home is the lair. Ground walkers pick spots in a ring, steer around the burrow and neighbours, pause, and sometimes turn to face a neighbour — same feel as the v3 mockup.
- Recommended radius: about **1 tile (72 px)**, inside the 2.2-tile spacing so they don't walk through each other. **`pick()` must use the visual anchor**, not only the tile, or taps will miss.
- Depth is `10 + visualY / SIZE`, so they pass under and over each other correctly.
- The **level tag stays at the lair**, just below the footprint, and does not follow the body. That is the fix for the v3 name-tag overlap, and it matches Ants (the name sits on the ground by the nest).

### 3.4 Attack lunge

When a local (or rally) march targets a creature:

1. The rig **turns to face** the incoming squad.
2. When the march is about to arrive (or on arrival, just before `battleFx`), it plays the **v3 lunge** (coil, wide mandible snap, ~50 px strike, flash and dust, recoil).
3. The existing battle resolution, sheet, report, and loot are unchanged.

The creature does not chase or leave its ring. Locked / too-high-level creatures still roam and idle, but they do not lunge (you can't attack them).

## 4. Per-creature rundown and art

Shared prompt base, same as the v3 Scuttler parts:

> Top-down overhead view, painted dark-fantasy game art, Broken Dawn gold-and-teal palette, soft top-left light, isolated on flat #00FF00 green, no drop shadow, centred. If you paint a head, include a short thorax below the face and have the face/fangs point **up** (forward). Lower legs should be long and slender, with a clear claw. Do not attach legs to the body, or the head to the full shell.

Key JPGs with the v3 despill (choke + edge-only green removal; leave teal cracks and eyes alone). Prefer a standalone shell, not a whole-body painting we have to crop.

**Lessons from the Scuttler:** paint the head *with* a bit of thorax, already facing up; paint a long separate tibia so it is not squashed; paint the mandible and the antenna as their own parts.

| Creature | Body type | Motion (on top of idle + lunge) | Art layers to generate |
|---|---|---|---|
| **Husk Scuttler** | 8-leg ground bug | Alternating 4+4 gait, roam around the nest (`lair-nest`). v3 parts already exist. | **Reuse the 6 v3 parts:** body, head+thorax, femur, long tibia, mandible, antenna. Optional fixes: a shell whose plates match the head, and a thicker antenna (**+0–2**). |
| **Rift Drone** | Flying insect | Hover and bank over the roost (`lair-roost`); wing flutter; legs dangle, they do not walk. Drift in a small hover, don't roam on the ground. Dive-lunge. | **7:** body, head+thorax, wing L, wing R (separate, light is from the top-left), hanging femur, hanging tibia, antenna or stinger. |
| **Void Hound** | 4-leg beast | Walk/trot around the crater (`lair-crater`); head leads turns; tail; idle glance; a pounce lunge (they already have `firstStrike`). | **8:** body, head, front upper, front lower, back upper, back lower, tail, jaw/mandible. |
| **Shard Golem** | 4-leg heavy | Slow, heavy walk around the tower (`lair-tower`); strong bob; arms hang; idle crystal pulse; a short smash-lunge. | **7:** body, head, front upper, front lower, back upper, back lower, arm or crystal spike. |
| **Dusk Wyrm** | Segmented centipede | A chain of segments follows a short spline around the burrow (`lair-burrow`); body wave; metachronal legs; rearing head; pincers. Do **not** cut the current coiled painting (that is what ghosted in 20b/20c). | **8:** head, body segment A, body segment B, tail, leg L, leg R (or one leg if a flip looks right — paint both if unsure), antenna, pincer. |
| **Rift Behemoth** | 4-leg winged boss | Mostly a heavy idle (breathe, wing flex) with a **short** pace around its tile — it is 300 px wide. Roar / wing-spread lunge when a rally arrives. Keep the teal shimmer. | **9:** body, head, wing L, wing R, front upper, front lower, back upper, back lower, tail. |

**Totals:** **39 new paintings** for Drone, Hound, Golem, Wyrm, and Behemoth, plus the **6 Scuttler parts we already have**, and optionally **2 Scuttler revisions** (seam + antenna). **45 parts in the game, 39 of them still to generate** (47 if we redo those two Scuttler pieces).

Generate art **just ahead of the stage that needs it** (Scuttler first, then the two bugs in B, then the 4-leg types in C), so we can adjust prompts from the last batch.

## 5. Stages

Each stage is small, testable on a phone at 390×844, and has its own preview (a branch or a flagged build, same rawcdn style as the mockup). **Jason's yes before any merge.** No merge and no deploy without that yes.

### Stage A — the module, plus Scuttlers in the real game (behind a flag)

**Est. 1–1.5 days of agent time.** No new art required (use the v3 parts).

- Port `creatureRig.js` and a Scuttler config. Hook it into `WorldScene` behind `?creatures=rig`. Other types stay on today's flat sprite.
- Visual roam around `lair-nest`, tag fixed at the lair, `pick()` and `s.img` follow the visual body.
- Lunge when a march arrives; then the existing battle FX.
- v3 nits: tag overlap (fixed by anchoring the tag); head/shell seam and antennae — use the current v3 parts, and a light in-engine thicken/glow on the antennae. If the seam still bothers us on the map, ask for the optional 2 redo paintings before B.
- Near-base **Lv 1 is a Scuttler**, so the First hunt line is true. Confirm the tutorial pointer still lands on it (and that it will stay compatible with PR3's `creatureTarget`).
- Preview at 390×844, plus a short MP4 and 2–3 screenshots. Playwright: a flagged world loads, a Scuttler roams, a tap still opens the sheet, a march still plays the lunge then the battle.

### Stage B — the other bugs (Drone, Dusk Wyrm)

**Est. 1.5–2 days**, after the 7 + 8 new paintings are in.

- Drone: hover rig (wings, dangling legs, dive-lunge), no ground roam.
- Wyrm: segment-chain rig (spline, body wave, metachronal legs, rear and snap).
- Both types join the flag (or follow the "any type with a rig" default). Preview + clips of each.

### Stage C — four-legged creatures (Hound, Golem, Behemoth)

**Est. 1.5–2 days**, after the 8 + 7 + 9 new paintings are in.

- Shared 4-leg walk (different weights: Hound trot, Golem stomp, Behemoth a slow pace).
- Hound pounce, Golem smash, Behemoth roar / wing spread. Behemoth keeps its shimmer and rally-only rules.
- Preview + clips. All six types are now rigged.

### Stage D — performance, reduced motion, tests, then ship

**Est. ~1 day.**

- Budget and LOD as in §6. Stress with 60+ creatures at 390×844, including a zoomed-out map and a tight cluster near the base.
- Reduced motion: freeze or a single breathe; no roam, gait, or lunge. Honour the OS flag; add an in-game Settings toggle if it stays a small change (optional, Jason's call).
- Playwright: rigs on/off, cull/LOD, reduced motion, First hunt still completable, a march still kills and respawns, no leftover sprites after a reset. Full suite green.
- Remove the flag (every type uses its rig, with the flat sprite only as LOD). Preview of the "ship" build. **Merge only after Jason's yes**, and only after PR2/PR3 are decided and this branch has been rebased.

## 6. Performance budget and risks

A rigged Scuttler is many sprites (body, head, two mandibles, antenna segments, 8 femurs, 8 tibias, a shadow, a glow, a tag) — on the order of **25 display objects each**. 60 of those, all ticking, is too many for a low-end phone (draw calls, fill rate, and JS).

**Budget:** 60 fps at `startZoom` (0.55) on a mid-range phone, with about **8–12 fully animated** creatures (whatever is on-screen and close). Everyone else is a billboard or hidden.

**Mitigations:**

- **Off-screen cull** (already in `animateIdle`): hide and do not tick.
- **LOD / freeze when far:** if zoom is low or the creature is small on screen, show `cr-<type>` and skip the rig. The Behemoth, being 300 px, is a special case — never more than one or two on screen, but LOD still applies when zoomed out.
- **Cap full rigs** (e.g. the 10 nearest on-screen). The rest freeze in a posed still.
- **Batch-friendly parts:** one texture per part *kind* (all Scuttler femurs share a texture). Prefer images over per-creature `Graphics` for shadows and glows where we can, so Phaser can batch.
- **Reduced motion** skips almost all of the work.
- Measure in Stage D with a debug overlay (`idleAnimated`-style counts: full / LOD / culled). If a low-end device still stutters, drop the cap and go to billboards earlier — never drop the creature count below 60.

**Other risks:**

- Tutorial / PR3 hooks breaking if `s.img` moves or disappears — keep the anchor (§2.1).
- Roam vs `pick()` — use the visual position (§3.3).
- Cutting parts from old ¾-view art — don't; wait for top-down layers.
- Visual roam that *looks* like the creature left its tile, confusing a march line — keep the radius tight and the tag on the lair.
- No save-format change if roam is visual only. Keep it that way.

## 7. v3 nits to fix as we go

- **Name tag overlap:** tag stays at the lair, below the footprint, and does not follow the lunge or the roam (Stage A).
- **Head / shell seam:** the v3 head and shell come from two paintings, so the plates don't quite match. Live with it in A; if it still reads on the map, generate a matching pair before B (counts as 2 of the optional revisions).
- **Antennae still a bit stick-like:** in A, keep the v3 thicken + teal tip glow. A dedicated thicker antenna painting is the other optional revision.

## 8. Cost

**$0.** Phaser 3, Vite, GitHub Pages, Python/PIL for keying, Playwright for tests, and images generated with the same free pipeline as the mockup. No Spine licence, no paid art, no new services.

## 9. Open questions for Jason

Recommended defaults are in **bold**.

1. **Who roams?** **Ground walkers (Scuttler, Hound, Golem, Wyrm) roam around their lair; Drones hover and drift over the roost; the Behemoth only paces a short arc.** Or should only the bugs roam, and the rest idle in place?
2. **How far?** **About one tile (72 px)** so they stay on their nest and don't walk into neighbours. Bigger than that will need more careful avoidance.
3. **Do they react to marching troops?** **Yes, a little:** they turn to face a squad that is coming for them, and they lunge when it arrives. They do not chase, and they do not leave their ring.
4. **When does the Scuttler go live for everyone?** **After Stage A looks good, turn it on by default for Scuttlers only** (other types stay flat until B and C). Or keep the flag off for all types until Stage D, when all six are ready?

## 10. Effort (about 5–6.5 days of agent time, plus time to generate art between stages)

| Part | Est. |
| --- | --- |
| A: rig module, Scuttler in-game, flag, tag/pick/tutorial hooks, preview | 1–1.5 d |
| B: Drone + Wyrm (after 15 paintings) | 1.5–2 d |
| C: Hound + Golem + Behemoth (after 24 paintings) | 1.5–2 d |
| D: perf, LOD, reduced motion, tests, flag off, preview | ~1 d |
| Art (39 new, optional 2 Scuttler redos) | Jason / the art pipeline, staged before B and C |
