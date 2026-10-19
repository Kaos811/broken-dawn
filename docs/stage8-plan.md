# Stage 8 plan: Daily Missions + Events (for approval, not built yet)

Goal: give players a reason to come back every day (missions) and every week (events), in the
style of The Ants and Game of War, using only actions the game already has. Beacon Cores stay scarce.

## Today's Core income (for comparison)
- Daily login: 1/day, plus 3 extra every 7th day in a row, so **~10 a week**.
- One-time Cores: Beacon levels (3 each), 6 milestones (9), first kills Lv 1–20 (24), tutorial (2).

## 1. Daily Missions
**Reset:** at the player's local midnight (same day logic as the daily login claim).
**Unlocks:** after the tutorial. All 7 tasks come from things you already do:

| # | Task | Points |
|---|------|--------|
| 1 | Claim the daily reward | 10 |
| 2 | Defeat 8 creatures (offline Auto-hunts count) | 20 |
| 3 | Train or promote 30 troops | 15 |
| 4 | Start a building upgrade | 15 |
| 5 | Start a research (before the Archive: raise a leader star or gear level instead) | 15 |
| 6 | Heal 10 wounded troops | 15 |
| 7 | Win a hunt at your best kill level − 1 or higher | 20 |

The tasks add up to 110 points, so you can skip one and still fill the track. **Activity chests** open at
20/40/60/80/100 points. Rewards grow with Beacon level (L):
- 20: Energy 300×L
- 40: Alloy 40×L and Stamina 10
- 60: Shards 60
- 80: Energy 600×L and Stamina 20
- 100: **1 Beacon Core** and Shards 100

**Where it lives:** a new **Missions** button (a clipboard icon) at the right edge under the top HUD.
It shows a red badge with the number of chests and tasks ready to claim. The screen shows the task list
with progress bars, the chest track along the top, and a "resets in 5h 12m" timer. A finished task flashes
a short toast ("Mission complete: Train 30 troops").

## 2. Events (rotating, limited time)
**Framework:** an `EventService`, built the same way as the existing `LocalWorldService`.
- The local version builds the schedule from a fixed weekly calendar in **UTC**, so every player sees the same windows (times are shown in local time with a countdown).
- A server version can replace it later (for PvP and online leaderboards) without changing the UI.
- Each event has its own id (for example `rift-hunt-2026-W43`). The save keeps only points and claims per id.

**Weekly rotation** (Denver times shown in MDT):
- **Beacon Surge** (build/research power event), Mon 00:00 to Thu 00:00 UTC (Sun 6 PM to Wed 6 PM MDT). Points:
  - Each building upgrade completed: 100 × the new level.
  - Each research level completed: 80 × the new level.
  - Each troop trained: 2 × its tier.
  - Milestones at 500 / 1,500 / 3,000 / 6,000 / 10,000.
- **Rift Hunt** (weekend creature event), Fri 00:00 to Mon 00:00 UTC (Thu 6 PM to Sun 6 PM MDT). Points:
  - Each creature kill: 10 × its level, with elites ×2.
  - Milestones at 300 / 1,000 / 2,000 / 3,500 / 5,000.
  - About 24 hunts a day is possible on stamina (plus the +20 from the daily claim).
- **Rift Exchange** (event shop, open all week): both events also pay **Rift Marks** (1 per 50 points, ~100–150
  a week for an active player). Marks buy resource crates, Stamina 50, a gear upgrade crate (Shards), and
  **1 Beacon Core** (200 Marks, limit 1 per week). The stock refreshes on Mondays.

**Milestone rewards (each event):** Energy and Alloy, then Shards, Stamina 30, Rift Marks, and
**1 Core at milestone 4 and 1 Core at milestone 5** (2 Cores per event at most). Milestones you
reached but didn't claim are paid automatically after the event ends, with a summary popup.

**Where it lives:** the More sheet's **Events** tile goes live (no more "coming soon") and opens an
Events hub: the live event, its countdown and milestone track, the next event, and the Exchange. A second
right-edge button shows the live event icon with a countdown and a badge when a milestone is ready.
Rank lists come later, with the server.

## 3. Core balance (fully active player, per week)
- Today: ~10.
- Missions: +7.
- Events: +4.
- Exchange: +1.

Total ≈ **22 a week** (about 2 ten-pulls). A casual player who fills half the chests and reaches event
milestone 3 gets ~10–12. Pity stays at 10 for Epic and 60 for Legendary. Every number lives in `config.js`
(MISSIONS, EVENTS) for easy tuning, and every Core still goes through `grantCores(n, source)`.

## 4. Offline, timezone and clock safety
- Actions that complete while you're away (training, upgrades, offline Auto-hunts) count toward the day you come back on.
- If midnight passes while playing, missions reset on the spot with a toast. Chests you reached but didn't claim are paid automatically, not lost.
- Missions reset only when the day number goes **up**. Turning the device clock back doesn't give a second reset. Events use the latest time ever seen (the most recent clock reading the save has recorded), so going back doesn't reopen an ended event.
- Travel or a DST change: the local midnight shifts, but a day is never counted twice.

## 5. Save v10, tutorial
- **v9 → v10:** adds `missions {day, progress, chests}` and `events {byId, marks, shop}`, with empty defaults.
  - Today's missions start fresh, and nothing is back-dated.
  - The usual one-time backup (`…backup-v9`) is kept.
- **Tutorial:** no new steps. A one-time pointer on the Missions button appears right after the tutorial ends, and a one-time pointer on the Events button appears the first time an event is live.

## 6. Tests (new stage 8 suite, both builds, ~70 checks)
- Reset at local midnight using the store clock override and two browser time zones (Denver and Auckland).
- Every task counts from its real action, including offline.
- Chest claims and amounts, and auto-pay at reset.
- Clock moved back, and DST.
- Schedule: the same windows for any time zone, start and end boundaries, ids.
- Event points per action, milestones, Marks, shop limits, and auto-pay after the event ends.
- A simulated week to check the ~22 Core ceiling.
- Migration v9 → v10.
- UI: buttons, badges, screens, phone sizes, screenshots, no console errors.

## 7. Art you'd generate (same pipeline: bright green background, I key it out and convert to webp)
1. Missions button icon: a holographic clipboard or scroll with a check mark.
2. Activity chests: 3 tiers (bronze, silver, gold), each closed and open, so 6 images (one 3×2 sheet).
3. Rift Mark token: the event currency coin.
4. Rift Exchange shop icon: a crate or market stall.
5. Event banners, wide (~3:1): Beacon Surge and Rift Hunt.
6. Stamina icon: there's no painted one yet, and the world HUD draws a lightning bolt.

The live-event button can reuse the new Events star medallion.

## 8. Estimate and order of work
About **3 sessions**, each pushed and checked live:
1. Missions, save v10, the Missions button and screen, and tests.
2. EventService, Beacon Surge, Rift Hunt, the Events hub, and tests.
3. Rift Exchange, balance pass, art integration, README, and the full suite.

Placeholder icons are used until your art arrives.
