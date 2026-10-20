# Stage 10b: slice the painted sheets by object bounding boxes (connected components on the keyed alpha),
# writing one keyed RGBA PNG per icon into /workspace/artwork/raw/ for process_stage10b.py.
import sys; sys.path.insert(0, '/workspace/artwork')
import numpy as np
from collections import deque
from PIL import Image
from keylib import key, RAW
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
def slice_sheet(f, names, rows):
    k = key(Image.open(RAW + f).convert('RGB'), enclosed=True, gold=False, enc_res=40, enc_k=0.55)
    a = np.asarray(k); S = 4
    small = a[::S, ::S, 3] > 60
    lab, boxes = components(small)
    big = sorted([b for b in boxes if b[0] > 200], key=lambda b: -b[0])[:len(names)]
    # reading order: row by centre y, then x
    H = a.shape[0]
    big.sort(key=lambda b: (int(((b[3] + b[5]) / 2 * S) / (H / rows)), b[2]))
    for name, b in zip(names, big):
        _, n, x0, y0, x1, y1 = b
        pad = 6
        X0, Y0, X1, Y1 = max(0, (x0 - pad) * S), max(0, (y0 - pad) * S), min(a.shape[1], (x1 + pad + 1) * S), min(H, (y1 + pad + 1) * S)
        crop = a[Y0:Y1, X0:X1].copy()
        # drop pixels of OTHER big objects that fall inside this box
        others = np.isin(lab, [o[1] for o in big if o[1] != n])
        om = np.kron(others, np.ones((S, S), bool))[:a.shape[0], :a.shape[1]][Y0:Y1, X0:X1]
        crop[om, 3] = 0
        Image.fromarray(crop, 'RGBA').save(RAW + name + '.png')
        print(name, (X0, Y0, X1, Y1))
slice_sheet('speedups-sheet.jpg', ['su-m1', 'su-m5', 'su-m15', 'su-h1', 'su-h3', 'su-h8', 'su-h24'], 2)
slice_sheet('bundles-crest-sheet.jpg', ['res-energy', 'res-alloy', 'res-shards', 'more-leaders'], 2)
