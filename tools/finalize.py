from PIL import Image
import numpy as np, os
os.makedirs('site/art',exist_ok=True)
for n in ['femur','tibia','head','shell']:
    im=np.array(Image.open(f'parts/{n}.png').convert('RGBA')).astype(float)
    r,g,b,a=[im[...,i] for i in range(4)]
    mag=(r>g+25)&(b>g+5)
    # pull magenta fringe to dark bronze
    im[mag,0]=im[mag,0]*0.55+20; im[mag,1]=im[mag,1]*0.9+10; im[mag,2]=im[mag,2]*0.35
    Image.fromarray(im.clip(0,255).astype('uint8')).save(f'site/art/{n}.webp',quality=92)
for k in ['lair-burrow','crystal-1','crystal-3','ruin-1','fissure-1','glow-teal']:
    Image.open(f'atl_{k}.png').save(f'site/art/{k}.webp',quality=90)
Image.open('/workspace/broken-dawn/src/art/world/world-ground.webp').save('site/art/ground.webp')
