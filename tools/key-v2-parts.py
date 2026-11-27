from PIL import Image, ImageFilter
import numpy as np, os
N='/workspace/broken-dawn-mockups/creature-anim/newart/'
os.makedirs('site/art/v2',exist_ok=True); os.makedirs('keyprev',exist_ok=True)
def key(im):
    a=np.array(im.convert('RGB')).astype(float)
    r,g,b=a[...,0],a[...,1],a[...,2]
    dom=g-np.maximum(r,b)
    al=1-np.clip((dom-90)/(200-90),0,1)
    alpha=Image.fromarray((al*255).astype('uint8'))
    alpha=alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    A=np.array(alpha).astype(float)
    # edge band = within ~4px of transparency: kill green spill there (JPG halo), keep teal inside untouched
    band=np.array(Image.fromarray((A<250).astype('uint8')*255).filter(ImageFilter.MaxFilter(9)))>0
    greenish=(g>np.maximum(r,b))&(b<g*0.8)
    fix=band&greenish
    a[...,1]=np.where(fix,np.maximum(r,b)*1.02,g)
    A[A<20]=0
    out=Image.fromarray(a.clip(0,255).astype('uint8')).convert('RGBA'); out.putalpha(Image.fromarray(A.astype('uint8')))
    return out
def trim(im,pad=4):
    bb=im.getchannel('A').point(lambda v:255 if v>24 else 0).getbbox()
    return im.crop((bb[0]-pad,bb[1]-pad,bb[2]+pad,bb[3]+pad))
def save(im,name,w=None,h=None):
    if w: im=im.resize((w,round(im.height*w/im.width)),Image.LANCZOS)
    if h: im=im.resize((round(im.width*h/im.height),h),Image.LANCZOS)
    im.save(f'site/art/v2/{name}.webp',quality=92,method=6)
    for bgc,tag in [((20,16,12),'d'),((255,0,255),'m')]:
        bg=Image.new('RGBA',im.size,bgc+(255,)); bg.alpha_composite(im); bg.save(f'keyprev/{name}_{tag}.png')
    print(name,im.size)
body=trim(key(Image.open(N+'src-body.jpg'))); save(body,'body',w=256)
head=trim(key(Image.open(N+'src-head.jpg').rotate(180))); save(head,'head',w=200)
legs=Image.open(N+'src-legs.jpg'); W=legs.width
fem=trim(key(legs.crop((0,0,W//2,legs.height)))); save(fem,'femur',h=220)
tib=trim(key(legs.crop((W//2,0,W,legs.height)))); save(tib,'tibia',h=260)
ma=Image.open(N+'src-mandible-antenna.jpg'); W=ma.width
mand=trim(key(ma.crop((0,0,int(W*0.62),ma.height)))); save(mand,'mandL',h=120)
ant=trim(key(ma.crop((int(W*0.62),0,W,ma.height)))).transpose(Image.FLIP_TOP_BOTTOM); save(ant,'antenna',h=240)
an=Image.open('site/art/v2/antenna.webp'); h=an.height//2
save(an.crop((0,0,an.width,h+3)),'antA'); save(an.crop((0,h-3,an.width,an.height)),'antB')
