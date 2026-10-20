// quick layout probe: all LAYOUT_SCREENS at 6 sizes, mid save (and late/early at 375x560)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const ROOT = '/workspace/broken-dawn';
const { LAYOUT_SCREENS } = await import(ROOT + '/tests/layout-screens.js');
const only = process.env.SCR ? process.env.SCR.split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = createServer(async (req, res) => { try { const p = join(ROOT, 'dist', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])); const b = await readFile(p); res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png' }[extname(p)] ?? 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const midsave = readFileSync(ROOT + '/tools/midsave.js', 'utf8');
let total = 0;
for (const [w, h] of [[390, 844], [360, 740], [375, 667], [430, 932], [390, 664], [375, 560]]) for (const save of (w === 375 && h === 560 ? ['mid', 'late', 'early'] : ['mid'])) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const ev = (f, a) => page.evaluate(f, a);
  await page.goto(url); await page.waitForFunction(() => window.__BD?.ui()?.panel);
  await ev(midsave); await ev((k) => window[`__${k}Save`](), save); await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(600);
  for (const [name, code] of LAYOUT_SCREENS) {
    if (only && !only.some((o) => name.startsWith(o))) continue;
    await ev(() => { const u = __BD.ui(); u.reveal?.destroy(); u.reveal = null; u.closeModal(true); u.closeScreen(); u.closePanel(true); if (u.worldMode) { u.scene.get('World').select?.(null); u.hideWorld(); } });
    await sleep(100);
    try { const r = await ev(`(async (u) => { ${code} })(__BD.ui())`); if (r?.tap) await page.mouse.click(r.tap.x, r.tap.y); } catch (e) { console.log(w, h, save, name, 'ERR', e.message.slice(0, 200)); }
    await sleep(name.startsWith('reveal') ? 3000 : 350);
    const is = await ev(() => __BD.layoutIssues());
    if (is.length) { total += is.length; console.log(`${w}x${h} ${save} ${name}:`, is.slice(0, 4).join(' | ')); }
  }
  if (errs.length) console.log(w, h, save, 'PAGE ERRORS', errs.slice(0, 3));
  await ctx.close();
}
console.log('TOTAL', total);
await browser.close(); srv.close();
