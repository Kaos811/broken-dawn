# Onboarding audit (fresh save, 390x664, v0.9.x @ f1552f8)
Script: `tools/audit13.mjs` (follows the tutorial pointer with real taps; 10 idle minutes simulated at the end). Shots in this folder (also /workspace/broken-dawn-ref/onboarding-audit/).

## Friction found
1. **Everything is on from second one** (01-first-load): all 6 nav tabs, 4 queue buttons (Builder/Research "Beacon 3"/Training/Healing), Cores "+" and red badges on Cores, Armory and More, plus 500 Shards and 10 Cores before the player knows what they are. No story, no "why".
2. **Text-heavy coach card that covers the UI** (06-step4-3, 05): bodies are 1-2 compound sentences ("Open Squads, tap Edit Formation, fill a line (Max) and Save. (Your first batch was rushed for you.)"). On Squads/Edit Formation the card sits on top of the screen header; on the Barracks panel it hides half of the panel.
3. **Squad formation is the hardest screen and comes 4th** (05, 06): 3 lines x 4 troop types x T1-T3 tabs x +/- steppers + leader, when the player owns 10 Sentinels. The game silently "rushes" the training so the player never sees troops finish.
4. **Flat rewards / no celebration**: first build finishes in ~7 s with no moment; Recruit reveal (09) is a single grey "Aegis Mesh, NEW armor" card; tutorial completion (15) is a one-line toast "+500 Energy, +2 Beacon Cores"; first Victory (12) is a dense report (rewards, casualties, Cores, Replay, Infirmary).
5. **Steps 7-8 point at systems the player can't use yet**: Infirmary when only 2 troops were wounded, and Research which "appears at Beacon Lv 3" (14): a step that ends in a locked thing. Step 6 also hides the coach while marching, then the report pops over it.
6. **After the tutorial there is no next goal** (16-21): back on base with every tab badged, no "upgrade the Beacon to Lv 2" style objective; Missions/Events exist but aren't pointed at. 10 idle minutes later nothing has changed (queues idle).
7. Minor: Armory opens on Recruit with 10 Cores (Pull x10 visible and greyed), Gear/Leaders tabs, history - lots to parse; World map opens zoomed with zone labels and locked Lv 2-5 creatures around the target.
