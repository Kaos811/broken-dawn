# Stage 10b: painted item icons (one image per icon, magenta background) -> src/art/ui/item-*.webp, more-leaders.webp
# Drop the generated images in /workspace/artwork/raw/ with these names, then:
#   cd /workspace/artwork && python3 /workspace/broken-dawn/tools/process_stage10b.py
# Missing files are skipped (the game keeps its placeholder for those).
import os, sys
sys.path.insert(0, '/workspace/artwork')
from PIL import Image
from keylib import key, crop, RAW, PRE
SRC = '/workspace/broken-dawn/src/art/ui/'
FILES = {f'su-{t}': f'item-su-{t}' for t in ['m1', 'm5', 'm15', 'h1', 'h3', 'h8', 'h24']}
FILES.update({f'res-{r}': f'item-res-{r}' for r in ['energy', 'alloy', 'shards']})
FILES['more-leaders'] = 'more-leaders'
for raw, name in FILES.items():
    path = next((RAW + raw + e for e in ('.png', '.jpg', '.jpeg', '.webp') if os.path.exists(RAW + raw + e)), None)
    if not path: print('skip', raw); continue
    src = Image.open(path)
    # already keyed slices (tools/slice_stage10b.py) keep their alpha; flat magenta images get keyed here
    k = crop(src.convert('RGBA') if src.mode == 'RGBA' else key(src.convert('RGB'), enclosed=True, gold=False), 2)
    # despill: pull magenta out of semi-transparent fringe pixels (R and B above G)
    import numpy as np
    a = np.asarray(k).astype(float); al = a[..., 3:4] / 255
    rgb = a[..., :3]; g = rgb[..., 1:2]; spill = np.clip(np.minimum(rgb[..., 0:1], rgb[..., 2:3]) - g, 0, None)
    fr = (al < 0.98)
    rgb[..., 0:1] -= spill * fr; rgb[..., 2:3] -= spill * fr
    # magenta haze trapped inside rings / glows (pink, not the violet crystals: R close to B, low G):
    # fade it out and turn what's left teal-ish so it reads as glow
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mag = np.minimum(R, B) - G
    haze = (mag > 25) & (R > 0.85 * B)
    fade = np.clip(1 - (mag - 25) / 70, 0, 1)
    a[..., 3] = np.where(haze, a[..., 3] * fade, a[..., 3])
    R[haze] = G[haze]
    a[..., :3] = np.clip(rgb, 0, 255); k = Image.fromarray(a.astype('uint8'), 'RGBA')
    s = 152 / max(k.size); k = k.resize((round(k.width * s), round(k.height * s)), Image.LANCZOS)
    sq = Image.new('RGBA', (160, 160), (0, 0, 0, 0)); sq.alpha_composite(k, ((160 - k.width) // 2, (160 - k.height) // 2)); k = sq
    k.save(SRC + name + '.webp', 'WEBP', quality=82, method=6)
    pv = Image.new('RGBA', k.size, (30, 34, 40, 255)); pv.alpha_composite(k); pv.convert('RGB').save(PRE + name + '.jpg')
    print('ok', name, k.size)
