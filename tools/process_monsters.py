"""Stage 12c: slice painted map monsters from artwork/raw/world-monsters.jpg (magenta bg) -> src/art/world/creatures/cr-<id>.webp (256x256, bottom-centred)."""
import numpy as np, colorsys
from PIL import Image, ImageFilter
from scipy import ndimage
SRC='/workspace/artwork/raw/world-monsters.jpg'; OUT='src/art/world/creatures/'
IDS=['scuttler','drone','hound','golem','wyrm']
a=np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)/255
bg=np.median(np.concatenate([a[:20].reshape(-1,3),a[-20:].reshape(-1,3)]),0)
r,g,b=a[...,0],a[...,1],a[...,2]
mx=a.max(-1); mn=a.min(-1); sat=(mx-mn)/(mx+1e-6)
# hue
import numpy as _n
h=_n.zeros_like(mx); d=mx-mn+1e-6
h=_n.where(mx==r,((g-b)/d)%6,_n.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
bh=float(colorsys.rgb_to_hsv(*bg)[0]*360)
dh=_n.abs(((h-bh)+180)%360-180)
# background = hue near bg, saturated, and green low relative to r,b (covers shadows on magenta)
bgness=_n.clip(1-(dh-10)/14,0,1)*_n.clip((sat-0.45)/0.25,0,1)
alpha=1-bgness
alpha=ndimage.grey_erosion(alpha,size=(2,2))*0.5+alpha*0.5
# despill: clamp magenta (r and b both above g) toward max(g, ...)
lim=_n.maximum(g, _n.minimum(r,b)*0.0+g)  # spill limit
spill=_n.minimum(r,b)-g
fix=a.copy()
m=(spill>0)&(dh<40)
k=_n.clip(spill,0,None)*(1-alpha*0.3)
fix[...,0]=_n.where(m,r-k*0.6,r); fix[...,2]=_n.where(m,b-k*0.6,b)
mask=alpha>0.5
lab,n=ndimage.label(ndimage.binary_dilation(mask,iterations=6))
objs=ndimage.find_objects(lab); sizes=ndimage.sum(mask,lab,range(1,n+1))
big=sorted([i for i in range(n) if sizes[i]>3000],key=lambda i:objs[i][1].start)
assert len(big)==5,(len(big),sorted(sizes)[-8:])
rgba=_n.dstack([fix,alpha]); rgba=(_n.clip(rgba,0,1)*255).astype(_n.uint8)
for id_,i in zip(IDS,big):
    sl=objs[i]; crop=rgba[sl].copy(); crop[lab[sl]!=i+1,3]=0
    im=Image.fromarray(crop,'RGBA'); im=im.crop(im.getbbox())
    S=256; pad=8; sc=min((S-2*pad)/im.width,(S-2*pad)/im.height)
    im=im.resize((round(im.width*sc),round(im.height*sc)),Image.LANCZOS)
    c=Image.new('RGBA',(S,S)); c.alpha_composite(im,((S-im.width)//2,S-pad-im.height))
    c.save(OUT+f'cr-{id_}.webp',quality=90); print(id_,im.size)
