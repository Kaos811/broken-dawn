import numpy as np
from PIL import Image
src = open('/workspace/artwork/process_ui.py').read()
exec(src[:src.index("sheet('nav-icons.jpg'")])
from keylib import PRE
def sheet2(name, names, sizes, split=None):
    k = key(Image.open(RAW + name), enclosed=True, gold=False, enc_res=34, enc_k=0.6)
    k = degreen(k)
    W, H = k.size
    for i, n in enumerate(names):
        if not n: continue
        cx, cy = i % 3, i // 3
        ys = [0, split or H // 2, H]
        part = k.crop((cx * W // 3, ys[cy], (cx + 1) * W // 3, ys[cy + 1]))
        im = crop(despeckle(part, 300, 0.04), 2)
        s = sizes[n]
        im = fit(im, s) if im.width >= im.height else im.resize((round(im.width * s / im.height), s), Image.LANCZOS)
        save(im, n, 86); print(n, im.size, round(len(open(OUT + n + '.webp','rb').read())/1024,1), 'KB')
sheet2('stage8-icons.jpg', ['hud-missions', 'rift-mark', 'exchange', 'hud-stamina', None, None],
       {'hud-missions': 104, 'rift-mark': 96, 'exchange': 128, 'hud-stamina': 80})
sheet2('stage8-chests.jpg', ['chest-bronze', 'chest-silver', 'chest-gold', 'chest-bronze-open', 'chest-silver-open', 'chest-gold-open'],
       {n: 128 for n in ['chest-bronze', 'chest-silver', 'chest-gold', 'chest-bronze-open', 'chest-silver-open', 'chest-gold-open']}, split=305)
# banners: 3:1 strip, darkened on the left for the title text
for n, y0 in [('banner-beacon-surge', 70), ('banner-rift-hunt', 90)]:
    im = Image.open(RAW + n + '.jpg').convert('RGB').crop((0, y0, 1280, y0 + 427)).resize((720, 240), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    x = np.linspace(0, 1, 720)[None, :, None]
    shade = 0.45 + 0.55 * np.clip((x - 0.15) / 0.45, 0, 1)
    out = Image.fromarray((a * shade).clip(0, 255).astype(np.uint8))
    out.save(OUT + n + '.webp', 'WEBP', quality=78, method=6); out.save(PRE + n + '.jpg', quality=85)
    print(n, out.size, round(len(open(OUT + n + '.webp','rb').read())/1024,1), 'KB')
names = ['hud-missions', 'rift-mark', 'exchange', 'hud-stamina', 'chest-bronze', 'chest-silver', 'chest-gold', 'chest-bronze-open', 'chest-silver-open', 'chest-gold-open']
c = Image.new('RGBA', (1460, 300), (30, 34, 40, 255)); x = 10
for i, n in enumerate(names):
    im = Image.open(OUT + n + '.webp'); c.alpha_composite(im, (x, 10 + (150 if i >= 5 else 0))); x = x + im.width + 10 if i != 4 else 10
c.convert('RGB').save('preview/stage8-icons.png')
