# Stage 9b: painted leader portraits + gear icons (keyed from magenta sheets) -> src/art/ui/*.webp
import numpy as np
from PIL import Image
from keylib import key, crop, fit, RAW, PRE
SRC = '/workspace/broken-dawn/src/art/ui/'
def cells(f, cols, rows, ytrim=None):
    im = Image.open(RAW + f).convert('RGB'); W, H = im.size
    cw, ch = W / cols, H / rows
    for r in range(rows):
        for c in range(cols):
            y1 = r * ch + (ytrim[r] if ytrim else ch)
            yield r, c, im.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round(y1)))
def isolate(k):
    # keep only the contiguous run of occupied columns / rows around the centre (drops neighbour slivers)
    a = np.asarray(k.getchannel('A')) > 40
    def run(p, c):
        occ = p > 2
        if not occ[c]:
            idx = np.nonzero(occ)[0]; c = idx[np.argmin(abs(idx - c))]
        l = c
        while l > 0 and occ[l - 1]: l -= 1
        r = c
        while r < len(occ) - 1 and occ[r + 1]: r += 1
        return l, r + 1
    x0, x1 = run(a.sum(0), a.shape[1] // 2)
    y0, y1 = run(a[:, x0:x1].sum(1), a.shape[0] // 2)
    m = np.zeros(a.shape, bool); m[y0:y1, x0:x1] = True
    arr = np.asarray(k).copy(); arr[..., 3] = np.where(m, arr[..., 3], 0)
    return crop(Image.fromarray(arr, 'RGBA'), 2)
def label_cut(cell):
    # first row (lower half) with a cluster of near-white, low-saturation pixels = the label
    a = np.asarray(cell).astype(int); H = a.shape[0]
    wh = (a.min(2) > 200) & (a.max(2) - a.min(2) < 40)
    for y in range(H // 2, H):
        if wh[y].sum() >= 4: return y - 4
    return H
def out(im, name, q):
    im.save(SRC + name + '.webp', 'WEBP', quality=q, method=6)
    pv = Image.new('RGBA', im.size, (30, 34, 40, 255)); pv.alpha_composite(im); pv.convert('RGB').save(PRE + name + '.jpg')
names = {'leaders-a.jpg': [['kael', 'lyra', 'jax'], ['seren', 'vex', 'orin']], 'leaders-b.jpg': [['nova', 'rook', 'dax'], ['mira', 'thane', None]]}
for f, grid in names.items():
    for r, c, cell in cells(f, 3, 2):
        n = grid[r][c]
        if not n: continue
        k = isolate(key(cell, enclosed=True, gold=False, enc_res=30, enc_k=0.7))
        out(fit(k, 300) if k.width > 300 else k, f'leader-{n}', 80)
gear = [['scrapPlating', 'pulseCarbine', 'fieldWeave'], ['aegisMesh', 'arcRifle', 'wardenShell'], ['lumenLance', 'dawnforgedAegis', 'beaconEdge']]
for r, c, cell in cells('gear-sheet.jpg', 3, 3):
    cell = cell.crop((0, 0, cell.width, label_cut(cell)))
    k = isolate(key(cell, enclosed=True, gold=False))
    s = 180 / max(k.size); k = k.resize((round(k.width * s), round(k.height * s)), Image.LANCZOS)
    out(k, f'gear-{gear[r][c]}', 80)
