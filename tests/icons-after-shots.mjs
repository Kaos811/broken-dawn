import { chromium } from 'playwright-core';
import { createServer } from 'http'; import { readFile } from 'fs/promises'; import { join, extname } from 'path';
const ROOT='/workspace/broken-dawn/dist', T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json'};
const srv=createServer(async(q,r)=>{try{const p=join(ROOT,q.url==='/'?'index.html':decodeURIComponent(q.url.split('?')[0]));const b=await readFile(p);r.writeHead(200,{'content-type':T[extname(p)]??'application/octet-stream'});r.end(b);}catch{r.writeHead(404);r.end();}});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
await ctx.addInitScript(()=>{window.__BD_TEST={noTutorial:true};});
const p=await ctx.newPage(); await p.goto(`http://localhost:${srv.address().port}/`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__BD?.controls?.().length>3,null,{timeout:60000});
const w=(ms)=>p.waitForTimeout(ms); const ev=(f)=>p.evaluate(f);
const shot=async(n)=>{await w(1500);await p.screenshot({path:`/workspace/broken-dawn/screens/icons-after-${n}.png`});};
await ev(()=>{const s=__BD.store;s.state.resources.energy=1e6;s.state.resources.alloy=1e6;s.state.resources.shards=5e4;s.state.beacon.level=10;s.upgrade('barracks');s.emit('change');});
await shot('base');
const steps=[['more',()=>__BD.ui().onTab('more')],['settings',()=>{__BD.ui().closeModal();__BD.ui().openSettings();}],['troops',()=>{__BD.ui().closeModal();__BD.ui().openScreen('troops');}],['armory',()=>{__BD.ui().openScreen('armory');}],['leaders',()=>{__BD.ui().openScreen('armory',{armoryTab:'leaders'});}],['squads',()=>{__BD.ui().onTab('squads');}],['infirmary',()=>{__BD.ui().openScreen('infirmary');}],['items',()=>{__BD.ui().closeScreen?.();__BD.ui().onTab('more');}],['world',()=>{__BD.ui().closeModal();__BD.ui().onTab('world');}]];
for(const [n,f] of steps){try{await ev(f);await shot(n);}catch(e){console.log(n,e.message);}}
await b.close();srv.close();console.log('ok');
