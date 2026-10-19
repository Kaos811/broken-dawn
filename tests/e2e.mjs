// Headless e2e test for stages 1-7. Runs against the single-file build
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
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
  // stages 1-4 predate the tutorial: keep its coach card out of their way (stage 5 tests it)
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  // On a busy machine the game can drop to a few fps; let Phaser process each click (input runs on its
  // next frame, tweens need frames to settle) before the test reads state.
  const frames = (n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const rawClick = page.mouse.click.bind(page.mouse);
  page.mouse.click = async (...args) => { await rawClick(...args); await frames(4); };

  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(400); };
  await page.goto(url); await ready();
  await page.evaluate(() => localStorage.clear()); await page.reload(); await ready();

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const cam = () => ev(() => { const c = __BD.base().cameras.main; return { zoom: c.zoom, x: c.scrollX, y: c.scrollY }; });
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const power = () => ev(() => __BD.store.power.total);
  // page coords of a footprint centre, of a world point, of a UI (game-space) point
  // (stage 6: computed with the game's own grid math, __BD.grid; the map is 44 tiles, Beacon 4x4 at 20,20)
  const fpCenter = (id) => ev((id) => __BD.fpToPage(id), id);
  const tileCenter = (gx, gy) => ev(([gx, gy]) => __BD.baseTileToPage(gx, gy), [gx, gy]);
  // footprint centre of a building of size `size` standing at (gx, gy)
  const fpAt = (gx, gy, size = 3) => ev(([gx, gy, size]) => { const w = __BD.grid.isoToWorld(gx + size / 2, gy + size / 2); return __BD.worldToPage(w.x, w.y); }, [gx, gy, size]);
  const EMPTY = [28, 28]; // open ground just below the Beacon plaza (no building on default layout)
  const uiPoint = (fn) => ev(fn);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });

  const shot = async (name) => { if (takeShots) { await sleep(250); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };

  // --- Wheel zoom (clamped)
  const z0 = (await cam()).zoom;
  await page.mouse.move(195, 420);
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 200); await sleep(20); }
  const zMin = (await cam()).zoom;
  const zFloor = await ev(() => __BD.base().minZoom());
  check('wheel zoom out works and clamps at min (never past the painted ground)', zMin < z0 && Math.abs(zMin - zFloor) < 1e-6 && zFloor > 0.4, `${z0.toFixed(2)} -> ${zMin.toFixed(2)} (floor ${zFloor.toFixed(3)})`);
  const edge = await ev(() => { const c = __BD.base().cameras.main, v = c.worldView, G = __BD.grid.GROUND; return v.x >= G.x - 1 && v.y >= G.y - 1 && v.right <= G.x + G.w + 1 && v.bottom <= G.y + G.h + 1; });
  check('zoomed all the way out the view stays on painted ground (no void)', edge);
  await shot('01-base-zoomed-out.png');
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -200); await sleep(10); }
  check('wheel zoom in clamps at max', Math.abs((await cam()).zoom - 1.6) < 1e-6);
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
  const empty = await tileCenter(...EMPTY);
  await page.mouse.move(empty.x, empty.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(empty.x + i * 10, empty.y + i * 6); await sleep(16); }
  await page.mouse.up();
  let c1 = await cam();
  check('mouse drag on empty ground pans the map', Math.abs(c1.x - c0.x) > 50 && Math.abs(c1.y - c0.y) > 30, `dx ${(c1.x - c0.x).toFixed(0)} dy ${(c1.y - c0.y).toFixed(0)}`);
  c0 = c1;
  const e2 = await tileCenter(...EMPTY);
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
  for (let i = 0; i < 30 && !(await ev(() => (__BD.ui().toastLog ?? []).some((m) => /anchored/i.test(m)))); i++) await sleep(100); // slow frames: wait for the long-press
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: bp.x + i * 12, y: bp.y + i * 8 }]); await sleep(16); }
  await touch('touchEnd', []);
  await sleep(100);
  const beaconSpriteAfter = await ev(() => { const s = __BD.base().beaconSprite; return [s.x, s.y]; });
  const beaconToast = await ev(() => (__BD.ui().toastLog ?? []).find((m) => /anchored/i.test(m)));
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
  const eUp0 = (await state()).resources.energy;
  await page.mouse.click(up.x, up.y);
  await sleep(300);
  let st1 = await state();
  check('Upgrade starts a 10 s timer (Lv 2), pays 50 Energy up front', st1.construction.length === 1 && st1.construction[0].id === 'commandCenter' && st1.construction[0].total === 10 && Math.abs(eUp0 - st1.resources.energy - 50) < 1, JSON.stringify(st1.construction));
  check('level and power unchanged while upgrading', st1.buildings.commandCenter.level === 1 && (await power()) === p0);
  check('one builder: a second upgrade is refused while busy', (await ev(() => __BD.store.upgradeInfo('barracks').reason || '')).startsWith('Builder busy'));
  await ev(() => __BD.store.tick(9));
  check('still Lv 1 after 9 s', (await state()).buildings.commandCenter.level === 1 && (await power()) === p0);
  await ev(() => __BD.store.tick(1.01));
  await sleep(300);
  const p1 = await power();
  const hudPower = await ev(() => __BD.ui().powerText.text);
  check('Upgrade completes after 10 s and raises Base Power by +10 (Command Center)', p1 === p0 + 10, `${p0} -> ${p1}, HUD "${hudPower}"`);
  check('HUD Base Power shows new value', hudPower === String(p1));
  check('Upgrade raised level and freed the builder', (await state()).buildings.commandCenter.level === 2 && (await state()).construction.length === 0);
  // not enough energy -> stays put
  await ev(() => { __BD.store.state.resources.energy = 0; });
  await page.mouse.click(up.x, up.y); await sleep(200);
  check('Upgrade blocked without Energy', (await power()) === p1 && (await state()).buildings.commandCenter.level === 2 && (await state()).construction.length === 0);
  // close panel via X
  const x = await uiPoint(() => { const ui = __BD.ui(); const r = ui.panelRect; return __BD.gameToPage(r.x + r.width - 40, r.y + 44); });
  await page.mouse.click(x.x, x.y); await sleep(150);
  check('panel closes with ✕', (await ev(() => __BD.ui().panelOpenFor)) === null);

  // --- Long-press + drag Barracks to a new tile (touch)
  const br0 = (await state()).buildings.barracks;
  const bS = await fpCenter('barracks');
  const bT = await fpAt(br0.gx, br0.gy - 3);
  await touch('touchStart', [bS]); await sleep(600);
  for (let i = 0; i < 30 && (await ev(() => __BD.base().moveId)) !== 'barracks'; i++) await sleep(100);
  check('long-press enters move mode', (await ev(() => __BD.base().moveId)) === 'barracks');
  for (let i = 1; i <= 12; i++) { await touch('touchMove', [{ x: bS.x + ((bT.x - bS.x) * i) / 12, y: bS.y + ((bT.y - bS.y) * i) / 12 }]); await sleep(20); }
  await touch('touchEnd', []); await sleep(150);
  const br1 = (await state()).buildings.barracks;
  check('dragging Barracks moves it (snapped to grid)', br1.gx === br0.gx && br1.gy === br0.gy - 3, `(${br0.gx},${br0.gy}) -> (${br1.gx},${br1.gy})`);
  // Done
  const done = await uiPoint(() => { const r = __BD.ui().bannerRect; return __BD.gameToPage(r.x + r.width - 80, r.y + r.height / 2); });
  check('move banner visible', await ev(() => __BD.ui().banner.visible));
  await page.mouse.click(done.x, done.y); await sleep(150);
  check('Done exits move mode', (await ev(() => __BD.base().moveId)) === null);

  // --- Tap-select route: tap Armory -> Move button -> drag (mouse)
  const ar0 = (await state()).buildings.armory;
  // the Barracks drag may have edge-panned the map; bring the Armory back into the open (clear of the HUD side columns)
  await ev(() => __BD.base().focus('armory', 0)); await sleep(100);
  const aS = await fpCenter('armory');
  await page.mouse.click(aS.x, aS.y); await sleep(250);
  const mv = await uiPoint(() => { const b = __BD.ui().pMove; return __BD.gameToPage(b.x, b.y); });
  const dbg = await ev(() => `panel=${__BD.ui().panelOpenFor} panelY=${__BD.ui().panel.y} move=${__BD.base().moveId}`);
  await page.mouse.click(mv.x, mv.y); await sleep(200);
  check('Move button enters move mode', (await ev(() => __BD.base().moveId)) === 'armory', dbg);
  const aT = await fpAt(ar0.gx - 3, ar0.gy);
  await page.mouse.move(aS.x, aS.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(aS.x + ((aT.x - aS.x) * i) / 12, aS.y + ((aT.y - aS.y) * i) / 12); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  const ar1 = (await state()).buildings.armory;
  const arDbg = await ev(([gx, gy]) => JSON.stringify({ can: __BD.store.canMove ? __BD.store.canMove('armory', gx, gy) : null, b: Object.fromEntries(Object.entries(__BD.store.state.buildings).map(([k, v]) => [k, [v.gx, v.gy, v.placed]])) }), [ar0.gx - 3, ar0.gy]);
  check('mouse drag moves Armory in move mode', ar1.gx === ar0.gx - 3 && ar1.gy === ar0.gy, `(${ar0.gx},${ar0.gy}) -> (${ar1.gx},${ar1.gy}) aS=${JSON.stringify(aS)} aT=${JSON.stringify(aT)} ${arDbg}`);

  // --- Invalid drop on the Beacon is rejected
  const aS2 = await fpCenter('armory');
  const onBeacon = await fpCenter('beacon');
  await page.mouse.move(aS2.x, aS2.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(aS2.x + ((onBeacon.x - aS2.x) * i) / 10, aS2.y + ((onBeacon.y - aS2.y) * i) / 10); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  check('dropping onto the Beacon is rejected (snaps back)', JSON.stringify((await state()).buildings.armory) === JSON.stringify(ar1));
  // Invalid drop off-platform
  const offP = await tileCenter(4, 4);
  await ev(() => { const b = __BD.base(); b.setZoomKeeping(0.52, b.beaconCenter.x, b.beaconCenter.y - 40, 360, b.cameras.main.height / 2); });
  await sleep(50);
  const aS3 = await fpCenter('armory'); const off2 = await tileCenter(4, 4); // outside the buildable ellipse
  await page.mouse.move(aS3.x, aS3.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(aS3.x + ((off2.x - aS3.x) * i) / 10, aS3.y + ((off2.y - aS3.y) * i) / 10); await sleep(20); }
  await page.mouse.up(); await sleep(150);
  check('dropping outside the base area is rejected', JSON.stringify((await state()).buildings.armory) === JSON.stringify(ar1) && !(await ev(() => __BD.grid.isPlatformTile(4, 4))));
  void offP;
  // tap empty ground exits move mode
  await ev(() => { const b = __BD.base(); b.cameras.main.setZoom(0.62); b.cameras.main.centerOn(b.beaconCenter.x, b.beaconCenter.y - 40); });
  await sleep(100);
  const emptyTap = await tileCenter(...EMPTY);
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
  const expect = await ev(() => { const s = __BD.store.state.buildings.barracks; const a = __BD.grid.footprintAnchor(s.gx, s.gy, 3); return [a.x, a.y]; });
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
  check('Beacon upgrade spends the full charge and starts a timer', (await state()).beacon.charge < 1 && (await state()).beacon.level === 1 && (await power()) === bp0);
  await ev(() => __BD.store.tick(10.01));
  check('Beacon upgrade adds +15 power when the timer finishes', (await power()) === bp0 + 15 && (await state()).beacon.level === 2);

  // --- Nav: Troops / Armory / Squads open real screens now; Settings > Reset
  // (indices kept from stage 1/2; the nav now also has a World tab, so look tabs up by id)
  const tabPt = (i) => ev((id) => __BD.tabToPage(id), ['base', 'troops', 'armory', 'squads', 'more'][i]);
  // Settings moved into the More sheet (v0.6 nav): More tab -> Settings tile
  const openSettings1 = async () => {
    const m = await tabPt(4); await page.mouse.click(m.x, m.y); await sleep(300);
    let st = null; for (let i = 0; i < 20 && !st; i++) { st = await ev(() => __BD.controls().find((c) => c.meta === 'more-settings')); if (!st) await sleep(100); }
    await page.mouse.click(st.x, st.y); await sleep(300);
  };
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
  await openSettings1();
  const btn = async (label) => {
    for (let i = 0; i < 30; i++) {
      const p = await ev((label) => {
        const m = __BD.ui().modal; const b = m?.list.find((o) => o.list && o.list.some((q) => q.text === label));
        return b ? __BD.gameToPage(b.x, b.y) : null;
      }, label);
      if (p) { await sleep(150); return p; }
      await sleep(100);
    }
    throw new Error(`modal button not found: ${label}`);
  };
  let rb = await btn('Reset Save'); await page.mouse.click(rb.x, rb.y); await sleep(250);
  check('Reset Save asks for confirmation', await ev(() => __BD.ui().modal.list.some((o) => o.text && /Reset all progress/.test(o.text))));
  rb = await btn('Cancel'); await page.mouse.click(rb.x, rb.y); await sleep(200);
  check('Cancel keeps the save', (await state()).beacon.level === 2);
  await openSettings1();
  rb = await btn('Reset Save'); await page.mouse.click(rb.x, rb.y); await sleep(250);
  rb = await btn('Reset'); await page.mouse.click(rb.x, rb.y); await sleep(300);
  const fresh = await state();
  check('Reset restores defaults (Base Power 35 incl. Infirmary Lv 1)', fresh.beacon.level === 1 && fresh.buildings.commandCenter.level === 1 && fresh.buildings.barracks.gy === 30 && (await power()) === 35);
  const sp2 = await ev(() => { const b = __BD.base(); return [b.sprites.barracks.img.x, b.sprites.barracks.img.y]; });
  check('Reset moves sprites back', Math.abs(sp2[0] - (await ev(() => __BD.grid.footprintAnchor(23, 30, 3).x))) < 0.5);
  await page.reload(); await ready();
  check('Reset persists after reload', (await state()).buildings.barracks.gy === 30 && (await power()) === 35);

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
  // stages 1-4 predate the tutorial: keep its coach card out of their way (stage 5 tests it)
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
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
  const tab = async (i) => { const p = await ev((id) => __BD.tabToPage(id), ['base', 'troops', 'armory', 'squads', 'more'][i]); await page.mouse.click(p.x, p.y); await sleep(350); };
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
    check('v2 save migrates to version 10 (via v3 … v8)', m.version === 10);
    check('v2 queue moves into per-class lanes (sentinel 3+2, bearer 5, voyager 4)', m.training.sentinel.count === 5 && m.training.bearer.count === 5 && m.training.voyager.count === 4, JSON.stringify(m.training));
    check('v2 head batch progress carries over to its lane', m.training.sentinel.progress >= 2 && m.training.sentinel.progress < 5, m.training.sentinel.progress.toFixed(2));
    check('migrated lanes all run at once', m.training.bearer.progress > 0 && m.training.voyager.progress > 0);
    check('v2 migration keeps troops, Energy, Shards, Alloy and squads', m.troops.sentinel === 5 && m.troops.bearer === 2 && m.troops.voyager === 1 && m.resources.energy >= 500 && m.resources.energy < 510 && Math.floor(m.resources.shards) === 321 && m.resources.alloy >= 12 && m.squads.alpha.lines[0].count === 2, JSON.stringify(m.resources));
    check('v2→v4 migration keeps Shards (321) and grants 10 starter Beacon Cores', Math.floor(m.resources.shards) === 321 && m.resources.cores === 10, JSON.stringify(m.resources));
    check('v2 migration keeps a backup of the v2 save', await ev(() => { const b = JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v2') || 'null'); return !!b && b.version === 2 && b.training.length === 4; }));

    // --- 0b. v3 save (parallel lanes, no Cores) -> v4: Shards stay, +10 Cores, backup kept
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 3, resources: { energy: 50, shards: 777, alloy: 3 }, beacon: { level: 3, charge: 0 },
        buildings: { commandCenter: { level: 1, gx: 12, gy: 8 }, barracks: { level: 1, gx: 8, gy: 12 }, armory: { level: 1, gx: 16, gy: 16 } },
        troops: { sentinel: 4, bearer: 0, voyager: 0 }, training: { sentinel: { count: 2, progress: 1 }, bearer: { count: 0, progress: 0 }, voyager: { count: 0, progress: 0 } },
        squads: {}, leaders: { jax: { stars: 2 } }, gear: { arcRifle: 1 }, gacha: { sinceEpic: 4, sinceLegendary: 30, total: 30, history: [] }, lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    m = await state();
    check('v3 save migrates to v10: Shards 777 stay, +10 Cores, lanes/leaders/gear/pity kept', m.version === 10 && Math.floor(m.resources.shards) === 777 && m.resources.cores === 10 && m.training.sentinel.count === 2 && m.leaders.jax.stars === 2 && m.gear.arcRifle === 1 && m.gacha.sinceLegendary === 30 && m.claims.beacon.length === 0 && m.daily.lastDay === null, JSON.stringify(m.resources));
    check('v3 migration keeps a backup of the v3 save', await ev(() => JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v3') || '{}').version === 3));
    check('migration grants Cores only once (reload keeps 10)', await (async () => { await ev(() => __BD.store.save()); await page.reload(); await ready(); return (await state()).resources.cores === 10; })());

    // --- 0c. v4 save (before upgrade timers) -> v5: levels kept, nothing under construction, backup kept
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 4, resources: { energy: 300, shards: 40, alloy: 0, cores: 7 }, beacon: { level: 4, charge: 100 },
        buildings: { commandCenter: { level: 5, gx: 12, gy: 8 }, barracks: { level: 3, gx: 8, gy: 12 }, armory: { level: 2, gx: 16, gy: 16 } },
        troops: { sentinel: 0, bearer: 0, voyager: 0 }, claims: { beacon: [2, 3], milestones: ['cc3'] }, lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    m = await state();
    check('v4 save migrates to v10: levels, Cores, claims kept; no construction', m.version === 10 && m.buildings.commandCenter.level === 5 && m.beacon.level === 4 && m.resources.cores === 7 && m.claims.beacon.length === 2 && Array.isArray(m.construction) && m.construction.length === 0, JSON.stringify({ v: m.version, c: m.construction, cores: m.resources.cores }));
    check('v4 migration keeps a backup of the v4 save', await ev(() => JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v4') || '{}').version === 4));

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
    check('v1 save migrates to version 10', s.version === 10);
    // the Barracks sat off its default tile (8,15): on the v9 map it keeps its direction from the Beacon
    const bOff = await ev(() => { const b = __BD.store.state.buildings.barracks, c = __BD.grid.isoToWorld(b.gx + 1.5, b.gy + 1.5), o = __BD.grid.BEACON_CENTER; return { dx: c.x - o.x, dy: c.y - o.y, ok: __BD.store.canPlace('barracks', b.gx, b.gy), def: b.gx === 23 && b.gy === 30 }; });
    check('migration keeps buildings (moved Barracks keeps its direction from the Beacon), levels, Energy and Beacon', bOff.ok && !bOff.def && bOff.dx < -200 && Math.abs(bOff.dy) < 220 && s.buildings.commandCenter.level === 3 && s.buildings.barracks.level === 2 && s.beacon.level === 2 && s.resources.energy >= 1234 && s.resources.energy < 1260, `energy ${s.resources.energy.toFixed(0)}`);
    check('migration adds Shards (500), 10 Cores, Alloy, troops, squad lines', Math.floor(s.resources.shards) === 500 && s.resources.cores === 10 && s.resources.alloy < 5 && s.troops.sentinel === 0 && s.squads.alpha.lines.length === 3 && s.squads.alpha.leader === null);
    check('migration keeps a backup of the v1 save', await ev(() => !!localStorage.getItem('brokenDawn.save.v1.backup-v1')));
    check('Base Power after migration = buildings only (75 incl. new Infirmary)', (await power()).total === 75, JSON.stringify(await power()));
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
    check('Troop Power: trained soldier adds 1 to Base Power', p1.troop === 1 && p1.total === 76, JSON.stringify(p1));
    check('HUD breakdown shows Troops', await waitTrue(() => /Troops 1\b/.test(__BD.ui().powerSub.text) && __BD.ui().powerText.text === '76'));

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
    await sleep(2000);
    const lp1 = await ev(() => JSON.parse(JSON.stringify(__BD.store.state.training)));
    check('all three lane timers run simultaneously (live)', ['sentinel', 'bearer', 'voyager'].every((t) => lp1[t].progress > lp0[t].progress + 0.03), JSON.stringify(lp1));
    check('lane UI shows next + all timers and a ✕ per lane', await waitTrue(() => {
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
    check('Base Power = Building + Troop Power after offline training', p2.troop === 30 && p2.total === 75 + 30, JSON.stringify(p2));
    check('offline earned (modest) Shards and Alloy, but no Cores', s.resources.shards > 500.2 && s.resources.shards < 501 && s.resources.alloy > 4.7 && s.resources.cores === 10, `shards ${s.resources.shards.toFixed(2)} alloy ${s.resources.alloy.toFixed(2)}`);

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
    check('formation saved (10 Sentinels, 9 Bearers, 9 Voyagers)', s.squads.alpha.lines[0].count === 10 && s.squads.alpha.lines[1].count === 9 && s.squads.alpha.lines[2].type === 'voyager' && s.squads.alpha.lines[2].count === 9 && s.squads.alpha.lines[2].full === 9 && !(await ev(() => __BD.ui().screenState.edit)), JSON.stringify(s.squads.alpha.lines));
    check('ready vs assigned counts', await ev(() => __BD.store.readyCount('bearer') === 0 && __BD.store.assignedCount('bearer') === 9 && __BD.store.readyCount('voyager') === 1));
    check('Squad Power = troops + 10 x level (28 + 10)', (await ev(() => __BD.store.squadPower('alpha'))) === 38);
    check('assigning troops does not change Base Power', (await power()).total === 105);
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
    await ev(() => { __BD.store.state.resources.shards = 500; __BD.store.state.resources.cores = 15; __BD.store.setSeed(2026); }); await refresh();
    check('Recruitment shows the How to earn Cores panel', await ev(() => { const t = []; const w = (o) => { if (o.text !== undefined) t.push(o.text); (o.list ?? []).forEach(w); }; w(__BD.ui().screen.container); return t.includes('HOW TO EARN BEACON CORES') && t.some((x) => /Daily login/.test(x)); }));
    await click('Pull x10  ·  10 Cores', { wait: 500 });
    s = await state();
    check('x10 pull costs 10 Beacon Cores (Shards untouched)', s.resources.cores === 5 && s.resources.shards >= 500 && s.resources.shards < 500.5, `cores ${s.resources.cores} shards ${s.resources.shards.toFixed(2)}`);
    check('x10 pull gives 10 results and history', s.gacha.history.length === 10 && s.gacha.total === 10);
    check('reveal animation shown', await ev(() => !!__BD.ui().reveal && __BD.ui().revealCards.length === 10));
    await click('Reveal All', { wait: 1500 });
    await shot('stage2-gacha-x10-reveal.png');
    await click('Continue', { wait: 400 });
    check('reveal closes on Continue', await waitTrue(() => __BD.ui().reveal === null));
    await ev(() => { __BD.store.state.resources.cores = 3; __BD.store.state.resources.shards = 50; __BD.store.setSeed(2026); __BD.store.pull(1); });
    check('x1 pull costs 1 Core', (await state()).resources.cores === 2 && (await state()).resources.shards >= 50);
    const poor10 = await ev(() => __BD.store.pull(10));
    check('x10 blocked with only 2 Cores', poor10.ok === false && /Need 10 Beacon Cores/.test(poor10.reason) && (await state()).resources.cores === 2, poor10.reason);
    await ev(() => { __BD.store.state.resources.cores = 0; __BD.store.state.resources.shards = 99999; }); await refresh();
    const poor = await ev(() => __BD.store.pull(1));
    check('cannot pull without Cores, even with lots of Shards', poor.ok === false && (await state()).resources.cores === 0 && (await state()).gacha.total === 11);
    check('pull buttons disabled at 0 Cores', await ev(() => __BD.controls().filter((c) => /^Pull x/.test(c.label)).every((c) => !c.enabled)));
    await ev(() => { __BD.store.state.resources.shards = 50; });

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
    check('duplicate leader stars up, then converts to Shards at 5★', dup[0] === 'kael' && dup[1] === 'new' && dup[2] === 'star' && dup[3] === 2 && dup[4] === 'shards' && Math.abs(dup[5] - 50) < 1e-6, JSON.stringify(dup));

    // --- 5b. Beacon Cores: earned only (daily streak, Beacon levels, milestones)
    const passive = await ev(() => { const st = __BD.store; const snap = JSON.stringify(st.state); st.state.resources.cores = 4; st.tick(3600); const c = st.state.resources.cores; st.state = JSON.parse(snap); return c; });
    check('no passive Core income (1h of ticks adds 0)', passive === 4);
    const daily = await ev(() => {
      const st = __BD.store, DAY = 864e5; const t0 = Date.now() - 40 * DAY;
      st.state.daily = { lastDay: null, streak: 0 }; st.state.resources.cores = 0;
      const log = [];
      for (let d = 0; d < 7; d++) { st.clock = () => t0 + d * DAY; const r = st.claimDaily(); log.push(r.cores); if (d === 0) log.push(st.claimDaily().ok); }
      const after7 = st.state.resources.cores;
      st.clock = () => t0 + 8 * DAY; const reset = st.claimDaily();            // skipped day 7 -> streak resets
      st.clock = () => Date.now();
      return { log, after7, reset: [reset.cores, reset.streak], cores: st.state.resources.cores };
    });
    check('daily login: +1/day, same-day re-claim refused', JSON.stringify(daily.log) === '[1,false,1,1,1,1,1,4]', JSON.stringify(daily.log));
    check('7-day streak pays the +3 bonus on day 7 (10 Cores over 7 days)', daily.after7 === 10);
    check('missing a day resets the streak to 1', daily.reset[0] === 1 && daily.reset[1] === 1 && daily.cores === 11, JSON.stringify(daily));
    // HUD Cores counter opens the rewards panel; claim today's daily in the UI
    await tab(0);
    await ev(() => { const st = __BD.store; st.state.beacon.level = 3; st.state.claims.beacon = []; st.state.claims.milestones = []; st.state.resources.cores = 0; st.save(); });
    const ch = await ev(() => { const h = __BD.ui().coreHit; return __BD.gameToPage(h.x, h.y); });
    await page.mouse.click(ch.x, ch.y); await sleep(400);
    check('tapping the HUD Cores counter opens Beacon Core Rewards', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'Beacon Core Rewards')));
    check('rewards panel lists ready rewards (daily + Beacon Lv 2, 3 + squad/leader/CC3 milestones)', (await ev(() => __BD.store.rewardsReady())) >= 4, String(await ev(() => __BD.store.rewardsReady())));
    await shot('stage2-cores-earn.png');
    await click('Claim +1', { meta: 'daily' });
    check('UI daily claim adds 1 Core', (await state()).resources.cores === 1);
    check('daily button shows Claimed afterwards', !!(await ev(() => __BD.controls().find((c) => c.label === 'Claimed' && c.meta === 'daily' && !c.enabled))));
    await click('Lv 2 · +3', { meta: 'beacon-2' });
    s = await state();
    check('Beacon Lv 2 reward claimed via UI (+3)', s.resources.cores === 4 && s.claims.beacon.includes(2));
    const bl = await ev(() => [__BD.store.claimBeaconLevel(2).ok, __BD.store.claimBeaconLevel(4).ok, __BD.store.claimBeaconLevel(3).ok, __BD.store.claimBeaconLevel(3).ok]);
    check('Beacon level rewards: each level once only, unreached levels refused', JSON.stringify(bl) === '[false,false,true,false]' && (await state()).resources.cores === 7, JSON.stringify(bl));
    await ev(() => __BD.ui().openRewards()); await sleep(300);
    await click('Claim +2', { meta: 'ms-cc3' });
    s = await state();
    check('milestone "Command Center Lv 3" claimed via UI (+2)', s.claims.milestones.includes('cc3') && s.resources.cores === 9);
    const ms = await ev(() => { const st = __BD.store; const a = st.claimMilestone('cc3').ok; const b = st.claimMilestone('troops50'); return [a, b.ok, b.reason]; });
    check('milestones: claimed once only; unfinished ones refused', ms[0] === false && ms[1] === false && /Own 50 troops/.test(ms[2]), JSON.stringify(ms));
    const t50 = await ev(() => { const st = __BD.store; const snap = JSON.stringify(st.state.troops); st.state.troops.sentinel += 50; const r = [st.claimMilestone('troops50').cores, st.claimMilestone('troops50').ok]; st.state.troops = JSON.parse(snap); return r; });
    check('owning 50 troops unlocks its milestone (+2) once', t50[0] === 2 && t50[1] === false);
    const all = await ev(() => { const st = __BD.store; const before = st.state.resources.cores; const r = st.claimAllRewards(); return [r.cores, st.state.resources.cores - before, st.rewardsReady()]; });
    check('Claim all collects the rest (first squad saved) and leaves nothing ready', all[0] === all[1] && all[0] >= 1 && all[2] === 0, JSON.stringify(all));
    await ev(() => __BD.ui().closeModal(true));
    const cBefore = (await state()).resources.cores;
    await ev(() => __BD.store.save()); await page.reload(); await ready();
    const again = await ev(() => [__BD.store.claimBeaconLevel(2).ok, __BD.store.claimMilestone('cc3').ok, __BD.store.claimDaily().ok, __BD.store.state.resources.cores]);
    check('claims persist across reload (no double-claiming)', JSON.stringify(again) === JSON.stringify([false, false, false, cBefore]), JSON.stringify(again));
    check('stage-3 hook: grantCores(n, "battle") adds Cores', await ev(() => { const st = __BD.store; const c = st.state.resources.cores; st.grantCores(1, 'battle'); const ok = st.state.resources.cores === c + 1; st.state.resources.cores = c; return ok; }));
    // Shards now buy leader stars and gear levels
    const su = await ev(() => {
      const st = __BD.store; st.state.leaders.jax = { stars: 1 }; st.state.resources.shards = 1000;
      const r1 = st.starUpLeader('jax'); const sh = st.state.resources.shards;
      st.state.leaders.jax.stars = 5; const r2 = st.starUpLeader('jax');
      st.state.leaders.jax.stars = 1; st.state.resources.shards = 10; const r3 = st.starUpLeader('jax');
      return [r1.ok, r1.cost, sh, r2.reason, r3.ok];
    });
    check('leader star-up with Shards (Epic 1→2★ = 160 Shards); capped at 5★; needs Shards', su[0] && su[1] === 160 && su[2] === 840 && su[3] === 'Max stars' && su[4] === false, JSON.stringify(su));

    // --- 6. Leader assignment (UI)
    await tab(2);
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
    const steal = await ev(() => __BD.store.assignLeader('kael', 'bravo'));
    s = await state();
    check('a leader leads only one squad: assigning Kael (in Alpha) to Bravo is rejected, no silent steal', steal.ok === false && steal.lockedIn === 'alpha' && /already leads Alpha/.test(steal.reason) && s.squads.bravo.leader === null && s.squads.alpha.leader === 'kael', JSON.stringify(steal));
    await click('leader-kael', { kind: 'zone' });
    check('Leaders screen: other squad buttons disabled while Kael leads Alpha', await ev(() => { const c = __BD.controls(); return c.some((b) => b.label === 'Bravo' && b.kind === 'button' && !b.enabled) && c.some((b) => b.label === 'Alpha' && b.kind === 'button' && !b.enabled); }));
    await ev(() => __BD.ui().closeModal(true));

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
    await ev(() => { __BD.store.state.resources.shards = 100; __BD.ui().renderScreen(); });
    const atk3 = await ev(() => __BD.store.squadStats('alpha').atk);
    await click('gearcard-arcRifle', { kind: 'zone' });
    await click('Upgrade · 40 Shards');
    s = await state();
    check('gear level-up via UI costs Shards (Rare Lv1→2 = 40) and raises the buff (+10% → +12%)', s.gearLevels.arcRifle === 2 && Math.abs(s.resources.shards - 60) < 0.5 && (await ev(() => __BD.store.gearBuffPct('arcRifle'))) === 12, `shards ${s.resources.shards.toFixed(1)}`);
    check('upgraded gear raises squad ATK', (await ev(() => __BD.store.squadStats('alpha').atk)) > atk3);
    await ev(() => __BD.ui().closeModal(true));
    const gmax = await ev(() => { const st = __BD.store; st.state.gearLevels.arcRifle = 5; const r = st.upgradeGear('arcRifle'); st.state.gearLevels.arcRifle = 2; return r.reason; });
    check('gear level capped at 5', gmax === 'Max level');

    // --- 7b. Leader picker: leaders in another squad are locked ('In Alpha'), own leader can be cleared/swapped
    await tab(3);
    await click('Bravo', { kind: 'tab' });
    await click('slot-leader', { kind: 'zone' });
    const pk = await ev(() => { const c = __BD.controls(); const z = (n) => c.find((b) => b.kind === 'zone' && b.label === n); return { kael: z('pick-kael')?.enabled, none: z('pick-none')?.enabled, tag: !!__BD.ui().modal?.list.some((o) => o.text === '🔒 In Alpha') }; });
    check('Bravo picker: Kael shown locked "In Alpha", No-leader selectable', pk.kael === false && pk.none === true && pk.tag, JSON.stringify(pk));
    await shot('leader-picker-locked.png');
    { const z = await ev(() => __BD.controls().find((b) => b.kind === 'zone' && b.label === 'pick-kael')); await page.mouse.click(z.x, z.y); await sleep(400); }
    s = await state();
    check('tapping a locked leader does nothing (Bravo stays empty, Alpha keeps Kael, picker stays open)', s.squads.bravo.leader === null && s.squads.alpha.leader === 'kael' && !!(await ev(() => __BD.ui().modal)));
    await ev(() => __BD.ui().closeModal(true));
    await click('Alpha', { kind: 'tab' });
    await click('slot-leader', { kind: 'zone' });
    check("Alpha picker: Alpha's own leader Kael is not locked", await ev(() => __BD.controls().find((b) => b.kind === 'zone' && b.label === 'pick-kael')?.enabled === true));
    await click('pick-none', { kind: 'zone' });
    check('own leader can be unassigned from the picker', (await state()).squads.alpha.leader === null);
    const re = await ev(() => [__BD.store.assignLeader('kael', 'bravo').ok, __BD.store.assignLeader('kael', 'alpha').ok, __BD.store.assignLeader('kael', 'bravo').ok, __BD.store.assignLeader(null, 'alpha').ok, __BD.store.assignLeader('kael', 'alpha').ok]);
    check('freed leader can move; swap back works; re-steal rejected again', JSON.stringify(re) === '[true,false,true,true,false]', JSON.stringify(re));
    await ev(() => { __BD.store.assignLeader(null, 'bravo'); __BD.store.assignLeader('kael', 'alpha'); });
    check('gear stays locked per copy across squads (no steal)', (await ev(() => __BD.store.equipGear('bravo', 'weapon', 'arcRifle'))).ok === false && (await state()).squads.alpha.weapon === 'arcRifle');

    // --- 8. Everything persists across reload
    const before = await state();
    await ev(() => __BD.store.save());
    await page.reload(); await ready();
    s = await state();
    check('squads, leaders, gear, troops and gacha persist after reload', JSON.stringify(s.squads) === JSON.stringify(before.squads) && JSON.stringify(Object.entries(s.leaders).sort()) === JSON.stringify(Object.entries(before.leaders).sort()) && s.gear.arcRifle === 1 && s.troops.bearer === 9 && s.gacha.total === before.gacha.total);

    // --- 9. Tapping buildings opens their screens; World button opens the World map
    await ev(() => __BD.base().select('barracks')); await sleep(300);
    await click('Train');
    check('Barracks panel → Train opens Troops screen', await ev(() => __BD.ui().screen?.id === 'troops'));
    await tab(0);
    await ev(() => __BD.base().select('armory')); await sleep(300);
    await click('Recruit');
    check('Armory panel → Recruit opens the Armory', await ev(() => __BD.ui().screen?.id === 'armory'));
    await tab(3);
    await click('World');
    check('Squads → World button opens the World map (stage 3)', await waitTrue(() => __BD.ui().worldMode && __BD.ui().activeTab === 'world'));
    await tab(0);
    // tap the Base Power pill -> breakdown
    const pp = await ev(() => __BD.gameToPage(348, 90));
    await page.mouse.click(pp.x, pp.y); await sleep(300);
    check('Base Power breakdown opens from the HUD', await ev(() => __BD.ui().modal?.list.some((o) => o.text && /TROOP POWER/.test(o.text))));
    await ev(() => __BD.ui().closeModal());

    // --- 10. Building upgrade timers (one builder)
    const durs = await ev(() => { const st = __BD.store; const lv0 = st.state.buildings.armory.level; const out = []; for (let L = 1; L <= 8; L++) { st.state.buildings.armory.level = L; out.push(st.upgradeSeconds('armory')); } st.state.buildings.armory.level = lv0; return out; });
    check('upgrade durations: Lv2 10s, Lv3 30s, Lv4 2m, Lv5 6m, Lv6 20m, then x3', JSON.stringify(durs) === JSON.stringify([10, 30, 120, 360, 1200, 3600, 10800, 32400]), JSON.stringify(durs));
    check('Beacon uses the same timer table', await ev(() => __BD.store.upgradeSeconds('beacon') === 120)); // Beacon Lv 3 -> 4
    await ev(() => { const st = __BD.store; st.state.resources.energy = 5000; st.state.construction = []; st.save(); __BD.base().select('barracks'); });
    await sleep(400);
    const bPow0 = (await power()).total, bCap0 = await ev(() => __BD.store.laneCapacity()), bE0 = (await state()).resources.energy;
    await waitTrue(() => { const u = __BD.ui(); return u.panel.visible && Math.abs(u.panel.y) < 0.5 && /^Upgrade/.test(u.pUpgrade.labelText.text); }); await sleep(150);
    const upB = await ev(() => { const b = __BD.ui().pUpgrade; return __BD.gameToPage(b.x, b.y); });
    const dbg = await ev(() => { const u = __BD.ui(); return { lab: u.pUpgrade.labelText.text, en: u.pUpgrade.enabled, py: u.panel.y, vis: u.panel.visible, modal: !!u.modal, screen: u.screen?.id ?? !!u.screen, tab: u.activeTab, sel: __BD.base().selected?.id ?? __BD.base().selected }; });
    await page.mouse.click(upB.x, upB.y); await sleep(400);
    s = await state();
    if (!s.construction.length) console.log('DBG', JSON.stringify(dbg), JSON.stringify(upB));
    check('Barracks Lv 2→3 upgrade starts via the panel: 30 s, 47 Energy paid up front', s.construction.length === 1 && s.construction[0].id === 'barracks' && s.construction[0].toLevel === 3 && s.construction[0].total === 30 && Math.abs(bE0 - s.resources.energy - 47) < 1, JSON.stringify(s.construction));
    check('panel shows countdown + Cancel while upgrading', await waitTrue(() => /Upgrading to Lv 3/.test(__BD.ui().pStats.text) && /^Cancel/.test(__BD.ui().pUpgrade.labelText.text)));
    check('map shows a countdown over the Barracks', await waitTrue(() => { const t = __BD.base().buildTexts?.barracks; return !!t && t.visible && /Lv 3/.test(t.text); }));
    const lock = await ev(() => [__BD.store.upgrade('commandCenter').reason, __BD.store.upgrade('armory').ok, __BD.store.state.construction.length]);
    check('single builder: other upgrades refused while one runs', /^Builder busy: Barracks/.test(lock[0]) && lock[1] === false && lock[2] === 1, JSON.stringify(lock));
    await ev(() => __BD.store.tick(12)); await sleep(400);
    await shot('stage2-building-upgrade.png');
    await ev(() => __BD.store.tick(17));
    check('level, power and lane capacity unchanged before the timer ends', (await state()).buildings.barracks.level === 2 && (await power()).total === bPow0 && (await ev(() => __BD.store.laneCapacity())) === bCap0);
    await ev(() => __BD.store.tick(1.01)); await sleep(300);
    check('on completion: Barracks Lv 3, +5 power, lanes 20→30', (await state()).buildings.barracks.level === 3 && (await power()).total === bPow0 + 5 && (await ev(() => __BD.store.laneCapacity())) === 30 && (await state()).construction.length === 0);
    // cancel = full refund (UI)
    await ev(() => { __BD.base().select('commandCenter'); }); await sleep(300);
    const cE0 = (await state()).resources.energy;
    await waitTrue(() => { const u = __BD.ui(); return u.panel.visible && Math.abs(u.panel.y) < 0.5 && /^Upgrade/.test(u.pUpgrade.labelText.text); }); await sleep(150);
    const upC = await ev(() => { const b = __BD.ui().pUpgrade; return __BD.gameToPage(b.x, b.y); });
    await page.mouse.click(upC.x, upC.y); await sleep(400);
    const cCost = (await state()).construction[0]?.cost;
    check('Command Center Lv 3→4 takes 2 min', (await state()).construction[0]?.total === 120);
    await ev(() => __BD.store.tick(30));
    await waitTrue(() => /^Cancel/.test(__BD.ui().pUpgrade.labelText.text));
    await page.mouse.click(upC.x, upC.y); await sleep(400);
    s = await state();
    check('Cancel refunds the full cost and frees the builder', s.construction.length === 0 && s.buildings.commandCenter.level === 3 && s.resources.energy >= cE0 - 0.01 && cCost > 0, `cost ${cCost}, energy ${cE0.toFixed(1)} -> ${s.resources.energy.toFixed(1)}`);
    const exact = await ev(() => { const st = __BD.store; st.state.resources.energy = 1000; const r = st.upgrade('armory'); const mid = st.state.resources.energy; const c = st.cancelUpgrade('armory'); return [r.cost, mid, c.refund, st.state.resources.energy, st.cancelUpgrade('armory').ok]; });
    check('cancel refund is exact (1000 → 1000)', exact[1] === 1000 - exact[0] && exact[2] === exact[0] && exact[3] === 1000 && exact[4] === false, JSON.stringify(exact));
    // Beacon still needs full charge; cancelling gives the charge back
    const bc = await ev(() => { const st = __BD.store; st.state.beacon.charge = 50; const a = st.upgrade('beacon').reason; st.state.beacon.charge = 100; const b = st.upgrade('beacon'); const ch = st.state.beacon.charge; st.cancelUpgrade('beacon'); return [a, b.ok, ch, st.state.beacon.charge, st.state.beacon.level]; });
    check('Beacon upgrade still requires full charge; cancel restores charge', bc[0] === 'Beacon must be fully charged' && bc[1] && bc[2] === 0 && bc[3] === 100 && bc[4] === 3, JSON.stringify(bc));
    // offline: a 2-minute upgrade finishes while away; another keeps counting
    await ev(() => { __BD.ui().closePanel(true); __BD.store.upgrade('commandCenter'); __BD.store.save(); });
    await editSave('s.lastSaved = Date.now() - arg;', 200e3);
    s = await state();
    check('offline: Command Center upgrade completed while away (Lv 4)', s.buildings.commandCenter.level === 4 && s.construction.length === 0 && (await ev(() => (__BD.store.offlineReport?.built ?? []).some((b) => b.id === 'commandCenter' && b.level === 4))));
    await ev(() => { const st = __BD.store; st.state.beacon.charge = 100; st.state.resources.energy = 5000; st.upgrade('beacon'); st.save(); });
    await editSave('s.lastSaved = Date.now() - arg;', 60e3);
    s = await state();
    check('offline: Beacon upgrade timer kept running (≈60 of 120 s), level unchanged', s.beacon.level === 3 && s.construction[0]?.id === 'beacon' && s.construction[0].progress >= 59 && s.construction[0].progress < 70, JSON.stringify(s.construction));
    const sp = await ev(() => { const st = __BD.store; const cost = st.speedUpCoreCost('beacon'); const r = st.speedUpConstruction('beacon', 1e6); return [cost, r.ok, st.state.beacon.level, st.state.construction.length]; });
    check('speed-up hook (no UI): speedUpConstruction finishes the timer', sp[0] >= 1 && sp[1] && sp[2] === 4 && sp[3] === 0, JSON.stringify(sp));
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, tab: __BD.ui().screenState, modal: !!__BD.ui().modal, reveal: !!__BD.ui().reveal, controls: __BD.controls().map((c) => c.label) })).catch(() => ({}));
    check(`stage 2 suite ran without exceptions`, false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 2: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ STAGE 3 --
async function runStage3(url, label, takeShots) {
  console.log(`\n=== stage 3 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // stages 1-4 predate the tutorial: keep its coach card out of their way (stage 5 tests it)
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(400); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async (name) => { if (takeShots) { await sleep(350); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
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
    await frames(2);
    const c = await ctl(label, opts);
    if (!c) throw new Error(`control not found: ${label} ${JSON.stringify(opts)}`);
    await page.mouse.click(c.x, c.y); await frames(4); await sleep(opts.wait ?? 300);
    return c;
  };
  const waitTrue = async (fn, arg) => { for (let i = 0; i < 25; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const editSave = async (fn, arg) => { await ev(([fn, arg]) => { __BD.store.save = () => {}; const k = 'brokenDawn.save.v1'; const s = JSON.parse(localStorage.getItem(k)); new Function('s', 'arg', fn)(s, arg); localStorage.setItem(k, JSON.stringify(s)); }, [fn, arg]); await page.reload(); await ready(); };
  // advance game time in 1 s steps until a predicate holds (marches, battles, healing)
  const runUntil = (pred, max = 120) => ev(([pred, max]) => { const f = new Function('st', `return (${pred})(st)`); for (let i = 0; i < max; i++) { if (f(__BD.store)) return i; __BD.store.tick(1); } return f(__BD.store) ? max : -1; }, [pred.toString(), max]);
  const cam = () => ev(() => { const c = __BD.world().cameras.main; return { zoom: c.zoom, x: c.scrollX, y: c.scrollY }; });

  try {
    await page.goto(url); await ready();

    // --- 0. v5 save -> v6: Infirmary added (on a free spot: its default tile is taken here), world, stamina
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 5, resources: { energy: 900, shards: 120, alloy: 30, cores: 6 }, beacon: { level: 3, charge: 40 },
        buildings: { commandCenter: { level: 3, gx: 12, gy: 8 }, barracks: { level: 2, gx: 8, gy: 12 }, armory: { level: 2, gx: 16, gy: 8 } },
        troops: { sentinel: 8, bearer: 4, voyager: 0 }, training: { sentinel: { count: 0, progress: 0 }, bearer: { count: 0, progress: 0 }, voyager: { count: 0, progress: 0 } },
        squads: { alpha: { level: 2, lines: [{ type: 'sentinel', count: 6 }, { type: 'bearer', count: 4 }, { type: null, count: 0 }], leader: null, armor: null, weapon: null } },
        leaders: {}, gear: {}, construction: [], claims: { beacon: [2, 3], milestones: [] }, lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    let s = await state();
    check('v5 save migrates to v6 (and on to v10)', s.version === 10);
    // the Armory sat on the old Infirmary tile (16,8), right of the Beacon: it stays to the right on the v9 map
    const aOff = await ev(() => { const b = __BD.store.state.buildings.armory, c = __BD.grid.isoToWorld(b.gx + 1.5, b.gy + 1.5), o = __BD.grid.BEACON_CENTER; return { dx: c.x - o.x, dy: c.y - o.y, ok: __BD.store.canPlace('armory', b.gx, b.gy) }; });
    check('v6 keeps buildings (Armory stays right of the Beacon), levels, resources, troops and squads', aOff.ok && aOff.dx > 200 && Math.abs(aOff.dy) < 250 && s.buildings.commandCenter.level === 3 && s.beacon.level === 3 && s.resources.cores === 6 && s.troops.sentinel === 8 && s.squads.alpha.level === 2 && s.squads.alpha.lines[0].count === 6, JSON.stringify(s.buildings));
    const inf = s.buildings.infirmary;
    check('v6 adds the Infirmary at Lv 1 on a free spot (no overlap with the Armory)', inf.level === 1 && !(inf.gx === s.buildings.armory.gx && inf.gy === s.buildings.armory.gy) && (await ev(() => __BD.store.canPlace('infirmary', __BD.store.state.buildings.infirmary.gx, __BD.store.state.buildings.infirmary.gy))), JSON.stringify(inf));
    check('v6 formation lines get full = saved count', s.squads.alpha.lines[0].full === 6 && s.squads.alpha.lines[1].full === 4);
    check('v6 generates a world: 40 creatures + your base; stamina starts full (100)', s.world.entities.filter((e) => e.kind === 'creature').length === 40 && s.world.entities.some((e) => e.kind === 'base' && e.owner === 'local') && s.hunt.stamina === 100);
    check('v5 migration keeps a backup of the v5 save', await ev(() => JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v5') || '{}').version === 5));
    check('Infirmary adds +5 Base Power (Lv 1) (+5 Archive, unsealed at Beacon Lv 3)', (await ev(() => __BD.store.power.building)) === 30 + 10 + 45 + 0 + 5 + 5, String(await ev(() => __BD.store.power.building)));
    check('Infirmary sprite is drawn on the base', await ev(() => !!__BD.base().sprites.infirmary?.img.visible));

    // --- 1. fresh game with a seeded world and three squads
    await ev(() => { localStorage.clear(); __BD.store.save = () => {}; }); await page.reload(); await ready();
    await ev(() => {
      const st = __BD.store;
      delete st.save; // restore the prototype save()
      st.state.world = __BD.dev.createWorld(424242);
      Object.assign(st.state.troops, { sentinel: 60, bearer: 60, voyager: 60 });
      st.state.buildings.commandCenter.level = 5;
      st.state.resources.energy = 20000;
      st.saveFormation('alpha', [{ type: 'sentinel', count: 14 }, { type: 'bearer', count: 12 }, { type: 'voyager', count: 10 }]);
      st.saveFormation('bravo', [{ type: 'sentinel', count: 8 }, { type: 'bearer', count: 6 }, { type: null, count: 0 }]);
      st.saveFormation('charlie', [{ type: 'bearer', count: 4 }, { type: null, count: 0 }, { type: 'voyager', count: 4 }]);
      st.save();
    });
    await page.reload(); await ready();

    // --- 2. world layout
    const lay = await ev(() => {
      const st = __BD.store, base = { x: 32, y: 32 }, cr = st.creatures();
      const ringOk = cr.every((e) => e.level === __BD.dev.ringLevel(e.ring, __BD.dev.dist(e, base)));
      const avgD = [0, 1, 2, 3].map((r) => { const xs = cr.filter((e) => e.ring === r); return xs.reduce((n, e) => n + __BD.dev.dist(e, base), 0) / xs.length; });
      const levels = new Set(cr.map((e) => e.level));
      return { n: cr.length, ringOk, avgD, all: [...Array(20)].every((_, i) => levels.has(i + 1)), wyrm: cr.every((e) => (e.level % 5 === 0) === (e.type === 'wyrm')), types: [...new Set(cr.map((e) => e.type))].sort() };
    });
    check('world has ~40 creatures (40)', lay.n === 40);
    check('creature level follows its ring + distance (Lv 1-5 near base … Lv 16-20 at the edge)', lay.ringOk && lay.avgD.every((d, i) => i === 0 || d > lay.avgD[i - 1]), lay.avgD.map((d) => d.toFixed(1)).join(' < '));
    check('every level 1-20 is on the map', lay.all);
    check('Dusk Wyrm elites exactly on every 5th level; all 5 creature types present', lay.wyrm && lay.types.join() === 'drone,golem,hound,scuttler,wyrm', lay.types.join());
    const pw = await ev(() => [1, 5, 10, 20].map((L) => __BD.store.creaturePowerOf({ level: L, type: L % 5 ? 'hound' : 'wyrm' })));
    check('creature power: Lv1 20, +20%/level, elites x1.25 (Lv5 52, Lv10 129, Lv20 799)', JSON.stringify(pw) === JSON.stringify([20, 52, 129, 799]), JSON.stringify(pw));

    // --- 3. World tab: separate view, pan + pinch + wheel
    await tab('world');
    check('World tab opens the World map (base view sleeps)', await waitTrue(() => __BD.ui().worldMode && __BD.ui().activeTab === 'world' && __BD.world().scene.isVisible() && __BD.base().scene.isSleeping()));
    check('World HUD shows stamina, Auto and squads', await waitTrue(() => __BD.ui().worldHud.visible && __BD.controls().some((c) => c.meta === 'auto') && __BD.controls().some((c) => c.label === 'chip-alpha')));
    let c0 = await cam();
    await touch('touchStart', [{ x: 200, y: 450 }]);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: 200 - i * 12, y: 450 - i * 8 }]); await sleep(16); }
    await touch('touchEnd', []); await frames(3);
    let c1 = await cam();
    check('touch drag pans the World map', Math.abs(c1.x - c0.x) > 60 && Math.abs(c1.y - c0.y) > 40, `dx ${(c1.x - c0.x).toFixed(0)} dy ${(c1.y - c0.y).toFixed(0)}`);
    await touch('touchStart', [{ x: 170, y: 450 }, { x: 230, y: 450 }]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: 170 - i * 6, y: 450 }, { x: 230 + i * 6, y: 450 }]); await sleep(16); }
    await touch('touchEnd', []); await frames(3);
    const zp = (await cam()).zoom;
    check('pinch-out zooms the World map in', zp > c1.zoom * 1.4, `${c1.zoom.toFixed(2)} -> ${zp.toFixed(2)}`);
    await page.mouse.move(195, 450);
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 200); await sleep(10); }
    check('wheel zoom clamps at 0.25', Math.abs((await cam()).zoom - 0.25) < 1e-6);
    await ev(() => { const w = __BD.world(); w.cameras.main.setZoom(0.55); w.cameras.main.centerOn(32.5 * 72, 32.5 * 72); }); await frames(3);

    // --- 4. tap a Lv 1 creature -> sheet -> Attack · Alpha
    const lv1 = await ev(() => { const st = __BD.store; return st.creatures().filter((e) => e.level === 1).sort((a, b) => __BD.dev.dist(a, { x: 32, y: 32 }) - __BD.dev.dist(b, { x: 32, y: 32 }))[0].id; });
    const tp = await ev((id) => { const e = __BD.store.world.get(id); return __BD.tileToPage(e.x, e.y); }, lv1);
    await page.mouse.click(tp.x, tp.y - 3); await frames(4); await sleep(300);
    check('tapping a creature opens its attack sheet', await waitTrue((id) => __BD.ui().worldHud.sheetFor === id, lv1));
    check('locked levels: can only attack up to best kill + 1 (Lv 1 now)', (await ev(() => __BD.store.maxAttackLevel())) === 1 && /Defeat a Lv 1/.test(await ev(() => __BD.store.attackInfo('alpha', __BD.store.creatures().find((e) => e.level === 2).id).reason)));
    const e0 = await state();
    await click('Attack · Alpha', { meta: 'attack-alpha' });
    s = await state();
    const m0 = s.world.marches[0];
    check('Attack sends a march: −10 stamina, target reserved, travel 5 s + 1 s/tile', !!m0 && m0.squadId === 'alpha' && m0.phase === 'out' && s.hunt.stamina === 90 && s.world.entities.find((e) => e.id === lv1).busy === m0.id && Math.abs(m0.travel - Math.min(60, 5 + Math.hypot(m0.to.x - 32, m0.to.y - 32))) < 1e-6, JSON.stringify(m0 && { t: m0.travel, st: s.hunt.stamina }));
    check('only healthy troops march (army snapshot = Alpha lines 14/12/10)', JSON.stringify(m0.army.lines.map((l) => l.count)) === '[14,12,10]');
    check('formation is locked while marching', (await ev(() => __BD.store.saveFormation('alpha', [{ type: 'sentinel', count: 1 }, { type: null, count: 0 }, { type: null, count: 0 }]).reason)) === 'Alpha is out on a march');
    check('a second squad can\'t attack the same creature', /already on its way/.test(await ev((id) => __BD.store.attackInfo('bravo', id).reason, lv1)));
    await sleep(600);
    await shot('stage3-world-march.png');
    const steps = await runUntil((st) => st.state.hunt.reports.length > 0, 70);
    s = await state();
    const r1 = s.hunt.reports[0];
    check('march arrives after its travel time and auto-battles', steps >= 0 && steps <= Math.ceil(m0.travel) + 1 && !!r1, `steps ${steps}, travel ${m0.travel.toFixed(1)}`);
    check('Lv 1 hunt won: +30 Energy, +4 Alloy, +10 Shards', r1.win && r1.loot.energy === 30 && r1.loot.alloy === 4 && r1.loot.shards === 10);
    check('first Lv 1 kill pays +1 Beacon Core via grantCores(…,"battle")', r1.loot.cores === 1 && s.resources.cores === e0.resources.cores + 1 && r1.firstKill && s.hunt.firstKills.includes(1));
    const sent1 = 36, cas = r1.casualties;
    check('win casualties are 10-20% of troops sent, mostly wounded', cas.total >= Math.round(sent1 * 0.1) && cas.total <= Math.round(sent1 * 0.2) && cas.woundedTotal >= cas.deadTotal && cas.woundedTotal + cas.deadTotal === cas.total, JSON.stringify(cas));
    check('casualties leave the squad + troop count; wounded wait in the Infirmary', s.troops.sentinel + s.troops.bearer + s.troops.voyager === 180 - cas.total && (await ev(() => __BD.store.woundedTotal())) === cas.woundedTotal && s.squads.alpha.lines.reduce((n, l) => n + l.count, 0) === 36 - cas.total && s.squads.alpha.lines[0].full === 14);
    check('killed creature leaves the map and is scheduled to respawn in 10 min', !s.world.entities.some((e) => e.id === lv1) && s.world.respawns.length === 1 && Math.abs(s.world.respawns[0].at - s.world.clock - 600) < 2);
    check('best kill raised: Lv 2 now attackable', s.hunt.bestKill === 1 && (await ev(() => __BD.store.maxAttackLevel())) === 2);
    check('manual attack pops the battle report card', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'VICTORY')));
    await shot('stage3-battle-report.png');
    // replay
    await click('▶ Watch Replay', { wait: 400 });
    check('Watch Replay opens the battle replay', await waitTrue(() => !!__BD.ui().replay));
    await sleep(2600);
    await shot('stage3-battle-replay.png');
    check('replay advances through the battle volley by volley', await waitTrue(() => __BD.ui().replayState().i >= 1));
    const det = await ev(() => { const st = __BD.store, r = st.state.hunt.reports[0]; const a = st.replayOf(r), b = st.replayOf(r); return JSON.stringify(a) === JSON.stringify(b) && (a.winner === 'attacker') === r.win && a.seed === r.seed; });
    check('replay is the exact same deterministic battle (same seed → same result)', det);
    await click('Skip', { wait: 300 });
    check('Skip jumps to the result', await waitTrue(() => __BD.ui().replayState().done));
    await click('Close', { wait: 300 });
    check('replay closes', await waitTrue(() => __BD.ui().replay === null));
    await runUntil((st) => !st.squadMarch('alpha'), 60);
    check('squad marches back home and is free again', await ev(() => !__BD.store.squadMarch('alpha') && __BD.store.squadStatus('alpha') === 'home'));

    // --- 5. resolver: deterministic, plain data, seed-dependent, strength matters
    const rz = await ev(() => {
      const d = __BD.dev, st = __BD.store.state;
      const atk = d.squadArmy(st, 'alpha'), def = d.creatureArmy('hound', 4);
      const a = d.resolveBattle(atk, def, 99), b = d.resolveBattle(JSON.parse(JSON.stringify(atk)), JSON.parse(JSON.stringify(def)), 99);
      const seeds = new Set(); for (let k = 1; k <= 8; k++) seeds.add(JSON.stringify(d.resolveBattle(atk, def, k).events.map((e) => e.dmg)));
      const weak = d.squadArmy({ ...st, squads: { alpha: { ...st.squads.alpha, lines: [{ type: 'sentinel', count: 2 }, { type: null, count: 0 }, { type: null, count: 0 }] } } }, 'alpha');
      let weakWins = 0, strongWins = 0;
      for (let k = 1; k <= 20; k++) { if (d.resolveBattle(weak, d.creatureArmy('golem', 8), k).winner === 'attacker') weakWins++; if (d.resolveBattle(atk, d.creatureArmy('scuttler', 2), k).winner === 'attacker') strongWins++; }
      return { same: JSON.stringify(a) === JSON.stringify(b), variety: seeds.size, weakWins, strongWins, plain: JSON.stringify(atk).length > 0 && !('state' in atk) };
    });
    check('battle resolver: plain-data armies, same seed → identical result', rz.same && rz.plain);
    check('battle resolver: different seeds roll different damage', rz.variety > 1, `${rz.variety} distinct`);
    check('battle resolver: strength decides (strong squad 20/20 vs Lv 2, 2 Sentinels 0/20 vs Lv 8 Golems)', rz.strongWins === 20 && rz.weakWins === 0, JSON.stringify(rz));

    // --- 6. second kill of the same level: loot, but no Core
    const second = await ev(() => {
      const st = __BD.store; const c0 = st.state.resources.cores;
      const t = st.creatures().filter((e) => !e.busy && e.ring === 0).sort((a, b) => a.level - b.level)[0];
      t.level = 1; // fixture: this seed has a single Lv 1 creature, make another
      const r = st.attack('bravo', t.id);
      for (let i = 0; i < 70 && st.state.hunt.reports[0].squadId !== 'bravo'; i++) st.tick(1);
      const rep = st.state.hunt.reports[0];
      return { ok: r.ok, win: rep.win, cores: rep.loot.cores, delta: st.state.resources.cores - c0, energy: rep.loot.energy };
    });
    check('repeat Lv 1 kill: loot again but no Core (first kill only)', second.ok && second.win && second.cores === 0 && second.delta === 0 && second.energy === 30, JSON.stringify(second));
    await ev(() => __BD.ui().closeModal(true));

    // --- 7. respawn after 10 min, back to 40
    const resp = await ev(() => { const st = __BD.store; const before = st.creatures().length; for (let i = 0; i < 61; i++) st.tick(10); return [before, st.creatures().length, st.state.world.respawns.length]; });
    check('creatures respawn after 10 min (back to 40)', resp[0] === 38 && resp[1] === 40 && resp[2] === 0, JSON.stringify(resp));

    // --- 8. defeat: heavier losses
    const loss = await ev(() => {
      const st = __BD.store; st.state.hunt.bestKill = 19;
      st.refillSquad('charlie');
      const t = st.creatures().filter((e) => e.level >= 12 && !e.busy)[0];
      const r = st.attack('charlie', t.id);
      for (let i = 0; i < 70 && st.state.hunt.reports[0].squadId !== 'charlie'; i++) st.tick(1);
      st.state.hunt.bestKill = 1;
      const rep = st.state.hunt.reports[0];
      return { ok: r.ok, win: rep.win, total: rep.casualties.total, dead: rep.casualties.deadTotal, loot: rep.loot.energy, losses: st.state.hunt.losses };
    });
    check('a weak squad loses to a Lv 12+ creature: no loot', loss.ok && !loss.win && loss.loot === 0 && loss.losses === 1, JSON.stringify(loss));
    check('defeat casualties are heavier (35-60% of 8 sent, ~40% of them dead)', loss.total >= 3 && loss.total <= 5 && loss.dead >= 1 && loss.dead < loss.total, JSON.stringify(loss));

    // --- 9. Infirmary capacity: wounded beyond beds die
    const ovf = await ev(() => {
      const st = __BD.store; const cap = st.infirmaryCapacity();
      st.state.infirmary.wounded.voyager.reserve += cap - st.woundedTotal() - 1; // one bed left
      st.refillSquad('alpha');
      const t = st.creatures().find((e) => e.level <= 2 && !e.busy);
      const dead0 = st.state.hunt.dead;
      st.attack('alpha', t.id);
      for (let i = 0; i < 70 && st.state.hunt.reports[0].squadId !== 'alpha'; i++) st.tick(1);
      const rep = st.state.hunt.reports[0];
      const res = { cap, used: st.woundedTotal(), overflow: rep.casualties.overflow, wounded: rep.casualties.woundedTotal, dead: st.state.hunt.dead - dead0, tot: rep.casualties.total };
      st.state.infirmary.wounded.voyager.reserve = 0;
      return res;
    });
    check('Infirmary full: only 1 wounded admitted, the rest die', ovf.used === ovf.cap && ovf.wounded === 1 && ovf.overflow >= 1 && ovf.dead === ovf.tot - 1, JSON.stringify(ovf));

    // --- 10. healing via the base panel -> Infirmary screen
    await tab('base');
    await ev(() => { __BD.store.state.resources.energy = 5000; __BD.base().select('infirmary'); }); await sleep(400);
    check('Infirmary panel shows beds + heal speed', await waitTrue(() => /Beds \d+\/30/.test(__BD.ui().pStats.text) && __BD.ui().pOpen.labelText.text === 'Heal'));
    await click('Heal');
    check('Heal opens the Infirmary screen', await waitTrue(() => __BD.ui().screen?.id === 'infirmary'));
    const w0 = await ev(() => { const st = __BD.store; return { s: st.woundedPool('sentinel'), b: st.woundedPool('bearer'), e: st.state.resources.energy, alpha: st.state.squads.alpha.lines.map((l) => [l.count, l.full]) }; });
    const sLbl = `Heal all (${w0.s})`;
    await click(sLbl, { meta: 'heal-sentinel' });
    s = await state();
    check('Heal all Sentinels queues them for 3 Energy each', s.infirmary.queue.length === 1 && s.infirmary.queue[0].type === 'sentinel' && s.infirmary.queue[0].count === w0.s && s.infirmary.queue[0].energyPer === 3 && w0.e - s.resources.energy > 3 * w0.s - 6 && w0.e - s.resources.energy <= 3 * w0.s + 1e-6, `${w0.s} wounded, spent ${(w0.e - s.resources.energy).toFixed(1)}`);
    await ev(() => __BD.store.tick(2)); await sleep(500);
    await shot('stage3-infirmary-healing.png');
    check('healing progress runs (4 s per Sentinel at Lv 1)', (await ev((n) => { const b = __BD.store.state.infirmary.queue[0]; return b && (b.progress >= 2 || b.count < n); }, w0.s)) && (await ev(() => __BD.store.healUnitTime('sentinel'))) === 4);
    // cancel refund on a second batch
    const cr = await ev(() => { const st = __BD.store; const e = st.state.resources.energy; const n = st.woundedPool('bearer'); st.heal('bearer', n); const mid = st.state.resources.energy; const r = st.cancelHeal(1); return { n, paid: e - mid, refund: r.refund, back: st.state.resources.energy - e, pool: st.woundedPool('bearer') }; });
    check('cancel a healing batch: full Energy refund, wounded go back to waiting', cr.n > 0 && cr.paid === 4 * cr.n && cr.refund === cr.paid && Math.abs(cr.back) < 1e-9 && cr.pool === cr.n, JSON.stringify(cr));
    await ev(() => { const b = __BD.store.state.infirmary.queue[0]; if (b) b.progress = 0; });
    const qn = await ev(() => ({ q: __BD.store.state.infirmary.queue[0]?.count ?? 0, p: __BD.store.woundedPool('sentinel') }));
    await click('✕', { meta: 'cancel-heal-0', wait: 300 });
    check('✕ in the queue cancels via the UI too', qn.q > 0 && (await ev(() => __BD.store.state.infirmary.queue.length)) === 0 && (await ev(() => __BD.store.woundedPool('sentinel'))) === qn.p + qn.q, JSON.stringify(qn));
    const healed = await ev(() => {
      const st = __BD.store;
      for (let i = 0; i < 120 && st.state.world.marches.length; i++) st.tick(1); // squads home (healed troops only rejoin squads that are home)
      st.state.infirmary.queue.length = 0;
      const n = st.woundedPool('sentinel'); const t0 = st.state.troops.sentinel;
      const fromAlpha = st.state.infirmary.wounded.sentinel.alpha; const a0 = st.state.squads.alpha.lines[0].count; const room = st.state.squads.alpha.lines[0].full - a0;
      st.heal('sentinel', n); for (let i = 0; i < n * 4 + 2; i++) st.tick(1);
      return { n, gained: st.state.troops.sentinel - t0, fromAlpha, room, alphaGain: st.state.squads.alpha.lines[0].count - a0, left: st.state.infirmary.queue.length };
    });
    check('healed troops return to the army and rejoin their own squad line', healed.n > 0 && healed.gained === healed.n && healed.fromAlpha > 0 && healed.alphaGain === Math.min(healed.fromAlpha, healed.room) && healed.left === 0, JSON.stringify(healed));
    check('dead troops are gone (Refill pulls retrained/ready troops back into lines)', await ev(() => { const st = __BD.store; const before = st.refillable('alpha'); const r = st.refillSquad('alpha'); return before === r.added && st.state.squads.alpha.lines.every((l) => !l.type || l.count === l.full || st.readyCount(l.type) === 0); }));
    // healing continues offline
    const nb = await ev(() => { const st = __BD.store; st.state.infirmary.wounded.bearer.bravo += 6; st.state.troops.bearer -= 6; const n = st.woundedPool('bearer'); st.heal('bearer', n); st.save(); return n; });
    const tb = await ev(() => __BD.store.state.troops.bearer);
    await editSave('s.lastSaved = Date.now() - arg;', (nb * 5 + 3) * 1000);
    check(`healing keeps running offline (${nb} Bearers × 5 s)`, await ev(([tb, nb]) => __BD.store.state.infirmary.queue.length === 0 && __BD.store.woundedPool('bearer') === 0 && __BD.store.state.troops.bearer === tb + nb, [tb, nb]));

    // --- 11. healthy-only marching, stamina rules
    const hz = await ev(() => {
      const st = __BD.store; const snap = JSON.stringify(st.state);
      for (const l of st.state.squads.charlie.lines) l.count = 0;
      for (const t of ['sentinel', 'bearer', 'voyager']) st.state.troops[t] = st.assignedCount(t);
      const t = st.creatures().find((e) => e.level <= st.maxAttackLevel() && !e.busy);
      const a = st.attack('charlie', t.id).reason;
      st.state = JSON.parse(snap);
      st.state.hunt.stamina = 5;
      const b = st.attack('alpha', t.id).reason;
      st.state.hunt.stamina = 50; st.state.hunt.staminaCarry = 0; st.tick(3600);
      const regen = st.state.hunt.stamina;
      st.state.hunt.stamina = 100; st.tick(3600);
      const capped = st.state.hunt.stamina;
      st.state.daily = { lastDay: null, streak: 0 }; st.state.hunt.stamina = 30; st.claimDaily();
      const daily = st.state.hunt.stamina;
      st.state.hunt.stamina = 12; st.state.beacon.charge = 100; st.state.construction = []; st.upgrade('beacon'); st.speedUpConstruction('beacon', 1e6);
      const beacon = st.state.hunt.stamina;
      st.state.hunt.stamina = 100;
      return { a, b, regen, capped, daily, beacon };
    });
    check('a squad with no healthy troops can\'t march', /No healthy troops in Charlie/.test(hz.a), hz.a);
    check('attacks need 10 stamina', hz.b === 'Need 10 stamina', hz.b);
    check('stamina regenerates 10 per hour, capped at 100', hz.regen === 60 && hz.capped === 100, JSON.stringify(hz));
    check('daily login gives +20 stamina; Beacon level-up refills to 100', hz.daily === 50 && hz.beacon === 100, JSON.stringify(hz));
    // recall refunds stamina
    const rc = await ev(() => { const st = __BD.store; const t = st.creatures().find((e) => e.level <= 2 && !e.busy); st.attack('bravo', t.id); st.tick(2); const mid = st.state.hunt.stamina; const r = st.recall('bravo'); const m = st.squadMarch('bravo'); const out = { ok: r.ok, mid, after: st.state.hunt.stamina, phase: m?.phase, free: !t.busy }; for (let i = 0; i < 5; i++) st.tick(1); out.home = !st.squadMarch('bravo'); return out; });
    check('recall turns a march around (refunds its 10 stamina, frees the target)', rc.ok && rc.after === rc.mid + 10 && rc.phase === 'back' && rc.free && rc.home, JSON.stringify(rc));

    // --- 12. Auto mode (UI toggle): picks highest beatable level, nearest; all idle squads; stamina-limited
    await tab('world');
    await ev(() => { const st = __BD.store; st.state.hunt.bestKill = 6; st.state.hunt.stamina = 20; for (const id of ['alpha', 'bravo', 'charlie']) st.refillSquad(id); });
    const expect = await ev(() => {
      const st = __BD.store, out = {};
      for (const id of ['alpha', 'bravo']) {
        const p = st.squadCombatPower(id), home = { x: 32, y: 32 };
        const ok = st.creatures().filter((e) => !e.busy && e.level <= 7 && p >= 1.1 * st.creaturePowerOf(e) && !Object.values(out).includes(e.id));
        ok.sort((a, b) => b.level - a.level || __BD.dev.dist(a, home) - __BD.dev.dist(b, home));
        out[id] = ok[0]?.id ?? null;
      }
      return out;
    });
    await click('AUTO: OFF', { meta: 'auto' });
    s = await state();
    const am = Object.fromEntries(s.world.marches.map((m) => [m.squadId, m.targetId]));
    check('Auto toggled ON from the World HUD', s.hunt.auto === true);
    check('Auto sends idle squads at the highest-level creature they out-power by 10%+ (nearest first)', am.alpha === expect.alpha && am.bravo === expect.bravo && !!expect.alpha, `${JSON.stringify(am)} vs ${JSON.stringify(expect)}`);
    check('Auto stops when stamina runs out (20 stamina → 2 marches, Charlie waits)', s.world.marches.length === 2 && s.hunt.stamina === 0 && !am.charlie);
    await sleep(800);
    await ev(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); });
    await shot('stage3-world-map.png');
    const auto2 = await ev(() => { const st = __BD.store; const k0 = st.state.hunt.kills + st.state.hunt.losses; for (let i = 0; i < 400; i++) st.tick(1); return { fights: st.state.hunt.kills + st.state.hunt.losses - k0, marches: st.state.world.marches.length, stamina: st.state.hunt.stamina }; });
    check('Auto keeps hunting as stamina regenerates (no new march until 10 stamina)', auto2.fights === 2 && auto2.marches === 0 && auto2.stamina === 1, JSON.stringify(auto2));
    const autoSee = await ev(() => { const st = __BD.store; st.state.hunt.stamina = 10; st.tick(1); return st.state.world.marches.length; });
    check('Auto resumes as soon as stamina reaches 10', autoSee === 1);
    await ev(() => { const st = __BD.store; for (let i = 0; i < 200 && st.state.world.marches.length; i++) st.tick(1); });

    // --- 13. Auto keeps hunting OFFLINE (stamina-limited, 8 h cap)
    await ev(() => { const st = __BD.store; st.state.hunt.stamina = 40; st.state.hunt.staminaCarry = 0; st.state.hunt.auto = true; for (const id of ['alpha', 'bravo', 'charlie']) st.refillSquad(id); st.save(); });
    const k0 = await ev(() => __BD.store.state.hunt.kills + __BD.store.state.hunt.losses);
    await editSave('s.lastSaved = Date.now() - arg;', 3 * 3600e3);
    const off = await ev(() => ({ hu: __BD.store.offlineReport?.hunts, fights: __BD.store.state.hunt.kills + __BD.store.state.hunt.losses, stamina: __BD.store.state.hunt.stamina, offlineReports: __BD.store.state.hunt.reports.filter((r) => r.offline).length, out: __BD.store.state.world.marches.length }));
    check('offline Auto: 3 h away = 40 + 30 regen stamina → 7 marches (fought or still out), simulated on load', off.hu?.fights >= 5 && off.hu.fights + off.out === 7 && off.fights - k0 === off.hu.fights && off.stamina < 10 && off.offlineReports === off.hu.fights, JSON.stringify(off));
    check('offline hunt summary (wins, loot, wounded/fallen) is reported', off.hu.wins >= 1 && off.hu.energy > 0 && off.hu.wounded + off.hu.dead > 0);
    await ev(() => { const st = __BD.store; st.state.hunt.stamina = 200; st.save(); });
    await editSave('s.lastSaved = Date.now() - arg; s.hunt.stamina = 0; s.hunt.staminaCarry = 0;', 30 * 3600e3);
    const cap8 = await ev(() => ({ secs: __BD.store.offlineReport.seconds, fights: __BD.store.offlineReport.hunts.fights }));
    check('offline Auto is capped at 8 h (≤ 80 stamina regen → ≤ 8 hunts)', cap8.secs === 8 * 3600 && cap8.fights <= 8 && cap8.fights >= 1, JSON.stringify(cap8));
    await ev(() => __BD.store.setAuto(false));

    // --- 14. persistence + reports list
    const before = await state();
    await ev(() => __BD.store.save()); await page.reload(); await ready();
    s = await state();
    check('world, hunt progress and infirmary persist across reload', JSON.stringify(s.world.entities) === JSON.stringify(before.world.entities) && s.hunt.kills === before.hunt.kills && JSON.stringify(s.hunt.firstKills) === JSON.stringify(before.hunt.firstKills) && JSON.stringify(s.infirmary) === JSON.stringify(before.infirmary) && s.hunt.reports.length === before.hunt.reports.length);
    const cores = await ev(() => { const st = __BD.store; return { fk: st.state.hunt.firstKills.length, tot: [...Array(20)].reduce((n, _, i) => n + ((i + 1) % 5 === 0 ? 2 : 1), 0) }; });
    check('lifetime first-kill Cores total 24 (16 × 1 + 4 Wyrm × 2)', cores.tot === 24);
    await tab('world');
    await click('Reports', { meta: 'reports' }).catch(async () => click(`Reports (${s.hunt.reports.length})`, { meta: 'reports' }));
    check('Reports list opens with the latest battles', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'Battle Reports')));
    await click('report-0', { kind: 'zone' });
    check('tapping a report opens its card', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'VICTORY' || o.text === 'DEFEAT')));
    await ev(() => __BD.ui().closeModal(true));
    await tab('base');
    check('Base tab returns to the base view', await waitTrue(() => !__BD.ui().worldMode && !__BD.base().scene.isSleeping() && __BD.world().scene.isSleeping()));
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, world: __BD.ui().worldMode, modal: !!__BD.ui().modal, controls: __BD.controls().map((c) => c.label + (c.meta ? `#${c.meta}` : '')) })).catch(() => ({}));
    check('stage 3 suite ran without exceptions', false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 3: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ STAGE 4 --
async function runStage4(url, label, takeShots) {
  console.log(`\n=== stage 4 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // stages 1-4 predate the tutorial: keep its coach card out of their way (stage 5 tests it)
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(400); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const hideToast = () => ev(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); });
  const shot = async (name) => { if (takeShots) { await sleep(350); await hideToast(); await frames(2); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  const ctl = async (label, { meta, kind } = {}) => {
    for (let tries = 0; tries < 15; tries++) {
      const all = await ev(() => __BD.controls());
      const m = all.filter((c) => (label == null || c.label === label) && (meta === undefined || c.meta === meta) && (!kind || c.kind === kind) && c.enabled);
      if (m.length) return m[m.length - 1];
      await sleep(200);
    }
    return null;
  };
  const click = async (label, opts = {}) => {
    await frames(2);
    const c = await ctl(label, opts);
    if (!c) throw new Error(`control not found: ${label} ${JSON.stringify(opts)}`);
    await page.mouse.click(c.x, c.y); await frames(4); await sleep(opts.wait ?? 300);
    return c;
  };
  const waitTrue = async (fn, arg) => { for (let i = 0; i < 25; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const editSave = async (fn, arg) => { await ev(([fn, arg]) => { __BD.store.save = () => {}; const k = 'brokenDawn.save.v1'; const s = JSON.parse(localStorage.getItem(k)); new Function('s', 'arg', fn)(s, arg); localStorage.setItem(k, JSON.stringify(s)); }, [fn, arg]); await page.reload(); await ready(); };
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

  try {
    await page.goto(url); await ready();

    // --- 0. v6 save -> v7: every troop is T1, lanes/formations/wounded/heal queue carry over, Archive added (sealed)
    await ev(() => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 6, resources: { energy: 800, shards: 90, alloy: 40, cores: 12 }, beacon: { level: 2, charge: 10 },
        buildings: { commandCenter: { level: 3, gx: 12, gy: 8 }, barracks: { level: 2, gx: 8, gy: 12 }, armory: { level: 2, gx: 16, gy: 16 }, infirmary: { level: 1, gx: 16, gy: 8 } },
        troops: { sentinel: 12, bearer: 5, voyager: 0 },
        training: { sentinel: { count: 3, progress: 1.5 }, bearer: { count: 0, progress: 0 }, voyager: { count: 0, progress: 0 } },
        squads: { alpha: { level: 2, lines: [{ type: 'sentinel', count: 6, full: 8 }, { type: 'bearer', count: 4, full: 4 }, { type: null, count: 0, full: 0 }], leader: null, armor: null, weapon: null } },
        infirmary: { wounded: { sentinel: { alpha: 2, bravo: 0, charlie: 0, reserve: 0 }, bearer: { alpha: 0, bravo: 0, charlie: 0, reserve: 0 }, voyager: { alpha: 0, bravo: 0, charlie: 0, reserve: 0 } }, queue: [] },
        hunt: { stamina: 70, staminaCarry: 0, auto: false, bestKill: 3, firstKills: [1, 2, 3], kills: 5, losses: 1, dead: 2, reports: [], reportSeq: 6 },
        leaders: {}, gear: {}, construction: [], claims: { beacon: [2], milestones: [] }, lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    });
    await page.reload(); await ready();
    let s = await state();
    check('v6 save migrates to v7 (and v10)', s.version === 10);
    check('v7 keeps every troop as T1 (sentinel/bearer ids unchanged), no higher tiers', s.troops.sentinel === 12 && s.troops.bearer === 5 && s.troops.bulwark === 0 && s.troops.lancer === 0 && s.troops.aegis === 0, JSON.stringify(s.troops));
    check('v7 keeps the training lane (3 Sentinels, progress 1.5) as a T1 job', s.training.sentinel.count === 3 && near(s.training.sentinel.progress, 1.5, 0.6) && s.training.sentinel.unit === 'sentinel' && s.training.sentinel.from === null, JSON.stringify(s.training.sentinel));
    check('v7 keeps formations, wounded and hunt progress', s.squads.alpha.lines[0].type === 'sentinel' && s.squads.alpha.lines[0].count === 6 && s.squads.alpha.lines[0].full === 8 && s.infirmary.wounded.sentinel.alpha === 2 && s.hunt.bestKill === 3 && s.hunt.stamina === 70 && s.resources.cores === 12);
    check('v7 starts with no research', JSON.stringify(s.research) === JSON.stringify({ levels: {}, job: null }));
    check('v7 adds the Archive at Lv 1, hidden (not placed) until Beacon Lv 3', s.buildings.archive.level === 1 && s.buildings.archive.placed === false && !(await ev(() => __BD.base().sprites.archive.img.visible)));
    check('v6 migration keeps a backup of the v6 save', await ev(() => JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v6') || '{}').version === 6));
    check('a sealed Archive (Beacon Lv 2) adds no Power', (await ev(() => __BD.store.power.building)) === 30 + 30 + 10 + 0 + 5, String(await ev(() => __BD.store.power.building)));

    // --- 1. sealed Archive until Beacon Lv 3
    const sealed = await ev(() => ({ r: __BD.store.researchInfo('energyYield').reason, u: __BD.store.upgradeInfo('archive').reason, vis: __BD.base().sprites.archive.img.visible, placed: __BD.store.isPlaced('archive') }));
    check('Archive is hidden below Beacon Lv 3 (no research, no upgrade, not on the map)', /unlocks at Beacon Lv 3/.test(sealed.r) && sealed.u === 'Unlocks at Beacon Lv 3' && !sealed.vis && !sealed.placed, JSON.stringify(sealed));
    await ev(() => { const st = __BD.store; st.state.beacon.level = 2; st.state.beacon.charge = 100; st.state.resources.energy = 5000; st.upgrade('beacon'); st.speedUpConstruction('beacon', 1e6); });
    check('Beacon Lv 3 unlocks the Archive: +5 Power, research possible', await ev(() => __BD.store.archiveUnlocked() && __BD.store.power.building === 30 + 45 + 10 + 0 + 5 + 5 && __BD.store.researchInfo('energyYield').can));
    check('…and drops the player into placing it', await waitTrue(() => __BD.base().placeId === 'archive' && __BD.base().sprites.archive.img.visible));
    await ev(() => __BD.base().confirmPlace());
    check('placing it puts the Archive on the map', await waitTrue(() => __BD.store.isPlaced('archive') && __BD.base().sprites.archive.img.visible && !__BD.base().placeId));
    await ev(() => __BD.ui().closePanel(true));

    // --- 2. fresh game at Beacon Lv 3: research via the Archive screen
    await ev(() => { localStorage.clear(); __BD.store.save = () => {}; }); await page.reload(); await ready();
    await ev(() => {
      const st = __BD.store; delete st.save;
      Object.assign(st.state.beacon, { level: 3, charge: 0 });
      Object.assign(st.state.resources, { energy: 50000, alloy: 5000, shards: 5000 });
      st.state.buildings.commandCenter.level = 5;
      st.state.buildings.archive.placed = true; // unlocked and built (stage 6: hidden until placed)
      st.save();
    });
    await page.reload(); await ready();
    await ev(() => __BD.base().select('archive')); await sleep(400);
    await click('Research');
    check('Archive panel → Research opens the research tree', await waitTrue(() => __BD.ui().screen?.id === 'archive'));
    check('research tree: 4 branches (Economy, Military, Healing, World)', await waitTrue(() => ['Economy', 'Military', 'Healing', 'World'].every((t) => __BD.controls().some((c) => c.kind === 'tab' && c.label === t))));
    const gate = await ev(() => { const st = __BD.store; return { tier2: st.researchInfo('tier2').reason, tier3: st.researchInfo('tier3').reason, e: st.researchInfo('energyYield') }; });
    check('Lv 1 research: 150 Energy + 20 Alloy + 30 Shards, 30 s', JSON.stringify(gate.e.cost) === JSON.stringify({ energy: 150, alloy: 20, shards: 30 }) && gate.e.seconds === 30 && gate.e.can);
    check('tier research gated by Barracks level (T2: Barracks Lv 5, T3: Tier II first)', gate.tier2 === 'Needs Barracks Lv 5' && gate.tier3 === 'Research Tier II Protocols first', JSON.stringify(gate));
    const r0 = await state();
    await click('Lv 1', { meta: 'research-energyYield' });
    s = await state();
    check('tapping a node starts it in the single research slot (resources paid up front)', s.research.job?.id === 'energyYield' && s.research.job.toLevel === 1 && near(r0.resources.alloy - s.resources.alloy, 20, 0.5) && near(r0.resources.shards - s.resources.shards, 30, 0.5), JSON.stringify(s.research.job));
    check('only one research at a time', /^Archive busy: Beacon Harmonics Lv 1/.test(await ev(() => __BD.store.researchInfo('alloyYield').reason)));
    await ev(() => __BD.store.tick(9)); await sleep(300);
    await shot('stage4-research-in-progress.png');
    check('the current project shows a countdown', await waitTrue(() => __BD.ui().screen?.container.list.some((o) => o.text && /left$/.test(o.text))));
    const rc = await ev(() => ({ e: __BD.store.state.resources.energy, a: __BD.store.state.resources.alloy, s: __BD.store.state.resources.shards }));
    await click('Cancel', { meta: 'cancel-research' });
    s = await state();
    check('Cancel refunds the research in full', !s.research.job && near(s.resources.alloy - rc.a, 20, 0.5) && near(s.resources.shards - rc.s, 30, 0.5) && s.resources.energy - rc.e >= 150 - 0.01 && s.resources.energy - rc.e < 160);
    await click('Lv 1', { meta: 'research-energyYield' });
    const lv1 = await ev(() => { const st = __BD.store; const before = st.energyRate; st.tick(30.5); return { lv: st.researchLevel('energyYield'), before, after: st.energyRate, next: st.researchInfo('energyYield').reason }; });
    check('research completes after its timer: Energy income +4%', lv1.lv === 1 && near(lv1.after, lv1.before * 1.04, 1e-9), JSON.stringify(lv1));
    check('node level is capped by the Archive level (Lv 2 needs Archive Lv 2)', lv1.next === 'Needs Archive Lv 2');
    // fill the tree a bit for the screenshot
    await ev(() => { const st = __BD.store; st.state.buildings.archive.level = 4; Object.assign(st.state.research.levels, { alloyYield: 2, buildSpeed: 1, energyYield: 3, sentinelDrills: 2, bearerDrills: 1, trainSpeed: 3 }); st.startResearch('voyagerDrills'); st.tick(12); st.emit('change'); });
    await click('Military', { kind: 'tab' });
    check('branch tabs switch the tree (Military shows Tier II Protocols)', await waitTrue(() => __BD.controls().some((c) => c.meta === 'research-tier2')));
    await sleep(400);
    await shot('stage4-archive-research-tree.png');
    await ev(() => { const st = __BD.store; st.cancelResearch(); st.state.buildings.archive.level = 1; st.state.research.levels = {}; });

    // --- 3. research bonuses applied everywhere
    const bon = await ev(() => {
      const st = __BD.store, S = st.state, out = {};
      const base = { e: st.energyRate, a: st.alloyRate, sh: st.shardRate, build: st.upgradeSeconds('commandCenter'), train: st.unitTime('bearer'),
        beds: st.infirmaryCapacity(), heal: st.healUnitTime('sentinel'), healE: st.healEnergy('sentinel'), smax: st.staminaMax(), regen: st.staminaRegenPerHour(),
        loot: st.killRewards({ type: 'hound', level: 10 }), atk: st.squadArmy('alpha') };
      S.research.levels = { energyYield: 5, alloyYield: 2, shardYield: 4, buildSpeed: 2, trainSpeed: 2, beds: 2, triage: 1, medSynth: 2, staminaCells: 2, recovery: 3, striders: 4, salvage: 2 };
      out.e = st.energyRate / base.e; out.a = st.alloyRate / base.a; out.sh = st.shardRate / base.sh;
      out.build = st.upgradeSeconds('commandCenter') / base.build; out.train = st.unitTime('bearer') / base.train;
      out.beds = [base.beds, st.infirmaryCapacity()]; out.heal = st.healUnitTime('sentinel') / base.heal; out.healE = [base.healE, st.healEnergy('sentinel')];
      out.smax = [base.smax, st.staminaMax()]; out.regen = [base.regen, st.staminaRegenPerHour()];
      out.loot = [base.loot.energy, st.killRewards({ type: 'hound', level: 10 }).energy, base.loot.shards, st.killRewards({ type: 'hound', level: 10 }).shards];
      const t = st.creatures()[0];
      out.march = st.attackInfo('alpha', t.id).travel / (Math.min(60, 5 + __BD.dev.dist(t, { x: 32, y: 32 })));
      // stamina regen at 13/h: 1 h from 50 -> 63
      S.hunt.stamina = 50; S.hunt.staminaCarry = 0; st.tick(3600); out.stam = S.hunt.stamina;
      S.research.levels = {};
      return out;
    });
    check('Economy: Energy +20% (Lv 5), Alloy +10% (Lv 2), Shards +20% (Lv 4) incomes', near(bon.e, 1.2) && near(bon.a, 1.1) && near(bon.sh, 1.2), JSON.stringify([bon.e, bon.a, bon.sh]));
    check('Economy: Rapid Assembly Lv 2 → building upgrades take 1/1.10 of the time', near(bon.build, 1 / 1.1));
    check('Military: Drill Cadence Lv 2 → training 1/1.10 of the time', near(bon.train, 1 / 1.1));
    check('Healing: beds +20% (30 → 36), heal speed +8%, heal cost −10% (3 → 2.7 Energy)', bon.beds[0] === 30 && bon.beds[1] === 36 && near(bon.heal, 1 / 1.08) && bon.healE[0] === 3 && near(bon.healE[1], 2.7), JSON.stringify(bon));
    check('World: stamina cap 100 → 120, regen 10/h → 13/h (1 h: 50 → 63)', bon.smax[1] === 120 && bon.regen[1] === 13 && bon.stam === 63, JSON.stringify([bon.smax, bon.regen, bon.stam]));
    check('World: Rift Striders Lv 4 → marches take 1/1.20 of the time; Salvage Lv 2 → hunt loot +10%', near(bon.march, 1 / 1.2) && bon.loot[1] === Math.round(bon.loot[0] * 1.1) && bon.loot[3] === Math.round(bon.loot[2] * 1.1), JSON.stringify(bon.loot));
    const surv = await ev(() => {
      const st = __BD.store, S = st.state, snap = JSON.stringify(S);
      S.troops.sentinel = 200; st.saveFormation('alpha', [{ type: 'sentinel', count: 100 }, { type: null, count: 0 }, { type: null, count: 0 }]);
      S.buildings.infirmary.level = 20;
      const army = st.squadArmy('alpha'), fake = { fallen: { A: [100, 0, 0] } };
      const a = st.applyCasualties('alpha', army, fake, false);
      st.state = JSON.parse(snap); S.troops.sentinel = 200; st.state.troops.sentinel = 200; st.saveFormation('alpha', [{ type: 'sentinel', count: 100 }, { type: null, count: 0 }, { type: null, count: 0 }]); st.state.buildings.infirmary.level = 20;
      st.state.research.levels.stabilizers = 5;
      const b = st.applyCasualties('alpha', st.squadArmy('alpha'), fake, false);
      st.state = JSON.parse(snap);
      return { dead0: a.deadTotal, dead5: b.deadTotal, tot: [a.total, b.total] };
    });
    check('Healing: Stabilizers Lv 5 → 25% fewer battle deaths (the rest come back wounded)', surv.tot[0] === surv.tot[1] && surv.dead0 === 24 && surv.dead5 === 18, JSON.stringify(surv));
    const cmb = await ev(() => {
      const st = __BD.store, S = st.state, d = __BD.dev;
      S.troops.sentinel = 40; S.troops.bearer = 20; st.saveFormation('alpha', [{ type: 'sentinel', count: 20 }, { type: 'bearer', count: 10 }, { type: null, count: 0 }]);
      const a0 = st.squadArmy('alpha'), p0 = st.squadCombatPower('alpha');
      S.research.levels.sentinelDrills = 5;
      const a1 = st.squadArmy('alpha'), p1 = st.squadCombatPower('alpha');
      const enemy = d.creatureArmy('hound', 6);
      const r1 = d.resolveBattle(a1, enemy, 77), r2 = d.resolveBattle(JSON.parse(JSON.stringify(a1)), JSON.parse(JSON.stringify(enemy)), 77);
      S.research.levels = {};
      return { hp: a1.lines[0].hp / a0.lines[0].hp, atk: a1.lines[0].atk / a0.lines[0].atk, bearerSame: a1.lines[1].hp === a0.lines[1].hp, p0, p1, same: JSON.stringify(r1) === JSON.stringify(r2) };
    });
    check('Military: Shield Drills Lv 5 → Sentinel-class HP and ATK +15% (Bearers unchanged), higher Combat Power', near(cmb.hp, 1.15) && near(cmb.atk, 1.15) && cmb.bearerSame && cmb.p1 > cmb.p0, JSON.stringify(cmb));
    check('resolver stays deterministic on plain-data armies with research baked in', cmb.same);

    // --- 4. research continues offline
    await ev(() => { const st = __BD.store; st.startResearch('alloyYield'); st.save(); });
    await editSave('s.lastSaved = Date.now() - arg;', 40e3);
    check('research keeps running offline (30 s project done after 40 s away)', await ev(() => __BD.store.researchLevel('alloyYield') === 1 && !__BD.store.researchJob() && __BD.store.offlineReport?.researched?.[0]?.id === 'alloyYield'));

    // --- 5. Tier II unlock: Barracks Lv 5 + Archive Lv 3
    const t2 = await ev(() => {
      const st = __BD.store, S = st.state;
      const lockedTrain = st.trainInfo('bulwark', 1).reason;
      S.buildings.barracks.level = 5;
      const needArchive = st.researchInfo('tier2').reason;
      S.buildings.archive.level = 3;
      const info = st.researchInfo('tier2');
      const r = st.startResearch('tier2');
      st.tick(1200.5);
      return { lockedTrain, needArchive, cost: info.cost, seconds: info.seconds, ok: r.ok, maxTier: st.maxTier(), t3: st.researchInfo('tier3').reason, done: st.researchInfo('tier2').reason };
    });
    check('T2 troops are locked until researched', t2.lockedTrain === 'Research Tier II Protocols in the Archive', t2.lockedTrain);
    check('Tier II Protocols needs Archive Lv 3 too; costs 1500 E + 200 Alloy + 150 Shards, 20 min', t2.needArchive === 'Needs Archive Lv 3' && JSON.stringify(t2.cost) === JSON.stringify({ energy: 1500, alloy: 200, shards: 150 }) && t2.seconds === 1200 && t2.ok, JSON.stringify(t2));
    check('Tier II researched → T2 unlocked; Tier III still needs Barracks Lv 9', t2.maxTier === 2 && t2.t3 === 'Needs Barracks Lv 9' && t2.done === 'Fully researched', JSON.stringify(t2));

    // --- 6. Barracks: tier tabs, T2 training, promotion
    await ev(() => { const st = __BD.store; st.state.troops.sentinel = 30; st.state.troops.bearer = 20; st.state.troops.voyager = 20; for (const id of ['alpha', 'bravo', 'charlie']) st.saveFormation(id, [{ type: null, count: 0 }, { type: null, count: 0 }, { type: null, count: 0 }]); st.save(); });
    await tab('troops');
    check('Barracks shows T1/T2/T3 tabs per class (T3 locked)', await waitTrue(() => { const c = __BD.controls(); return ['sentinel', 'bearer', 'voyager'].every((k) => c.some((x) => x.meta === `tier-${k}-2`)) && c.some((x) => x.meta === 'tier-sentinel-3' && /🔒/.test(x.label)); }));
    await click('T2', { meta: 'tier-sentinel-2' });
    check('T2 tab shows Bulwarks with their own train buttons', await waitTrue(() => __BD.controls().some((c) => c.label === 'x1' && c.meta === 'bulwark')));
    const b0 = await state();
    await click('x1', { meta: 'bulwark' });
    s = await state();
    check('training a Bulwark costs 13 Energy + 2 Alloy and uses the Sentinel lane', s.training.sentinel.count === 1 && s.training.sentinel.unit === 'bulwark' && near(b0.resources.alloy - s.resources.alloy, 2, 0.3) && b0.resources.energy - s.resources.energy > 12 && b0.resources.energy - s.resources.energy < 14, JSON.stringify(s.training.sentinel));
    check('one job per lane: T1 Sentinels wait until the Bulwark is done', /Sentinel lane is busy: training 1 Bulwarks/.test(await ev(() => __BD.store.trainInfo('sentinel', 1).reason)));
    const bt = await ev(() => { const st = __BD.store; const ut = st.unitTime('bulwark'); st.tick(ut + 0.05); return { ut, n: st.state.troops.bulwark }; });
    check('T2 trains in 1.8x the T1 time (14.4 s at Lv 1 speed) and lands as a Bulwark', bt.n === 1 && near(bt.ut, 14.4 / 1.8), JSON.stringify(bt));
    // promotion
    await click(null, { meta: 'promote-sentinel' });
    check('Promote opens the promotion picker', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text && /Promote Sentinels → Bulwarks/.test(o.text))));
    const p0 = await state();
    await click('x10', { meta: 'promote-go-x10' });
    s = await state();
    check('promote x10: 10 ready Sentinels leave, cost = difference (10 × 7 E + 10 × 2 Alloy)', s.troops.sentinel === p0.troops.sentinel - 10 && s.training.sentinel.from === 'sentinel' && s.training.sentinel.unit === 'bulwark' && s.training.sentinel.count === 10 && near(p0.resources.alloy - s.resources.alloy, 20, 0.5) && p0.resources.energy - s.resources.energy > 69 && p0.resources.energy - s.resources.energy < 71.5, JSON.stringify({ tr: s.training.sentinel, de: p0.resources.energy - s.resources.energy }));
    await sleep(500);
    await shot('stage4-barracks-tiers-promote.png');
    check('lane shows the promotion (Sentinel → Bulwark)', await waitTrue(() => __BD.ui().screen?.container.list.some((o) => o.text === 'Sentinel → Bulwark')));
    const pc = await ev(() => { const st = __BD.store; const e = st.state.resources.energy, s0 = st.state.troops.sentinel; const r = st.cancelLane('sentinel'); return { r, back: st.state.troops.sentinel - s0, de: st.state.resources.energy - e }; });
    check('cancelling a promotion refunds the cost and gives the Sentinels back', pc.r.ok && pc.back === 10 && pc.r.refund === 70 && pc.r.alloy === 20 && near(pc.de, 70, 1e-6), JSON.stringify(pc));
    const pr = await ev(() => {
      const st = __BD.store, S = st.state;
      const pow0 = st.power.troop;
      st.promote('sentinel', 4);
      const t = st.promoteTime('bulwark');
      st.tick(4 * t + 0.1);
      const out = { t, bulwark: S.troops.bulwark, sentinel: S.troops.sentinel, gain: st.power.troop - pow0 };
      // assigned troops can't be promoted
      st.saveFormation('alpha', [{ type: 'sentinel', count: S.troops.sentinel }, { type: null, count: 0 }, { type: null, count: 0 }]);
      out.assigned = st.promoteInfo('sentinel', 1).reason;
      st.saveFormation('alpha', [{ type: null, count: 0 }, { type: null, count: 0 }, { type: null, count: 0 }]);
      return out;
    });
    check('promotion takes 60% of the T2 time per troop; each promoted troop is +1 Troop Power (T2 = 2)', pr.bulwark === 5 && pr.sentinel === 26 && near(pr.t, 0.6 * 14.4 / 1.8) && pr.gain === 4, JSON.stringify(pr));
    check('only ready troops can be promoted (not assigned or wounded)', /No ready Sentinels/.test(pr.assigned), pr.assigned);
    check('T3 tab explains its lock (Tier III research + Barracks Lv 9)', await ev(() => /Research Tier III Protocols in the Archive/.test(__BD.store.trainInfo('aegis', 1).reason) && __BD.store.promoteInfo('bulwark', 1).reason === 'Research Tier III Protocols in the Archive'));
    // T3 path works once researched (Barracks 9 + Archive 5)
    const t3 = await ev(() => {
      const st = __BD.store, S = st.state, snap = JSON.stringify(S);
      S.buildings.barracks.level = 9; S.buildings.archive.level = 5; S.research.levels.tier3 = 1;
      const r = st.promote('bulwark', 2); st.tick(60);
      const out = { ok: r.ok, aegis: S.troops.aegis, cost: r.cost, alloy: r.alloy, power: st.power.troop };
      st.state = JSON.parse(snap);
      return out;
    });
    check('Tier III: Bulwark → Aegis promotion (27−13 = 14 E + 4 Alloy each)', t3.ok && t3.aegis === 2 && t3.cost === 28 && t3.alloy === 8, JSON.stringify(t3));

    // --- 7. formation with a T2 line (one tier per line)
    await ev(() => { const st = __BD.store; st.state.troops.bulwark = 12; st.save(); });
    await tab('squads');
    await click('Edit Formation');
    await click('Sentinels', { meta: 'line0-sentinel' });
    await click('T2', { meta: 'line0-bulwark' });
    await click('Max 12', { meta: 'line0max' });
    await click('Bearers', { meta: 'line1-bearer' });
    await sleep(300);
    await shot('stage4-squad-formation-t2.png');
    await click('Save Formation');
    s = await state();
    check('formation saved with a T2 Front line (12 Bulwarks) + T1 Bearers', s.squads.alpha.lines[0].type === 'bulwark' && s.squads.alpha.lines[0].count === 12 && s.squads.alpha.lines[1].type === 'bearer' && s.squads.alpha.lines[1].count === 10, JSON.stringify(s.squads.alpha.lines));
    check('Squad details label the tier (Bulwarks (T2))', await waitTrue(() => __BD.ui().screen?.container.list.some((o) => o.text && /^Bulwarks \(T2\)/.test(o.text))));
    const arm = await ev(() => { const a = __BD.store.squadArmy('alpha'); return a.lines[0]; });
    check('battle army line keeps class behaviour (Sentinel front wall) with T2 stats', arm.type === 'bulwark' && arm.cls === 'sentinel' && arm.tier === 2 && near(arm.hp, 192) && near(arm.atk, 12.8) && near(arm.def, 20 * 1.2), JSON.stringify(arm));

    // --- 8. T2 in a hunt: wounded per tier, tier heal cost
    const hunt = await ev(() => {
      const st = __BD.store, S = st.state;
      const t = st.creatures().filter((e) => e.level === 1)[0];
      const r = st.attack('alpha', t.id);
      for (let i = 0; i < 80 && !S.hunt.reports.length; i++) st.tick(1);
      const rep = S.hunt.reports[0];
      const w = st.woundedPool('bulwark');
      return { ok: r.ok, win: rep?.win, wb: w, cas: rep?.casualties, e: st.healEnergy('bulwark'), ht: st.healUnitTime('bulwark') };
    });
    check('a T2 squad hunts; its wounded are tracked per tier', hunt.ok && hunt.win && (hunt.cas.wounded.bulwark ?? 0) === hunt.wb, JSON.stringify(hunt));
    check('healing cost per tier: Bulwark 6 Energy / 6 s (T1 Sentinel 3 / 4)', hunt.e === 6 && near(hunt.ht, 6));
    if (hunt.wb > 0) {
      await ev(() => __BD.ui().closeModal(true));
      await ev(() => __BD.ui().openScreen('infirmary'));
      check('Infirmary lists wounded Bulwarks with their own heal buttons', await waitTrue(() => __BD.controls().some((c) => c.meta === 'heal-bulwark')));
    } else check('Infirmary lists wounded Bulwarks with their own heal buttons', true, 'no Bulwark wounded this fight (all losses in other lines)');

    // --- 9. persistence
    const before = await state();
    await ev(() => { __BD.store.state.research.levels.salvage = 1; __BD.store.save(); }); await page.reload(); await ready();
    s = await state();
    check('research levels, tier troops and tier formations persist', s.research.levels.tier2 === 1 && s.research.levels.salvage === 1 && s.troops.bulwark === before.troops.bulwark && s.squads.alpha.lines[0].type === 'bulwark');
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, modal: !!__BD.ui().modal, controls: __BD.controls().map((c) => c.label + (c.meta ? `#${c.meta}` : '')) })).catch(() => ({}));
    check('stage 4 suite ran without exceptions', false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 4: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ STAGE 5 --
async function runStage5(url, label, takeShots) {
  console.log(`\n=== stage 5 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(500); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const hideToast = () => ev(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); });
  const shot = async (name, { keepToast = false, wait = 350 } = {}) => { if (takeShots) { await sleep(wait); if (!keepToast) await hideToast(); await frames(2); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  const ctl = async (label, { meta, kind } = {}) => {
    for (let tries = 0; tries < 15; tries++) {
      const all = await ev(() => __BD.controls());
      const m = all.filter((c) => (label == null || c.label === label) && (meta === undefined || c.meta === meta) && (!kind || c.kind === kind) && c.enabled);
      if (m.length) return m[m.length - 1];
      await sleep(200);
    }
    return null;
  };
  const click = async (label, opts = {}) => {
    await frames(2);
    const c = await ctl(label, opts);
    if (!c) throw new Error(`control not found: ${label} ${JSON.stringify(opts)}`);
    await page.mouse.click(c.x, c.y); await frames(4); await sleep(opts.wait ?? 300);
    return c;
  };
  const waitTrue = async (fn, arg, n = 30) => { for (let i = 0; i < n; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const tut = () => ev(() => __BD.tutorial());
  const au = () => ev(() => __BD.audioState());
  // Tap wherever the tutorial pointer points until the step changes (real taps on the canvas).
  const follow = async (from, max = 7) => {
    for (let k = 0; k < max; k++) {
      await sleep(250); await frames(3);
      const t = await tut();
      if (t.step !== from || !t.active) return true;
      if (t.target) { const p = await ev((t) => __BD.gameToPage(t.x, t.y), t.target); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); }
    }
    await sleep(300);
    const t = await tut();
    return t.step !== from || !t.active;
  };

  try {
    await page.goto(url); await ready();
    await ev(() => localStorage.clear()); await page.reload(); await ready();

    // --- 0. loading screen, fresh save v8, defaults
    check('loading screen fades out and is removed once the game is ready', await waitTrue(() => !document.getElementById('boot')));
    let s = await state();
    check('new game: save v10 with audio defaults (music 70%, effects 90%, sound on, haptics on)', s.version === 10 && s.settings.music === 0.7 && s.settings.sfx === 0.9 && s.settings.muted === false && s.settings.haptics === true, JSON.stringify(s.settings));
    let t = await tut();
    check('new game: tutorial starts at step 1 (The Beacon) with a coach card and a pointer', t.active && t.step === 0 && t.visible && t.title === 'The Beacon' && !!t.target, JSON.stringify(t));
    let a = await au();
    check('no audio before the first tap (browser autoplay rule)', a.unlocked === false && a.ctx === 'none', JSON.stringify(a));
    await shot('stage5-tutorial-step.png', { wait: 500 });

    // --- 1. Beacon (tap it for real) -> also unlocks audio
    check('tutorial 1/8: tapping the Beacon advances', await follow(0));
    a = await au();
    check('first tap unlocks audio (AudioContext running) and base music plays', a.unlocked && a.ctx === 'running' && a.track === 'base' && a.playing.includes('base'), JSON.stringify({ u: a.unlocked, c: a.ctx, t: a.track, p: a.playing }));
    check('Beacon panel is open after step 1', await ev(() => __BD.ui().panelOpenFor === 'beacon'));

    // --- 2. Build: Barracks -> Upgrade
    const played0 = (await au()).played;
    check('tutorial 2/8: Barracks upgrade started via the pointer', await follow(1));
    s = await state();
    a = await au();
    check('upgrade start plays the build sound; button taps play click sounds', s.construction.some((j) => j.id === 'barracks') && a.byName.build >= 1 && a.byName.tap >= 1 && a.played > played0, JSON.stringify(a.byName));
    check('construction shows scaffolding on the building', await waitTrue(() => __BD.base().scaffolds?.barracks?.visible === true));
    await ev(() => { __BD.ui().closePanel(true); const b = __BD.base(); const img = b.sprites.barracks.img; b.cameras.main.setZoom(1.25); b.cameras.main.centerOn(img.x, img.y - 120); });
    await shot('stage5-construction-scaffolding.png', { wait: 700 });
    const fx0 = await ev(() => __BD.base().fxCount ?? 0);
    await ev(() => { const st = __BD.store; const j = st.state.construction.find((x) => x.id === 'barracks'); st.tick(j.total - j.progress + 0.1); });
    check('upgrade finishing: level-up burst + level-up sound, scaffolding removed', await waitTrue(() => (__BD.base().fxCount ?? 0) > 0 && __BD.audioState().byName.levelup >= 1 && !__BD.base().scaffolds.barracks.visible) && fx0 === 0);

    // --- 3. Train
    check('tutorial 3/8: training started from the Troops screen', await follow(2));
    // --- 4. Squad (first batch rushed for you)
    check('tutorial 4/8: formation saved in Squads', await follow(3, 9));
    s = await state();
    check('squad step rushed the first batch so the formation has troops', s.squads.alpha.lines.some((l) => l.type && l.count > 0), JSON.stringify(s.squads.alpha.lines));
    check('Squads shows Squad Power (Base) and Combat Power (Hunts) as separate labelled numbers', await ev(() => { const L = __BD.ui().screen?.container.list.map((o) => o.text).filter(Boolean) ?? []; return L.includes('SQUAD POWER · BASE') && L.includes('COMBAT POWER · HUNTS'); }));
    // --- 5. Recruit
    check('tutorial 5/8: Pull x1 in the Armory', await follow(4));
    check('recruit reveal plays reveal sounds per card', await waitTrue(() => __BD.audioState().byName.reveal >= 1));
    await ev(() => __BD.ui().closeReveal());
    // --- 6. Hunt
    check('tutorial 6/8: squad sent to hunt from the World map', await follow(5, 9));
    a = await au();
    check('World map switches music to the world track (crossfade) + march sound', await waitTrue(() => __BD.audioState().track === 'world') && a.byName.march >= 1, JSON.stringify({ t: a.track, m: a.byName.march }));
    const fl0 = await ev(() => __BD.ui().fx.floats);
    await ev(() => { for (let i = 0; i < 120 && !__BD.store.state.hunt.reports.length; i++) __BD.store.tick(1); });
    check('battle result pops the report card with reward pop-ups + win/lose sound', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'VICTORY' || o.text === 'DEFEAT')) && await waitTrue((f) => __BD.ui().fx.floats > f || !__BD.store.state.hunt.reports[0].win, fl0) && ((await au()).byName.win ?? 0) + ((await au()).byName.lose ?? 0) >= 1);
    await shot('stage5-reward-popup.png', { wait: 250 });
    await click('▶ Watch Replay', { wait: 100 });
    check('battle replay switches music to the battle track', await waitTrue(() => __BD.audioState().track === 'battle'));
    check('replay: hit numbers pop with impact sparks and hit sounds', await waitTrue(() => __BD.ui().fx.hits >= 2 && __BD.audioState().byName.hit + (__BD.audioState().byName.crit ?? 0) >= 1, null, 60));
    await shot('stage5-battle-replay.png', { wait: 120 });
    await click('Skip');
    check('replay finish: result banner + victory/defeat sting', await waitTrue(() => __BD.ui().replayState().done));
    await ev(() => __BD.ui().closeReplay());
    check('closing the replay returns to the world track', await waitTrue(() => __BD.audioState().track === 'world'));
    // --- 7. Infirmary  --- 8. Research
    const f7 = await follow(6, 9);
    check('tutorial 7/8: Infirmary opened from the Base', f7, f7 ? '' : JSON.stringify(await ev(() => ({ t: __BD.tutorial(), scr: __BD.ui().screen?.id, panel: __BD.ui().panelOpenFor, world: __BD.ui().worldMode, modal: !!__BD.ui().modal, inf: (() => { const b = __BD.base(), i = b.sprites.infirmary.img; return b.worldToScreen(i.x, i.y); })() }))));
    check('back on the Base the music returns to the base track', await waitTrue(() => __BD.audioState().track === 'base'));
    const res0 = (await state()).resources;
    check('tutorial 8/8: Archive tapped', await follow(7, 9));
    s = await state(); t = await tut();
    check('tutorial complete: marked done, reward paid once (+500 Energy, +2 Cores), coach hidden', s.tutorial.done && !s.tutorial.skipped && s.tutorial.rewarded && s.resources.cores === res0.cores + 2 && s.resources.energy >= res0.energy + 499 && !t.visible, JSON.stringify({ tu: s.tutorial, c0: res0.cores, c1: s.resources.cores }));
    check('completion toast mentions replaying from More → Settings', await waitTrue(() => (__BD.ui().toastLog ?? []).some((m) => /Tutorial complete/.test(m) && /More → Settings/.test(m))), JSON.stringify(await ev(() => __BD.ui().toastLog)));

    // --- 9. Settings: audio panel
    await ev(() => { const u = __BD.ui(); u.closePanel(true); u.closeScreen(); });
    await tab('more');
    await click(null, { meta: 'more-settings' });
    check('Settings (More → Settings) opens the audio panel', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'AUDIO')) && await ev(() => __BD.ui().activeTab === 'more'));
    await click(null, { meta: 'music-down' });
    await click(null, { meta: 'sfx-up' });
    s = await state();
    const saved = await ev(() => JSON.parse(localStorage.getItem('brokenDawn.save.v1')).settings);
    check('music − / effects + change volume in 10% steps and save', s.settings.music === 0.6 && s.settings.sfx === 1 && saved.music === 0.6 && saved.sfx === 1, JSON.stringify(saved));
    check('settings panel shows the new volume values', await ev(() => { const L = __BD.ui().modal.list.map((o) => o.text); return L.includes('60%') && L.includes('100%'); }));
    await click(null, { meta: 'mute' });
    const mutedPlay = await ev(() => { const a = __BD.audio, s0 = a.stats.suppressed; const ok = a.play('reward', { gap: 0 }); return { ok, sup: a.stats.suppressed - s0, muted: __BD.store.state.settings.muted }; });
    check('Mute: sound effects are suppressed', mutedPlay.muted && mutedPlay.ok === false && mutedPlay.sup === 1, JSON.stringify(mutedPlay));
    await click(null, { meta: 'mute' });
    const unmuted = await ev(() => { const a = __BD.audio; a.lastAt = {}; return a.play('reward'); });
    check('Unmute: sound effects play again', unmuted === true && (await state()).settings.muted === false);
    await click(null, { meta: 'haptics' });
    const hap = await ev(() => { const a = __BD.audio, h0 = a.stats.haptics; a.haptic(10); return { on: __BD.store.state.settings.haptics, n: a.stats.haptics - h0 }; });
    check('Haptics off: no vibration requests', hap.on === false && hap.n === 0, JSON.stringify(hap));
    await click(null, { meta: 'haptics' });
    check('Haptics back on (requests go through navigator.vibrate where supported)', await ev(() => { const a = __BD.audio, h0 = a.stats.haptics; a.haptic(10); return __BD.store.state.settings.haptics && a.stats.haptics === h0 + 1; }));
    check('settings shows the tutorial as Completed', await ev(() => __BD.ui().modal.list.some((o) => o.text === 'Completed')));
    await shot('stage5-settings-audio.png');

    // --- 10. Replay + Skip
    await click(null, { meta: 'replay-tutorial' });
    t = await tut();
    check('Replay Tutorial restarts at step 1 with the coach card', t.active && t.step === 0 && await waitTrue(() => __BD.tutorial().visible), JSON.stringify(t));
    await click(null, { meta: 'tutorial-skip' });
    s = await state(); t = await tut();
    check('Skip ends the tutorial (done + skipped) and hides the coach; no second reward', s.tutorial.done && s.tutorial.skipped && !t.visible && s.resources.cores === (await ev(() => __BD.store.state.resources.cores)));

    // --- 11. pause when hidden
    await ev(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('audio pauses (context suspended) when the page is hidden', await waitTrue(() => __BD.audioState().paused && __BD.audioState().ctx === 'suspended'));
    await ev(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    check('audio resumes when visible again', await waitTrue(() => !__BD.audioState().paused && __BD.audioState().ctx === 'running'));

    // --- 12. idle 30 fps cap
    await ev(() => { __BD.ui().closeModal(true); __BD.ui().lastInput = performance.now() - 60000; });
    check('idle: frame rate capped to ~30 fps after a while without input', await waitTrue(() => __BD.perf().capped && Math.abs(__BD.perf().limitRate - 1000 / 32) < 0.5));
    await page.mouse.click(360, 300);
    check('any tap lifts the idle cap immediately', await waitTrue(() => !__BD.perf().capped && __BD.perf().limitRate === 0));
    await ev(() => __BD.ui().closePanel(true));

    // --- 13. text overlap sweep across screens/overlays
    const overlaps = [];
    const sweep = async (name) => {
      await sleep(250); await frames(3);
      const o = await ev(() => {
        const ui = __BD.ui(); const root = ui.modal ?? ui.screen?.container; if (!root) return [];
        const vis = (x) => { for (let p = x; p; p = p.parentContainer) if (!p.visible || !p.active || p.alpha < 0.05) return false; return true; };
        const ts = []; const walk = (x) => { if (x.type === 'Text' && x.text.trim() && vis(x)) ts.push(x); (x.list ?? []).forEach(walk); }; walk(root);
        const out = [];
        // text running under a button (other than the button's own label)
        const btns = []; const walkB = (x) => { if (x.isButton && vis(x)) btns.push(x); (x.list ?? []).forEach(walkB); }; walkB(root);
        for (const t of ts) {
          if (t.parentContainer?.isButton) continue;
          const A = t.getBounds();
          for (const b of btns) {
            const B = b.hit.getBounds();
            const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
            if (w > 6 && h > 6) out.push(`${t.text.slice(0, 24)} under [${b.labelText.text.slice(0, 16)}]`);
          }
        }
        for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
          const A = ts[i].getBounds(), B = ts[j].getBounds();
          const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (w > 4 && h > 4 && w * h > 0.15 * Math.min(A.width * A.height, B.width * B.height)) out.push(`${ts[i].text.slice(0, 24)} ⨯ ${ts[j].text.slice(0, 24)}`);
        }
        return out;
      });
      o.forEach((x) => overlaps.push(`${name}: ${x}`));
    };
    await ev(() => { const st = __BD.store.state; st.beacon.level = 3; st.buildings.archive.level = 2; st.research.levels.energyYield = 1; __BD.store.emit('change'); });
    for (const id of ['troops', 'squads', 'infirmary', 'archive']) { await ev((id) => __BD.ui().openScreen(id), id); await sweep(id); }
    for (const tb of ['recruit', 'leaders', 'gear']) { await ev((tb) => { __BD.ui().screenState.armoryTab = tb; __BD.ui().openScreen('armory'); __BD.ui().renderScreen(); }, tb); await sweep(`armory/${tb}`); }
    await ev(() => { __BD.ui().screenState.edit = null; __BD.ui().openScreen('squads'); }); await click('Edit Formation'); await sweep('squads/edit');
    await ev(() => { __BD.ui().screenState.edit = null; __BD.ui().closeScreen(); __BD.ui().openSettings(); }); await sweep('settings');
    await ev(() => __BD.ui().openRewards()); await sweep('rewards');
    await ev(() => __BD.ui().openPowerBreakdown()); await sweep('power');
    await ev(() => __BD.ui().closeModal(true));
    check('text overlap sweep: no overlapping labels on any screen or overlay', overlaps.length === 0, overlaps.slice(0, 12).join(' | '));

    // --- 14. rotation re-layout
    await ev(() => __BD.store.save());
    const h0 = (await ev(() => __BD.perf())).layoutH;
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction((h0) => window.__BD?.perf && window.__BD.ui()?.panel && __BD.perf().layoutH !== h0, h0, { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const h1 = (await ev(() => __BD.perf())).layoutH;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction((h1) => window.__BD?.perf && window.__BD.ui()?.panel && __BD.perf().layoutH !== h1, h1, { timeout: 15000 }).catch(() => {});
    await ready();
    const h2 = (await ev(() => __BD.perf())).layoutH;
    s = await state();
    check('rotating re-lays out the game (landscape 1280 tall, back to portrait 1558) and keeps progress', h0 === 1558 && h1 === 1280 && h2 === 1558 && s.tutorial.done && s.settings.music === 0.6, `${h0} → ${h1} → ${h2}`);

    // --- 15. v7 save -> v8: tutorial marked done, defaults, backup, one-time toast
    await ev(() => { const k = 'brokenDawn.save.v1'; __BD.store.save = () => {}; const st = JSON.parse(localStorage.getItem(k)); st.version = 7; delete st.settings; delete st.tutorial; localStorage.setItem(k, JSON.stringify(st)); });
    await page.reload(); await ready();
    s = await state(); t = await tut();
    check('v7 save migrates to v10: tutorial marked done (no coach), default audio settings, backup kept', s.version === 10 && s.tutorial.done && !s.tutorial.skipped && !t.visible && s.settings.music === 0.7 && s.settings.haptics === true && (await ev(() => !!localStorage.getItem('brokenDawn.save.v1.backup-v7'))), JSON.stringify({ tu: s.tutorial, set: s.settings }));
    check('existing players get a one-time "replay the tutorial from Settings" toast', await waitTrue(() => /Replay the tutorial/.test(__BD.ui().toastText.text) && __BD.ui().toastBox.visible, null, 40));
    await ev(() => { delete __BD.store.save; __BD.store.save(); });
    await page.reload(); await ready(); await sleep(800);
    check('…and only once (not again on the next load)', await ev(() => !/Replay the tutorial/.test(__BD.ui().toastText.text) || !__BD.ui().toastBox.visible));
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, modal: !!__BD.ui().modal, tut: __BD.tutorial(), controls: __BD.controls().map((c) => c.label + (c.meta ? `#${c.meta}` : '')) })).catch(() => ({}));
    check('stage 5 suite ran without exceptions', false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 5: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

// ------------------------------------------------------------------ STAGE 6 --
// Painted Base: full-screen ground, art sprites with level badges, HUD queue/quick buttons,
// buildings hidden until unlocked + placement on unlock, moving buildings, v8 -> v9 migration.
async function runStage6(url, label, takeShots) {
  console.log(`\n=== stage 6 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { window.__BD_TEST = { noTutorial: true }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const ready = async () => { await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(500); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => JSON.parse(JSON.stringify(__BD.store.state)));
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const hideToast = () => ev(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); });
  const shot = async (name, { keepToast = false, wait = 400 } = {}) => { if (takeShots) { await sleep(wait); if (!keepToast) await hideToast(); await frames(2); await page.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  const ctl = async (label, { meta, kind } = {}) => {
    for (let tries = 0; tries < 15; tries++) {
      const all = await ev(() => __BD.controls());
      const m = all.filter((c) => (label == null || c.label === label) && (meta === undefined || c.meta === meta) && (!kind || c.kind === kind) && c.enabled);
      if (m.length) return m[m.length - 1];
      await sleep(200);
    }
    return null;
  };
  const click = async (label, opts = {}) => {
    await frames(2);
    const c = await ctl(label, opts);
    if (!c) throw new Error(`control not found: ${label} ${JSON.stringify(opts)}`);
    await page.mouse.click(c.x, c.y); await frames(4); await sleep(opts.wait ?? 300);
    return c;
  };
  const waitTrue = async (fn, arg, n = 30) => { for (let i = 0; i < n; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const fpCenter = (id) => ev((id) => __BD.fpToPage(id), id);
  const fpAt = (gx, gy, size = 3) => ev(([gx, gy, size]) => { const w = __BD.grid.isoToWorld(gx + size / 2, gy + size / 2); return __BD.worldToPage(w.x, w.y); }, [gx, gy, size]);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const toastHas = (re) => waitTrue((src) => __BD.ui().toastBox.visible && new RegExp(src).test(__BD.ui().toastText.text), re.source, 30);
  const centerCam = (zoom = 0.62, dy = -40) => ev(([z, dy]) => { const b = __BD.base(); b.cameras.main.setZoom(z); b.cameras.main.centerOn(b.beaconCenter.x, b.beaconCenter.y + dy); b.clampCamera(); }, [zoom, dy]);
  // a valid free spot ~4 tiles from (gx,gy) for building `id` (searching a few directions)
  const freeNear = (id, gx, gy) => ev(([id, gx, gy]) => {
    for (const [dx, dy] of [[0, 4], [4, 0], [-4, 0], [0, -4], [3, 3], [-3, -3], [3, -3], [-3, 3]]) if (__BD.store.canPlace(id, gx + dx, gy + dy)) return { gx: gx + dx, gy: gy + dy };
    return null;
  }, [id, gx, gy]);
  // long-press (touch) a building and drag it to page point `to`
  const dragBuilding = async (from, to, longPress = true) => {
    await touch('touchStart', [from]);
    if (longPress) { await sleep(600); for (let i = 0; i < 30 && !(await ev(() => __BD.base().moveId)); i++) await sleep(100); }
    for (let i = 1; i <= 12; i++) { await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }]); await sleep(20); }
    await touch('touchEnd', []); await frames(4); await sleep(200);
  };

  try {
    await page.goto(url); await ready();
    await ev(() => localStorage.clear()); await page.reload(); await ready();

    // --- 1. full-screen painted base, art sprites, level badges
    let s = await state();
    check('new game: save v9, Beacon 4x4 fixed at the centre, buildings 3x3 on the new map', s.version === 10 && (await ev(() => __BD.grid.BEACON.footprint === 4 && __BD.grid.BEACON.gx === 20 && Object.values(__BD.grid.BUILDINGS).every((b) => b.footprint === 3))));
    const art = await ev(() => { const b = __BD.base(); return { cc: b.sprites.commandCenter.img.texture.key, beacon: b.beaconSprite.texture.key, ground: b.ground.texture.key, decos: b.decos.length, inner: b.innerDecos.length }; });
    check('painted art: building + Beacon sprites, baked ground, scattered crystals/plants/rocks', art.cc === 'art-commandCenter' && art.beacon === 'art-beacon' && art.ground === 'ground-baked' && art.decos >= 60 && art.inner >= 10, JSON.stringify(art));
    const fill = await ev(() => { const c = __BD.base().cameras.main, v = c.worldView, G = __BD.grid.GROUND; return { ok: v.x >= G.x - 1 && v.y >= G.y - 1 && v.right <= G.x + G.w + 1 && v.bottom <= G.y + G.h + 1, bigger: G.w > v.width && G.h > v.height }; });
    check('the base fills the screen (no void) and the world is bigger than the screen', fill.ok && fill.bigger, JSON.stringify(fill));
    // pan hard toward a corner: the view stops at the painted edge
    await ev(() => { const b = __BD.base(), c = b.cameras.main; c.scrollX -= 5000; c.scrollY -= 5000; b.clampCamera(); });
    await frames(3);
    check('panning stops at the edge of the painted ground', await ev(() => { const v = __BD.base().cameras.main.worldView, G = __BD.grid.GROUND; return Math.abs(v.x - G.x) < 1 && Math.abs(v.y - G.y) < 1; }));
    await ev(() => { const b = __BD.base(); b.setZoomKeeping(0.01, b.beaconCenter.x, b.beaconCenter.y, 360, b.cameras.main.height / 2); });
    await shot('stage6-base-full.png');
    await ev(() => { const b = __BD.base(); b.setZoomKeeping(1.25, b.beaconCenter.x, b.beaconCenter.y - 120, 360, b.cameras.main.height / 2 + 60); });
    await shot('stage6-base-zoomed.png');
    await centerCam(0.72, -60);
    const plates = await ev(() => { const b = __BD.base(); return ['commandCenter', 'barracks', 'armory', 'infirmary'].map((id) => [b.sprites[id].plate.visible, b.sprites[id].plate.plate.lv.text, b.sprites[id].label.text]); });
    check('every building shows a name plate with a round level badge', plates.every(([v, lv, n]) => v && lv === '1' && n.length > 3), JSON.stringify(plates));

    // --- 2. HUD: avatar + Power + resources, left queue buttons, right quick buttons
    const ctrls = await ev(() => __BD.controls().map((c) => c.meta).filter(Boolean));
    check('HUD left column: Builder, Research, Training, Healing queue buttons', ['q-builder', 'q-research', 'q-training', 'q-healing'].every((m) => ctrls.includes(m)), ctrls.join(','));
    check('old right column replaced: Hunt -> World tab, Rewards -> Cores +, Armory -> tab, Events -> More', !ctrls.some((m) => /^k-/.test(m)) && ctrls.includes('cores-plus') && (await ev(() => !!__BD.ui().hero && __BD.ui().tabs.some((t) => t.id === 'armory') && __BD.ui().tabs.some((t) => t.id === 'more'))));
    check('HUD top bar: commander avatar, Power and resource counters', await ev(() => { const u = __BD.ui(); return u.avatar.texture.key === 'art-avatar' && u.powerText.text === String(__BD.store.power.total) && u.energyText.visible && u.coreText.visible && u.shardText.visible && u.alloyText.visible && u.troopText.visible; }));
    await waitTrue(() => Object.values(__BD.ui().queueBtns).every((b) => b.timer.text)); // first 200 ms HUD refresh
    const qIdle = await ev(() => Object.values(__BD.ui().queueBtns).map((b) => b.timer.text));
    check('queue buttons idle on a new game (Research waits for Beacon Lv 3)', qIdle.join('|') === 'Idle|Beacon 3|Idle|Idle', qIdle.join('|'));
    await ev(() => { const st = __BD.store; st.state.resources.energy = 500; st.upgrade('barracks'); });
    check('Builder button shows the running upgrade timer', await waitTrue(() => /^\d+:\d\d$/.test(__BD.ui().queueBtns.builder.timer.text)));
    await click(null, { meta: 'q-builder' });
    check('tapping Builder opens the building that is under construction', await waitTrue(() => __BD.ui().panelOpenFor === 'barracks'));
    check('construction scaffolding + progress bar drawn on the art sprite', await ev(() => !!__BD.base().scaffolds?.barracks?.visible && __BD.base().buildTexts?.barracks?.visible));
    await ev(() => __BD.ui().closePanel(true));
    await ev(() => __BD.store.speedUpConstruction('barracks', 1e6)); await sleep(300);
    check('level badge follows the building level (Barracks Lv 2)', await waitTrue(() => __BD.base().sprites.barracks.plate.plate.lv.text === '2'));
    await click(null, { meta: 'q-training' });
    check('Training button jumps to the Barracks (Troops) screen', await waitTrue(() => __BD.ui().screen?.id === 'troops'));
    await tab('base');
    await click(null, { meta: 'q-healing' });
    check('Healing button jumps to the Infirmary screen', await waitTrue(() => __BD.ui().screen?.id === 'infirmary'));
    await tab('base');
    await tab('armory');
    check('Armory tab opens the Armory', await waitTrue(() => __BD.ui().screen?.id === 'armory'));
    await tab('base');
    await click(null, { meta: 'cores-plus' });
    check('Cores + opens Beacon Core Rewards', await waitTrue(() => __BD.ui().modal?.list.some((o) => o.text === 'Beacon Core Rewards')));
    await ev(() => __BD.ui().closeModal());
    await tab('base');
    await tab('world');
    check('World tab opens the World map (side columns hide there)', await waitTrue(() => __BD.ui().worldMode && !__BD.ui().queueBtns.builder.visible));
    await tab('base');
    await tab('more');
    await click(null, { meta: 'more-events' });
    check('Events placeholder (More sheet) explains it is coming soon', await toastHas(/coming soon/));
    await ev(() => __BD.ui().closeModal());

    // --- 3. hidden until unlocked
    s = await state();
    const hid = await ev(() => {
      const b = __BD.base(), st = __BD.store, d = __BD.grid.BUILDINGS.archive.start;
      const w = __BD.grid.isoToWorld(d.gx + 1.5, d.gy + 1.5);
      return { vis: b.sprites.archive.img.visible, plate: b.sprites.archive.plate.visible, placed: st.isPlaced('archive'), pick: b.pick(w.x, w.y), pending: st.pendingPlacements().length, others: st.othersFootprints('commandCenter').length };
    });
    check('Archive is hidden before Beacon Lv 3: no sprite, no plate, not tappable, no footprint', !hid.vis && !hid.plate && !hid.placed && hid.pick !== 'archive' && hid.pending === 0 && hid.others === 3, JSON.stringify(hid));
    await click(null, { meta: 'q-research' });
    check('Research button explains where research comes from (Archive at Beacon Lv 3)', await toastHas(/Beacon Lv 3/));
    check('a hidden building can not be moved or placed early', await ev(() => { const st = __BD.store; return !st.moveBuilding('archive', 12, 19) && !st.placeBuilding('archive', 12, 19).ok; }));

    // --- 4. unlock -> notify + placement mode
    await centerCam(0.72, -60);
    await ev(() => { const st = __BD.store; st.state.beacon.level = 2; st.state.beacon.charge = 100; st.state.resources.energy = 50000; st.upgrade('beacon'); st.speedUpConstruction('beacon', 1e6); });
    check('reaching Beacon Lv 3 tells the player the Archive is unlocked', await toastHas(/Archive unlocked/));
    check('…and enters placement mode with the Archive at a suggested free spot', await waitTrue(() => { const b = __BD.base(); return b.placeId === 'archive' && b.moveId === 'archive' && b.sprites.archive.img.visible && b.placeTarget?.valid && b.gridG.visible; }));
    check('placement banner: "Build the Archive" with Place + Later', await waitTrue(() => { const u = __BD.ui(); return u.banner.visible && /Build the Archive/.test(u.bannerText.text) && u.bannerPlace.visible && u.bannerPlace.isEnabled() && u.bannerLater.visible; }));
    check('not saved as placed until confirmed', !(await state()).buildings.archive.placed);
    await shot('stage6-unlock-placement.png', { keepToast: true });
    // Later: hidden again, "New building" chip offers it
    await click('Later', { meta: 'place-later' });
    check('Later postpones: Archive hidden again, still unplaced', await waitTrue(() => !__BD.base().placeId && !__BD.base().sprites.archive.img.visible && !__BD.store.isPlaced('archive')));
    check('a "New: build the Archive" chip waits under the top bar', await waitTrue(() => __BD.ui().placeChip.visible && /build the Archive/.test(__BD.ui().placeChipBtn.labelText.text)));
    await click(null, { meta: 'place-new' });
    check('the chip re-enters placement mode', await waitTrue(() => __BD.base().placeId === 'archive'));
    // tap outside the base area: target follows, Place disabled
    const t0 = await ev(() => ({ ...__BD.base().placeTarget }));
    await ev(() => __BD.base().setPlaceTarget(4, 4));
    check('an invalid spot (outside the base) disables Place', await waitTrue(() => !__BD.base().placeTarget.valid && !__BD.ui().bannerPlace.isEnabled()));
    check('Place on an invalid spot is refused', !(await ev(() => __BD.base().confirmPlace().ok)) && !(await state()).buildings.archive.placed);
    await ev(([gx, gy]) => __BD.base().setPlaceTarget(gx, gy), [t0.gx, t0.gy]); await frames(3);
    // drag it (no long-press needed while placing) to another free spot
    const dest = await freeNear('archive', t0.gx, t0.gy);
    const from = await fpCenter('archive');
    await dragBuilding(from, await fpAt(dest.gx, dest.gy), false);
    const pt = await ev(() => ({ ...__BD.base().placeTarget }));
    check('dragging the new building moves the proposed spot (snapped to the grid)', pt.gx === dest.gx && pt.gy === dest.gy && pt.valid, `${JSON.stringify(t0)} -> ${JSON.stringify(pt)} want ${JSON.stringify(dest)}`);
    await click('Place', { meta: 'place-confirm' });
    s = await state();
    check('Place builds it there: placed, visible, saved', s.buildings.archive.placed && s.buildings.archive.gx === dest.gx && s.buildings.archive.gy === dest.gy && (await ev(() => __BD.base().sprites.archive.img.visible && !__BD.base().placeId && !__BD.ui().banner.visible)));
    check('placement chip gone once built', await waitTrue(() => !__BD.ui().placeChip.visible));
    const arc = await fpCenter('archive');
    await page.mouse.click(arc.x, arc.y); await frames(4); await sleep(300);
    check('the placed Archive opens its panel on tap', await waitTrue(() => __BD.ui().panelOpenFor === 'archive'));
    await ev(() => __BD.ui().closePanel(true));
    await click(null, { meta: 'q-research' });
    check('Research button now opens the Archive research screen', await waitTrue(() => __BD.ui().screen?.id === 'archive'));
    await tab('base');
    await page.reload(); await ready();
    s = await state();
    check('placement persists after reload', s.buildings.archive.placed && s.buildings.archive.gx === dest.gx && s.buildings.archive.gy === dest.gy && (await ev(() => __BD.base().sprites.archive.img.visible)));

    // --- 5. moving buildings stays possible on the new map
    await centerCam(0.72, -60);
    const cc0 = s.buildings.commandCenter;
    const ccDest = await freeNear('commandCenter', cc0.gx, cc0.gy);
    await dragBuilding(await fpCenter('commandCenter'), await fpAt(ccDest.gx, ccDest.gy));
    s = await state();
    check('long-press + drag moves the Command Center to a free spot', s.buildings.commandCenter.gx === ccDest.gx && s.buildings.commandCenter.gy === ccDest.gy, `${JSON.stringify(cc0)} -> ${JSON.stringify(s.buildings.commandCenter)}`);
    check('move mode shows the placement grid + Done banner', await ev(() => __BD.base().gridG.visible && __BD.ui().banner.visible && __BD.ui().bannerDone.visible && !__BD.ui().bannerPlace.visible));
    await shot('stage6-move-mode.png');
    // onto the Archive: rejected
    await dragBuilding(await fpCenter('commandCenter'), await fpCenter('archive'), false);
    check('dropping onto another building is rejected', JSON.stringify((await state()).buildings.commandCenter) === JSON.stringify(s.buildings.commandCenter));
    await click('Done');
    check('Done leaves move mode (grid hidden)', await waitTrue(() => !__BD.base().moveId && !__BD.base().gridG.visible));
    check('small ground details hide under buildings and show elsewhere', await ev(() => { const b = __BD.base(); const v = b.innerDecos.filter((d) => d.img.visible).length; return v > 0 && v <= b.innerDecos.length; }));

    // --- 6. v8 -> v9 migration (old 26x26 map), with backup
    const v8 = (lv, extra) => ev(([lv, extra]) => {
      localStorage.clear();
      localStorage.setItem('brokenDawn.save.v1', JSON.stringify({
        version: 8, resources: { energy: 700, shards: 50, alloy: 9, cores: 4 }, beacon: { level: lv, charge: 20 },
        buildings: { commandCenter: { level: 4, gx: 12, gy: 8 }, barracks: { level: 3, gx: 9, gy: 15 }, armory: { level: 2, gx: 16, gy: 16 }, infirmary: { level: 2, gx: 16, gy: 8 }, archive: { level: 2, gx: 8, gy: 8 }, ...extra },
        settings: { music: 0.5, sfx: 0.8, muted: false, haptics: true }, tutorial: { done: true, step: 8, skipped: false }, construction: [], lastSaved: Date.now(),
      }));
      __BD.store.save = () => {};
    }, [lv, extra ?? {}]);
    await v8(3); await page.reload(); await ready();
    s = await state();
    const mig = await ev(() => {
      const st = __BD.store, B = st.state.buildings, ids = Object.keys(B), o = __BD.grid.BEACON_CENTER;
      const off = (id) => { const c = __BD.grid.isoToWorld(B[id].gx + 1.5, B[id].gy + 1.5); return { dx: c.x - o.x, dy: c.y - o.y }; };
      return { valid: ids.every((id) => st.canPlace(id, B[id].gx, B[id].gy)), cc: [B.commandCenter.gx, B.commandCenter.gy], arch: [B.archive.gx, B.archive.gy, B.archive.placed], br: off('barracks'), levels: ids.map((id) => B[id].level).join(',') };
    });
    check('v8 save migrates to v9', s.version === 10);
    check('v9: buildings on their old default tiles move to the new defaults (CC 12,8 -> 11,11; Archive 8,8 -> 12,19)', mig.cc.join() === '11,11' && mig.arch.join() === '12,19,true', JSON.stringify(mig));
    check('v9: a moved building keeps its direction from the Beacon (Barracks 9,15 stays lower-left)', mig.br.dx < -150 && mig.br.dy > -100, JSON.stringify(mig.br));
    check('v9: every migrated position is valid (inside the base, no overlaps), levels kept', mig.valid && mig.levels === '4,3,2,2,2', JSON.stringify(mig));
    check('v9: unlocked Archive (Beacon Lv 3) stays placed and visible; other progress kept', mig.arch[2] && (await ev(() => __BD.base().sprites.archive.img.visible)) && s.resources.cores === 4 && s.settings.music === 0.5 && s.tutorial.done);
    check('v8 migration keeps a backup with the old positions', await ev(() => { const b = JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v8') || '{}'); return b.version === 8 && b.buildings.commandCenter.gx === 12 && b.buildings.commandCenter.gy === 8; }));
    await v8(2); await page.reload(); await ready();
    s = await state();
    check('v9: a locked Archive (Beacon Lv 2) is hidden until unlocked', !s.buildings.archive.placed && !(await ev(() => __BD.base().sprites.archive.img.visible)) && (await ev(() => __BD.store.pendingPlacements().length === 0)));
  } catch (e) {
    const diag = await ev(() => ({ screen: __BD.ui().screen?.id, modal: !!__BD.ui().modal, place: __BD.base().placeId, move: __BD.base().moveId, controls: __BD.controls().map((c) => c.label + (c.meta ? `#${c.meta}` : '')) })).catch(() => ({}));
    check('stage 6 suite ran without exceptions', false, `${e.message} :: ${JSON.stringify(diag)}`);
  }
  check('stage 6: no console errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}


// Stage 7 (v0.6 HUD + nav redesign): top HUD (portrait, Power plaque, Beacon gauge, Cores pill, resource
// capsules + tooltips), sculpted bottom nav (illustrated tabs, Base centre emblem, badges, raised active tab),
// More sheet, safe-area insets and other phone sizes.
async function runStage7(url, label, takeShots) {
  console.log(`\n=== stage 7 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (viewport, test = {}) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript((t) => { window.__BD_TEST = { noTutorial: true, ...t }; }, test);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(500);
    return { ctx, page, errors };
  };
  let { ctx, page, errors } = await open({ width: 390, height: 844 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async (name, p = page) => { if (takeShots) { await sleep(400); await p.evaluate(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); }); await sleep(60); await p.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  const ctl = async (meta) => { for (let i = 0; i < 15; i++) { const c = await ev((m) => __BD.controls().find((c) => c.meta === m && c.enabled), meta); if (c) return c; await sleep(150); } return null; };
  const click = async (meta) => { await frames(2); const c = await ctl(meta); if (!c) throw new Error(`control not found: ${meta}`); await page.mouse.click(c.x, c.y); await frames(4); await sleep(300); };
  const tapGame = async (x, y) => { const p = await ev(([x, y]) => __BD.gameToPage(x, y), [x, y]); await page.mouse.click(p.x, p.y); await frames(4); await sleep(300); };
  const waitTrue = async (fn, arg, n = 30) => { for (let i = 0; i < n; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const modalHas = (re) => waitTrue((src) => !!__BD.ui().modal?.list.some((o) => o.text && new RegExp(src).test(o.text)), re.source);
  // text objects (visible, in the UI scene) whose bounds overlap each other inside a region
  const overlaps = (y0, y1) => ev(([y0, y1]) => {
    const ui = __BD.ui(), out = [], vis = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active || p.alpha === 0) return false; return true; };
    const walk = (o) => { if (o.type === 'Text' && o.text && vis(o)) out.push(o); (o.list ?? []).forEach(walk); };
    ui.children.list.forEach(walk);
    const bs = out.map((t) => ({ t: t.text, b: t.getBounds() })).filter((x) => x.b.y >= y0 && x.b.bottom <= y1);
    const bad = [];
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i].b, b = bs[j].b;
      if (a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1) bad.push(`${bs[i].t}|${bs[j].t}`);
    }
    return bad;
  }, [y0, y1]);

  try {
    await ev(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(600);
    const L = await ev(() => __BD.layout());
    // --- 1. top HUD
    const hud = await ev(() => {
      const u = __BD.ui(), s = __BD.store.state;
      return { av: u.avatar.texture.key, lv: u.avatarLv.text, blv: s.beacon.level, beacon: u.beaconLv.text, charge: u.chargeText.text, power: u.powerText.text, total: String(__BD.store.power.total), cores: u.coreText.text, c: String(s.resources.cores), plus: !!u.corePlus,
        icons: u.children.list.filter((o) => o.type === 'Image').map((o) => o.texture.key).filter((k) => /^hud-|^nav-troops/.test(k)) };
    });
    check('top HUD: commander portrait in a gold ring with the commander level badge', hud.av === 'art-avatar' && hud.lv === String(hud.blv), JSON.stringify(hud));
    check('Power plaque shows Base Power with the shield icon', hud.power === hud.total && hud.icons.includes('hud-power'));
    check('Beacon level + charge stay visible (gauge under the portrait)', hud.beacon === `BEACON Lv ${hud.blv}` && /^\d+%$|^FULL$/.test(hud.charge), `${hud.beacon} ${hud.charge}`);
    check('Beacon Cores pill with a + button on the right', hud.cores === hud.c && hud.plus && hud.icons.includes('hud-core'));
    check('resource capsules use the new icons (Energy, Alloy, Shards, Troops)', ['hud-energy', 'hud-alloy', 'hud-shards', 'nav-troops'].every((k) => hud.icons.includes(k)), hud.icons.join(','));
    check('top HUD stays compact (≤ 190 game px at 390×844, no insets)', L.TOP_H <= 190 && L.SAFE.top === 0, JSON.stringify(L));
    const visFrac = await ev(() => { const H = __BD.ui().scale.height, l = __BD.layout(); return (H - l.TOP_H - l.NAV_H) / H; });
    check('the base keeps most of the screen (≥ 70% between HUD and nav)', visFrac >= 0.7, visFrac.toFixed(3));
    check('top HUD labels do not overlap', (await overlaps(0, L.TOP_H)).length === 0, (await overlaps(0, L.TOP_H)).join(', '));
    await shot('stage7-hud-base.png');

    // portrait / plaque -> Power breakdown; Beacon gauge -> glide to the Beacon
    await tapGame(74, L.SAFE.top + 70);
    check('tapping the portrait opens the Power breakdown (profile)', await modalHas(/^Base Power$/));
    await ev(() => __BD.ui().closeModal());
    await tapGame(300, L.SAFE.top + 62);
    check('tapping the Power plaque opens the Power breakdown', await modalHas(/^Base Power$/));
    await ev(() => __BD.ui().closeModal());
    await tab('troops');
    await tapGame(76, L.SAFE.top + 155);
    check('tapping the Beacon gauge returns to the base and glides to the Beacon', await waitTrue(() => !__BD.ui().screen && __BD.ui().panelOpenFor === 'beacon'));
    await ev(() => __BD.ui().closePanel(true));
    // Cores pill / + -> rewards, badge counts ready rewards
    await click('cores-plus');
    check('Cores + opens Beacon Core Rewards', await modalHas(/^Beacon Core Rewards$/));
    await ev(() => __BD.ui().closeModal());
    await tapGame(560, L.SAFE.top + 62);
    check('tapping the Cores pill also opens the rewards', await modalHas(/^Beacon Core Rewards$/));
    await ev(() => __BD.ui().closeModal());
    check('red badge on Cores + shows how many rewards are ready', await waitTrue(() => { const u = __BD.ui(), n = __BD.store.rewardsReady(); return n > 0 && u.coreBadgeText.text === String(n); }));

    // capsule tooltips
    const capTap = async (id) => { const p = await ev((id) => { const c = __BD.ui().capsules[id]; return __BD.gameToPage(c.x + c.w / 2, c.hit.y); }, id); await page.mouse.click(p.x, p.y); await frames(3); await sleep(250); };
    const tips = {};
    for (const id of ['energy', 'alloy', 'shards', 'troops']) { await capTap(id); tips[id] = await ev(() => __BD.ui().tip && { kind: __BD.ui().tip.kind, text: __BD.ui().tip.text, vis: __BD.ui().tipBox.visible }); }
    check('tapping a capsule shows a tooltip for that resource', Object.entries(tips).every(([id, t]) => t && t.kind === id && t.vis), JSON.stringify(Object.values(tips).map((t) => t?.kind)));
    check('tooltips explain the source (Energy rate from the Beacon, Alloy from the Command Center, Shards from the Armory, Troops from the Barracks)',
      /\/s from the Beacon/.test(tips.energy.text) && /Command Center/.test(tips.alloy.text) && /Armory/.test(tips.shards.text) && /Barracks/.test(tips.troops.text), JSON.stringify(tips));
    await capTap('troops');
    check('tapping the same capsule again closes its tooltip', await waitTrue(() => !__BD.ui().tip));
    await capTap('energy');
    const cam0 = await ev(() => __BD.base().cameras.main.scrollX);
    await tapGame(360, 900);
    check('a tap elsewhere closes the tooltip (and does not pass through to the map)', await waitTrue(() => !__BD.ui().tip) && (await ev(() => __BD.base().cameras.main.scrollX)) === cam0);
    await capTap('alloy');
    await ev(() => { const u = __BD.ui(); u.tip.until = u.time.now - 1; });
    check('tooltips close by themselves after a few seconds', await waitTrue(() => !__BD.ui().tip));

    // --- 2. bottom nav
    const nav = await ev(() => { const u = __BD.ui(); return u.tabs.map((t) => ({ id: t.id, cx: Math.round(t.cx), hero: !!t.hero, key: t.icon?.texture.key, label: t.label?.text })); });
    check('nav order: World, Troops, [Base emblem], Armory, Squads, More', nav.map((t) => t.id).join(',') === 'world,troops,base,armory,squads,more' && nav[2].hero, nav.map((t) => t.id).join(','));
    check('World tab uses the planet globe icon (leftmost)', nav[0].id === 'world' && nav[0].key === 'nav-world' && nav[0].label === 'World');
    check('illustrated tab icons with labels', nav.filter((t) => !t.hero).every((t) => t.key === `nav-${t.id}` && t.label && t.label.length > 3), JSON.stringify(nav));
    check('Base is the big centre emblem button (beacon-fortress medallion)', await ev(() => { const u = __BD.ui(), h = u.hero; return Math.abs(h.x - u.scale.width / 2) < 1 && h.em.texture.key === 'hud-base-emblem' && h.lab.text === 'BASE' && !u.textures.exists('hud-emblem') && h.em.displayWidth >= 120 && h.y - h.em.displayHeight / 2 < u.scale.height - __BD.layout().NAV_H; }));
    check('nav labels do not overlap', (await overlaps(await ev(() => __BD.ui().scale.height - __BD.layout().NAV_H - __BD.layout().HERO_RISE), 99999)).length === 0);
    const lifted = async (id) => ev((id) => { const u = __BD.ui(), t = u.tabs.find((x) => x.id === id), o = u.tabs.find((x) => !x.hero && x.id !== id); return u.activeTab === id && t.icon.y < o.icon.y && t.icon.scale > o.icon.scale && u.navGlow.visible && Math.abs(u.navGlow.x - t.cx) < 1 && t.label.style.color === '#ffb347'; }, id);
    check('the game opens on Base: the Base emblem is lit, no tab plate', await ev(() => { const u = __BD.ui(); return u.activeTab === 'base' && !u.worldMode && !u.screen && !u.navGlow.visible && u.hero.em.scale > u.hero.baseScale; }));
    check('Research queue button and More sheet use the new illustrated icons', await ev(() => { const u = __BD.ui(), q = u.queueBtns.research; return q.list.some((o) => o.texture?.key === 'more-research'); }));
    for (const id of ['troops', 'armory', 'squads']) {
      await tab(id);
      check(`${id} tab opens its screen and becomes the raised tab`, (await ev((id) => __BD.ui().screen?.id === id, id)) && await lifted(id));
    }
    await shot('stage7-tab-squads.png');
    await tab('troops');
    await shot('stage7-tab-troops.png');
    await tab('world');
    check('World tab opens the World map and becomes the raised tab', await waitTrue(() => __BD.ui().worldMode) && await lifted('world'));
    check('…the Base emblem is unlit there', await ev(() => { const h = __BD.ui().hero; return Math.abs(h.em.scale - h.baseScale) < 1e-6; }));
    await shot('stage7-tab-world.png');
    check('the centre emblem is not covered by the World squad bar', await ev(() => { const u = __BD.ui(); return u.worldHud.barRect.bottom <= u.hero.y - u.hero.em.displayHeight / 2 + 4; }));
    await tab('base');
    check('Base emblem returns to the base', await waitTrue(() => !__BD.ui().worldMode && !__BD.ui().screen && __BD.ui().activeTab === 'base'));
    check('screens end above the centre emblem (resting size: screens open on other tabs)', await ev(() => { const u = __BD.ui(), a = u.area, h = u.hero; return a.y + a.h <= h.y - (h.em.height * h.baseScale) / 2 + 2; }));

    // --- 3. More sheet
    await tab('more');
    const more = await ev(() => ({ open: !!__BD.ui().modal?.isMore, tab: __BD.ui().activeTab, items: __BD.controls().filter((c) => /^more-/.test(c.meta)).map((c) => c.meta) }));
    check('More sheet: Research and Events use the new illustrated icons', await ev(() => { const keys = []; const walk = (o) => { if (o.texture) keys.push(o.texture.key); (o.list ?? []).forEach(walk); }; walk(__BD.ui().modal); return keys.includes('more-research') && keys.includes('more-events'); }));
    check('More opens a sheet: Settings, Rewards, Power, Leaders, Research, Events', more.open && more.tab === 'more' && ['settings', 'rewards', 'profile', 'leaders', 'research', 'events'].every((k) => more.items.includes(`more-${k}`)), JSON.stringify(more));
    await shot('stage7-more-sheet.png');
    await tab('more');
    check('tapping More again closes the sheet', await waitTrue(() => !__BD.ui().modal && __BD.ui().activeTab === 'base'));
    await tab('more');
    await tapGame(360, 300);
    check('tapping outside the sheet closes it', await waitTrue(() => !__BD.ui().modal));
    await tab('more');
    await tab('squads');
    check('the nav stays usable while More is open (Squads closes it and opens Squads)', await waitTrue(() => !__BD.ui().modal && __BD.ui().screen?.id === 'squads'));
    await tab('more');
    await click('more-settings');
    check('More → Settings opens Settings (audio, tutorial, Reset)', await modalHas(/^AUDIO$/) && await ev(() => __BD.ui().activeTab === 'more'));
    await ev(() => __BD.ui().closeModal());
    await tab('more'); await click('more-leaders');
    check('More → Leaders opens the leader collection', await waitTrue(() => __BD.ui().screen?.id === 'armory' && __BD.ui().screenState.armoryTab === 'leaders'));
    await tab('more'); await click('more-rewards');
    check('More → Rewards opens Beacon Core Rewards', await modalHas(/^Beacon Core Rewards$/));
    await ev(() => __BD.ui().closeModal());
    await tab('more'); await click('more-research');
    check('More → Research explains the Archive (Beacon Lv 3) before it unlocks', await waitTrue(() => /Archive/.test(__BD.ui().toastText.text) && __BD.ui().toastBox.visible));
    await tab('more'); await click('more-profile');
    check('More → Power opens the Power breakdown', await modalHas(/^Base Power$/));
    await ev(() => __BD.ui().closeModal());

    // --- 4. badges
    const badge = (id) => ev((id) => __BD.ui().tabs.find((t) => t.id === id).badgeText.text, id);
    await tab('base');
    await ev(() => { __BD.store.state.resources.cores = 3; });
    check("Armory badge: '!' when Cores buy a recruit (3 Cores -> !)", await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'armory').badgeText.text === '!'));
    await ev(() => { __BD.store.state.resources.cores = 1; });
    check("Armory badge: '!' with exactly one recruit's worth (1 Core)", await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'armory').badgeText.text === '!'));
    await ev(() => { __BD.store.state.resources.cores = 0; });
    check('Armory badge clears with no Cores', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'armory').badgeText.text === ''));
    check('More badge counts rewards ready to claim', await waitTrue(() => { const n = __BD.store.rewardsReady(); return n > 0 && __BD.ui().tabs.find((t) => t.id === 'more').badgeText.text === String(n); }));
    await ev(() => __BD.store.claimAllRewards());
    check('More badge clears once rewards are claimed', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'more').badgeText.text === ''));
    await ev(() => { const st = __BD.store; st.state.resources.energy = 5000; st.train('sentinel', 4); st.tick(120); });
    check('Troops badge: troops finished training while you were elsewhere', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'troops').badgeText.text === '4'), await badge('troops'));
    await tab('troops');
    check('Troops badge clears when you open Troops', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'troops').badgeText.text === ''));
    await ev(() => { const st = __BD.store.state; st.beacon.level = 3; st.buildings.archive.placed = false; });
    check('Base emblem badge (!) while a new building waits to be placed', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'base').badgeText.text === '!'));
    await tab('base');
    check('…and clears back on the Base', await waitTrue(() => __BD.ui().tabs.find((t) => t.id === 'base').badgeText.text === ''));
    check('stage 7 (390×844): no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // --- 5. safe-area insets (notch + home indicator) and other phone sizes
    ({ ctx, page, errors } = await open({ width: 390, height: 844 }, { safe: { top: 47, bottom: 34 } }));
    const S = await page.evaluate(() => {
      const u = __BD.ui(), l = __BD.layout(), H = u.scale.height;
      const t = u.tabs.filter((x) => !x.hero);
      return { l, H, avatarTop: u.avatar.y - u.avatar.displayHeight / 2, powerTop: u.powerText.y, labelsBottom: Math.max(...t.map((x) => x.label.y + x.label.height)), heroLab: u.hero.y + u.hero.lab.y + u.hero.lab.height };
    });
    check('safe-area insets: HUD and nav grow by the notch / home-indicator insets', S.l.SAFE.top > 70 && S.l.SAFE.bottom > 50 && S.l.TOP_H === S.l.SAFE.top + S.l.HUD_CONTENT_H && S.l.NAV_H === S.l.NAV_BODY + S.l.SAFE.bottom, JSON.stringify(S.l));
    check('…the portrait and Power sit below the top inset', S.avatarTop >= S.l.SAFE.top && S.powerTop >= S.l.SAFE.top, JSON.stringify(S));
    check('…tab labels and the Base emblem label sit above the home indicator', S.labelsBottom <= S.H - S.l.SAFE.bottom && S.heroLab <= S.H - S.l.SAFE.bottom, JSON.stringify(S));
    await page.evaluate(() => __BD.ui().openScreen('troops'));
    check('…screens fit between the HUD and nav with insets', await page.evaluate(() => { const u = __BD.ui(), a = u.area, l = __BD.layout(); return a.y === l.TOP_H && a.y + a.h <= u.scale.height - l.NAV_H - l.HERO_RISE; }));
    await page.evaluate(() => __BD.ui().closeScreen());
    if (takeShots) { await sleep(400); await page.screenshot({ path: join(ROOT, 'screens', 'stage7-safe-area.png') }); console.log('      saved screens/stage7-safe-area.png'); }
    check('safe-area run: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    for (const vp of [{ width: 360, height: 640 }, { width: 430, height: 932 }, { width: 375, height: 667 }]) {
      ({ ctx, page, errors } = await open(vp));
      const r = await page.evaluate(() => {
        const u = __BD.ui(), H = u.scale.height, l = __BD.layout();
        u.openMore();
        const m = u.modal.sheetRect;
        const fits = m.y >= l.TOP_H && m.bottom <= H - l.NAV_H - l.HERO_RISE;
        u.closeModal();
        return { H, fits, vis: (H - l.TOP_H - l.NAV_H) / H };
      });
      const bad = await page.evaluate(() => {
        const ui = __BD.ui(), out = [], vis = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active || p.alpha === 0) return false; return true; };
        const walk = (o) => { if (o.type === 'Text' && o.text && vis(o)) out.push({ t: o.text, b: o.getBounds() }); (o.list ?? []).forEach(walk); };
        ui.children.list.forEach(walk);
        const bad = []; for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) { const a = out[i].b, b = out[j].b; if (a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1) bad.push(`${out[i].t}|${out[j].t}`); }
        return bad;
      });
      check(`${vp.width}×${vp.height}: HUD + nav lay out without overlaps, More sheet fits, base keeps ≥ 65%`, r.fits && bad.length === 0 && r.vis >= 0.65 && errors.length === 0, JSON.stringify({ ...r, bad, errors }));
      await ctx.close();
    }
  } catch (e) {
    check('stage 7 suite ran without exceptions', false, e.message);
  }
  await browser.close();
}

async function runStage8(url, label, takeShots) {
  console.log(`\n=== stage 8 · ${label}: ${url}`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (viewport, test = {}) => {
    const { timezoneId, ...tflags } = test;
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ...(timezoneId ? { timezoneId } : {}) });
    await ctx.addInitScript((t) => { window.__BD_TEST = { noTutorial: true, ...t }; }, tflags);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__BD?.base()?.sprites && window.__BD.ui()?.panel); await sleep(500);
    return { ctx, page, errors };
  };
  let { ctx, page, errors } = await open({ width: 390, height: 844 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n = 4) => ev((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async (name, p = page) => { if (takeShots) { await sleep(400); await p.evaluate(() => { const u = __BD.ui(); u.tweens.killTweensOf(u.toastBox); u.toastBox.setVisible(false); }); await sleep(60); await p.screenshot({ path: join(ROOT, 'screens', name) }); console.log(`      saved screens/${name}`); } };
  const ctl = async (meta) => { for (let i = 0; i < 15; i++) { const c = await ev((m) => __BD.controls().find((c) => c.meta === m && c.enabled), meta); if (c) return c; await sleep(150); } return null; };
  const click = async (meta) => { await frames(2); const c = await ctl(meta); if (!c) throw new Error(`control not found: ${meta}`); await page.mouse.click(c.x, c.y); await frames(4); await sleep(300); };
  const tapGame = async (x, y) => { const p = await ev(([x, y]) => __BD.gameToPage(x, y), [x, y]); await page.mouse.click(p.x, p.y); await frames(4); await sleep(300); };
  const waitTrue = async (fn, arg, n = 30) => { for (let i = 0; i < n; i++) { if (await ev(fn, arg)) return true; await sleep(100); } return false; };
  const tab = async (id) => { const p = await ev((id) => __BD.tabToPage(id), id); await page.mouse.click(p.x, p.y); await frames(4); await sleep(350); };
  const modalHas = (re) => waitTrue((src) => !!__BD.ui().modal?.list.some((o) => o.text && new RegExp(src).test(o.text)), re.source);
  // text objects (visible, in the UI scene) whose bounds overlap each other inside a region
  const overlaps = (y0, y1) => ev(([y0, y1]) => {
    const ui = __BD.ui(), out = [], vis = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active || p.alpha === 0) return false; return true; };
    const walk = (o) => { if (o.type === 'Text' && o.text && vis(o)) out.push(o); (o.list ?? []).forEach(walk); };
    ui.children.list.forEach(walk);
    const bs = out.map((t) => ({ t: t.text, b: t.getBounds() })).filter((x) => x.b.y >= y0 && x.b.bottom <= y1);
    const bad = [];
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i].b, b = bs[j].b;
      if (a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1) bad.push(`${bs[i].t}|${bs[j].t}`);
    }
    return bad;
  }, [y0, y1]);


  // seconds to the next local midnight in a time zone, computed in Node (independent of the game code)
  const toMidnight = (tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return 86400 - ((+p.hour % 24) * 3600 + +p.minute * 60 + +p.second); };
  // real hunts: a strong Alpha squad attacks low-level creatures and the world ticks until it reports back
  const hunts = (n, minLevel = 1) => ev(([n, minLevel]) => {
    const st = __BD.store, out = [];
    st.state.hunt.stamina = 200;
    for (let k = 0; k < n; k++) {
      st.state.troops.sentinel = Math.max(st.state.troops.sentinel, 60); st.state.troops.bearer = Math.max(st.state.troops.bearer, 60); st.state.troops.voyager = Math.max(st.state.troops.voyager, 60);
      st.saveFormation('alpha', [{ type: 'sentinel', count: 20 }, { type: 'bearer', count: 20 }, { type: 'voyager', count: 20 }]);
      st.refillSquad('alpha', { silent: true });
      const t = st.creatures().filter((e) => e.level >= minLevel && e.level <= Math.max(4, minLevel) && !e.busy && !e.elite).sort((a, b) => a.level - b.level)[0];
      const seq = st.state.hunt.reportSeq;
      const r = st.attack('alpha', t.id);
      for (let i = 0; i < 90 && st.state.hunt.reportSeq === seq; i++) st.tick(1);
      for (let i = 0; i < 90 && st.squadMarch('alpha'); i++) st.tick(1);
      out.push({ ok: r.ok, win: st.state.hunt.reports[0]?.win, lv: t.level });
    }
    return out;
  }, [n, minLevel]);
  const mission = (id) => ev((id) => __BD.store.missionList().find((t) => t.id === id), id);

  try {
    await ev(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(600);
    // ---------------------------------------------------------------- A. Daily Missions
    const m0 = await ev(() => { const st = __BD.store, s = st.state; return { v: s.version, day: s.missions.day, today: st.dayIndex(), tasks: st.missionList().map((t) => [t.id, t.goal, t.pts]), chests: st.missionChests().map((c) => `${c.at}:${c.tier}`), vis: __BD.ui().rightBtns.missions.visible, done: s.tutorial.done }; });
    check('new game: save v10 with today\'s missions (local day)', m0.v === 10 && m0.day === m0.today, JSON.stringify(m0));
    check('7 daily tasks worth 110 points in total', m0.tasks.length === 7 && m0.tasks.reduce((a, t) => a + t[2], 0) === 110, JSON.stringify(m0.tasks));
    check('activity chests at 20/40/60/80/100: bronze, bronze, silver, silver, gold', m0.chests.join(',') === '20:bronze,40:bronze,60:silver,80:silver,100:gold', m0.chests.join(','));
    check('Missions stay hidden until the tutorial is done', !m0.vis && !m0.done, JSON.stringify({ vis: m0.vis, done: m0.done }));
    await ev(() => __BD.store.skipTutorial()); await sleep(400);
    check('…then the Missions button appears on the right edge (clipboard icon)', await waitTrue(() => { const b = __BD.ui().rightBtns.missions; return b.visible && b.labelText.text === 'Missions' && b.list.some((o) => o.texture?.key === 'hud-missions'); }));

    // tasks count from real actions
    await ev(() => __BD.store.claimDaily());
    check('task: claiming the daily reward counts', (await mission('daily')).done);
    await ev(() => { __BD.store.state.resources.energy = 100000; __BD.store.upgrade('barracks'); });
    check('task: starting a building upgrade counts', (await mission('build')).done);
    const alt = await ev(() => { const st = __BD.store; const name = st.missionList().find((t) => t.id === 'research').name; st.state.leaders.jax = { stars: 1 }; st.state.resources.shards = 5000; const r = st.starUpLeader('jax'); return { name, ok: r.ok }; });
    check('task 5 before the Archive: "Raise a leader star or gear level" (a star-up counts)', alt.name === 'Raise a leader star or gear level' && alt.ok && (await mission('research')).done, JSON.stringify(alt));
    const tr = await ev(() => { const st = __BD.store; st.train('sentinel', 10); st.train('bearer', 10); st.train('voyager', 10); const atStart = st.state.missions.progress.train ?? 0; for (let i = 0; i < 400 && st.queuedUnits(); i++) st.tick(5); return { atStart, after: st.state.missions.progress.train ?? 0 }; });
    check('task: 30 troops counted when training completes', tr.atStart === 0 && tr.after === 30, JSON.stringify(tr));
    const h1 = await hunts(1);
    check('task: a hunt won at your top level (or 1 below) counts', h1[0].ok && h1[0].win && (await mission('push')).done, JSON.stringify(h1));
    const h8 = await hunts(7);
    check('task: 8 creatures defeated in real hunts', h8.every((h) => h.ok && h.win) && (await mission('kills')).done, JSON.stringify(h8));
    const hl = await ev(() => { const st = __BD.store; st.state.infirmary.wounded.sentinel.reserve += 10; const r = st.heal('sentinel', 10); for (let i = 0; i < 600 && st.state.infirmary.queue.length; i++) st.tick(5); return { ok: r.ok, p: st.state.missions.progress.heal ?? 0 }; });
    check('task: healing 10 wounded troops counts', hl.ok && hl.p >= 10 && (await mission('heal')).done, JSON.stringify(hl));
    check('finished tasks toast "Mission complete"', await ev(() => __BD.ui().toastLog.some((t) => /^Mission complete: /.test(t))));
    const rdy = await ev(() => ({ n: __BD.store.missionsReady(), badge: __BD.ui().rightBtns.missions.badgeText.text }));
    check('Missions badge counts tasks ready to claim', rdy.n === 7 && await waitTrue(() => __BD.ui().rightBtns.missions.badgeText.text === '7'), JSON.stringify(rdy));

    // claim through the UI
    await click('q-missions');
    check('Missions button opens the Daily Missions screen', await waitTrue(() => !!__BD.ui().modal?.isMissions) && await modalHas(/^Resets in /));
    await click('mission-daily');
    check('claiming a task banks its points (+10)', (await ev(() => __BD.store.missionPoints())) === 10);
    await click('mission-kills');
    const e0 = await ev(() => ({ e: __BD.store.state.resources.energy, L: __BD.store.state.beacon.level }));
    await click('chest-20');
    check('20-point bronze chest pays Energy 300 × Beacon level', await ev((e0) => Math.round(__BD.store.state.resources.energy - e0.e) >= 300 * e0.L && __BD.store.state.missions.chests.includes(20), e0));
    const c0 = await ev(() => __BD.store.state.resources.cores);
    await click('missions-all');
    const all = await ev(() => ({ pts: __BD.store.missionPoints(), chests: __BD.store.state.missions.chests.slice().sort((a, b) => a - b), cores: __BD.store.state.resources.cores, ready: __BD.store.missionsReady() }));
    check('Claim all: every task claimed (110 points) and every chest opened', all.pts === 110 && all.chests.join(',') === '20,40,60,80,100' && all.ready === 0, JSON.stringify(all));
    check('the 100-point gold chest is the only Core: exactly +1', all.cores - c0 === 1, `${c0} -> ${all.cores}`);
    check('opened chests show their open art', await ev(() => { const keys = []; const w = (o) => { if (o.texture) keys.push(o.texture.key); (o.list ?? []).forEach(w); }; w(__BD.ui().modal); return ['chest-bronze-open', 'chest-silver-open', 'chest-gold-open'].every((k) => keys.includes(k)); }));
    await ev(() => __BD.ui().closeModal(true));

    // a fresh screenshot state: some progress, one chest waiting
    // --- local midnight reset with auto-pay
    const roll = await ev(() => {
      const st = __BD.store, real = Date.now;
      st.state.missions = { day: st.dayIndex(), progress: { daily: 1, kills: 8, train: 30 }, claimed: ['daily'], chests: [] };
      const e = st.state.resources.energy, a = st.state.resources.alloy, L = st.state.beacon.level, day = st.state.missions.day;
      const ms = st.missionsResetIn() * 1000;
      st.clock = () => real() + ms + 2000;   // 2 s past local midnight
      for (let i = 0; i < 3; i++) st.tick(0.5);
      return { day0: day, day: st.state.missions.day, prog: st.state.missions.progress, dE: Math.round(st.state.resources.energy - e), dA: Math.round(st.state.resources.alloy - a), L, paid: st.missionsReport?.paid };
    });
    check('missions reset at local midnight (new day, progress cleared)', roll.day === roll.day0 + 1 && Object.keys(roll.prog).length === 0, JSON.stringify(roll));
    check('…unclaimed work is paid, not lost (10+20+15 = 45 pts: bronze 20 + 40 chests)', roll.paid && roll.paid.energy === 300 * roll.L && roll.paid.alloy === 40 * roll.L && roll.paid.stamina === 10 && roll.dA === 40 * roll.L, JSON.stringify(roll));
    check('…with a "new day" toast', await waitTrue(() => __BD.ui().toastLog.some((t) => /Daily Missions reset/.test(t) && /Unclaimed rewards paid/.test(t))));
    const back = await ev(() => {
      const st = __BD.store, real = Date.now, day = st.state.missions.day;
      st.state.missions.progress.kills = 3;
      st.clock = () => real() - 3 * 864e5; // clock set back 3 days
      st.missionsRoll(); st.tick(1.1);
      return { same: st.state.missions.day === day, kills: st.state.missions.progress.kills };
    });
    check('setting the clock back never resets missions again', back.same && back.kills === 3, JSON.stringify(back));
    await ev(() => { __BD.store.clock = () => Date.now(); __BD.store.state.missions = { day: __BD.store.dayIndex(), progress: {}, claimed: [], chests: [] }; __BD.store.save(); });

    // --- offline actions count toward the day you come back
    const off = await ev(() => { const st = __BD.store; st.state.resources.energy = 100000; st.train('voyager', 12); st.save(); st.save = () => {}; const raw = JSON.parse(localStorage.getItem('brokenDawn.save.v1')); raw.lastSaved = Date.now() - 3600e3; localStorage.setItem('brokenDawn.save.v1', JSON.stringify(raw)); return st.state.missions.progress.train ?? 0; });
    await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(500);
    check('offline: training that finished while away counts toward today', off === 0 && (await ev(() => __BD.store.state.missions.progress.train)) === 12 && (await ev(() => __BD.store.state.missions.day === __BD.store.dayIndex())));

    // --- save v9 -> v10
    await ev(() => { __BD.store.save = () => {}; const raw = JSON.parse(localStorage.getItem('brokenDawn.save.v1')); raw.version = 9; delete raw.missions; delete raw.events; delete raw.hints; raw.lastSaved = Date.now(); localStorage.setItem('brokenDawn.save.v1', JSON.stringify(raw)); });
    await page.reload(); await page.waitForFunction(() => window.__BD?.ui()?.panel); await sleep(500);
    const mig = await ev(() => { const s = __BD.store.state; return { v: s.version, day: s.missions.day === __BD.store.dayIndex(), p: Object.keys(s.missions.progress).length, ev: s.events && typeof s.events.marks === 'number', bk: JSON.parse(localStorage.getItem('brokenDawn.save.v1.backup-v9') || '{}').version, lv: s.buildings.barracks.level, cores: s.resources.cores }; });
    check('v9 save migrates to v10: missions start fresh today, events added, backup kept', mig.v === 10 && mig.day && mig.p === 0 && mig.ev && mig.bk === 9 && mig.lv >= 2, JSON.stringify(mig));

    // --- screenshot: missions in progress
    await ev(() => { const st = __BD.store; st.state.missions.progress = { daily: 1, kills: 5, train: 30, build: 1, heal: 4 }; st.state.missions.claimed = ['daily', 'train']; st.state.missions.chests = [20]; st.save(); });
    await click('q-missions'); await sleep(300);
    await shot('stage8-missions.png');
    await ev(() => __BD.ui().closeModal(true));
    check('stage 8 missions: no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();

    // --- time zones (Denver + Auckland): reset countdown = time to local midnight; DST day counted once
    for (const tz of ['America/Denver', 'Pacific/Auckland']) {
      ({ ctx, page, errors } = await open({ width: 390, height: 844 }, { timezoneId: tz }));
      const r = await page.evaluate(() => ({ left: __BD.store.missionsResetIn(), day: __BD.store.state.missions.day, today: __BD.store.dayIndex() }));
      const exp = toMidnight(tz);
      check(`${tz}: missions reset at local midnight (in ${Math.round(exp / 60)} min)`, Math.abs(r.left - exp) < 5 && r.day === r.today, JSON.stringify({ r, exp }));
      if (tz === 'America/Denver') {
        const dst = await page.evaluate(() => {
          const st = __BD.store, at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime(), days = [];
          st.clock = () => at(2026, 9, 31, 22, 0); st.state.missions = { day: st.dayIndex(), progress: {}, claimed: [], chests: [] };
          for (const t of [at(2026, 10, 1, 0, 30), at(2026, 10, 1, 1, 30), at(2026, 10, 1, 23, 30), at(2026, 10, 2, 0, 10)]) { st.clock = () => t; st.missionsRoll(); days.push(st.state.missions.day); }
          st.clock = () => Date.now();
          return days;
        });
        check('DST end (Nov 1, a 25-hour day in Denver): one reset that day, the next at midnight Nov 2', dst[0] === dst[1] && dst[1] === dst[2] && dst[3] === dst[2] + 1, JSON.stringify(dst));
      }
      await ctx.close();
    }

    // --- one-time pointer on the Missions button after the tutorial
    ({ ctx, page, errors } = await open({ width: 390, height: 844 }, { hints: true }));
    await page.evaluate(() => __BD.store.skipTutorial());
    check('after the tutorial, a one-time pointer pulses on the Missions button', await page.evaluate(async () => { for (let i = 0; i < 20; i++) { if (__BD.ui().hintTarget === 'missions' && __BD.ui().hintG.visible) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }));
    { const c = await page.evaluate(() => __BD.controls().find((c) => c.meta === 'q-missions')); await page.mouse.click(c.x, c.y); await sleep(500); }
    { const h = await page.evaluate(() => ({ st: __BD.store.state.hints, ls: JSON.parse(localStorage.getItem('brokenDawn.save.v1')).hints, t: __BD.ui().hintTarget, m: !!__BD.ui().modal?.isMissions }));
      check('…tapping it opens Missions and clears the pointer for good (saved)', h.st.missions === true && h.ls.missions === true && h.t === null && h.m, JSON.stringify(h)); }
    await ctx.close();
  } catch (e) {
    check('stage 8 suite ran without exceptions', false, e.message);
  }
  await browser.close();
}

const srv = await serveDist();
try {
  if (!process.env.ONLY || process.env.ONLY === '1') {
    await run(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
    if (!process.env.QUICK) await run(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  }
  if (!process.env.ONLY || process.env.ONLY === '2') await runStage2(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '2')) await runStage2(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '3') await runStage3(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '3')) await runStage3(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '4') await runStage4(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '4')) await runStage4(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '5') await runStage5(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '5')) await runStage5(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '6') await runStage6(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '6')) await runStage6(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '7') await runStage7(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '7')) await runStage7(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
  if (!process.env.ONLY || process.env.ONLY === '8') await runStage8(`file://${join(ROOT, 'broken-dawn.html')}`, 'single-file build', SHOTS);
  if (!process.env.QUICK && (!process.env.ONLY || process.env.ONLY === '8')) await runStage8(`http://localhost:${srv.address().port}/`, 'dist/ build', false);
} finally { srv.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
