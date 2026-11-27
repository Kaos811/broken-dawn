# Broken Dawn: creature motion mockup (do not merge)

Standalone mockup, not part of the game. Open `index.html`.
- Husk Scuttler rig: painted shell/head/leg parts cut from `cr-scuttler.webp` (tools/*.py), driven by procedural locomotion in `creature.js`
  (foot planting + alternating 4-leg groups, 2-bone leg IK, gait-driven bob/sway, shell lag on turns, head look, antenna springs, mandible chew, crouch-lunge attack).
- `?capture=1` = fixed-step mode used to record the MP4.

## v2 (Nov 27)
- New top-down painted Scuttler parts (art/v2, keyed from #00FF00 JPGs with tools/key-v2-parts.py: choke + edge-band despill).
- Legs use a raised-knee (3D-style) projection, so legs radiate cleanly instead of crossing.
- Roaming: 3 Scuttlers pick random waypoints in a ring around the burrow, steer around the lair and the Sentinels, pause, and turn to face neighbours; depth-sorted by y so they pass under each other. The big one breaks off to attack the Sentinels.
