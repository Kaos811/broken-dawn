// Headless e2e test for stages 1 and 2. Runs against the single-file build
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
  check('Beacon upgrade adds +15 power and resets charge', (await power()) === bp0 + 15 && (await state()).beacon.charge < 1 && (await state()).beacon.level === 2);

  // --- Nav: Troops / Armory / Squads open real screens now; Settings > Reset
  const tabPt = (i) => ev((i) => __BD.gameToPage((720 / 5) * (i + 0.5), __BD.ui().scale.height - 65), i);
  let t = await tabPt(1); await page.mouse.click(t.x, t.y); await sleep(300);
  check('Troops tab opens the Barracks screen', await ev(() => __BD.ui().screen?.id === 'troops' && __BD.ui().activeTab === 'troops'));
  // map is blocked while a screen is open
  const zBefore = (await cam()).x;
  await page.mouse.move(195, 500); await page.mouse.down(); await page.mouse.move(260, 560, { steps: 5 }); await page.mouse.up();
  check('map input blocked while a screen is open', (await cam()).x === zBefore);
  for (const [i, id] of [[2, 'armory'], [3, 'squads']]) {
    t = await tabPt(i); await page.mouse.click(t.x, t.y); await sleep(300);
    check(`tab ${i} opens the ${id} screen`, await ev((id) => __BD.ui().screen?.id === id, id));
  }
  t = await tabPt(0); await page.mouse.click(t.x, t.y); await sleep(200);
  check('Base tab closes screens', await ev(() => __BD.ui().screen === null && __BD.ui().activeTab === 'base'));
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

// ------------------------------------------------------------------ STAGE 2 --
async function runStage2(url, label, takeShots) {
  console.log(`\n=== stage 2 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(400); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const power = () => ev(() => __BD.store.power);
  const shot = async (name) => { if (takeShots) { await sleep(300); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  // Finds a visible control, polling up to 3 s (the UI refreshes on its own ~5x/s).
  const ctl = async (label, { meta, kind } = {}) => {
    for (let tries = 0; tries < 15; tries++) {
      const all = await ev(() => __BD.controls());
      const m = all.filter((c) => c.label === label && (meta === undefined || c.meta === meta) && (!kind || c.kind === kind) && c.enabled);
      if (m.length) return m[m.length - 1];
      await sleep(200);
    }
    return null;
  };
  const click = async (label, opts = {}) => {
    // Phaser makes new interactive objects hittable on the next frame, so let a couple of frames pass first.
    await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const c = await ctl(label, opts);
    if (!c) throw new Error(`control not found: ${label} ${JSON.stringify(opts)}`);
    await page.mouse.click(c.x, c.y);
    // Phaser handles input on its next frame and buttons fire via delayedCall(0), so wait a few frames
    // (on a busy machine 300 ms alone can be less than one frame).
    await ev(() => new Promise((r) => { let n = 0; const f = () => (++n >= 4 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await sleep(opts.wait ?? 300);
    return c;
  };
  // Polls a page predicate (up to ~2.5 s) so UI-timing checks don't flake under load.
  const waitTrue = async (fn, arg) => { for (let i = 0; i < 25; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const refresh = async () => { await ev(() => __BD.ui().renderScreen()); await sleep(150); };
  const tab = async (i) => { const p = await ev((i) => __BD.gameToPage((720 / 5) * (i + 0.5), __BD.ui().scale.height - 65), i); await page.mouse.click(p.x, p.y); await sleep(350); };
  // Overwrite the save while the page can't overwrite it back, then reload.
  const editSave = async (fn, arg) => { await ev(([fn, arg]) => { __BD.store.save = () => {}; const k = 'brokenDawn.save.v1'; const s = JSON.parse(localStorage.getItem(k)); new Function('s', 'arg', fn)(s, arg); localStorage.setItem(k, JSON.stringify(s)); }, [fn, arg]); await page.reload(); await ready(); };

  try {
    await page.goto(url); await ready();

    // --- 0. Save migration from a v2 save with the old SEQUENTIAL queue -> v3 parallel lanes
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 2, resources: { energy: 500, shards: 321, alloy: 12 }, beacon: { level: 1, charge: 10 },
        buildings: { commandCenter: { level: 1, gx: 12, gy: 8 }, barracks: { level: 1, gx: 8, gy: 12 }, armory: { level: 1, gx: 16, gy: 16 } },
        troops: { sentinel: 5, bearer: 2, voyager: 1 },
        training: [{ type: 'sentinel', count: 3, progress: 2 }, { type: 'bearer', count: 5, progress: 0 }, { type: 'sentinel', count: 2, progress: 0 }, { type: 'voyager', count: 4, progress: 0 }],
        squads: { alpha: { level: 1, lines: [{ type: 'sentinel', count: 2 }, { type: null, count: 0 }, { type: null, count: 0 }] }, bravo: { level: 1, lines: [] }, charlie: { level: 1, lines: [] } },
        leaders: {}, gear: {}, gacha: { sinceEpic: 0, sinceLegendary: 0, total: 0, history: [] },
        lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    let m = await state();
    check('v2 save migrates to version 3', m.version === 3);
    check('v2 queue moves into per-class lanes (sentinel 3+2, bearer 5, voyager 4)', m.training.sentinel.count === 5 && m.training.bearer.count === 5 && m.training.voyager.count === 4, JSON.stringify(m.training));
    check('v2 head batch progress carries over to its lane', m.training.sentinel.progress >= 2 && m.training.sentinel.progress < 5, m.training.sentinel.progress.toFixed(2));
    check('migrated lanes all run at once', m.training.bearer.progress > 0 && m.training.voyager.progress > 0);
    check('v2 migration keeps troops, Energy, Shards, Alloy and squads', m.troops.sentinel === 5 && m.troops.bearer === 2 && m.troops.voyager === 1 && m.resources.energy >= 500 && m.resources.energy < 510 && Math.floor(m.resources.shards) === 321 && m.resources.alloy >= 12 && m.squads.alpha.lines[0].count === 2, JSON.stringify(m.resources));
    check('v2 migration keeps a backup of the v2 save', await ev(() => { const b = JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v2') || 'null'); return !!b && b.version === 2 && b.training.length === 4; }));

    // --- 1. Save migration from a stage-1 (v1) save
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 1, resources: { energy: 1234 }, beacon: { level: 2, charge: 50 },
        buildings: { commandCenter: { level: 3, gx: 12, gy: 8 }, barracks: { level: 2, gx: 8, gy: 15 }, armory: { level: 1, gx: 16, gy: 16 } },
        troops: {}, squads: { alpha: { level: 1, members: [] }, bravo: { level: 1, members: [] }, charlie: { level: 1, members: [] } },
        lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    let s = await state();
    check('v1 save migrates to version 3', s.version === 3);
    check('migration keeps buildings, levels, Energy and Beacon', s.buildings.barracks.gy === 15 && s.buildings.commandCenter.level === 3 && s.buildings.barracks.level === 2 && s.beacon.level === 2 && s.resources.energy >= 1234 && s.resources.energy < 1260, `energy ${s.resources.energy.toFixed(0)}`);
    check('migration adds Shards (500), Alloy, troops, squad lines', Math.floor(s.resources.shards) === 500 && s.resources.alloy < 5 && s.troops.sentinel === 0 && s.squads.alpha.lines.length === 3 && s.squads.alpha.leader === null);
    check('migration keeps a backup of the v1 save', await ev(() => !!localStorage.getItem('brokenDawn.save.v1.backup-v1')));
    check('Base Power after migration = buildings only (70)', (await power()).total === 70, JSON.stringify(await power()));
    await ev(() => { __BD.store.state.resources.energy = 200; __BD.store.state.resources.shards = 500; __BD.store.save(); });

    // --- 2. Training via the Troops tab (three parallel lanes)
    await tab(1);
    check('Troops tab opens the Barracks', await ev(() => __BD.ui().screen?.id === 'troops'));
    check('per-lane capacity = 20 at Barracks Lv2', (await ev(() => __BD.store.laneCapacity())) === 20);
    const e0 = (await state()).resources.energy;
    await click('x1', { meta: 'sentinel' });
    s = await state();
    check('Train x1 Sentinel puts 1 unit in the Sentinel lane and costs 6 Energy', s.training.sentinel.count === 1 && s.training.bearer.count === 0 && Math.abs((e0 - s.resources.energy) - 6) < 0.6, `spent ${(e0 - s.resources.energy).toFixed(2)}`);
    check('queued unit does not add power yet', (await power()).troop === 0);
    const pr0 = await ev(() => __BD.store.state.training.sentinel.progress);
    await sleep(1500);
    const pr1 = await ev(() => __BD.store.state.training.sentinel.progress);
    check('training timer runs live', pr1 > pr0, `${pr0.toFixed(2)} -> ${pr1.toFixed(2)}s`);
    check('unit time = 8s / Barracks Lv2 speed 1.2', Math.abs((await ev(() => __BD.store.unitTime('sentinel'))) - 8 / 1.2) < 1e-9);
    await ev(() => __BD.store.tick(7));
    s = await state();
    check('timer completes: Sentinel trained, lane empty', s.troops.sentinel === 1 && s.training.sentinel.count === 0 && s.training.sentinel.progress === 0);
    await sleep(300);
    const p1 = await power();
    check('Troop Power: trained soldier adds 1 to Base Power', p1.troop === 1 && p1.total === 71, JSON.stringify(p1));
    check('HUD breakdown shows Troops', await ev(() => /Troops 1\b/.test(__BD.ui().powerSub.text) && __BD.ui().powerText.text === '71'));

    await ev(() => { __BD.store.state.resources.energy = 150; }); await refresh();
    await click('x10', { meta: 'bearer' });
    s = await state();
    check('Train x10 Bearers fills the Bearer lane with 10 for 80 Energy', s.training.bearer.count === 10 && s.resources.energy < 71 && s.resources.energy > 69, `energy ${s.resources.energy.toFixed(1)}`);
    await sleep(300);
    const maxBtn = await ctl('Max (10)', { meta: 'voyager' });
    check('Max button shows the affordable/lane-limited amount', !!maxBtn, (await ev(() => __BD.controls().filter((c) => c.meta === 'voyager').map((c) => c.label))).join(','));
    await click('Max (10)', { meta: 'voyager' });
    await ev(() => { __BD.store.state.resources.energy = 60; }); await refresh();
    await click('x10', { meta: 'sentinel' });
    s = await state();
    check('all three lanes hold 10 units at once (30 queued > old shared cap of 20)', s.training.sentinel.count === 10 && s.training.bearer.count === 10 && s.training.voyager.count === 10 && (await ev(() => __BD.store.queuedUnits())) === 30, JSON.stringify(s.training));
    const lp0 = await ev(() => JSON.parse(JSON.stringify(__BD.store.state.training)));
    await sleep(1200);
    const lp1 = await ev(() => JSON.parse(JSON.stringify(__BD.store.state.training)));
    check('all three lane timers run simultaneously (live)', ['sentinel', 'bearer', 'voyager'].every((t) => lp1[t].progress > lp0[t].progress + 0.1), JSON.stringify(lp1));
    check('lane UI shows next + all timers and a ✕ per lane', await ev(() => {
      const ui = __BD.ui(); const texts = []; const walk = (o) => { if (o.text !== undefined) texts.push(o.text); (o.list ?? []).forEach(walk); }; walk(ui.screen.container);
      return texts.filter((t) => /^next \d+:\d\d  ·  all \d+:\d\d$/.test(t)).length === 3;
    }) && (await ev(() => ['sentinel', 'bearer', 'voyager'].every((t) => __BD.controls().some((c) => c.label === '✕' && c.meta === t && c.enabled)))));
    // lane-full check on a scratch copy of the state
    const full = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      st.state.resources.energy = 10000;
      const a = st.trainInfo('bearer', 11); const b = st.train('bearer', 10); const c = st.trainInfo('bearer', 1); const d = st.trainInfo('sentinel', 10);
      st.state = JSON.parse(snap);
      return { a: a.reason, b: b.ok, c: c.reason, d: d.can };
    });
    check('a full lane blocks only its own class', full.a === 'Bearer lane has room for 10' && full.b && full.c === 'Bearer lane is full' && full.d === true, JSON.stringify(full));
    // parallel math on a scratch copy: 10 of each at Lv2 (6.67s / 8.33s / 7.5s per unit)
    const par = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      for (const t of ['sentinel', 'bearer', 'voyager']) st.state.training[t] = { count: 10, progress: 0 };
      const total = st.trainingSecondsLeft();
      const sum = ['sentinel', 'bearer', 'voyager'].reduce((n, t) => n + 10 * st.unitTime(t), 0);
      const t0 = { ...st.state.troops };
      const at80 = st.processTraining(80);
      const left80 = JSON.parse(JSON.stringify(st.state.training));
      const at84 = st.processTraining(4);
      const out = { total, sum, at80, left80, at84, gained: ['sentinel', 'bearer', 'voyager'].map((t) => st.state.troops[t] - t0[t]), idle: st.queuedUnits() };
      st.state = JSON.parse(snap);
      return out;
    });
    check('parallel: 10 of each finish in the slowest lane time (83.3s), not the sum (225s)', Math.abs(par.total - 250 / 3) < 1e-6 && Math.abs(par.sum - 225) < 1e-6 && par.idle === 0 && JSON.stringify(par.gained) === '[10,10,10]', `total ${par.total.toFixed(2)}s vs sum ${par.sum.toFixed(1)}s`);
    check('parallel: after 80s Sentinels + Voyagers done, Bearers 9/10 with 5s into the last', par.at80.sentinel === 10 && par.at80.voyager === 10 && par.at80.bearer === 9 && par.left80.bearer.count === 1 && Math.abs(par.left80.bearer.progress - 5) < 1e-6 && par.at84.bearer === 1, JSON.stringify(par));
    await ev(() => __BD.store.tick(2.5));
    await shot('stage2-barracks-training.png');

    // --- 3. Offline training progress (80 s away, all lanes in parallel from 0)
    await editSave('s.lastSaved = Date.now() - arg; s.troops = { sentinel: 1, bearer: 0, voyager: 0 }; for (const t of ["sentinel","bearer","voyager"]) s.training[t] = { count: 10, progress: 0 };', 80e3);
    s = await state();
    check('offline: Sentinel and Voyager lanes both finished while away', s.troops.sentinel === 11 && s.troops.voyager === 10 && s.training.sentinel.count === 0 && s.training.voyager.count === 0, JSON.stringify(s.troops));
    check('offline: Bearer lane trained 9 in parallel, 1 still training', s.troops.bearer === 9 && s.training.bearer.count === 1 && s.training.bearer.progress >= 5, JSON.stringify(s.training));
    await sleep(500);
    check('offline report lists every class trained in parallel (10/9/10)', await ev(() => { const t = __BD.store.offlineReport?.trained ?? {}; return t.sentinel === 10 && t.bearer === 9 && t.voyager === 10; }), await ev(() => JSON.stringify(__BD.store.offlineReport?.trained)));
    // per-lane cancel refunds in full (UI ✕ on the Bearer lane)
    await tab(1);
    const ec0 = (await state()).resources.energy;
    await click('✕', { meta: 'bearer' });
    s = await state();
    check('cancel ✕ on one lane refunds its full Energy (8) and leaves other lanes alone', s.training.bearer.count === 0 && s.training.bearer.progress === 0 && Math.abs((s.resources.energy - ec0) - 8) < 0.8 && s.troops.bearer === 9, `refund ${(s.resources.energy - ec0).toFixed(2)}`);
    const cr = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      st.state.resources.energy = 0;
      st.state.training.sentinel = { count: 4, progress: 3 }; st.state.training.voyager = { count: 2, progress: 1 };
      const r = st.cancelLane('sentinel');
      const out = { refund: r.refund, energy: st.state.resources.energy, voy: { ...st.state.training.voyager }, again: st.cancelLane('sentinel').ok };
      st.state = JSON.parse(snap);
      return out;
    });
    check('cancelLane refunds every unit incl. the one in progress (4 × 6 = 24), other lanes untouched', cr.refund === 24 && cr.energy === 24 && cr.voy.count === 2 && cr.voy.progress === 1 && cr.again === false, JSON.stringify(cr));
    const p2 = await power();
    check('Base Power = Building + Troop Power after offline training', p2.troop === 30 && p2.total === 70 + 30, JSON.stringify(p2));
    check('offline earned Shards and Alloy', s.resources.shards > 500.7 && s.resources.alloy > 4.7, `shards ${s.resources.shards.toFixed(2)} alloy ${s.resources.alloy.toFixed(2)}`);

    // --- 4. Squads: formation save limited by available troops
    await tab(3);
    check('Squads tab opens', await ev(() => __BD.ui().screen?.id === 'squads'));
    await click('Edit Formation');
    await click('Sentinels', { meta: 'line0-sentinel' });
    await click('Bearers', { meta: 'line1-bearer' });
    await click('+10', { meta: 'line1+10' });
    let draft = await ev(() => JSON.parse(JSON.stringify(__BD.ui().screenState.edit.lines)));
    check('edit formation clamps counts to available troops', draft[0].type === 'sentinel' && draft[0].count === 10 && draft[1].type === 'bearer' && draft[1].count === 9, JSON.stringify(draft));
    await click('Voyagers', { meta: 'line2-voyager' });
    await click('−1', { meta: 'line2-1' });
    await shot('stage2-squad-formation-edit.png');
    await click('Save Formation');
    s = await state();
    check('formation saved (10 Sentinels, 9 Bearers, 9 Voyagers)', s.squads.alpha.lines[0].count === 10 && s.squads.alpha.lines[1].count === 9 && s.squads.alpha.lines[2].type === 'voyager' && s.squads.alpha.lines[2].count === 9 && !(await ev(() => __BD.ui().screenState.edit)), JSON.stringify(s.squads.alpha.lines));
    check('ready vs assigned counts', await ev(() => __BD.store.readyCount('bearer') === 0 && __BD.store.assignedCount('bearer') === 9 && __BD.store.readyCount('voyager') === 1));
    check('Squad Power = troops + 10 x level (28 + 10)', (await ev(() => __BD.store.squadPower('alpha'))) === 38);
    check('assigning troops does not change Base Power', (await power()).total === 100);
    const over = await ev(() => __BD.store.saveFormation('bravo', [{ type: 'bearer', count: 1 }, { type: null, count: 0 }, { type: null, count: 0 }]));
    check('Bravo cannot take Bearers already in Alpha', over.ok === false && /Only 0 Bearers/.test(over.reason), over.reason);
    const over2 = await ev(() => __BD.store.saveFormation('alpha', [{ type: 'sentinel', count: 12 }, { type: null, count: 0 }, { type: null, count: 0 }]));
    check('formation rejects more troops than owned', over2.ok === false);
    check('Charlie locked below Command Center Lv 5', (await ev(() => __BD.store.saveFormation('charlie', [{ type: 'voyager', count: 1 }, { type: null, count: 0 }, { type: null, count: 0 }]))).ok === false);
    await click('Bravo', { kind: 'tab' });
    check('Bravo unlocked at Command Center Lv 3', await ev(() => __BD.store.squadUnlocked('bravo') && !!__BD.controls().find((c) => c.label === 'Edit Formation')));
    await click('Alpha', { kind: 'tab' });
    // squad level up: Energy + Alloy, capped by CC level
    await ev(() => { const s = __BD.store.state; s.resources.energy = 2000; s.resources.alloy = 500; }); await refresh();
    const pb = (await power()).total;
    await click('Level Up');
    check('Squad level-up costs Energy + Alloy and adds +10 power', (await state()).squads.alpha.level === 2 && (await power()).total === pb + 10);
    await ev(() => __BD.store.levelUpSquad('alpha'));
    const lv4 = await ev(() => __BD.store.levelUpSquad('alpha'));
    check('squad level capped by Command Center level (3)', (await state()).squads.alpha.level === 3 && lv4.ok === false, lv4.reason);

    // --- 5. Gacha
    await tab(2);
    check('Armory tab opens', await ev(() => __BD.ui().screen?.id === 'armory'));
    await click('Recruitment', { kind: 'tab' });
    await ev(() => { __BD.store.state.resources.shards = 500; __BD.store.setSeed(2026); }); await refresh();
    await click('Pull x10  ·  100', { wait: 500 });
    s = await state();
    check('x10 pull costs 100 Shards', s.resources.shards >= 400 && s.resources.shards < 400.5, s.resources.shards.toFixed(2));
    check('x10 pull gives 10 results and history', s.gacha.history.length === 10 && s.gacha.total === 10);
    check('reveal animation shown', await ev(() => !!__BD.ui().reveal && __BD.ui().revealCards.length === 10));
    await click('Reveal All', { wait: 1500 });
    await shot('stage2-gacha-x10-reveal.png');
    await click('Continue', { wait: 400 });
    check('reveal closes on Continue', await waitTrue(() => __BD.ui().reveal === null));
    await ev(() => { __BD.store.state.resources.shards = 50; __BD.store.setSeed(2026); __BD.store.pull(1); });
    check('x1 pull costs 10 Shards', Math.abs((await state()).resources.shards - 40) < 0.5);
    await ev(() => { __BD.store.state.resources.shards = 5; });
    const poor = await ev(() => __BD.store.pull(1));
    check('pull blocked without enough Shards', poor.ok === false && (await state()).resources.shards < 5.5);

    // rarity distribution over many seeded pulls (pity included)
    const dist = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      st.state.gacha = { sinceEpic: 0, sinceLegendary: 0, total: 0, history: [] };
      st.setSeed(12345);
      const n = 20000, c = { common: 0, rare: 0, epic: 0, legendary: 0 };
      let maxEpicGap = 0, maxLegGap = 0, ge = 0, gl = 0;
      for (let i = 0; i < n; i++) {
        const r = st.pullOne(); c[r.rarity]++;
        ge++; gl++;
        if (r.rarity === 'epic' || r.rarity === 'legendary') { maxEpicGap = Math.max(maxEpicGap, ge); ge = 0; }
        if (r.rarity === 'legendary') { maxLegGap = Math.max(maxLegGap, gl); gl = 0; }
      }
      st.state = JSON.parse(snap); st.setSeed(null);
      return { c: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / n])), maxEpicGap, maxLegGap };
    });
    const d = dist.c;
    check('rarity distribution is sane (20k seeded pulls)', d.common > 0.53 && d.common < 0.61 && d.rare > 0.24 && d.rare < 0.30 && d.epic > 0.11 && d.epic < 0.17 && d.legendary > 0.02 && d.legendary < 0.045, JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.toFixed(3)]))));
    check('no Epic+ drought longer than 10, no Legendary drought longer than 60', dist.maxEpicGap <= 10 && dist.maxLegGap <= 60, `max gaps ${dist.maxEpicGap}/${dist.maxLegGap}`);
    // worst-case luck: rng always 0.999 -> pity must kick in exactly
    const pity = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      st.state.gacha = { sinceEpic: 0, sinceLegendary: 0, total: 0, history: [] };
      st.rng = () => 0.999;
      const out = []; for (let i = 0; i < 60; i++) out.push(st.pullOne().rarity);
      st.state = JSON.parse(snap); st.setSeed(null);
      return out;
    });
    const epicAt = pity.map((r, i) => (r === 'epic' || r === 'legendary' ? i + 1 : 0)).filter(Boolean);
    check('pity: Epic+ on pulls 10, 20, ... with worst luck', JSON.stringify(epicAt.slice(0, 5)) === '[10,20,30,40,50]', JSON.stringify(epicAt));
    check('pity: Legendary on pull 60 with worst luck', pity[59] === 'legendary' && !pity.slice(0, 59).includes('legendary'));
    // duplicates: new -> star-up -> shards at max stars
    const dup = await ev(() => {
      const st = __BD.store; const seq = [0.001, 0.1, 0.1]; let i = 0;
      st.rng = () => seq[i++ % 3];
      delete st.state.leaders.kael;
      const a = st.pullOne(); const b = st.pullOne();
      st.state.leaders.kael.stars = 5;
      const sh0 = st.state.resources.shards; const c = st.pullOne();
      st.setSeed(null); st.save();
      return [a.id, a.result, b.result, b.stars, c.result, st.state.resources.shards - sh0];
    });
    check('duplicate leader stars up, then converts to Shards at 5★', dup[0] === 'kael' && dup[1] === 'new' && dup[2] === 'star' && dup[3] === 2 && dup[4] === 'shards' && dup[5] === 50, JSON.stringify(dup));

    // --- 6. Leader assignment (UI)
    await ev(() => __BD.store.save());
    await click('Leaders', { kind: 'tab' });
    await shot('stage2-leaders-collection.png');
    const atk0 = await ev(() => __BD.store.squadStats('alpha').atk);
    await click('leader-kael', { kind: 'zone' });
    check('leader detail opens', await waitTrue(() => !!__BD.ui().modal));
    await click('Alpha', { kind: 'button' });
    s = await state();
    const atk1 = await ev(() => __BD.store.squadStats('alpha').atk);
    check('Kael assigned to Alpha from the Leaders screen', s.squads.alpha.leader === 'kael');
    check('leader buff raises Alpha ATK (Bearer ATK +)', atk1 > atk0, `${atk0} -> ${atk1}`);
    await ev(() => __BD.store.assignLeader('kael', 'bravo'));
    s = await state();
    check('a leader leads only one squad at a time', s.squads.bravo.leader === 'kael' && s.squads.alpha.leader === null);
    await ev(() => __BD.store.assignLeader('kael', 'alpha'));

    // --- 7. Gear equip (UI)
    await ev(() => { __BD.store.state.gear.arcRifle = 1; __BD.store.state.squads.alpha.weapon = null; __BD.store.save(); __BD.ui().renderScreen(); });
    await click('Gear', { kind: 'tab' });
    const atk2 = await ev(() => __BD.store.squadStats('alpha').atk);
    await click('gearcard-arcRifle', { kind: 'zone' });
    await click('Alpha', { kind: 'button' });
    s = await state();
    check('Arc Rifle equipped on Alpha', s.squads.alpha.weapon === 'arcRifle');
    check('gear raises squad ATK', (await ev(() => __BD.store.squadStats('alpha').atk)) > atk2);
    const dupEquip = await ev(() => __BD.store.equipGear('bravo', 'weapon', 'arcRifle'));
    check('one copy of gear can only be equipped once', dupEquip.ok === false);
    check('armor cannot go in the weapon slot', (await ev(() => __BD.store.equipGear('alpha', 'weapon', 'scrapPlating'))).ok === false);

    // --- 8. Everything persists across reload
    const before = await state();
    await ev(() => __BD.store.save());
    await page.reload(); await ready();
    s = await state();
    check('squads, leaders, gear, troops and gacha persist after reload', JSON.stringify(s.squads) === JSON.stringify(before.squads) && JSON.stringify(Object.entries(s.leaders).sort()) === JSON.stringify(Object.entries(before.leaders).sort()) && s.gear.arcRifle === 1 && s.troops.bearer === 9 && s.gacha.total === before.gacha.total);

    // --- 9. Tapping buildings opens their screens; Battle is stage 3
    await ev(() => __BD.base().select('barracks')); await sleep(300);
    await click('Train');
    check('Barracks panel → Train opens Troops screen', await ev(() => __BD.ui().screen?.id === 'troops'));
    await tab(0);
    await ev(() => __BD.base().select('armory')); await sleep(300);
    await click('Recruit');
    check('Armory panel → Recruit opens the Armory', await ev(() => __BD.ui().screen?.id === 'armory'));
    await tab(3);
    await click('Battle');
    check('Battle says "Coming in stage 3"', await ev(() => __BD.ui().modal?.list.some((o) => o.text && /Coming in stage 3/.test(o.text))));
    await ev(() => __BD.ui().closeModal());
    await tab(0);
    // tap the Base Power pill -> breakdown
    const pp = await ev(() => __BD.gameToPage(348, 90));
    await page.mouse.click(pp.x, pp.y); await sleep(300);
    check('Base Power breakdown opens from the HUD', await ev(() => __BD.ui().modal?.list.some((o) => o.text && /TROOP POWER/.test(o.text))));
    await ev(() => __BD.ui().closeModal());
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, tab: __BD.ui().screenState, modal: !!__BD.ui().modal, reveal: !!__BD.ui().reveal, controls: __BD.controls().map((c) => c.label) })).catch(() => ({}));
    check(`stage 2 suite ran without exceptions`, false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 2: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

const srv = await serveDist();
try {
  if (process.env.ONLY !== '2') {
    await run(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
    await run(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  }
  await runStage2(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK) await runStage2(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
} finally { srv.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
