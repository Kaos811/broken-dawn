# Stage 13 plan: the first 10 minutes (PLAN ONLY)
Audit: `docs/onboarding-audit/NOTES.md`. Goal: a new player understands *why* (story), *what next* (one pointer at a time), and *feels progress* (celebrations), and is hooked by minute 10 with timers running and a clear next goal.

## Principles
- One thing on screen at a time: staged unlocks hide nav tabs, queue buttons, Cores/Events/Missions buttons until their step.
- Coach = short speech bubble from a painted narrator (max ~12 words) + hand pointer + dimmed backdrop with a spotlight cut-out; card docks away from the target (top/bottom auto).
- Early timers are seconds, not minutes; nothing is silently "rushed": the player taps the speed-up (teaches it).
- Every step ends with a moment: burst, sound, reward chips flying into the HUD.

## Target flow (minute by minute)
| Time | Beat | What the player does | Unlocks / reward |
|---|---|---|---|
| 0:00-0:40 | **Story hook**: 3 painted panels (the Rift breaks the world; the last Beacon flickers; "Commander, relight it"). Tap to advance, Skip on panel 1. | taps | - |
| 0:40-1:30 | **Relight the Beacon**: base is dark/foggy; tap Beacon -> Energy flows, base lights up (fog lifts, music swells). | 1 tap + "Collect" | Energy counter appears in HUD |
| 1:30-2:30 | **First build**: Barracks is a ruin; hand on it -> Rebuild (10 s). Gold **Free** button at the end (speed-up rule: <=5 min is free) -> celebration. | 2-3 taps | **Troops** tab appears |
| 2:30-3:30 | **First troops**: Troops tab -> Train x10 Sentinels (15 s). Hand on the timer's **Speed Up** -> picker -> use the free 1m chrono core (first speed-up). | 3 taps | 3x 1m chrono cores granted, **Items** reveal |
| 3:30-4:30 | **Auto squad**: squad Alpha auto-fills ("Your Sentinels joined Alpha"), one-tap confirm. Full Edit Formation is deferred to Beacon Lv 3 tip. | 1 tap | **World** tab appears |
| 4:30-6:00 | **First hunt**: World opens centred on base with one Lv1 Husk Scuttler glowing beside it (others hidden/fogged). Tap -> Attack -> short march (10 s) -> auto-replay highlights (5 s) -> **Victory** big banner + loot chips flying into HUD. | 3 taps | Alloy + Shards appear in HUD |
| 6:00-7:30 | **First leader**: story beat "A survivor answers the Beacon" -> **Armory** tab appears -> guaranteed **free** first pull = a named leader (painted reveal with light rays) -> "Assign to Alpha" button. | 2-3 taps | Beacon Cores counter appears |
| 7:30-8:30 | **Beacon Lv 2**: hand on Beacon -> Upgrade (30 s) -> Speed Up with a chrono core -> big level-up celebration; Builder queue button appears. | 3 taps | Squads + More tabs appear |
| 8:30-10:00 | **First mission chest**: Missions button appears with 2-3 tasks already done -> claim the 20-pt chest (opening animation). Then a persistent **"Next goal"** chip ("Beacon Lv 3: unlock Research") replaces the coach. | 2 taps | chest rewards; tutorial reward |
| later | Contextual one-shot tips (not blocking): first wounded troops -> Infirmary; Beacon 3 -> Research/Archive; first Event -> Events; Edit Formation when 2nd troop type unlocks. | - | - |

Unlock order of chrome: Energy -> Troops tab -> Items/speed-up -> World -> Alloy/Shards -> Armory + Cores -> Squads/More/Builder -> Missions -> (Beacon 3) Research, Events, Rift Exchange.

## Tuning for the first session
- Barracks Lv2 10 s, first training 15 s, first march 10 s, Beacon Lv2 30 s (only tutorial-flagged jobs; normal curve unchanged).
- Starting wallet: 0 Shards/0 Cores shown until introduced (granted on reveal, so numbers *appear* with a flourish). First pull free and guaranteed leader.
- Badges suppressed until the tab is introduced, max 1 red badge visible during the tutorial.

## Skip & returning players
- Skip on story panel 1 and a "Skip tutorial" in the coach menu: confirm dialog, unlocks everything, pays the completion reward (same as today).
- **Save migration (v12 -> v13)**: any save with `tutorial.done` OR Beacon >= 2 OR any hunt/pull -> `onboarding = { done: true, unlocked: ALL }`; no story, no re-tutorial. Only truly fresh saves get the new flow. In-progress old tutorial (step 1-7) -> mark done + pay reward (simplest, avoids mapping old steps).
- Replay from More -> Settings: replays story panels + flow on a sandbox flag without touching progress (as today's "Replay").

## Implementation outline
- `src/tutorial/onboarding.js`: data-driven steps (id, unlocks[], coach line, target(), done(), celebrate) replacing STEPS; reuse existing target helpers (`tab`, `findButton`, `buildingPos`).
- `ui.unlocked(id)` gate in nav, HUD counters, queue buttons, right-edge buttons; one source of truth in save `onboarding.unlocked`.
- Spotlight overlay (Graphics mask) + hand pointer sprite + narrator bubble component in `src/ui/kit.js` style.
- `Celebrate.burst(kind)` helper: level-up, victory, first-leader reveal, chest open (reuses existing particles/sfx).
- Tutorial-only short timers via a `tutorialFast` flag on the job.
- Tests: new e2e "fresh save plays to the 10-minute mark by following the pointer" + migration checks (old done save, mid-tutorial save, Beacon 5 save without tutorial flag); layout check at 6 sizes with coach visible.

## Art needed (painterly gold/teal, magenta-keyed where cut out)
1. 3 story panels (portrait-safe, ~720x1280): rift breaking the world; dark base with the flickering Beacon; the commander silhouette before the lit Beacon.
2. Narrator portrait (a scarred Rift Warden/engineer bust) for the coach bubble, 2 expressions.
3. Hand/gauntlet pointer (gold-trimmed gauntlet finger), 1 sprite.
4. Ruined Barracks state (rubble version of the existing building) + "dark base" overlay tint (can be a shader/tint, no art).
5. Mission chest open/closed (if the current chest art doesn't animate) + victory banner ribbon.
Scope: ~5 GenerateImage sheets; everything else reuses existing art.

## Estimate
2-3 build sessions: (1) unlock gating + migration + coach/spotlight; (2) flow steps, fast timers, celebrations; (3) art, story panels, tests and polish.

## Open questions for Jason
1. Story hook: 3 static panels OK, or skip the story and start straight on the dark base?
2. Narrator: an existing leader (e.g. the first recruitable one) or a new non-combat character?
3. First pull: guaranteed specific leader (which?) or random rare+?
4. Old in-progress tutorials: just mark done (recommended) vs. restart them in the new flow?
5. Keep Infirmary/Research as contextual tips later (recommended) rather than tutorial steps?
