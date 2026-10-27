# Broken Dawn: game-feel review (stage 17, v0.12.0)

Jason's note: *"something makes the game seem clunky or blocky… can't put my finger on it."*

## What the reference does (The Ants: Underground Kingdom)
- **It looks crisp.** Reviewers (GameRefinery, App Store reviews, Android Central) keep calling it
  "crisp and vivid". Many 4X games look "murky", and this one doesn't. Everything renders at the
  phone's native pixel density.
- **Everything answers your touch.** Buildings react when you tap them. Popups ease in and out
  instead of popping. Buttons squash and brighten.
- **Rewards travel.** Collected resources fly into the top bar and the number rolls up. You *see*
  the gain arrive where it is counted.
- **The camera has weight.** A flick keeps gliding and eases to a stop. Zoom is smooth, not stepped.
- **The colony feels alive.** It has constant low-key motion (ants on paths, glows, particles) and
  runs at a steady frame rate while you watch.

## Audit of Broken Dawn (v0.11, DPR-3 phone, 390×844 CSS)
I took screens and 40 ms frame sequences with `tests/stage17-shots.mjs`
(`screens/stage17-before-*`). The findings below are ranked by how much they add to the
"clunky / blocky" feeling.

| # | Finding | Why it feels clunky | Fix (v0.12) |
|---|---------|---------------------|-------------|
| 1 | **The canvas was 720 px wide and upscaled about 1.6× on a 3× phone** (1170 device px). | Every edge, letter and frame was soft and stair-stepped. This is the "blocky" part. | **Supersampled backbuffer:** RES = device px ÷ 720 (capped at 2×, rounded to ⅛). Cameras zoom by RES, but input, layout and tests stay in the same 720-wide logical coordinates. Text renders at RES, and baked skins bake at RES. Edge sharpness measured **about 2× higher** (edge variance 1185→2380 on the HUD, 1268→2505 on the panel). `?sharp=0` switches it off. |
| 2 | **Every close was instant.** Panels, modals, screens and the More sheet were destroyed or hidden in one frame, while their opens were animated. | The asymmetry reads as "glitchy": things fade in, then vanish. | Closes now ease out (fade and a 12 px drop, about 130 ms). The closing layer is detached at once, so taps and tests never hit it. The building panel rises with a slight overshoot. Switching buildings re-settles the panel instead of re-sliding it. Modals rise and fade in. |
| 3 | **HUD numbers snapped.** Energy, Cores, Shards, Alloy and Power jumped straight to the new value. | Rewards felt weightless. You couldn't tell what changed. | **Rolling numbers:** each number eases toward its value (about 400 ms). |
| 4 | **Collected resources did not travel.** | The reference's most satisfying beat was missing. | **Fly-to-HUD:** any lump gain (collect, claim, loot, gather return, crate) bursts 3–7 resource icons from where you tapped (or the screen centre). They curve into that resource's HUD slot, which pulses when they land. Normal per-second income does not trigger it. |
| 5 | **The camera stopped dead on release, and wheel zoom moved in hard 10% steps.** | The map felt like a spreadsheet, with no weight. | **Drag inertia:** a flick glides, decays smoothly and stops at the map edge. A new touch catches it. **Smooth zoom:** wheel steps set a target that the camera eases toward, staying anchored under the cursor. Both are on for the Base and World maps. |
| 6 | **Buttons only squashed.** | The press was hard to see on darker skins. | Buttons get an additive **press glow**. Faded-out (closing) buttons ignore taps. |
| 7 | **Tapping a building only drew an outline.** | The building felt static. | A **squash-and-settle** on select (Back ease, 280 ms), grounded at the building's base. |
| 8 | **The idle frame cap (30 fps) kicked in after 8 s.** | The Beacon pulse, embers and rings visibly stepped while you were just looking at the base. | The cap now waits 20 s. It still saves battery when the phone is put down. |
| 9 | Repeated `bump()` calls on the same text could stack and leave it oversized. | Small jitter on rapid claims. | bump() restarts cleanly from the base scale. |
| 10 | No `prefers-reduced-motion` handling. | Accessibility. | Reduced motion turns off inertia, flying icons, number rolls, eased closes, squash and press springs. |

### Second pass (after the first v0.12.0 deploy)
| # | Finding | Fix |
|---|---------|-----|
| 11 | **The base was still while you watched it.** The Beacon pulsed, but nothing moved *between* buildings. The reference's colony always has traffic. | **Energy couriers:** six small wisps shuttle along gently curved paths between each building's front and the edge of the Beacon plaza. Teal wisps carry energy in and gold wisps carry light back, with a soft shadow, a little scurrying bob and a short trail. They are visual only (no input, no state), cost six images each, and are off under reduced motion. |
| 12 | **Metal/ghost buttons had a hard-edged grey band across the top** (the gloss was a flat rectangle at 20% of the height). On tall tiles (the More sheet, Move, lane ✕) it read as a blocky stripe. | The gloss is now a sheen that fades out downward, capped at 24 px, so tall tiles keep a thin highlight. All button styles share it. |
| 13 | **The Rewards note overlapped the "Claim all" button** when it wrapped to two lines. | The button now sits a fixed gap below the note, whatever its height. |
| 14 | `select(null)` on the base re-opened an **empty building panel** that then lingered faintly behind other screens. | An empty selection now closes the panel, and closePanel also hides a stray visible panel. Stage 17 checks this. |

### Looked at, left alone (already good or not worth the risk tonight)
- Ambient motion already exists: Beacon glow pulse, rings and motes, drifting embers, and glowing
  ground veins. With the frame-cap change it now reads smoothly.
- Screen-to-screen tab changes now crossfade for free: the old screen fades out while the new one
  fades in.
- **HUD density / clutter:** the top bar is busy, but the stage 9–16 layout checks pin it, so
  rearranging it is a design decision for Jason. Candidates: hide the rate text until tapped, and
  merge the Power sub-line into a tooltip.
- **Pathing ant-style workers** (little troops walking between buildings) would be the next big
  "alive" win. The couriers (#11) are a lightweight version. Real walking soldier sprites that follow
  the flagstone paths would need new art, so I'm proposing it rather than doing it overnight.

## Tests
`ONLY=17` (stage 17 in `tests/e2e.mjs`) checks the following:
- RES and the backbuffer size at DPR 3.
- Taps on buildings and nav tabs landing at RES > 1.
- Eased closes that don't block or leave ghosts.
- Rolling numbers and fly-to-HUD.
- Inertia and smooth zoom.
- The reduced-motion and `?sharp=0` fallbacks.
- Idle couriers (running, no input, off under reduced motion) and that an empty selection closes the panel.
- Onboarding at DPR 3, and no console errors.

Under automation (`navigator.webdriver`), inertia and smooth zoom are off unless
`__BD_TEST.feel` is set. That keeps the older stages' pan-then-tap checks deterministic.
