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
# ---- stage 12b: painted sheets on flat magenta (keyed + despilled, sliced by bounding box, native resolution)
import sys; sys.path.insert(0, '/workspace/artwork')
import numpy as np
from collections import deque
from keylib import key
def components(mask):
    H, W = mask.shape; lab = np.zeros((H, W), int); n = 0; boxes = []
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                n += 1; q = deque([(y, x)]); lab[y, x] = n; ys = [y, y]; xs = [x, x]; cnt = 0
                while q:
                    cy, cx = q.popleft(); cnt += 1
                    ys[0] = min(ys[0], cy); ys[1] = max(ys[1], cy); xs[0] = min(xs[0], cx); xs[1] = max(xs[1], cx)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]: lab[ny, nx] = n; q.append((ny, nx))
                boxes.append((cnt, n, xs[0], ys[0], xs[1], ys[1]))
    return lab, boxes
def slice_sheet(path, count, order, bridge=1, rgb_from=None):
    a = np.asarray(key(Image.open(path).convert('RGB'), enclosed=True, gold=False, enc_res=40, enc_k=0.55)).copy()
    if rgb_from:  # stage 18b: same cut-out/anchors as `path`, colours from a recoloured copy of the sheet (Beacon-gold glows)
        a[..., :3] = np.asarray(key(Image.open(rgb_from).convert('RGB'), enclosed=True, gold=False, enc_res=40, enc_k=0.55))[..., :3]
    S = 4
    small = a[::S, ::S, 3] > 60
    if bridge > 1: small = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(bridge))) > 0  # bridge thin flag poles
    lab, boxes = components(small)
    big = sorted([b for b in boxes if b[0] > 150], key=lambda b: -b[0])[:count]
    big.sort(key=order)
    out = []
    for b in big:
        _, n, x0, y0, x1, y1 = b
        X0, Y0, X1, Y1 = max(0, x0 * S), max(0, y0 * S), min(a.shape[1], (x1 + 1) * S), min(a.shape[0], (y1 + 1) * S)
        crop = a[Y0:Y1, X0:X1].copy()
        others = np.isin(lab, [o[1] for o in big if o[1] != n])
        om = np.kron(others, np.ones((S, S), bool))[:a.shape[0], :a.shape[1]][Y0:Y1, X0:X1]
        crop[om, 3] = 0
        im2 = Image.fromarray(crop, 'RGBA')
        bb = im2.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
        out.append(im2.crop((max(0, bb[0] - 3), max(0, bb[1] - 3), min(im2.width, bb[2] + 3), min(im2.height, bb[3] + 3))))
    return out
def split_flag(img):
    """White flag cloth -> its own layer (tinted in game); the base keeps the pole."""
    a = np.asarray(img).astype(np.int16)
    mn, mx = a[..., :3].min(2), a[..., :3].max(2)
    H = a.shape[0]
    cloth = (mn > 175) & (mx - mn < 45) & (a[..., 3] > 30)
    cloth[int(H * 0.45):] = False  # flags sit on top
    lab, boxes = components(cloth)  # keep only the flag (largest white blob), not spire highlights
    if boxes: cloth = lab == max(boxes)[1]
    cm = np.asarray(Image.fromarray((cloth * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    soft = cm & (mn > 120) & (mx - mn < 60)  # anti-aliased cloth edge
    flag = np.zeros_like(a); base = a.copy()
    lum = a[..., :3].mean(2)
    flag[..., :3] = np.clip(lum * 1.08, 0, 255)[..., None]; flag[..., 3] = np.where(soft, a[..., 3], 0)
    base[..., 3] = np.where(soft, 0, a[..., 3])
    return Image.fromarray(base.astype(np.uint8), 'RGBA'), Image.fromarray(flag.astype(np.uint8), 'RGBA')

RAW = '/workspace/artwork/raw/'
tiers = slice_sheet(RAW + 'world-base-tiers.jpg', 5, lambda b: b[2], bridge=3, rgb_from=RAW + 'base-tiers-gold.jpg')
for i, t in enumerate(tiers):
    base_l, flag_l = split_flag(t)
    pieces[f'base-t{i + 1}'] = base_l; pieces[f'flag-t{i + 1}'] = flag_l
a_cl = slice_sheet(RAW + 'world-citadel-lairs.jpg', 5, lambda b: (-(b[4] - b[2]) * (b[5] - b[3]) > -1))  # any order
a_cl.sort(key=lambda im: -im.width * im.height)
pieces['citadel'] = a_cl[0]
# the 4 lairs: rebuild order by their position on the sheet (top-left, top-right, bottom-left, bottom-right)
lairs = slice_sheet(RAW + 'world-citadel-lairs.jpg', 5, lambda b: (b[2] < 120, (b[3] + b[5]) / 2 > 72, b[2]))[:4]
for k, im2 in zip(['lair-burrow', 'lair-roost', 'lair-nest', 'lair-tower'], lairs): pieces[k] = im2
# concept crops still used as decor (crystal nodes, rubble ruins, a crater)
for i, b in enumerate([(12, 505, 68, 572), (352, 660, 428, 728), (218, 876, 278, 938), (486, 150, 528, 198)]):
    pieces[f'crystal-{i + 1}'] = up(feather(crop(b), soft=0.3), 1.4)
pieces['lair-crater'] = up(feather(crop((8, 698, 82, 772)), soft=0.3), 1.4)
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

# --- pack the atlas (shelf packer, transparent margins trimmed; Phaser restores them via spriteSourceSize)
trim = {}
for k, p in pieces.items():
    bb = p.getchannel('A').getbbox() or (0, 0, 1, 1)
    trim[k] = (p.crop(bb), bb, p.size)
items = sorted(trim.items(), key=lambda kv: -kv[1][0].height)
AW, x, y, sh, frames = 2048, 0, 0, 0, {}
for k, (p, bb, full) in items:
    if x + p.width + 2 > AW: x, y, sh = 0, y + sh + 2, 0
    frames[k] = (x, y, p.width, p.height); x += p.width + 2; sh = max(sh, p.height)
AH = 1 << math.ceil(math.log2(y + sh))
atlas = Image.new('RGBA', (AW, AH), (0, 0, 0, 0))
for k, (p, bb, full) in items: atlas.paste(p, frames[k][:2])
atlas.save(f'{OUT}/world-atlas.webp', quality=88, method=6)
json.dump({'frames': {k: {'frame': dict(zip('xywh', v)), 'rotated': False, 'trimmed': True, 'sourceSize': {'w': trim[k][2][0], 'h': trim[k][2][1]},
                          'spriteSourceSize': {'x': trim[k][1][0], 'y': trim[k][1][1], 'w': v[2], 'h': v[3]}} for k, v in frames.items()},
           'meta': {'image': 'world-atlas.webp', 'size': {'w': AW, 'h': AH}, 'scale': 1}}, open(f'{OUT}/world-atlas.json', 'w'), indent=0)
print('atlas', AW, AH, len(frames), 'frames')
