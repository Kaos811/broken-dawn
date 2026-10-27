"""Stage 16 gather-node sheet (magenta) -> transparent webps in src/art/ui/ (node-*.webp, ic-alloy-pile.webp)."""
import sys; sys.path.insert(0,'tools')
src=open('tools/process_stage15.py').read().split("sheet(RAW+'icons-sheet-a.jpg'")[0]
ns={}; exec(src,ns)
ns['sheet'](ns['RAW']+'gather-nodes.jpg',4,1,['node-full','node-depleted','node-camp','ic-alloy-pile'],256)
from PIL import Image
Image.open('src/art/ui/ic-alloy-pile.webp').resize((96,96),Image.LANCZOS).save('src/art/ui/ic-alloy-pile.webp',quality=92)
