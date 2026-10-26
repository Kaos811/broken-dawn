// Stage 13 smoke: play the new-player onboarding from a fresh save by following the pointer.
//   node tools/play13.mjs [--shots]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SHOTS = process.argv.includes('--shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.css': 'text/css' };
const srv = createServer(async (q, s) => { try { const p = join(ROOT, 'dist', q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); const b = await readFile(p); s.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); s.end(b); } catch { s.writeHead(404); s.end(); } });
await new Promise((r) => srv.listen(0, r));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const ev = (f, a) => page.evaluate(f, a);
await page.goto(`http://localhost:${srv.address().port}/`);
await page.waitForFunction(() => window.__BD?.ui()?.panel); await ev(() => localStorage.clear()); await page.reload();
await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(1200);
const ctl = async (meta) => (await ev(() => __BD.controls())).find((c) => c.meta === meta && c.enabled);
const seen = new Set(); const t0 = Date.now(); let n = 0, last = '';
const shot = async (name) => { if (SHOTS && !seen.has(name)) { seen.add(name); await sleep(700); await page.screenshot({ path: join(ROOT, 'screens', `stage13-${name}.png`) }); console.log('  shot', name); } };
for (let i = 0; i < 400; i++) {
  const t = await ev(() => __BD.tutorial());
  const key = `${t.id}|${t.story}|${t.celebrating}|${t.visible}`;
  if (key !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', key, t.title, '| locked:', t.locked.join(',')); last = key; }
  if (!t.active && !t.celebrating) break;
  if (t.story != null) { await shot(`story-${t.story + 1}`); await page.mouse.click(195, 500); await sleep(700); continue; }
  if (t.celebrating) { await shot(`celebrate-${t.id}`); const b = await ctl('celebrate-btn'); if (b) await page.mouse.click(b.x, b.y); else await page.mouse.click(195, 800); await sleep(700); continue; }
  if (!t.visible && await ev(() => !!(__BD.ui().reveal || __BD.ui().replay))) { await shot(`reveal-${t.id}`); const b = (await ev(() => __BD.controls())).filter((c) => /^(Continue|Reveal All|Close|Skip)$/.test(c.label) && c.enabled).pop(); if (b) await page.mouse.click(b.x, b.y); await sleep(800); continue; }
  if (t.visible) await shot(`${String(t.step).padStart(2, '0')}-${t.id}`);
  if (t.target) { const p = await ev((t) => __BD.gameToPage(t.x, t.y), t.target); await page.mouse.click(p.x, p.y); n++; await sleep(600); continue; }
  const c = await ctl('tutorial-continue');
  if (t.visible && c) { await page.mouse.click(c.x, c.y); await sleep(600); continue; }
  await sleep(500);
}
await sleep(1000);
const t = await ev(() => __BD.tutorial()); const s = await ev(() => ({ v: __BD.store.state.version, tut: __BD.store.state.tutorial, leaders: Object.keys(__BD.store.state.leaders ?? {}), alpha: __BD.store.state.squads?.alpha?.leader }));
console.log('MODAL', await ev(() => { const m = __BD.ui().modal; return m ? Object.keys(m).filter(k => k.startsWith('is')).join(',') + ' ' + (m.list ?? []).map(o => o.text).filter(Boolean).slice(0,4).join('|') : null; }), 'hints', await ev(() => JSON.stringify(__BD.store.state.hints)));
console.log('END', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(t), JSON.stringify(s), 'taps', n);
await shot('done');
console.log('errors:', errors.slice(0, 10));
await browser.close(); srv.close();
