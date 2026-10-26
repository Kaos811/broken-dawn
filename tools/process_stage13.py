"""Stage 13 onboarding art: story panels -> webp; magenta sheets sliced, keyed, despilled."""
import numpy as np, colorsys
from PIL import Image
from scipy import ndimage
RAW='/workspace/artwork/raw/'; OUT='src/art/onboarding/'
def key(path):
    a=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)/255
    bg=np.median(np.concatenate([a[:20].reshape(-1,3),a[-20:].reshape(-1,3)]),0)
    r,g,b=a[...,0],a[...,1],a[...,2]; mx=a.max(-1); mn=a.min(-1); d=mx-mn+1e-6; sat=d/(mx+1e-6)
    h=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
    bh=colorsys.rgb_to_hsv(*bg)[0]*360; dh=np.abs(((h-bh)+180)%360-180)
    alpha=1-np.clip(1-(dh-10)/14,0,1)*np.clip((sat-0.45)/0.25,0,1)
    alpha=ndimage.grey_erosion(alpha,size=(2,2))*0.5+alpha*0.5
    spill=np.clip(np.minimum(r,b)-g,0,None); m=dh<40; fix=a.copy()
    fix[...,0]=np.where(m,r-spill*0.6,r); fix[...,2]=np.where(m,b-spill*0.6,b)
    return (np.clip(np.dstack([fix,alpha]),0,1)*255).astype(np.uint8), alpha>0.5
def slice_(path, names, dil=6, minpx=3000, maxw=None):
    rgba,mask=key(path)
    lab,n=ndimage.label(ndimage.binary_dilation(mask,iterations=dil))
    objs=ndimage.find_objects(lab); sz=ndimage.sum(mask,lab,range(1,n+1))
    big=sorted([i for i in range(n) if sz[i]>minpx],key=lambda i:objs[i][1].start)
    assert len(big)==len(names),(path,len(big))
    for nm,i in zip(names,big):
        sl=objs[i]; c=rgba[sl].copy(); c[lab[sl]!=i+1,3]=0
        im=Image.fromarray(c,'RGBA'); im=im.crop(im.getbbox())
        if maxw and im.width>maxw: im=im.resize((maxw,round(im.height*maxw/im.width)),Image.LANCZOS)
        im.save(OUT+nm+'.webp',quality=90); print(nm,im.size)
for i in (1,2,3):
    Image.open(RAW+f'story-{i}.jpg').convert('RGB').save(OUT+f'story-{i}.webp',quality=82)
slice_(RAW+'lyra-expressions-pointer.jpg',['lyra-neutral','lyra-smile','lyra-determined','lyra-excited','pointer'],dil=2)
slice_(RAW+'ruined-barracks-chest-banner.jpg',['barracks-ruin','chest-open','victory-banner'],dil=10)
