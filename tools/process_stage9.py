# Stage 9: painted troop portraits (1x3 magenta sheet) + Beacon Call recruit banner
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from keylib import key, crop, fit, RAW, PRE
_src = open('/workspace/artwork/process_ui.py').read()
exec(_src[_src.index('def degreen'):_src.index('\n', _src.index('return', _src.index('def degreen'))) + 1])
SRC = '/workspace/broken-dawn/src/art/ui/'
k = key(Image.open(RAW + 'troops-painted.jpg'), enclosed=True, gold=False, enc_res=34, enc_k=0.6)
W, H = k.size
k = degreen(k)
A = np.asarray(k).copy()
rgb = A[..., :3].astype(int)
xx = np.arange(W)[None, :].repeat(H, 0); yy0 = np.arange(H)[:, None].repeat(W, 1)
edge = 842 - (yy0 - 330) * 0.18            # Voyager cape's left edge in the overlap
d = np.abs((yy0 - 345) - (xx - 760) * 1.06) / 1.457   # distance to the Bearer's barrel line
barrel = (d < 13) & (xx >= 740) & (xx <= 874) & (yy0 <= 470)
bear = ((xx >= 482) & (xx < 760)) | (((xx >= 760) & (xx < 900)) & ((xx < edge) | barrel))
masks = {
    'sentinel': xx < 482,
    'bearer': bear,
    'voyager': (xx >= 760) & ~bear & ~((xx > 1040) & (yy0 < 215)),
}
figs = {}
for n, msk in masks.items():
    a = A.copy(); a[..., 3] = np.where(msk, a[..., 3], 0)
    im = crop(Image.fromarray(a), 2)
    im = im.resize((round(im.width * 360 / im.height), 360), Image.LANCZOS)
    im.save(SRC + f'troop-{n}.webp', 'WEBP', quality=84, method=6)
    pv = Image.new('RGBA', im.size, (30, 34, 40, 255)); pv.alpha_composite(im); pv.convert('RGB').save(PRE + f'troop-{n}.jpg')
    figs[n] = im
    print(n, im.size, round(len(open(SRC + f'troop-{n}.webp', 'rb').read()) / 1024, 1), 'KB')
# Beacon Call banner 720x320: dark violet sky, beacon in the middle, troops in silhouette at the sides
bg = Image.open(RAW + 'banner-beacon-surge.jpg').convert('RGB')
bw, bh = bg.size
bg = bg.crop((0, int(bh * 0.05), bw, int(bh * 0.05) + int(bw * 320 / 720))).resize((720, 320), Image.LANCZOS)
bg = bg.filter(ImageFilter.GaussianBlur(3))
a = np.asarray(bg).astype(np.float32) / 255
lum = a.mean(2, keepdims=True)
violet = np.array([0.55, 0.32, 0.9])
a = (lum * violet * 0.9 + a * 0.25) * 0.75
yy, xx = np.mgrid[0:320, 0:720]
glow = np.exp(-(((xx - 360) / 190) ** 2 + ((yy - 170) / 140) ** 2))[..., None]
a = a * (0.55 + 0.6 * glow) + glow * np.array([0.35, 0.22, 0.05]) * 0.8
ban = Image.fromarray((a.clip(0, 1) * 255).astype(np.uint8)).convert('RGBA')
def place(im, h, cx, bottom, dim=1.0, flip=False):
    im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if dim != 1.0:
        r, g, b, al = im.split(); rgb = ImageEnhance.Brightness(Image.merge('RGB', (r, g, b))).enhance(dim)
        im = Image.merge('RGBA', (*rgb.split(), al))
    ban.alpha_composite(im, (round(cx - im.width / 2), bottom - im.height))
place(figs['voyager'], 230, 92, 330, 0.55)
place(figs['bearer'], 260, 196, 335, 0.75)
place(figs['sentinel'], 255, 620, 335, 0.7, flip=True)
place(figs['voyager'], 215, 520, 330, 0.5, flip=True)
beacon = Image.open('/workspace/broken-dawn/src/art/base/beacon.webp').convert('RGBA')
place(beacon, 270, 360, 312, 1.08)
# bottom fade for the odds strip and top fade for the title
a = np.asarray(ban).astype(np.float32)
f = np.clip(1 - np.maximum((yy - 250) / 70, 0), 0, 1) * np.clip(0.55 + yy / 90, 0, 1)
a[..., :3] *= f[..., None] ** 0.8
ban = Image.fromarray(a.clip(0, 255).astype(np.uint8)).convert('RGB')
ban.save(SRC + 'banner-beacon-call.webp', 'WEBP', quality=80, method=6); ban.save(PRE + 'banner-beacon-call.jpg')
print('banner', round(len(open(SRC + 'banner-beacon-call.webp', 'rb').read()) / 1024, 1), 'KB')
