# Icon audit (stage 15 prep)

Style target: painted, gold-rimmed, teal-glow sci-fi icons, like `src/art/ui/hud-*.webp`, `nav-*.webp` and `item-su-*.webp`.
Deliver each as a square, transparent-background WebP at the "deliver" size.
Screens: `screens/icon-audit-{base,more,settings,troops,leaders,squads,infirmary,world}.png`. Offenders contact sheet: `screens/icon-audit-offenders.png`. Regenerate the screens with `node tests/icon-audit-shots.mjs` after `npm run build`.

**Already painted (fine):** HUD resources (energy/alloy/shards/core/power/stamina), nav tabs, More-sheet tiles (Rewards, Power, Leaders, Research, Events, Items), Missions, Exchange, chests, items and speed-ups, gear, leaders, troops, creatures, rift mark, and the onboarding art.

## Offenders

| # | Icon | Where | Current code | On-screen size, deliver size | Painted replacement |
|---|---|---|---|---|---|
| 1 | Builder | left queue button | `UIScene.createSideColumns` `ic.builder` (drawn T-hammer) | 56px, 128 | crossed hammer and wrench, brass head, teal-lit grip |
| 2 | Training | left queue button | `ic.training` (outline person) | 56px, 128 | soldier helmet with teal visor over a crossed-rifles plate |
| 3 | Healing | left queue button | `ic.healing` (flat green cross) | 56px, 128 | medkit/vial with glowing teal-green cross, gold clasp |
| 4 | Goal | right column (stage 14) | `src/ui/stage14.js` drawn flag | 56px, 128 | quest scroll or banner on a gold pole, teal wax seal |
| 5 | Help | right column (stage 14) | `stage14.js` drawn swirl | 56px, 128 | two clasped gauntlet hands, teal glow (crew-help emblem) |
| 6 | Cores "+" | top bar | `UIScene` `corePlus` drawn plus | 34px, 64 | gold-rim round gem button with a raised teal plus |
| 7 | Place chip 🏗 | "New: build the X" chip | `UIScene.js:506` emoji | 24px, 64 | small crane over a blueprint, gold and teal |
| 8 | Star ★/☆ | leader stars, squad power, troop power | `skin.glyph('star')`, text ★ in `armory.js` and `squads.js` | 20-28px, 64 (+ empty variant) | faceted gold star; empty = dark socket with a teal rim |
| 9 | HP heart | troop and squad stats | `glyph('hp')` | 20px, 64 | red-crystal heart in a gold setting |
| 10 | ATK sword | stats, "Combat power" | `glyph('atk'/'sword')` | 20px, 64 | gold blade with teal edge-glow |
| 11 | DEF shield | stats | `glyph('def'/'shield')` | 20px, 64 | kite shield, blue-teal face, gold rim |
| 12 | Clock / speed | train time, price tags | `glyph('clock'/'speed')` | 20px, 64 | brass pocket-chronometer, teal dial |
| 13 | Lock 🔒 | troop tiers, squads, world creature badges, Citadel title | `glyph('lock')`, emoji in `troops.js`, `squads.js`, `WorldScene.js`, `world.js`, `UIScene.js:1399` | 18-26px, 64 | heavy gold padlock with teal keyhole glow |
| 14 | Squad / troops | squads screen | `glyph('squad'/'troops')` | 20px, 64 | three helmet silhouettes, gold-edged |
| 15 | Beds / heal | infirmary header and rows | `glyph('beds'/'heal')` | 20px, 64 | med-bay cot with teal cross |
| 16 | Sound 🔊/🔇 | Settings buttons | `UIScene.js:1500` emoji | 24px, 64 ×2 | brass speaker with teal waves; muted = red slash |
| 17 | Haptics 📳/📴 | Settings buttons | `UIScene.js:1501` emoji | 24px, 64 ×2 | handheld with gold vibration arcs; off = dimmed with slash |
| 18 | Attack ⚔ (busy) | world creature badge, info line | `WorldScene.js:251`, `world.js:184` emoji | 18px, 64 | crossed gold swords, teal spark |
| 19 | Warning ⚠ | upgrade panel reason | `UIScene.js:1334` | 20px, 64 | amber triangle plate, riveted gold |
| 20 | Misc glyphs: lanes, cap, bolt/charge, anchor, move, up | troop/squad/research rows | `skin.glyph` | 20px, 64 each | painted mini-icons in the same set; lowest priority |

**Keep as text (fine as typography):** ✓ (claimed), ✕ (close), → / ↩ (march direction, before/after). Optional: a painted close button.
**Optional:** the More → Settings tile reuses `nav-more` (same gear as the More tab). A distinct painted cog-and-slider would read better.
**Not in use:** the drawn fallbacks for speed-ups and item plates in `src/ui/speedups.js`, because painted art exists for all of them.

## Integration notes (for step 2)
- Name the files `src/art/ui/<key>.webp`. Suggested keys: `q-builder`, `q-training`, `q-healing`, `hud-goal`, `hud-help`, `hud-plus`, `ic-place`, `ic-star`, `ic-star-empty`, `ic-hp`, `ic-atk`, `ic-def`, `ic-clock`, `ic-lock`, `ic-squad`, `ic-beds`, `ic-sound-on`, `ic-sound-off`, `ic-haptics-on`, `ic-haptics-off`, `ic-attack`, `ic-warn`.
- Queue icons: `roundButton` already accepts a texture key, as Research does with `more-research`.
- Glyphs: in `skin.glyph()`, draw `ic-<kind>` as an image when that texture exists. Emoji inside text strings need an inline image beside the text.

## Stage 15 status (painted icons wired)
Done: queue buttons (Builder/Training/Healing), Goal, Help, Cores "+", skin glyphs (clock, beds/heal, squad/troops, def/shield, atk/sword, hp, lock, star + empty star),
leading-emoji labels via `attachLeadIcon` (🔒 🏗 🔊 🔇 📳 📴 ⚠ ⚔ ★), Armory star row, world Lv badges and RIFT CITADEL plaque.
Kept as text: ✓ ✕ → ↩, and ★ inside sentences / counts ("5★", "★ Up" button keeps leading icon). Sheet D skipped.
After shots: screens/icons-after-*.png.
