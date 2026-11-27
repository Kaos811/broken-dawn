from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance
import math, os
os.makedirs('parts',exist_ok=True)
src=Image.open('/workspace/broken-dawn/src/art/world/creatures/cr-scuttler.webp').convert('RGBA').resize((512,512),Image.LANCZOS)
def prev(im,name,s=2):
    bg=Image.new('RGBA',im.size,(90,80,60,255)); bg.alpha_composite(im); bg.resize((im.width*s,im.height*s)).save('prev_'+name+'.png')
def strip(p0,p1,w,pad=4):
    # extract strip along p0->p1, output vertical with p0 at top
    ang=math.degrees(math.atan2(p1[1]-p0[1],p1[0]-p0[0]))
    L=math.dist(p0,p1)
    r=src.rotate(ang-90,resample=Image.BICUBIC,center=p0,translate=(256-p0[0],100-p0[1]))
    c=r.crop((256-w//2,100-pad,256+w//2,100+int(L)+pad))
    # keep only the largest connected-ish blob near center: fade columns at the edges
    m=Image.new('L',c.size,0); d=ImageDraw.Draw(m); d.rounded_rectangle((2,0,c.width-3,c.height-1),radius=w//3,fill=255); m=m.filter(ImageFilter.GaussianBlur(1.5))
    c.putalpha(ImageChops.multiply(c.getchannel('A'),m))
    return c
lp=lambda x,y:(x+260,y+180)
fem=strip(lp(100,58),lp(134,150),34); fem.save('parts/femur.png'); prev(fem,'femur',3)
tib=strip(lp(134,150),lp(150,282),30); tib.save('parts/tibia.png'); prev(tib,'tibia',3)
# shell
rot=Image.open('rot.png'); c0=300; y0,y1=150,420
right=rot.crop((c0,y0,c0+100,y1)); left=right.transpose(Image.FLIP_LEFT_RIGHT)
W=200;H=y1-y0
sh=Image.new('RGBA',(W,H)); sh.paste(left,(0,0)); sh.paste(right,(100,0))
m=Image.new('L',(W,H),0); d=ImageDraw.Draw(m); d.ellipse((8,6,W-8,H-4),fill=255); m=m.filter(ImageFilter.GaussianBlur(1.5))
base=sh.filter(ImageFilter.GaussianBlur(8)); out=Image.alpha_composite(base,sh)
# dome shading: light from top-left, dark rim
sh_l=Image.new('L',(W,H),0); px=sh_l.load()
for y in range(H):
    for x in range(W):
        nx=(x-W/2)/(W/2-8); ny=(y-H/2)/(H/2-4); r2=nx*nx+ny*ny
        if r2<1:
            nz=math.sqrt(1-r2); lgt=max(0,(-0.45*nx-0.55*ny+0.7*nz))
            v=0.55+0.6*lgt - 0.35*max(0,r2-0.6)/0.4
            px[x,y]=int(max(0,min(255,v*170)))
rgb=out.convert('RGB'); 
shade=Image.merge('RGB',(sh_l,sh_l,sh_l))
rgb=ImageChops.multiply(rgb,shade); rgb=ImageEnhance.Brightness(rgb).enhance(1.5)
# center seam
dd=ImageDraw.Draw(rgb); dd.line([(W/2,30),(W/2,H-12)],fill=(40,30,18),width=2)
out=rgb.convert('RGBA'); out.putalpha(m)
out.save('parts/shell.png'); prev(out,'shell')
# head: mirror half around eye axis, flip so mandible side is up (front)
hh=src.crop((140,238,196,336)); hl=hh.transpose(Image.FLIP_LEFT_RIGHT)
head=Image.new('RGBA',(112,98)); head.paste(hl,(0,0)); head.paste(hh,(56,0))
head=head.transpose(Image.FLIP_TOP_BOTTOM)
m=Image.new('L',head.size,0); d=ImageDraw.Draw(m); d.ellipse((6,4,106,96),fill=255); m=m.filter(ImageFilter.GaussianBlur(1.5))
hb=head.filter(ImageFilter.GaussianBlur(6)); head=Image.alpha_composite(hb,head); head.putalpha(m)
head.save('parts/head.png'); prev(head,'head',3)
