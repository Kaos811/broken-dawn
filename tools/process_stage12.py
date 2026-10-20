#!/usr/bin/env python3
"""Stage 12: painted world-map art, sliced out of artwork/raw/world-concept-stronghold.jpg (720x1280).
Objects sit on painted ground, so instead of keying we cut them with a soft (feathered) elliptical mask;
the world ground is synthesised from the same concept's ground patches, so the edges blend in.
Also paints a few procedural pieces (fissure, road, fog, banner, crown, dome glow) in the same palette.
Output: src/art/world/world-atlas.webp + world-atlas.json (Phaser JSON-hash atlas) and world-ground.webp
(1024 px seamless tile). Re-run any time:  python3 tools/process_stage12.py"""
import json, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance

SRC = '/workspace/artwork/raw/world-concept-stronghold.jpg'
OUT = 'src/art/world'
S = 1.25  # boxes below are in 576x1024 preview coordinates
im = Image.open(SRC).convert('RGB')

def crop(box):
    return im.crop(tuple(round(v * S) for v in box))

def feather(img, fx=0.47, fy=0.47, soft=0.18, top_soft=False):
    w, h = img.size
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    inset = soft * min(w, h) * 0.5
    d.ellipse((w * (0.5 - fx) + inset, h * (0.5 - fy) + inset, w * (0.5 + fx) - inset, h * (0.5 + fy) - inset), fill=255)
    if top_soft:  # keep spires: extend the mask upward as a rectangle
        d.rectangle((w * 0.25, 0, w * 0.75, h * 0.5), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(inset * 0.9 + 1))
    out = img.convert('RGBA'); out.putalpha(m)
    return out

def up(img, scale):
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)

pieces = {}
# --- player-base tiers (Lv1-4 outpost, 5-9 walled camp, 10-14 fortress, 15-19 citadel, 20 stronghold)
pieces['base-t1'] = up(feather(crop((22, 580, 108, 660))), 1.5)
pieces['base-t2'] = up(feather(crop((128, 180, 218, 258))), 1.6)
pieces['base-t3'] = up(feather(crop((352, 836, 448, 940))), 1.6)
pieces['base-t4'] = up(feather(crop((372, 150, 448, 248)), top_soft=True), 1.8)
pieces['base-t5'] = up(feather(crop((182, 648, 290, 760)), top_soft=True), 1.8)
# --- Rift Citadel with its golden dome rings
pieces['citadel'] = feather(crop((70, 255, 510, 640)), fx=0.5, fy=0.5, soft=0.12)
# --- crystal nodes, lairs, ruins
for i, b in enumerate([(12, 505, 68, 572), (352, 660, 428, 728), (218, 876, 278, 938), (486, 150, 528, 198)]):
    pieces[f'crystal-{i + 1}'] = up(feather(crop(b), soft=0.3), 1.4)
pieces['lair-1'] = feather(crop((118, 28, 262, 142)), soft=0.3)
pieces['lair-2'] = feather(crop((335, 58, 497, 152)), soft=0.25)
pieces['lair-3'] = up(feather(crop((8, 698, 82, 772)), soft=0.3), 1.4)
pieces['ruin-1'] = up(feather(crop((488, 812, 562, 882)), soft=0.3), 1.4)
pieces['ruin-2'] = feather(crop((218, 798, 322, 872)), soft=0.3)
pieces['ruin-3'] = up(feather(crop((18, 700, 82, 772)), soft=0.3), 1.2)

rng = random.Random(12)
TEAL, CYAN, GOLD = (32, 210, 190), (90, 240, 255), (255, 190, 80)

def fissure(w=320, h=80):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    pts, x, y = [], 8, h / 2
    while x < w - 8:
        pts.append((x, y)); x += rng.uniform(10, 22); y = max(14, min(h - 14, y + rng.uniform(-9, 9)))
    pts.append((w - 8, h / 2))
    for width, col, blur in [(14, (*TEAL, 90), 8), (6, (*TEAL, 200), 3), (2, (220, 255, 250, 255), 0)]:
        l = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
        d.line(pts, fill=col, width=width, joint='curve')
        for (px, py) in pts[1:-1:3]:  # side cracks
            a = rng.uniform(-1, 1) + (math.pi / 2 if rng.random() < .5 else -math.pi / 2)
            ln = rng.uniform(6, 16); d.line([(px, py), (px + math.cos(a) * ln, py + math.sin(a) * ln)], fill=col, width=max(1, width // 2))
        if blur: l = l.filter(ImageFilter.GaussianBlur(blur))
        img = Image.alpha_composite(img, l)
    # fade the ends
    m = Image.linear_gradient('L').rotate(90, expand=True).resize((w, h))
    m = ImageChops.multiply(m, m.transpose(Image.FLIP_LEFT_RIGHT)).point(lambda v: min(255, v * 4))
    a = ImageChops.multiply(img.getchannel('A'), m); img.putalpha(a)
    return img
pieces['fissure-1'] = fissure(); pieces['fissure-2'] = fissure(260, 70)

def road(w=256, h=72):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle((0, 18, w, h - 18), fill=(150, 118, 78, 150))
    for _ in range(140):  # cracked slabs + rubble
        x, y = rng.uniform(0, w), rng.uniform(16, h - 16); s = rng.uniform(2, 9)
        c = rng.choice([(98, 80, 60), (176, 142, 96), (70, 58, 46)])
        d.polygon([(x, y - s), (x + s, y), (x, y + s * .7), (x - s * .8, y)], fill=(*c, rng.randint(120, 230)))
    for _ in range(8):
        x = rng.uniform(0, w); d.line([(x, 18), (x + rng.uniform(-14, 14), h - 18)], fill=(60, 48, 38, 160), width=2)
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rectangle((0, 22, w, h - 22), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(7))
    holes = Image.new('L', (w, h), 255); hd = ImageDraw.Draw(holes)
    for _ in range(3):
        x = rng.uniform(20, w - 20); hd.ellipse((x - 16, 10, x + 16, h - 10), fill=rng.randint(40, 140))
    holes = holes.filter(ImageFilter.GaussianBlur(6))
    img.putalpha(ImageChops.multiply(ImageChops.multiply(img.getchannel('A'), m), holes).point(lambda v: min(255, int(v * 1.3))))
    return img
pieces['road'] = road()

def fog(sz=256, seed=0):
    r = random.Random(seed); img = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
    for _ in range(26):
        x, y, s = r.uniform(.25, .75) * sz, r.uniform(.3, .7) * sz, r.uniform(.12, .26) * sz
        l = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
        g = r.randint(48, 78)
        ImageDraw.Draw(l).ellipse((x - s, y - s * .7, x + s, y + s * .7), fill=(g, g + 4, g + 8, r.randint(60, 120)))
        img = Image.alpha_composite(img, l.filter(ImageFilter.GaussianBlur(s * .45)))
    return img
pieces['fog-1'] = fog(seed=1); pieces['fog-2'] = fog(seed=2)

def banner():  # white so it can be tinted to any alliance colour
    w, h = 56, 96; img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle((6, 0, 10, h), fill=(52, 46, 40, 255)); d.ellipse((3, 0, 13, 9), fill=(214, 168, 80, 255))
    d.polygon([(10, 8), (50, 8), (50, 58), (30, 70), (10, 58)], fill=(236, 236, 236, 255))
    d.line([(10, 8), (50, 8), (50, 58), (30, 70), (10, 58)], fill=(150, 150, 150, 255), width=2)
    d.polygon([(30, 22), (38, 36), (30, 50), (22, 36)], fill=(255, 255, 255, 255))
    for _ in range(90):  # painterly weathering
        x, y = rng.uniform(11, 49), rng.uniform(9, 64); v = rng.randint(170, 235)
        d.point((x, y), fill=(v, v, v, 255))
    return img.filter(ImageFilter.SMOOTH)
pieces['banner'] = banner()

def crown():
    w, h = 96, 64; img = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    pts = [(8, 56), (8, 20), (26, 38), (48, 6), (70, 38), (88, 20), (88, 56)]
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(glow).polygon(pts, fill=(255, 200, 90, 150))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(6))); d = ImageDraw.Draw(img)
    d.polygon(pts, fill=(214, 160, 62, 255)); d.line(pts + [pts[0]], fill=(120, 80, 30, 255), width=3)
    d.rectangle((8, 46, 88, 56), fill=(186, 132, 48, 255))
    for x in (28, 48, 68): d.ellipse((x - 5, 46, x + 5, 56), fill=(60, 230, 210, 255))
    for (x, y) in [(8, 20), (48, 6), (88, 20)]: d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(255, 226, 150, 255))
    return img
pieces['crown'] = crown()

def glow(sz=128, col=(255, 200, 100)):
    img = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
    for i in range(sz // 2, 0, -1):
        a = int(255 * (1 - i / (sz / 2)) ** 2.2)
        ImageDraw.Draw(img).ellipse((sz / 2 - i, sz / 2 - i, sz / 2 + i, sz / 2 + i), fill=(*col, a))
    return img
pieces['glow-gold'] = glow(); pieces['glow-teal'] = glow(col=(60, 230, 210))
pieces['shadow'] = glow(96, (0, 0, 0))

# --- seamless ground tile from concept ground patches (wrap-pasted feathered stamps)
patches = [(250, 165, 372, 252), (230, 90, 330, 160), (0, 400, 60, 480), (520, 430, 576, 500), (280, 840, 360, 880), (60, 470, 140, 520), (440, 300, 500, 360)]
GT = 1024
base = crop(patches[0]).resize((1, 1), Image.BOX).getpixel((0, 0))
ground = Image.new('RGB', (GT, GT), base)
stamps = [feather(crop(b), soft=0.6) for b in patches]
for k in range(420):
    st = stamps[k % len(stamps)]
    st = st.rotate(rng.choice([0, 90, 180, 270]), expand=True)
    if rng.random() < .5: st = st.transpose(Image.FLIP_LEFT_RIGHT)
    st = up(st, rng.uniform(1.3, 2.4))
    x, y = rng.randrange(GT), rng.randrange(GT)
    for dx in (-GT, 0, GT):
        for dy in (-GT, 0, GT):
            ground.paste(st, (x + dx - st.width // 2, y + dy - st.height // 2), st)
ground = ImageEnhance.Brightness(ground).enhance(0.92)
ground.save(f'{OUT}/world-ground.webp', quality=82)

# --- pack the atlas (simple shelf packer)
items = sorted(pieces.items(), key=lambda kv: -kv[1].height)
AW, x, y, sh, frames = 2048, 0, 0, 0, {}
for k, p in items:
    if x + p.width + 2 > AW: x, y, sh = 0, y + sh + 2, 0
    frames[k] = (x, y, p.width, p.height); x += p.width + 2; sh = max(sh, p.height)
AH = 1 << math.ceil(math.log2(y + sh))
atlas = Image.new('RGBA', (AW, AH), (0, 0, 0, 0))
for k, p in items: atlas.paste(p, frames[k][:2])
atlas.save(f'{OUT}/world-atlas.webp', quality=88, method=6)
json.dump({'frames': {k: {'frame': dict(zip('xywh', v)), 'rotated': False, 'trimmed': False, 'sourceSize': {'w': v[2], 'h': v[3]}, 'spriteSourceSize': {'x': 0, 'y': 0, 'w': v[2], 'h': v[3]}} for k, v in frames.items()},
           'meta': {'image': 'world-atlas.webp', 'size': {'w': AW, 'h': AH}, 'scale': 1}}, open(f'{OUT}/world-atlas.json', 'w'), indent=0)
print('atlas', AW, AH, len(frames), 'frames')
