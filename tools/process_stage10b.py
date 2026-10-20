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
    k = crop(key(Image.open(path).convert('RGB'), enclosed=True, gold=False), 2)
    s = 160 / max(k.size); k = k.resize((round(k.width * s), round(k.height * s)), Image.LANCZOS)
    k.save(SRC + name + '.webp', 'WEBP', quality=82, method=6)
    pv = Image.new('RGBA', k.size, (30, 34, 40, 255)); pv.alpha_composite(k); pv.convert('RGB').save(PRE + name + '.jpg')
    print('ok', name, k.size)
