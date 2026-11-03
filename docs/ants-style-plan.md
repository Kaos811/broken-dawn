# Ants-style map labels, fonts and creatures: plan (mockup only, not shipped)

References: `/workspace/artwork/ref/ants-base.jpg`, `/workspace/artwork/ref/ants-creatures.jpg`.
Mockups (local, reverted, game code untouched):
- `screens/ants-style-labels-before.png` / `screens/ants-style-labels-after.png` (creatures, nodes, Behemoth; same map view)
- `screens/ants-style-nameplate-before.png` / `screens/ants-style-nameplate-after.png` (rival base)
- Mockup script kept at `/tmp/ants-shot.mjs` on the box. It injects the new labels at runtime and does not change src/.

## 1. What the Ants refs do
- **Creature and node label:** a small, square-ish dark box (about 28 px, about 4 px radius) holding the level number in white. The name sits beside it in a clean, light, medium-weight sans (not bold). It has a soft drop shadow, no outline and no background pill, and it sits on the ground just below the sprite.
- **Base nameplate:** a round medal above the name (a gold ring, a dark purple centre, the level number), then `(TAG)Name` on one line. The tag and name share a colour (light blue), with a faint dark backing strip. It is compact and low on the base footprint.
- **Creatures:** realistic, highly detailed painted animals at a natural scale. They are similar in size to or smaller than the lair, have soft contact shadows, and are lit the same way as the terrain (from the top-left). They read as being on the ground, not as icons.

## 2. Audit (current Broken Dawn)
- **Fonts:** all text uses the `system-ui` stack. It is defined three times (`src/ui/widgets.js`, `src/scenes/WorldScene.js`, `src/scenes/BaseScene.js`), and the WorldScene victory text hard-codes it too. No web font is bundled.
- **Map labels:** `WorldScene.plaque()` draws a bold, 22–26 px label on a dark `#07090dcc` rectangle pill.
  - Creatures show `Lv N` (no name), with a 🔒 emoji when locked and amber text for elites.
  - The Behemoth shows `BEHEMOTH Lv N` in teal.
  - Nodes show `Lv N Alloy`.
  - Bases have two stacked pills: `[TAG] Name`, then `Lv N · Tier`.
  - Labels counter-scale with zoom (`1/zl`) and hide below `min` zoom. Keep both.
- **Creature sprites:** 256×256 WebP files in `src/art/world/creatures/`.
  - Display scale: 0.6 normal (≈154 px), 0.8 elite, 1.25 Behemoth, drawn 14 px (34 px for the Behemoth) above the tile centre over a lair decal.
  - There is no contact shadow. The art is a stylised, glowing "icon" render, so the creatures read as stickers floating above the lair.
  - Normal creatures are about the same size as a base, which is wrong for a natural scale.

## 3. Label restyle (as mocked)
- **Creatures and nodes:**
  - Level box: `0x0d0f12` at 88% opacity, 5 px radius, a 1 px gold `#c9a45a` stroke at 55% (the Broken Dawn touch), and the number in Source Sans 3 600, 21 px, white.
  - Name: Source Sans 3 600, 22 px, `#f4efe4`, with a shadow of (0, 1.5, black, blur 5). No pill.
  - Colour accents: the Behemoth name in teal `#8ff7e6`, Alloy in `#9ff3e6`, locked creatures in grey `#aab3c0` with the box tinted grey instead of the 🔒 emoji (the emoji doesn't render in the web font), and elites with an amber name `#ffb347`.
  - Names use the singular form: Husk Scuttler, Rift Drone, Void Hound, Shard Golem, Dusk Wyrm, Behemoth.
  - Busy (attacked or rallied) creatures get a small ⚔ glyph in the box corner instead of a text prefix.
- **Bases:**
  - A round level medal (r ≈ 18): a gold ring `#b8862c`/`#f3d27a`, a dark teal centre `#1a2a2e`, a thin teal inner ring `#46d6c8`, and the number in Source Sans 3 700 `#ffe9b0`.
  - Below the medal, on one line, the tag `(TAG)` in teal `#6fe3ff` and the name in `#f4efe4` (gold for your own base), on a faint rounded strip (black at 45%).
  - The `Lv N · Tier` second line is dropped from the map (it moves into the base's tap panel).
- **Implementation:**
  - Replace `plaque()` for these labels with a `levelTag(x, y, lv, name, style)` helper that returns a Container with `setText`, `setLevel` and `setColor`, so the `labels[]` zoom fitting (`setScale(1/zl)`) and `min` hiding keep working.
  - Move the `FONT` constants into one export.
  - The mockup containers did not join `labels[]`, which is why they don't rescale after a zoom change in the nameplate shot. The real helper must register with it.
  - Update the e2e label checks that read `badge.text` (`Lv N`, `BEHEMOTH Lv`).

## 4. Font choice
- **Labels and body:** Source Sans 3 (OFL, bundled locally from `@fontsource/source-sans-3`, latin 400/600/700 WebP-sized woff2 ≈ 3 × 20 KB). It's the closest free match to Ants' clean, humanist map font, readable at 18 px on phones, and has good digits for level boxes.
- **Titles only:** Cinzel 700 (latin, ≈ 25 KB) for modal titles, the VICTORY/DEFEAT banners, the BASE tab and scene headers. It fits the painted gold aesthetic; don't use it for numbers or small text.
- **Scope:** change it UI-wide, not just on the map. Mixing a web font on the map with `system-ui` in the HUD would look inconsistent, and the system stack renders differently on iOS, Android and Windows, which is the main reason Broken Dawn text looks "default" next to Ants. Roll it out in two steps:
  1. The map labels plus the single `FONT` export (low risk).
  2. The HUD and panels. Recheck the e2e layout checks ("leaves its panel" and text-fit checks), since Source Sans 3 is about 5% narrower than Segoe UI or Roboto.
- **Loading:** `@font-face` in `index.html` with `font-display: block`, and `await document.fonts.load(...)` before Phaser boots. Phaser rasterises text once, so a late font would leave fallback glyphs. The single-file build must inline the woff2 as base64 (≈ 85 KB).

## 5. Creatures: sizing and shadow changes
- **Natural scale:** creatures should be smaller than bases and similar in size to their lair.
  - Target on-map widths: Scuttler ≈ 90 px, Drone ≈ 100, Hound ≈ 115, Golem ≈ 130, Dusk Wyrm (elite) ≈ 160, Behemoth ≈ 300 (it stays dominant).
  - Set the scale from the displayed width (`setScale(W / img.width)`) instead of fixed 0.6/0.8/1.25, so the art resolution can change freely.
- **Grounding:**
  - Set the origin at the feet (`setOrigin(0.5, 0.85)`) at the tile centre, with no 14/34 px lift.
  - Add a soft contact-shadow ellipse beneath (black at 35–40%, width ≈ 70% of the sprite, height ≈ 18%, slightly offset down-right to match top-left light). Previewed in the mockup under each creature.
  - Use a shared blurred `shadow` frame from the `wmap` atlas instead of a hard-edged ellipse.
- **Lair decal:** shrink it to about 1.2× the creature width and lower its alpha to about 0.8, so the creature isn't framed like an icon.
- **Glow:** keep the teal and gold rift glow inside the painting, with no ADD-blend halo, and keep the existing grey tint for locked creatures.
- **Art pipeline:** generate on magenta at 1024² → slice, key out the magenta, trim → export WebP at 384² (2× the largest display size except the Behemoth, which is 512²) → `src/art/world/creatures/cr-<id>.webp`. The cost is zero.

## 6. GenerateImage prompts (one per creature)
All prompts share a style block (appended to each prompt):
> Style: realistic, highly detailed digital painting like a premium mobile strategy game world map (Ants: Underground Kingdom quality), natural anatomy, fine surface texture, soft top-left key light, subtle rim light, believable weight. Broken Dawn rift palette: weathered dark bodies with veins and cracks of glowing teal (#2fe0c8) and burnished gold (#c9a45a) accents, never neon or cartoon. Camera: 3/4 top-down view at about 50° (matching an isometric-ish strategy map), creature facing lower-left, whole body in frame, centered, standing on nothing. Background: flat solid pure magenta #FF00FF, no ground, no cast shadow, no text, no border, no glow bleeding onto the background, crisp clean silhouette edges for chroma keying.

1. **Husk Scuttler:** "A hollowed, beetle-like husk insect the size of a large dog. A cracked chitin carapace in dusty bone and umber tones, split along the back to reveal faint teal light inside, six jointed spindly legs with hooked tips, small serrated mandibles, tarnished gold flecks on the shell edges, dry and brittle like a shed exoskeleton."
2. **Rift Drone:** "A large winged rift wasp-drone hovering low. A segmented dark violet-black abdomen with glowing teal bands, four translucent veined wings with gold-tinted edges caught mid-beat, a long stinger, compound eyes glinting teal, thin dangling legs, faint teal motes trailing from the wings."
3. **Void Hound:** "A lean, muscular void hound, wolf-like but insectile: a plated dark slate hide with chitin scales along the spine, teal light glowing through cracks in its ribs and eyes, a long jaw with gold-stained fangs, mid-stride stalking pose, a wispy dark tail dissolving into teal smoke."
4. **Shard Golem:** "A hulking stone and crystal golem on four thick legs like a giant armored beetle. Its body is built from dark basalt slabs bound by veins of glowing teal crystal, jagged teal shard clusters erupting from its back, gold mineral seams in the rock, heavy and slow, with moss and dust on the lower plates."
5. **Dusk Wyrm (elite):** "A coiled serpentine wyrm with an armored centipede-like body. Rust-red and dark bronze overlapping plates, rows of short legs along its length, a horned head reared up with glowing ember-orange eyes and faint teal throat light, frayed gold-edged frills, coils resting heavily on themselves."
6. **Rift Behemoth (world boss):** "A colossal rift behemoth, a massive horned beast crossed with an armored ant queen: a hunched, plated dark-obsidian body, enormous teal crystal spikes along the spine and shoulders, burnished gold horn caps and armor rims, glowing teal cracks across its chest, thick clawed legs planted wide, menacing but grounded, scale reading as huge."

Negative or avoid (add if the tool supports it): cartoon, chibi, flat icon, sticker outline, heavy black outline, text, watermark, ground plane, drop shadow, gradient background.
