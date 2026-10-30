"""Stage 19: key the rally art (magenta bg) -> Behemoth map sprite, rally banner/emblem, 5 trophy chests."""
import sys; sys.path.insert(0,'/workspace/artwork')
import numpy as np
from PIL import Image
from scipy import ndimage
from keylib import key
RAW='/workspace/artwork/raw/'
def keyed(p, enclosed=True):
    return key(Image.open(RAW+p), enclosed=enclosed)
def blobs(im, n):
    a=np.asarray(im)[...,3]>40
    lab,k=ndimage.label(ndimage.binary_dilation(a,iterations=8))
    objs=ndimage.find_objects(lab); sz=ndimage.sum(a,lab,range(1,k+1))
    keep=sorted(np.argsort(sz)[::-1][:n], key=lambda i: objs[i][1].start)
    return [im.crop((objs[i][1].start,objs[i][0].start,objs[i][1].stop,objs[i][0].stop)) for i in keep]
def fitsq(im, S, bottom=False):
    im=im.copy(); im.thumbnail((S-8,S-8), Image.LANCZOS)
    out=Image.new('RGBA',(S,S),(0,0,0,0))
    out.paste(im,((S-im.width)//2, (S-4-im.height) if bottom else (S-im.height)//2),im); return out
b=blobs(keyed('behemoth.jpg'),1)[0]
fitsq(b,256,True).save('src/art/world/creatures/cr-behemoth.webp',quality=86)
ban,emb=blobs(keyed('rally-icons.jpg'),2)
fitsq(ban,128).save('src/art/rally/rally-banner.webp',quality=86)
fitsq(emb,128).save('src/art/rally/rally-emblem.webp',quality=86)
for i,t in enumerate(blobs(keyed('trophies.jpg'),5)):
    fitsq(t,128).save(f'src/art/rally/trophy-{i+1}.webp',quality=86)
print('ok')
