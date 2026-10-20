// Stage 8 UI: the right-edge Missions + Event buttons, the Daily Missions screen (task list + activity
// chest track), and one-time pointers. Lives in the UI scene; `ui` is the UIScene.
import { GAME_WIDTH as W, PALETTE, MISSIONS, EVENTS, SPEEDUPS } from '../config.js';
import { store } from '../state/store.js';
import { text, button, fmt, fmtDuration } from './widgets.js';
import { SKIN, drawBar, drawCard } from './skin.js';
import { sectionHeader } from './kit.js';
import { audio } from '../audio/audio.js';
import { TOP_H } from './layout.js';

const testFlags = () => (typeof window !== 'undefined' ? window.__BD_TEST ?? {} : {});

// "+900 Energy · +40 Alloy · +1 Core"
export function fmtBundle(b, sep = '  ·  ') {
  const names = { energy: 'Energy', alloy: 'Alloy', shards: 'Shards', stamina: 'Stamina', marks: 'Rift Marks', cores: 'Core' };
  const su = (k) => SPEEDUPS.items.find((i) => `su_${i.id}` === k);
  return Object.entries(b ?? {}).filter(([, v]) => v).map(([k, v]) => (su(k) ? `+${v}× ${su(k).short} speed-up` : `+${fmt(v)} ${k === 'cores' ? (v === 1 ? 'Beacon Core' : 'Beacon Cores') : names[k] ?? k}`)).join(sep);
}

function drawBadge(btn, n) {
  const g = btn.badge; g.clear();
  btn.badgeText.setText(n ? String(n) : '');
  if (!n) return;
  const bx = btn.r - 4, by = -btn.r + 4;
  g.fillStyle(0xe0263c, 1).fillCircle(bx, by, 14).lineStyle(2, 0xffd0d6, 0.9).strokeCircle(bx, by, 14);
  btn.badgeText.setPosition(bx, by);
}

// Right edge, mirroring the left queue column.
export function createRightColumn(ui) {
  const r = 36, xr = W - 52, y0 = TOP_H + 104, dy = 114;
  const mk = (y, caption, chip, icon, onClick, ring) => {
    const b = ui.roundButton(xr, y, r, caption, chip, icon, onClick, ring);
    b.badgeText = text(ui, 0, 0, '', 15, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5);
    b.add(b.badgeText);
    return b;
  };
  ui.rightBtns = {
    event: null,
    missions: mk(y0, 'Missions', 'q-missions', 'hud-missions', () => { markHint('missions'); ui.hintTarget = null; ui.hintG.clear().setVisible(false); openMissions(ui); }, PALETTE.cyan).setVisible(false),
  };
  ui.rightBtns.event = mk(y0 + dy, 'Event', 'q-event', 'more-events', () => { markHint('events'); ui.hintTarget = null; ui.hintG.clear().setVisible(false); openEvents(ui); }, PALETTE.gold).setVisible(false);
  ui.sideBtns.push(ui.rightBtns.missions, ui.rightBtns.event);
  ui.hintG = ui.add.graphics().setDepth(7).setVisible(false);
  const toast = (msg, ms) => { if (!store.simulating && store.missionsUnlocked()) ui.toast(msg, ms); };
  ui.unsubs.push(
    store.on('missionDone', (id) => { const T = MISSIONS.tasks.find((t) => t.id === id); toast(`Mission complete: ${store.missionName(T)}. Claim it in Missions.`, 2200); }),
    store.on('eventEnded', () => ui.time.delayedCall(300, () => showEventSummaries(ui))),
    store.on('missionsReset', (rep) => toast(`A new day: Daily Missions reset.${rep.paid ? `\nUnclaimed rewards paid: ${fmtBundle(rep.paid)}` : ''}`, rep.paid ? 4200 : 2400)),
  );
  // events that ended while away (settled while loading)
  if (store.eventSummaries?.length) ui.time.delayedCall(1200, () => showEventSummaries(ui));
  // a reset that happened while loading (before the UI existed)
  if (store.missionsReport?.paid && store.missionsUnlocked()) ui.time.delayedCall(5400, () => ui.toast(`A new day: Daily Missions reset.\nUnclaimed rewards paid: ${fmtBundle(store.missionsReport.paid)}`, 4200));
}

function markHint(id) { if (!store.state.hints[id]) { store.state.hints[id] = true; store.save(); } }

// Called with the side columns (every 200 ms).
export function refreshRightColumn(ui) {
  const vis = ui.sideVisible() && store.missionsUnlocked();
  const m = ui.rightBtns.missions;
  m.setVisible(vis);
  if (vis) {
    const pts = store.missionPoints();
    m.timer.setText(`${pts}/100`).setColor(pts >= 100 ? PALETTE.textGold : PALETTE.textDim);
    drawBadge(m, store.missionsReady());
  }
  // live event (or the next one) with its countdown
  const e = ui.rightBtns.event;
  e.setVisible(vis);
  if (vis) {
    const live = store.liveEvent(), info = store.eventInfo(live ?? store.nextEvent());
    e.labelText.setText(live ? info.def.name : 'Event');
    e.timer.setText(live ? fmtShort(info.endsIn) : `in ${fmtShort(info.startsIn)}`).setColor(live ? PALETTE.textGold : PALETTE.textDim);
    drawBadge(e, store.eventsReady());
  }
  if (ui.modal?.tick) ui.modal.tick();
  if (store.eventSummaries?.length && !ui.modal && !ui.screen && !ui.reveal) showEventSummaries(ui);
  // one-time pointers (after the tutorial): pulse a ring on the Missions button, then (the first time an
  // event is live) on the Event button, until each is tapped
  const f = testFlags();
  const free = (!f.noTutorial || f.hints) && !ui.modal && !ui.screen;
  const hintId = !vis || !free ? null : !store.state.hints.missions ? 'missions' : (!store.state.hints.events && store.liveEvent() ? 'event' : null);
  const hint = hintId ? ui.rightBtns[hintId] : null;
  ui.hintTarget = hintId;
  const g = ui.hintG; g.clear().setVisible(!!hint);
  if (hint) {
    const k = (Math.sin(ui.time.now / 180) + 1) / 2;
    g.lineStyle(4, PALETTE.gold, 0.9).strokeCircle(hint.x, hint.y, hint.r + 10 + k * 8);
    g.lineStyle(10, PALETTE.gold, 0.18).strokeCircle(hint.x, hint.y, hint.r + 20 + k * 8);
  }
}

// Jump to where a mission is done.
function goFor(ui, id) {
  ui.closeModal(true);
  if (id === 'daily') ui.openRewards();
  else if (id === 'kills' || id === 'push') ui.onTab('world');
  else if (id === 'train') ui.openScreen('troops');
  else if (id === 'build') { ui.onTab('base'); ui.toast('Tap a building, then Upgrade.'); }
  else if (id === 'research') { if (store.archiveUnlocked()) ui.onQueue('research'); else ui.openScreen('armory', { armoryTab: 'leaders' }); }
  else if (id === 'heal') ui.openScreen('infirmary');
}

export function openMissions(ui) {
  const reopen = () => openMissions(ui);
  const c = ui.openOverlay({
    title: 'Daily Missions', h: 1190,
    build: (c, r) => {
      const x0 = r.x + 28, xr = r.x + r.w - 28, g = ui.add.graphics(); c.add(g);
      const resetT = text(ui, x0, r.y + 74, '', 18, PALETTE.textDim); c.add(resetT);
      const pts = store.missionPoints();
      c.add(text(ui, xr, r.y + 70, `Activity ${pts} / 100`, 22, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(1, 0));
      // chest track
      const ty = r.y + 236, tx0 = x0 + 50, tx1 = xr - 50, tw = tx1 - tx0;
      g.fillStyle(0x05070a, 1).fillRoundedRect(tx0 - 6, ty - 8, tw + 12, 16, 8);
      g.fillStyle(PALETTE.cyan, 1).fillRoundedRect(tx0 - 4, ty - 6, Math.max(8, (tw + 8) * Math.min(1, pts / 100)), 12, 6);
      store.missionChests().forEach((ch) => {
        const cx = tx0 + tw * (ch.at / 100) - (ch.at === 100 ? 14 : 0), cy = ty - 66;
        const ready = ch.reached && !ch.claimed;
        const hit = button(ui, cx, cy + 10, 104, 128, '', () => {
          const res = store.claimChest(ch.at);
          if (res.ok) { audio.play('reward'); ui.toast(`${ch.tier[0].toUpperCase() + ch.tier.slice(1)} chest: ${fmtBundle(res.reward)}`, 2400); }
          else ui.toast(res.reason + (ch.claimed ? '' : `\nInside: ${fmtBundle(ch.reward)}`), 2400);
          reopen();
        }, { style: 'ghost', size: 14 });
        hit.chip = `chest-${ch.at}`; hit.alpha = 0.01; c.add(hit);
        if (ready) { g.fillStyle(PALETTE.gold, 0.22).fillCircle(cx, cy, 56); g.lineStyle(3, PALETTE.gold, 0.9).strokeCircle(cx, cy, 56); }
        const im = ui.add.image(cx, cy, `chest-${ch.tier}${ch.claimed ? '-open' : ''}`);
        im.setScale((ch.tier === 'gold' ? 96 : 86) / im.width); if (!ch.reached) im.setTint(0x8a8f99); c.add(im);
        g.fillStyle(ch.reached ? PALETTE.cyan : 0x2a3140, 1).fillCircle(tx0 + tw * (ch.at / 100), ty, 11);
        c.add(text(ui, tx0 + tw * (ch.at / 100), ty + 18, ch.claimed ? '✓' : String(ch.at), 18, ch.claimed ? PALETTE.textDim : (ready ? PALETTE.textGold : PALETTE.text), { fontStyle: 'bold' }).setOrigin(0.5, 0));
      });
      c.add(text(ui, x0, ty + 50, `Tasks reset at local midnight. The 100-point chest holds 1 Beacon Core.`, 16, PALETTE.textDim));
      // tasks
      const list = store.missionList();
      list.forEach((t, i) => {
        const y = ty + 86 + i * 92, w = r.w - 56;
        drawCard(g, x0, y, w, 82, { state: t.claimed ? 'done' : t.done ? 'ready' : 'normal', cut: 8 });
        c.add(text(ui, x0 + 14, y + 8, `${t.claimed ? '✓ ' : ''}${t.name}`, 19, t.claimed ? PALETTE.textDim : PALETTE.text, { fontStyle: 'bold', wordWrap: { width: w - 220 } }));
        const bw = 260, by = y + 56;
        drawBar(g, x0 + 14, by, bw, 12, t.progress / t.goal, { color: t.done ? PALETTE.gold : SKIN.teal });
        c.add(text(ui, x0 + 24 + bw, by - 5, `${t.progress}/${t.goal}`, 16, PALETTE.textDim));
        c.add(text(ui, xr - 196, y + 30, `+${t.pts}`, 20, PALETTE.textCyan ?? '#5ff3ff', { fontStyle: 'bold' }).setOrigin(0.5));
        if (t.claimed) c.add(text(ui, xr - 74, y + 30, 'Claimed', 17, PALETTE.textDim).setOrigin(0.5));
        else if (t.done) {
          const b = button(ui, xr - 74, y + 41, 128, 50, 'Claim', () => { const res = store.claimMission(t.id); if (res.ok) audio.play('reward'); reopen(); }, { style: 'gold', size: 20 });
          b.chip = `mission-${t.id}`; c.add(b);
        } else {
          const b = button(ui, xr - 74, y + 41, 128, 50, 'Go', () => goFor(ui, t.id), { style: 'ghost', size: 20 });
          b.chip = `mission-go-${t.id}`; c.add(b);
        }
      });
      const n = store.missionsReady();
      const yb = ty + 86 + list.length * 92 + 40;
      const all = button(ui, r.x + r.w / 2, yb, 320, 62, n ? `Claim all (${n})` : 'Nothing to claim', () => {
        const res = store.claimAllMissions();
        if (res.ok) { audio.play('reward'); ui.toast(`+${res.pts} activity${Object.keys(res.reward).length ? `\n${fmtBundle(res.reward)}` : ''}`, 2400); }
        reopen();
      }, { style: 'cyan', size: 22 });
      all.setEnabled(n > 0); all.chip = 'missions-all'; c.add(all);
      c.tick = () => resetT.setText(`Resets in ${fmtDuration(store.missionsResetIn())}`);
      c.tick();
    },
  });
  c.isMissions = true;
  return c;
}

// "2d 4h", "5h 12m", "14m"
export function fmtShort(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
// local day + time, e.g. "Sun 6:00 PM"
const fmtLocal = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Events hub: the live event (banner, countdown, points, milestone track), the next event and the Exchange.
export function openEvents(ui) {
  const reopen = () => openEvents(ui);
  const live = store.liveEvent(), next = store.nextEvent();
  const info = store.eventInfo(live ?? next), nextInfo = store.eventInfo(live ? next : store.eventService.next(next.end - 1));
  const c = ui.openOverlay({
    title: 'Events', h: 1110,
    build: (c, r) => {
      const x0 = r.x + 28, xr = r.x + r.w - 28, g = ui.add.graphics();
      // banner with the title on the (darkened) left side
      const bw = r.w - 56, bh = Math.round(bw / 3);
      const ban = ui.add.image(x0, r.y + 84, info.def.banner).setOrigin(0, 0); ban.setDisplaySize(bw, bh);
      c.add([ban, g]);
      g.lineStyle(4, SKIN.goldDk, 1).strokeRect(x0 - 2, r.y + 82, bw + 4, bh + 4).lineStyle(2, SKIN.gold, 1).strokeRect(x0, r.y + 84, bw, bh);
      c.add(text(ui, x0 + 22, r.y + 100, live ? 'LIVE EVENT' : 'NEXT EVENT', 16, info.def.hex, { fontStyle: 'bold', letterSpacing: 3 }));
      c.add(text(ui, x0 + 22, r.y + 124, info.def.name, 38, '#ffffff', { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 5 }));
      const cd = text(ui, x0 + 22, r.y + 174, '', 20, PALETTE.textGold, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }); c.add(cd);
      c.add(text(ui, x0 + 22, r.y + 204, info.def.blurb, 16, PALETTE.text, { stroke: '#05070a', strokeThickness: 3, wordWrap: { width: bw * 0.5 } }));
      c.tick = () => { const i = store.eventInfo(info); cd.setText(live ? `Ends in ${fmtShort(i.endsIn)}` : `Starts in ${fmtShort(i.startsIn)}  ·  ${fmtLocal(i.start)}`); };
      c.tick();
      let y = r.y + 84 + bh + 22;
      // points + marks
      const mark = ui.add.image(xr - 16, y + 16, 'rift-mark'); mark.setScale(36 / mark.width); c.add(mark);
      c.add(text(ui, xr - 40, y + 4, `${fmt(store.state.events.marks)} Rift Marks`, 20, '#d9b8ff', { fontStyle: 'bold' }).setOrigin(1, 0));
      c.add(text(ui, x0, y, live ? `Your points: ${fmt(info.points)}` : 'Your points: -', 24, PALETTE.text, { fontStyle: 'bold' }));
      c.add(text(ui, x0, y + 34, `+1 Rift Mark per ${EVENTS.marksPer} points  ·  ${fmtLocal(info.start)} – ${fmtLocal(info.end)} (your time)`, 15, PALETTE.textDim));
      y += 70;
      sectionHeader(ui, c, x0, y, 'HOW TO SCORE', { w: r.w - 56, color: info.def.hex, rule: info.def.color, size: 17 });
      info.def.how.forEach((h, k) => c.add(text(ui, x0 + 4, y + 28 + k * 26, `•  ${h}`, 17, PALETTE.text)));
      y += 28 + info.def.how.length * 26 + 14;
      sectionHeader(ui, c, x0, y, 'MILESTONES', { w: r.w - 56, color: info.def.hex, rule: info.def.color, size: 17 });
      y += 30;
      const top = info.def.milestones[info.def.milestones.length - 1];
      info.milestones.forEach((m) => {
        const ry = y + m.i * 70, w = r.w - 56;
        drawCard(g, x0, ry, w, 62, { state: m.claimed ? 'done' : m.reached ? 'ready' : 'normal', cut: 8 });
        g.fillStyle(info.def.color, 0.9).fillRect(x0 + 8, ry + 56, (w - 16) * Math.min(1, (live ? info.points : 0) / m.at), 3);
        c.add(text(ui, x0 + 14, ry + 6, `${m.claimed ? '✓ ' : ''}${fmt(m.at)} pts`, 20, m.claimed ? PALETTE.textDim : PALETTE.text, { fontStyle: 'bold' }));
        c.add(text(ui, x0 + 14, ry + 32, fmtBundle(m.reward), 15, m.reward.cores ? '#ff9ab3' : PALETTE.textDim));
        if (m.claimed) c.add(text(ui, xr - 74, ry + 22, 'Claimed', 17, PALETTE.textDim).setOrigin(0.5, 0));
        else {
          const b = button(ui, xr - 74, ry + 31, 128, 46, m.reached ? 'Claim' : `${Math.floor(Math.min(1, (live ? info.points : 0) / m.at) * 100)}%`, () => {
            const res = store.claimEventMilestone(info.id, m.i);
            if (res.ok) { audio.play('reward'); ui.toast(`Milestone ${fmt(m.at)}: ${fmtBundle(res.reward)}`, 2400); } else ui.toast(res.reason);
            reopen();
          }, { style: m.reached ? 'gold' : 'ghost', size: 19 });
          b.setEnabled(live && m.reached); b.chip = `ev-ms-${m.i}`; c.add(b);
        }
      });
      y += info.milestones.length * 70 + 8;
      c.add(text(ui, x0, y, `Unclaimed milestones are paid automatically when the event ends. Top milestone: ${fmt(top)} pts.`, 15, PALETTE.textDim, { wordWrap: { width: r.w - 56 } }));
      y += 44;
      if (nextInfo) c.add(text(ui, x0, y, `Next: ${nextInfo.def.name}  ·  ${fmtLocal(nextInfo.start)} (in ${fmtShort(nextInfo.startsIn)})`, 18, PALETTE.text));
      const ex = button(ui, r.x + r.w / 2 - 150, r.y + r.h - 54, 280, 70, 'Rift Exchange', () => openExchange(ui), { style: 'cyan', size: 24 });
      ex.chip = 'ev-exchange'; c.add(ex);
      const cl = button(ui, r.x + r.w / 2 + 150, r.y + r.h - 54, 240, 70, 'Close', () => ui.closeModal(true), { style: 'ghost', size: 24 });
      c.add(cl);
      const exi = ui.add.image(r.x + r.w / 2 - 262, r.y + r.h - 56, 'exchange'); exi.setScale(54 / exi.height); c.add(exi);
    },
    closeLabel: null,
  });
  c.isEvents = true;
  c.eventId = info.id;
  return c;
}

// Rift Exchange: spend Rift Marks. Limits refresh every Monday 00:00 UTC.
export function openExchange(ui) {
  const reopen = () => openExchange(ui);
  const c = ui.openOverlay({
    title: 'Rift Exchange', h: 940,
    build: (c, r) => {
      const x0 = r.x + 28, xr = r.x + r.w - 28, g = ui.add.graphics(); c.add(g);
      const stall = ui.add.image(xr - 70, r.y + 130, 'exchange'); stall.setScale(120 / stall.height); c.add(stall);
      const mark = ui.add.image(x0 + 22, r.y + 100, 'rift-mark'); mark.setScale(44 / mark.width); c.add(mark);
      c.add(text(ui, x0 + 54, r.y + 84, `${fmt(store.state.events.marks)} Rift Marks`, 28, '#d9b8ff', { fontStyle: 'bold' }));
      const rf = text(ui, x0, r.y + 136, '', 17, PALETTE.textDim); c.add(rf);
      c.add(text(ui, x0, r.y + 162, `Earn Marks in events: +1 per ${EVENTS.marksPer} points, plus milestone rewards.`, 16, PALETTE.textDim));
      c.tick = () => rf.setText(`Stock refreshes in ${fmtShort(store.shopRefreshIn())} (Monday 00:00 UTC)`);
      c.tick();
      store.shopItems().forEach((it, k) => {
        const y = r.y + 210 + k * 110, w = r.w - 56;
        drawCard(g, x0, y, w, 98, { accent: it.id === 'core' ? 0xff4f7b : null, cut: 8 });
        const icon = { energy: 'hud-energy', alloy: 'hud-alloy', stamina: 'hud-stamina', gear: 'hud-shards', core: 'hud-core' }[it.id];
        const im = ui.add.image(x0 + 48, y + 49, icon); im.setScale(60 / Math.max(im.width, im.height)); c.add(im);
        c.add(text(ui, x0 + 92, y + 12, it.name, 21, it.id === 'core' ? '#ff9ab3' : PALETTE.text, { fontStyle: 'bold' }));
        c.add(text(ui, x0 + 92, y + 42, fmtBundle(it.reward), 16, PALETTE.textDim));
        c.add(text(ui, x0 + 92, y + 66, `${it.left}/${it.limit} left this week`, 15, it.left ? PALETTE.textDim : '#ff8a95'));
        const b = button(ui, xr - 84, y + 49, 150, 58, `${it.price}`, () => {
          const res = store.buyShopItem(it.id);
          if (res.ok) { audio.play('reward'); ui.toast(`Bought: ${fmtBundle(res.reward)}`, 2000); } else ui.toast(res.reason);
          reopen();
        }, { style: it.can ? 'gold' : 'ghost', size: 22 });
        b.setEnabled(it.can); b.chip = `shop-${it.id}`; c.add(b);
        const bm = ui.add.image(xr - 128, y + 49, 'rift-mark'); bm.setScale(28 / bm.width); c.add(bm);
      });
      const back = button(ui, r.x + r.w / 2 - 130, r.y + r.h - 54, 240, 70, 'Events', () => openEvents(ui), { style: 'ghost', size: 24 });
      back.chip = 'ex-back'; c.add(back);
      c.add(button(ui, r.x + r.w / 2 + 130, r.y + r.h - 54, 240, 70, 'Close', () => ui.closeModal(true), { style: 'ghost', size: 24 }));
    },
    closeLabel: null,
  });
  c.isExchange = true;
  return c;
}

// "Rift Hunt ended" popups for events that finished (one at a time).
export function showEventSummaries(ui) {
  if (ui.modal || ui.screen || ui.reveal || !store.eventSummaries?.length || !store.missionsUnlocked()) return;
  const sm = store.eventSummaries.shift();
  const def = EVENTS.types[sm.type];
  ui.openModal({
    title: `${def.name} ended`,
    body: `You scored ${fmt(sm.points)} points.\n${sm.paid ? `Unclaimed milestone rewards paid:\n${fmtBundle(sm.paid, '\n')}` : 'All your milestone rewards were already claimed.'}`,
    buttons: [{ label: 'OK', style: 'gold' }],
  });
  ui.modal.isEventSummary = true;
}
