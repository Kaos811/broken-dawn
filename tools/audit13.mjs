import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname), OUT = '/workspace/broken-dawn-ref/onboarding-audit/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = createServer(async (req, res) => { try { const p = join(ROOT, 'dist', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])); const b = await readFile(p); res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png' }[extname(p)] ?? 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const ev = (f, a) => page.evaluate(f, a);
const frames = () => ev(() => new Promise((r) => { let k = 0; const f = () => (++k >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
await page.goto(`http://localhost:${srv.address().port}/`); await page.waitForFunction(() => window.__BD?.ui()?.panel);
await ev(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(1500);
const log = []; let n = 0; const t0 = Date.now();
const info = () => ev(() => { const st = __BD.store.state, u = __BD.ui(); const texts = (u.screen?.container?.list ?? []).map((o) => o.text).filter(Boolean); return { tut: __BD.tutorial(), res: st.resources, beacon: st.buildings.beacon?.level, constr: st.construction.map((j) => `${j.id} ${Math.round(j.total - j.progress)}s`), badges: Object.entries(u.navBadges ?? {}).length, modal: !!u.modal, screen: u.screen?.id, world: u.worldMode, nTexts: texts.length }; });
const shot = async (name, note) => { await sleep(700); const f = `${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: OUT + f }); const i = await info(); log.push({ f, note, t: Math.round((Date.now() - t0) / 1000), ...i }); console.log(f, JSON.stringify(i.tut), i.constr); };
await shot('first-load', 'what a brand-new player sees');
for (let step = 0; step < 8; step++) {
  for (let k = 0; k < 12; k++) {
    await sleep(300); await frames();
    const t = await ev(() => __BD.tutorial());
    if (!t.active || t.step !== step) break;
    if (k === 0 || k === 3) await shot(`step${step + 1}-${k}`, t.title);
    if (await ev(() => !!__BD.ui().reveal)) { await shot(`step${step + 1}-reveal`, 'recruit reveal'); await ev(() => __BD.ui().closeReveal()); continue; }
    if (t.target) { const p = await ev((t) => __BD.gameToPage(t.x, t.y), t.target); await page.mouse.click(p.x, p.y); await frames(); }
    if (step === 5) { const m = await ev(() => __BD.store.world.marches().length); if (m) { await shot('march', 'squad marching'); await ev(() => { for (let i = 0; i < 200 && !__BD.store.state.hunt.reports.length; i++) __BD.store.tick(1); }); await shot('battle-report', 'first battle result'); await ev(() => __BD.ui().closeModal?.()); } }
  }
}
await shot('tutorial-done', 'after tutorial');
// sample ~10 minutes of play: what is left to do, what timers run
for (const id of ['base', 'troops', 'armory', 'squads', 'more']) { await ev((id) => __BD.ui().onTab(id), id); await shot(`post-${id}`, 'post tutorial tab'); }
await ev(() => __BD.ui().onTab('base'));
await ev(() => { for (let i = 0; i < 600; i++) __BD.store.tick(1); }); await shot('after-10min-sim', '10 simulated minutes idle');
await writeFile(OUT + 'log.json', JSON.stringify({ log, errs }, null, 1));
await browser.close(); srv.close();
