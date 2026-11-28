from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
import numpy as np, os, shutil
N='/workspace/broken-dawn-mockups/creature-anim/newart/'
os.makedirs('site/art/v3',exist_ok=True); os.makedirs('keyprev',exist_ok=True)

def key(im):
    a=np.array(im.convert('RGB')).astype(float)
    r,g,b=a[...,0],a[...,1],a[...,2]
    dom=g-np.maximum(r,b)
    al=1-np.clip((dom-90)/(200-90),0,1)
    alpha=Image.fromarray((al*255).astype('uint8'))
    alpha=alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    A=np.array(alpha).astype(float)
    # edge band: kill JPG green halo, leave teal interiors (eyes, cracks) alone
    band=np.array(Image.fromarray((A<250).astype('uint8')*255).filter(ImageFilter.MaxFilter(9)))>0
    greenish=(g>np.maximum(r,b))&(b<g*0.8)
    fix=band&greenish
    a[...,1]=np.where(fix,np.maximum(r,b)*1.02,g)
    A[A<20]=0
    out=Image.fromarray(a.clip(0,255).astype('uint8')).convert('RGBA'); out.putalpha(Image.fromarray(A.astype('uint8')))
    return out

def trim(im,pad=4):
    bb=im.getchannel('A').point(lambda v:255 if v>24 else 0).getbbox()
    return im.crop((max(0,bb[0]-pad),max(0,bb[1]-pad),min(im.width,bb[2]+pad),min(im.height,bb[3]+pad)))

def save(im,name,w=None,h=None,folder='site/art/v3'):
    if w: im=im.resize((w,round(im.height*w/im.width)),Image.LANCZOS)
    if h: im=im.resize((round(im.width*h/im.height),h),Image.LANCZOS)
    im.save(f'{folder}/{name}.webp',quality=92,method=6)
    for bgc,tag in [((20,16,12),'d'),((255,0,255),'m'),((40,80,50),'g')]:
        bg=Image.new('RGBA',im.size,bgc+(255,)); bg.alpha_composite(im); bg.save(f'keyprev/{name}_{tag}.png')
    print(name,im.size)
    return im

# --- head: top of the whole-beetle painting, plus a short thorax so it tucks under the shell ---
src=Image.open(N+'src-head-v2-with-body.jpg')
# y 50-378 includes horns through the thorax taper just as the body seam begins
head=trim(key(src.crop((140, 48, 884, 378))))
save(head,'head',w=280)

# --- long tibia ---
tib=trim(key(Image.open(N+'src-tibia-long.jpg')))
save(tib,'tibia',h=480)

# --- brighten / warm existing antennae, boost teal tip ---
def warm(im, gain=1.22, add=(18,12,4)):
    a=np.array(im.convert('RGBA')).astype(float)
    for i,o in enumerate(add):
        a[...,i]=np.clip(a[...,i]*gain+o,0,255)
    out=Image.fromarray(a.astype('uint8')); out.putalpha(im.getchannel('A'))
    return out

def glow_tip(im):
    # soft teal glow near the bottom (tip) of antB
    a=np.array(im.convert('RGBA')).astype(float)
    h,w=a.shape[:2]
    yy,xx=np.mgrid[0:h,0:w]
    # tip is at the bottom center
    d=np.sqrt((xx-(w-1)/2)**2 + (yy-(h-4))**2)
    g=np.exp(-(d/max(3.0,w*0.9))**2)
    a[...,0]=np.clip(a[...,0]+g*40,0,255)
    a[...,1]=np.clip(a[...,1]+g*220,0,255)
    a[...,2]=np.clip(a[...,2]+g*210,0,255)
    # slightly raise alpha at the glow so it isn't clipped
    a[...,3]=np.clip(a[...,3]+g*80,0,255)
    return Image.fromarray(a.astype('uint8'))

for n in ('antA','antB'):
    im=Image.open(f'site/art/v2/{n}.webp').convert('RGBA')
    im=warm(im)
    if n=='antB': im=glow_tip(im)
    save(im,n)

print('done')
