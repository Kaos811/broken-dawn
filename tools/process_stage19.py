"""Stage 19: key the rally art (magenta bg) -> Behemoth map sprite, rally banner/emblem, 5 trophy chests."""
import sys; sys.path.insert(0,'/workspace/artwork')
import numpy as np
from PIL import Image
from scipy import ndimage
from keylib import key
RAW='/workspace/artwork/raw/'
def keyed(p, enclosed=True):
    return key(Image.open(RAW+p), enclosed=enclosed)
def blobs(im, n, dil=8):
    a=np.asarray(im)[...,3]>40
    lab,k=ndimage.label(ndimage.binary_dilation(a,iterations=dil))
    objs=ndimage.find_objects(lab); sz=ndimage.sum(a,lab,range(1,k+1))
    keep=sorted(np.argsort(sz)[::-1][:n], key=lambda i: objs[i][1].start)
    return [im.crop((objs[i][1].start,objs[i][0].start,objs[i][1].stop,objs[i][0].stop)) for i in keep]
def columns(im, n):
    # split by empty vertical gaps (the sheet's items sit in one row, close together)
    a=np.asarray(im)[...,3]>60; col=a.sum(0)>2
    segs=[]; x=0; W=len(col)
    while x<W:
        if col[x]:
            s0=x
            while x<W and col[x]: x+=1
            segs.append([s0,x])
        x+=1
    segs=[g for g in segs if g[1]-g[0]>6]
    while len(segs)>n:  # merge the closest pair
        i=min(range(len(segs)-1), key=lambda i: segs[i+1][0]-segs[i][1]); segs[i][1]=segs[i+1][1]; del segs[i+1]
    out=[]
    for x0,x1 in segs:
        rows=np.where(a[:,x0:x1].any(1))[0]; out.append(im.crop((x0,rows[0],x1,rows[-1]+1)))
    return out
def cuts(im, guess, win=18):
    # items touch in places: cut at the emptiest column near each guessed gap, then keep the main blob per slice
    a=np.asarray(im)[...,3]>60; col=a.sum(0)
    xs=[0]+[g-win+int(np.argmin(col[g-win:g+win])) for g in guess]+[im.width]
    out=[]
    for x0,x1 in zip(xs,xs[1:]):
        sub=im.crop((x0,0,x1,im.height)); m=np.asarray(sub)[...,3]>60
        lab,k=ndimage.label(ndimage.binary_dilation(m,iterations=3)); sz=ndimage.sum(m,lab,range(1,k+1))
        big=np.isin(lab,[i+1 for i in range(k) if sz[i]>0.04*sz.max()])
        arr=np.asarray(sub).copy(); arr[...,3]=np.where(big,arr[...,3],0); sub=Image.fromarray(arr)
        out.append(sub.crop(sub.getbbox()))
    return out
def fitsq(im, S, bottom=False):
    im=im.copy(); im.thumbnail((S-8,S-8), Image.LANCZOS)
    out=Image.new('RGBA',(S,S),(0,0,0,0))
    out.paste(im,((S-im.width)//2, (S-4-im.height) if bottom else (S-im.height)//2),im); return out
parts=cuts(keyed('rally-behemoth-sheet.jpg'),[517,657,758,862,980,1099])  # Jason's sheet: Behemoth, banner, 5 trophies
fitsq(parts[0],256,True).save('src/art/world/creatures/cr-behemoth.webp',quality=86)
fitsq(parts[1],128).save('src/art/rally/rally-banner.webp',quality=86)
for i,t in enumerate(parts[2:]): fitsq(t,128).save(f'src/art/rally/trophy-{i+1}.webp',quality=86)
# crossed-swords rally emblem (boss marker) from the extra icon sheet
fitsq(blobs(keyed('rally-icons.jpg'),2)[1],128).save('src/art/rally/rally-emblem.webp',quality=86)
print('ok')
