# Broken Dawn vs. The Ants: Underground Kingdom — gap review (stage 14)

Sources (Oct 2026): TechForNerd beginner guide, MrGuider tips, BlueStacks TAUK guide, r/SwagBucks TAUK guide,
official TAUK forum "Alliance – Active Rewards" (theantsforum.allstarunion.com).

## TAUK core loops (summary)
| Loop | How TAUK does it |
|---|---|
| Base building | Queen Anthill gates every building's level; many nests; 1–2 build queues. |
| Main quest chain | "Follow main tasks first": a single always-visible next task with a reward that walks you through the whole early game. |
| Troops | Guardian / Shooter / Carrier ants (tank / ranged / carry), tiers, mutation, healing pool. |
| World map | Hunt creatures (stamina), **gather** Meat/Plants/Wet Soil/Sand from nodes with marches; carry load matters. |
| Research | Evolution tree (development + military). |
| Heroes | Special Ants: war ants lead marches, development ants boost gathering/building when stationed. |
| Alliance help | Every upgrade/research posts a help request; each ally tap cuts time (≈1% or 1 min), capped per job. |
| Alliance rally | Rally lizards / bosses together. |
| Dailies | Daily tasks with activity chests, daily login, Benefits tab. |
| Events | Hourly "Colony Action", weekly "Strongest Warzone" themed days, bait creatures. |
| VIP | Paid/points VIP levels with passive buffs. |

## What Broken Dawn already has
Beacon gating (≈ Queen Anthill), 5 buildings + single builder, 3 classes × 3 tiers, training lanes, Infirmary,
world hunts with stamina, Auto-hunt, reports, research (Archive), leaders + gacha + gear, Daily Missions with
activity chests, daily reward, two weekly events, speed-up items, stage 13 onboarding with Lyra.

## Gaps ranked (value ÷ effort, client-side and zero-cost only)
| # | Gap | Value | Effort | Risk | Decision |
|---|---|---|---|---|---|
| 1 | **Chapter quest chain** (always-visible next goal + reward) | High: TAUK's main retention spine after the tutorial; BD's players lose direction after stage 13 | Low | Low (read-only checks on state) | **Build (stage 14)** |
| 2 | **Crew Help** on builds/research (≈ alliance help, simulated by the base crew) | High: the "tap for free time" feel, social-ish | Low | Low (uses existing speed-up hooks, capped) | **Build (stage 14)** |
| 3 | **Gathering marches to Alloy crystal nodes** on the world map | High: second world-map loop, gives stamina-free activity | Medium–High (nodes, march type, world-map art, balance) | Medium (world state, march code, save) | Defer to stage 15: needs a painted node sprite |
| 4 | Idle production "collect" bubbles (tap buildings to collect stored Alloy) | Medium | Medium (changes economy from continuous to stored) | Medium (balance, offline) | Defer |
| 5 | Rally (multi-squad attack on elites/bosses) | Medium | Medium | Medium | Defer: needs a boss creature + battle multi-army |
| 6 | Development-type leaders stationed in buildings | Medium | Medium | Low | Defer: needs leader art/roles |
| 7 | Hourly "Colony Action" mini-events | Medium | Low–Medium | Low | Candidate for stage 15 |
| 8 | Real alliances / PvP / Strongest Warzone | High | Very high (backend) | — | Out of scope (no backend) |
| 9 | VIP | Low for BD (monetisation) | — | — | Skip (no spending) |

## New art wanted (not made, listed for Jason)
- Painted Alloy crystal node (teal crystals in gold-veined rock), 3 sizes — for gathering (gap 3).
- Painted "crew help" hand/emblem icon in gold-and-teal (stage 14 reuses the existing Builder icon for now).
- Painted quest-scroll icon for the chapter goal bar (stage 14 reuses the Missions icon).
