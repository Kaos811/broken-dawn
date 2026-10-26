"""Stage 15 icon sheets (magenta) -> square transparent webps in src/art/ui/ (ic-*.webp)."""
import sys; sys.path.insert(0,'tools')
import numpy as np
from PIL import Image
from scipy import ndimage
import importlib.util
src=open('tools/process_stage13.py').read().split('for i in (1,2,3)')[0]
ns={}; exec(src,ns); key=ns['key']
RAW='/workspace/artwork/raw/'; OUT='src/art/ui/'
def sheet(path, cols, rows, names, size):
    rgba,mask=key(path); H,W=mask.shape
    lab,n=ndimage.label(ndimage.binary_dilation(mask,iterations=6))
    objs=ndimage.find_objects(lab); sz=ndimage.sum(mask,lab,range(1,n+1))
    cells={}
    for i in range(n):
        if sz[i]<1500: continue
        sl=objs[i]; cy=(sl[0].start+sl[0].stop)/2; cx=(sl[1].start+sl[1].stop)/2
        k=int(cy//(H/rows))*cols+int(cx//(W/cols)); cells.setdefault(k,[]).append(i)
    assert sorted(cells)==list(range(cols*rows)),(path,sorted(cells))
    for k,nm in enumerate(names):
        ids=cells[k]; m=np.isin(lab,[i+1 for i in ids])
        c=rgba.copy(); c[~m,3]=0
        im=Image.fromarray(c,'RGBA'); im=im.crop(im.getbbox())
        s=int(max(im.size)*1.06); sq=Image.new('RGBA',(s,s),(0,0,0,0)); sq.paste(im,((s-im.width)//2,(s-im.height)//2))
        sq.resize((size,size),Image.LANCZOS).save(OUT+nm+'.webp',quality=92); print(nm,im.size,len(ids))
sheet(RAW+'icons-sheet-a.jpg',3,2,['ic-q-builder','ic-q-training','ic-q-healing','ic-goal','ic-help','ic-plus'],128)
sheet(RAW+'icons-sheet-b.jpg',4,2,['ic-star','ic-star-empty','ic-hp','ic-atk','ic-def','ic-clock','ic-squad','ic-beds'],64)
sheet(RAW+'icons-sheet-c.jpg',4,2,['ic-lock','ic-attack','ic-warn','ic-place','ic-sound-on','ic-sound-off','ic-haptics-on','ic-haptics-off'],64)
