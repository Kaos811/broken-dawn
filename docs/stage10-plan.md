# Stage 10 plan: Speed-ups (PLAN ONLY, no code yet)

## 1. What exists today
- **Construction** (`CONSTRUCTION` in src/config.js): 1 builder. Time to reach a level: Lv2 10 s, Lv3 30 s, Lv4 2 m, Lv5 6 m, Lv6 20 m, then x3 per level: Lv7 1 h, Lv8 3 h, Lv9 9 h, Lv10 27 h, Lv11 81 h ... Buildings cap at Lv 20, so the x3 curve runs away (Lv12 ~10 days, Lv20 is years). **This curve needs a fix no matter what we do with speed-ups (see open questions).**
- **Hooks with no UI:** `store.speedUpConstruction(id, seconds)`, `store.speedUpCoreCost(id)` (1 Core per 300 s, `CONSTRUCTION.speedUp.secondsPerCore`), and `store.speedUpResearch(seconds)`. Training and healing have no speed-up hooks.
- **Research:** 30 s, 2 m, 8 m, 30 m, 2 h per node level (x3 after that). Tier II 20 m, Tier III 2 h.
- **Training:** 4–5 s per T1 unit (x1.8 for T2, x3 for T3), 3 lanes of 50 that run in parallel. A full lane is about 4–12 min.
- **Healing:** 4–5 s per unit (x1.5 / x2.2 by tier), one queue.
- **Cores (earned only, never bought):** daily login 1/day (+3 every 7th day in a row), +3 per Beacon level, 9 from one-time milestones, 24 from first kills (ever), 1/day from the 100-point mission chest, up to 2 per event (2 events a week), 1 a week from the Rift Exchange (200 Marks). That's about 22 a week for an active player, and Cores are also what recruitment pulls cost (1 per pull, 10 for x10).

## 2. Proposal

### Speed-up items
Seven inventory items: **1m, 5m, 15m, 1h, 3h, 8h, 24h**. They're kept in `state.items.speedups`, stack without limit and never expire. This needs a save bump to v11 that adds an empty inventory.

### What they apply to
- **General speed-ups** work on **construction and research**, where waits get long.
- **Training and healing: no items.** Queues there are minutes long, and lanes already run in parallel. Instead, both get the free finish below and a Core finish. (Open question: make training items later if T3 lanes get long.)

### Free finish
Any construction or research job with **5:00 or less** remaining shows a gold **Free** button that finishes it right away. It's the standard mobile 4X feel, and it makes Lv2–5 upgrades instant in practice. (Research can raise it to 10 m later via an Archive node; not in this stage.)

### Core instant finish
Keep the existing rate in the hook, but tier it so it stays fair on long timers:
- 1 Core per 5 min, rounded up, for the first hour (≤12 Cores)
- after that, 1 Core per 15 min (8 h ≈ 40 Cores)
- Cores are shown on the button, and a confirm pops up when it costs **5 Cores or more**.
- Training and healing finish: 1 Core per 10 min left (minimum 1).

Cores stay earned-only. Speed-ups never cost real money.

### Sources (everything stays earned)
| Source | Adds per day / event |
|---|---|
| Daily mission chests | 20 pts: 1x 5m · 40: 1x 15m · 60: 2x 5m · 80: 1x 1h · 100: 1x 15m (plus the current rewards) |
| Daily login | 1x 15m, and 1x 3h on every 7th day in a row |
| Event milestones (both events) | M1 1x 15m · M2 2x 15m · M3 1x 1h · M4 1x 3h · M5 1x 8h |
| Rift Exchange | 5m x10 for 5 Marks each · 1h x3 for 30 Marks · 8h x1 for 120 Marks (limits weekly, Monday 00:00 UTC) |
| Beacon level-up | 1x 1h per new level, plus 1x 8h at Lv 5 and 1x 24h at Lv 10 |
| One-time milestones | 3x 5m with the first upgrade (in the tutorial, to teach the button) |

### UI
- **Speed Up** button (teal, painted kit) next to each running timer: the building panel, the Builder/Research side timers on the Base, Archive research row, and the Barracks/Infirmary lanes (those offer Free/Core only).
- When ≤5:00 remain, the button changes to gold **Free**.
- **Picker** (a modal in the Stage 9 kit): the time left at the top with a live bar; one row per item you own (icon, count, "−1h", **Use** and **Use x N**); an **Auto-use** button that picks the fewest items that cover the time without wasting more than 5 minutes (biggest first, then fill in with smaller ones), with a preview ("uses 2x 1h + 1x 15m"); and the **Finish for N Cores** button at the bottom.
- Items are listed under More → **Items** (a simple inventory).
- e2e checks: the picker at all 6 layout sizes, auto-use math, the free finish at 5:00, Core cost tiers, save migration v10→v11, and Base Power/unlocks applying when a sped-up job finishes.

## 3. Balance note: a typical active week
- From missions (all chests, 7 days): 7x(3x 5m + 2x 15m + 1x 1h) ≈ **13.75 h**
- Login: 7x 15m + 1x 3h ≈ **4.75 h**
- Two events, all milestones: 2x(45m + 1h + 3h + 8h) ≈ **25.5 h**
- Rift Exchange (if Marks go to it): up to ~11.8 h
- **Total ≈ 44 h a week (≈ 56 h with the Exchange)**, plus level-up items.
- With one builder, that's about one Lv10 upgrade (27 h) plus a couple of Lv9s a week **on top of** real time. Speed-ups take about 25–35% off a week's waiting, which feels like a real help but doesn't let you skip the game.
- Cores: an 8 h finish costs about 40 Cores, close to two weeks of income, so spending Cores on time competes with recruitment. That's intended: items are the main speed-up tool and Cores are for emergencies.

## 4. Open questions for Jason
1. **Fix the construction curve first?** x3 per level from Lv6 makes Lv12+ take weeks to years. A suggestion: x1.6 per level after Lv8, capped at about 3 days, or a hand-tuned table to Lv20.
2. Should speed-ups also cover **training and healing** as items, or keep just Free/Core there (proposed)?
3. Free finish window: **5 min** (proposed), or grow it with a research node later?
4. Should Cores work for finishing at all, or only for recruitment (items + Free only)?
5. A second builder later (a common 4X reward) would also ease waits. In scope for later?
