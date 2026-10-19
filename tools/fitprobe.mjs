// node fitprobe.mjs ROOT OUTDIR [sizes] [saves]  -> OUTDIR/<size>-<save>/<nn>-<screen>.png + issues.json
import { chromium } from '/workspace/broken-dawn/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { LAYOUT_SCREENS } from '/workspace/broken-dawn/tests/layout-screens.js';
const [ROOT, OUT, SZ = '390x844,360x740,375x667,430x932', SV = 'mid,early,late'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const srv = createServer(async (req, res) => { try { const p = join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(p)); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => srv.listen(0, r));
const url = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const all = {};
for (const sz of SZ.split(',')) for (const sv of SV.split(',')) {
  const [w, h] = sz.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__BD?.ui()?.panel);
  await page.evaluate(readFileSync('/workspace/tools/midsave.js', 'utf8'));
  await page.evaluate((k) => window[`__${k}Save`](), sv);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__BD?.ui()?.panel); await page.waitForTimeout(1200);
  const dir = join(OUT, `${sz}-${sv}`); await mkdir(dir, { recursive: true });
  const issues = {};
  let n = 0;
  for (const [name, fn] of LAYOUT_SCREENS) {
    n++;
    try {
      await page.evaluate(() => { const u = __BD.ui(); u.reveal?.destroy(); u.reveal = null; u.closeModal(true); u.closeScreen(); u.closePanel(true); __BD.base().select?.(null); });
      await page.waitForTimeout(150);
      const r = await page.evaluate(`(async (u) => { ${fn} })(__BD.ui())`);
      if (r?.tap) await page.mouse.click(r.tap.x, r.tap.y);
      await page.waitForTimeout(name.startsWith('reveal') ? 3500 : 600);
      if (name.startsWith('reveal')) await page.evaluate(() => { const u = __BD.ui(); const b = __BD.controls().find((c) => c.label === 'Reveal All'); return b; }).then(async (b) => { if (b) { await page.mouse.click(b.x, b.y); await page.waitForTimeout(2500); } });
      await page.evaluate(() => { const u = __BD.ui(); if (u.toastBox) { u.tweens.killTweensOf(u.toastBox); u.toastBox.alpha = 0; } });
      const li = await page.evaluate(() => __BD.layoutIssues());
      if (li.length) issues[name] = li;
      await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name.replace(/\s+/g, '-')}.png`) });
    } catch (e) { issues[name] = [`ERROR ${e.message.split('\n')[0]}`]; }
  }
  if (errs.length) issues.pageErrors = errs.slice(0, 5);
  await writeFile(join(dir, 'issues.json'), JSON.stringify(issues, null, 1));
  all[`${sz}-${sv}`] = issues;
  console.log(sz, sv, Object.values(issues).reduce((a, b) => a + b.length, 0), 'issues');
  await ctx.close();
}
await writeFile(join(OUT, 'issues.json'), JSON.stringify(all, null, 1));
await browser.close(); srv.close();
