// Headless smoke test for stage 1. Runs against the single-file build
// (file://) and the dist/ build (served over http) at a 390x844 phone viewport.
//   npm run build && npm test
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOTS = process.argv.includes('--screens');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serveDist() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = createServer(async (req, res) => {
    try {
      const p = join(ROOT, 'dist', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

async function run(url, label, takeShots) {
  console.log(`\n=== ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);

  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(400); };
  await page.goto(url); await ready();
  await page.evaluate(() => localStorage.clear()); await page.reload(); await ready();

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const cam = () => ev(() => { const c = __BD.base().cameras.main; return { zoom: c.zoom, x: c.scrollX, y: c.scrollY }; });
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const power = () => ev(() => __BD.store.power.total);
  // page coords of a footprint centre, of a world point, of a UI (game-space) point
  const fpCenter = (id) => ev((id) => {
    const s = __BD.store.state, isB = id === 'beacon';
    const gx = isB ? 12 : s.buildings[id].gx, gy = isB ? 12 : s.buildings[id].gy;
    const b = __BD.base(); const ox = 26 * 48, oy = 140; // grid origin
    return __BD.worldToPage(ox + (gx + 1 - (gy + 1)) * 48, oy + (gx + 1 + gy + 1) * 24);
  }, id);
  const tileCenter = (gx, gy) => ev(([gx, gy]) => __BD.worldToPage(26 * 48 + (gx + 0.5 - (gy + 0.5)) * 48, 140 + (gx + gy + 1) * 24), [gx, gy]);
  const uiPoint = (fn) => ev(fn);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });

  const shot = async (name) => { if (takeShots) { await sleep(250); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };

  // --- Wheel zoom (clamped)
  const z0 = (await cam()).zoom;
  await page.mouse.move(195, 420);
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 200); await sleep(20); }
  const zMin = (await cam()).zoom;
  check('wheel zoom out works and clamps at min', zMin < z0 && Math.abs(zMin - 0.4) < 1e-6, `${z0.toFixed(2)} -> ${zMin.toFixed(2)}`);
  await shot('01-base-zoomed-out.png');
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -200); await sleep(10); }
  check('wheel zoom in clamps at max', Math.abs((await cam()).zoom - 1.8) < 1e-6);
  await ev(() => { const b = __BD.base(); b.cameras.main.setZoom(0.62); b.cameras.main.centerOn(b.beaconCenter.x, b.beaconCenter.y - 40); });
  await sleep(100);

  // --- Pinch zoom (two-finger touch)
  const zp0 = (await cam()).zoom;
  await touch('touchStart', [{ x: 160, y: 420 }, { x: 230, y: 420 }]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: 160 - i * 6, y: 420 }, { x: 230 + i * 6, y: 420 }]); await sleep(16); }
  await touch('touchEnd', []);
  const zp1 = (await cam()).zoom;
  check('pinch-out zooms in', zp1 > zp0 * 1.4, `${zp0.toFixed(2)} -> ${zp1.toFixed(2)}`);
  await touch('touchStart', [{ x: 100, y: 420 }, { x: 290, y: 420 }]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: 100 + i * 7, y: 420 }, { x: 290 - i * 7, y: 420 }]); await sleep(16); }
  await touch('touchEnd', []);
  check('pinch-in zooms out', (await cam()).zoom < zp1, `${zp1.toFixed(2)} -> ${(await cam()).zoom.toFixed(2)}`);
  await ev(() => { const b = __BD.base(); b.cameras.main.setZoom(0.62); b.cameras.main.centerOn(b.beaconCenter.x, b.beaconCenter.y - 40); });
  await sleep(100);

  // --- Drag-to-pan on empty ground (mouse) and touch
  const before = await state();
  let c0 = await cam();
  const empty = await tileCenter(10, 17);
  await page.mouse.move(empty.x, empty.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(empty.x + i * 10, empty.y + i * 6); await sleep(16); }
  await page.mouse.up();
  let c1 = await cam();
  check('mouse drag on empty ground pans the map', Math.abs(c1.x - c0.x) > 50 && Math.abs(c1.y - c0.y) > 30, `dx ${(c1.x - c0.x).toFixed(0)} dy ${(c1.y - c0.y).toFixed(0)}`);
  c0 = c1;
  const e2 = await tileCenter(10, 17);
  await touch('touchStart', [e2]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: e2.x - i * 10, y: e2.y - i * 6 }]); await sleep(16); }
  await touch('touchEnd', []);
  c1 = await cam();
  check('touch drag on empty ground pans the map', Math.abs(c1.x - c0.x) > 50, `dx ${(c1.x - c0.x).toFixed(0)}`);
  check('panning did not move any building', JSON.stringify((await state()).buildings) === JSON.stringify(before.buildings));

  // --- Dragging a NON-selected building quickly = pan, not move
  c0 = await cam();
  const ccp = await fpCenter('commandCenter');
  await touch('touchStart', [ccp]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: ccp.x + i * 12, y: ccp.y }]); await sleep(16); }
  await touch('touchEnd', []);
  c1 = await cam();
  check('quick swipe starting on a building pans (does not move it)', Math.abs(c1.x - c0.x) > 30 && JSON.stringify((await state()).buildings.commandCenter) === JSON.stringify(before.buildings.commandCenter));

  // --- Beacon can't be moved (long-press + drag)
  const beaconSpriteBefore = await ev(() => { const s = __BD.base().beaconSprite; return [s.x, s.y]; });
  const bp = await fpCenter('beacon');
  await touch('touchStart', [bp]); await sleep(650);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: bp.x + i * 12, y: bp.y + i * 8 }]); await sleep(16); }
  await touch('touchEnd', []);
  await sleep(100);
  const beaconSpriteAfter = await ev(() => { const s = __BD.base().beaconSprite; return [s.x, s.y]; });
  const beaconToast = await ev(() => __BD.ui().toastBox.visible && __BD.ui().toastText.text);
  check('Beacon cannot be moved by long-press + drag', JSON.stringify(beaconSpriteBefore) === JSON.stringify(beaconSpriteAfter) && /anchored/i.test(beaconToast || ''), beaconToast || 'no toast');
  check('Beacon is not in move mode', (await ev(() => __BD.base().moveId)) === null);
  check('Beacon has no movable entry and canPlace("beacon") is false', (await ev(() => __BD.store.canPlace('beacon', 9, 9))) === false);

  // --- Tap building -> info panel; Upgrade updates Base Power
  const p0 = await power();
  const ccTap = await fpCenter('commandCenter');
  await page.mouse.click(ccTap.x, ccTap.y);
  await sleep(300);
  check('tapping Command Center opens its info panel', (await ev(() => __BD.ui().panelOpenFor)) === 'commandCenter');
  const panelTxt = await ev(() => [__BD.ui().pTitle.text, __BD.ui().pLevel.text, __BD.ui().pStats.text].join(' | '));
  check('panel shows name, level, power contribution', /Command Center/.test(panelTxt) && /Lv 1/.test(panelTxt) && /\+10/.test(panelTxt));
  await shot('02-building-info-panel.png');
  const up = await uiPoint(() => { const b = __BD.ui().pUpgrade; return __BD.gameToPage(b.x, b.y); });
  await page.mouse.click(up.x, up.y);
  await sleep(300);
  const p1 = await power();
  const hudPower = await ev(() => __BD.ui().powerText.text);
  check('Upgrade raises Base Power by +10 (Command Center)', p1 === p0 + 10, `${p0} -> ${p1}, HUD "${hudPower}"`);
  check('HUD Base Power shows new value', hudPower === String(p1));
  check('Upgrade spent Energy and raised level', (await state()).buildings.commandCenter.level === 2);
  // not enough energy -> stays put
  await ev(() => { __BD.store.state.resources.energy = 0; });
  await page.mouse.click(up.x, up.y); await sleep(200);
  check('Upgrade blocked without Energy', (await power()) === p1 && (await state()).buildings.commandCenter.level === 2);
  // close panel via X
  const x = await uiPoint(() => { const ui = __BD.ui(); const r = ui.panelRect; return __BD.gameToPage(r.x + r.width - 40, r.y + 44); });
  await page.mouse.click(x.x, x.y); await sleep(150);
  check('panel closes with ✕', (await ev(() => __BD.ui().panelOpenFor)) === null);

  // --- Long-press + drag Barracks to a new tile (touch)
  const br0 = (await state()).buildings.barracks;
  const bS = await fpCenter('barracks');
  const bT = await ev(([gx, gy]) => __BD.worldToPage(26 * 48 + (gx + 1 - (gy + 1)) * 48, 140 + (gx + gy + 2) * 24), [br0.gx, br0.gy + 3]);
  await touch('touchStart', [bS]); await sleep(600);
  check('long-press enters move mode', (await ev(() => __BD.base().moveId)) === 'barracks');
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [{ x: bS.x + ((bT.x - bS.x) * i) / 12, y: bS.y + ((bT.y - bS.y) * i) / 12 }]); await sleep(20); }
  await touch('touchEnd', []); await sleep(150);
  const br1 = (await state()).buildings.barracks;
  check('dragging Barracks moves it (snapped to grid)', br1.gx === br0.gx && br1.gy === br0.gy + 3, `(${br0.gx},${br0.gy}) -> (${br1.gx},${br1.gy})`);
  // Done
  const done = await uiPoint(() => { const r = __BD.ui().bannerRect; return __BD.gameToPage(r.x + r.width - 80, r.y + r.height / 2); });
  check('move banner visible', await ev(() => __BD.ui().banner.visible));
  await page.mouse.click(done.x, done.y); await sleep(150);
  check('Done exits move mode', (await ev(() => __BD.base().moveId)) === null);

  // --- Tap-select route: tap Armory -> Move button -> drag (mouse)
  const ar0 = (await state()).buildings.armory;
  const aS = await fpCenter('armory');
  await page.mouse.click(aS.x, aS.y); await sleep(250);
  const mv = await uiPoint(() => { const b = __BD.ui().pMove; return __BD.gameToPage(b.x, b.y); });
  const dbg = await ev(() => `panel=${__BD.ui().panelOpenFor} panelY=${__BD.ui().panel.y} move=${__BD.base().moveId}`);
  await page.mouse.click(mv.x, mv.y); await sleep(200);
  check('Move button enters move mode', (await ev(() => __BD.base().moveId)) === 'armory', dbg);
  const aT = await ev(([gx, gy]) => __BD.worldToPage(26 * 48 + (gx + 1 - (gy + 1)) * 48, 140 + (gx + gy + 2) * 24), [ar0.gx - 3, ar0.gy]);
  await page.mouse.move(aS.x, aS.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(aS.x + ((aT.x - aS.x) * i) / 12, aS.y + ((aT.y - aS.y) * i) / 12); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  const ar1 = (await state()).buildings.armory;
  check('mouse drag moves Armory in move mode', ar1.gx === ar0.gx - 3 && ar1.gy === ar0.gy, `(${ar0.gx},${ar0.gy}) -> (${ar1.gx},${ar1.gy})`);

  // --- Invalid drop on the Beacon is rejected
  const aS2 = await fpCenter('armory');
  const onBeacon = await fpCenter('beacon');
  await page.mouse.move(aS2.x, aS2.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(aS2.x + ((onBeacon.x - aS2.x) * i) / 10, aS2.y + ((onBeacon.y - aS2.y) * i) / 10); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  check('dropping onto the Beacon is rejected (snaps back)', JSON.stringify((await state()).buildings.armory) === JSON.stringify(ar1));
  // Invalid drop off-platform
  const offP = await tileCenter(2, 2);
  await ev(() => { const c = __BD.base().cameras.main; c.setZoom(0.4); });
  await sleep(50);
  const aS3 = await fpCenter('armory'); const off2 = await tileCenter(1, 3);
  await page.mouse.move(aS3.x, aS3.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(aS3.x + ((off2.x - aS3.x) * i) / 10, aS3.y + ((off2.y - aS3.y) * i) / 10); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  check('dropping onto rocky terrain is rejected', JSON.stringify((await state()).buildings.armory) === JSON.stringify(ar1));
  void offP;
  // tap empty ground exits move mode
  await ev(() => { const b = __BD.base(); b.cameras.main.setZoom(0.62); b.cameras.main.centerOn(b.beaconCenter.x, b.beaconCenter.y - 40); });
  await sleep(100);
  const emptyTap = await tileCenter(10, 17);
  await page.mouse.click(emptyTap.x, emptyTap.y); await sleep(150);
  check('tapping empty ground exits move mode', (await ev(() => __BD.base().moveId)) === null);
  if (takeShots) await sleep(2700); // let the "can't place" toast fade
  await shot('03-after-moving-buildings.png');

  // --- Persistence across reload
  const saved = await state();
  await page.reload(); await ready();
  const restored = await state();
  check('building positions persist after reload', JSON.stringify(restored.buildings) === JSON.stringify(saved.buildings), JSON.stringify(restored.buildings));
  const spritePos = await ev(() => { const b = __BD.base(); return [b.sprites.barracks.img.x, b.sprites.barracks.img.y]; });
  const expect = await ev(() => { const s = __BD.store.state.buildings.barracks; return [26 * 48 + (s.gx - s.gy) * 48, 140 + (s.gx + s.gy + 4) * 24]; });
  check('restored sprite drawn at saved tile', Math.abs(spritePos[0] - expect[0]) < 0.5 && Math.abs(spritePos[1] - expect[1]) < 0.5);
  check('Base Power restored after reload', (await power()) === p1);

  // --- Offline earnings (1h, and capped at 8h)
  // (disable the live page's save-on-unload so it doesn't overwrite the edited save)
  const editSave = (agoMs) => ev((agoMs) => { __BD.store.save = () => {}; const k = 'brokenDawn.save.v1'; const s = JSON.parse(localStorage.getItem(k)); s.resources.energy = 0; s.lastSaved = Date.now() - agoMs; localStorage.setItem(k, JSON.stringify(s)); }, agoMs);
  await editSave(3600e3);
  await page.reload(); await ready();
  let en = (await state()).resources.energy;
  check('offline earnings applied (~1h at 1/s)', en > 3590 && en < 3700, `energy ${en.toFixed(0)}`);
  await editSave(30 * 3600e3);
  await page.reload(); await ready();
  en = (await state()).resources.energy;
  check('offline earnings capped at 8h', en > 28790 && en < 28900, `energy ${en.toFixed(0)}`);
  check('Beacon charge filled offline', (await state()).beacon.charge === 100);

  // --- Beacon upgrade (needs full charge) raises power by +15 and resets charge
  const bp0 = await power();
  await ev(() => __BD.store.upgrade('beacon'));
  check('Beacon upgrade adds +15 power and resets charge', (await power()) === bp0 + 15 && (await state()).beacon.charge === 0 && (await state()).beacon.level === 2);

  // --- Nav: stage-2 tabs and Settings > Reset
  const tabPt = (i) => ev((i) => __BD.gameToPage((720 / 5) * (i + 0.5), __BD.ui().scale.height - 65), i);
  let t = await tabPt(1); await page.mouse.click(t.x, t.y); await sleep(250);
  check('Troops tab shows "Coming in stage 2"', await ev(() => { const m = __BD.ui().modal; return !!m && m.list.some((o) => o.text && /Coming in stage 2/.test(o.text)); }));
  // map is blocked while modal is open
  const zBefore = (await cam()).x;
  await page.mouse.move(195, 500); await page.mouse.down(); await page.mouse.move(260, 560, { steps: 5 }); await page.mouse.up();
  check('map input blocked while a modal is open', (await cam()).x === zBefore);
  for (const i of [2, 3]) {
    await ev(() => __BD.ui().closeModal());
    t = await tabPt(i); await page.mouse.click(t.x, t.y); await sleep(200);
    check(`tab ${i} shows "Coming in stage 2"`, await ev(() => { const m = __BD.ui().modal; return !!m && m.list.some((o) => o.text && /Coming in stage 2/.test(o.text)); }));
  }
  await ev(() => __BD.ui().closeModal());
  t = await tabPt(4); await page.mouse.click(t.x, t.y); await sleep(250);
  const btn = async (label) => ev((label) => {
    const m = __BD.ui().modal; const b = m.list.find((o) => o.list && o.list.some((q) => q.text === label));
    return __BD.gameToPage(b.x, b.y);
  }, label);
  let rb = await btn('Reset Save'); await page.mouse.click(rb.x, rb.y); await sleep(250);
  check('Reset Save asks for confirmation', await ev(() => __BD.ui().modal.list.some((o) => o.text && /Reset all progress/.test(o.text))));
  rb = await btn('Cancel'); await page.mouse.click(rb.x, rb.y); await sleep(200);
  check('Cancel keeps the save', (await state()).beacon.level === 2);
  t = await tabPt(4); await page.mouse.click(t.x, t.y); await sleep(250);
  rb = await btn('Reset Save'); await page.mouse.click(rb.x, rb.y); await sleep(250);
  rb = await btn('Reset'); await page.mouse.click(rb.x, rb.y); await sleep(300);
  const fresh = await state();
  check('Reset restores defaults', fresh.beacon.level === 1 && fresh.buildings.commandCenter.level === 1 && fresh.buildings.barracks.gy === 12 && (await power()) === 30);
  const sp2 = await ev(() => { const b = __BD.base(); return [b.sprites.barracks.img.x, b.sprites.barracks.img.y]; });
  check('Reset moves sprites back', Math.abs(sp2[0] - (26 * 48 + (8 - 12) * 48)) < 0.5);
  await page.reload(); await ready();
  check('Reset persists after reload', (await state()).buildings.barracks.gy === 12 && (await power()) === 30);

  // --- Viewport fill
  const rect = await ev(() => { const r = __BD.game.canvas.getBoundingClientRect(); return [r.width, r.height]; });
  check('canvas fills the 390x844 viewport', Math.abs(rect[0] - 390) < 2 && Math.abs(rect[1] - 844) < 2, rect.map((n) => n.toFixed(0)).join('x'));

  check('no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

const srv = await serveDist();
try {
  await run(`file://${join(ROOT, 'broken-dawn-stage1.html')}`, 'single-file build', SHOTS);
  await run(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
} finally { srv.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
