// Stage 10 UI: the Speed Up picker (items + Auto-use + Free / Core finish) and More → Items.
// Uses the stage 9 kit (overlay sheet, row cards, glossy buttons, price tags).
import { PALETTE, SPEEDUPS, RESEARCH, TROOP_CLASSES } from '../config.js';
import { store } from '../state/store.js';
import { planAuto, itemDef } from '../systems/speedups.js';
import { text, button, fmt, fmtClock } from './widgets.js';
import { SKIN, drawCard, drawBar, glyph, oct, lerpC, bake } from './skin.js';
import { sectionHeader } from './kit.js';
import { audio } from '../audio/audio.js';

// rim colour by size: bronze (minutes), silver-teal (hours), gold (8h), violet (24h)
const RIM = { m1: 0x9a6b3a, m5: 0x9a6b3a, m15: 0xb5844a, h1: 0x3fd9d2, h3: 0x3fd9d2, h8: 0xffcf5a, h24: 0xc08cff };

// Placeholder icon (clean, in the gold/teal kit): painted art can replace it as texture `item-su-<id>`.
export function speedupIconKey(ui, id) {
  if (ui.textures.exists(`item-su-${id}`)) return `item-su-${id}`;
  const S = 96, rim = RIM[id] ?? SKIN.gold;
  return bake(ui, `su-icon-${id}`, S, S, (g) => {
    g.fillStyle(0x000000, 0.45).fillPoints(oct(5, 7, S - 8, S - 8, 18), true);
    g.fillStyle(lerpC(rim, 0x000000, 0.55), 1).fillPoints(oct(2, 2, S - 4, S - 4, 18), true);
    g.fillStyle(rim, 1).fillPoints(oct(5, 5, S - 10, S - 10, 16), true);
    g.fillGradientStyle(0x173a40, 0x173a40, 0x070b10, 0x070b10, 1, 1, 1, 1).fillPoints(oct(10, 10, S - 20, S - 20, 13), true);
    g.fillStyle(0x3fd9d2, 0.18).fillCircle(S / 2, S / 2 - 6, 30);
    // hourglass
    const cx = S / 2, cy = S / 2 - 6;
    g.fillStyle(lerpC(rim, 0xffffff, 0.35), 1).fillRect(cx - 20, cy - 25, 40, 6).fillRect(cx - 20, cy + 19, 40, 6);
    g.fillStyle(0x9ffcf6, 0.9).fillTriangle(cx - 15, cy - 19, cx + 15, cy - 19, cx, cy);
    g.fillStyle(0x1a9c98, 1).fillTriangle(cx - 15, cy + 19, cx + 15, cy + 19, cx, cy);
    g.fillStyle(0xffe08a, 1).fillTriangle(cx - 7, cy + 19, cx + 7, cy + 19, cx, cy + 9);
    g.lineStyle(2, lerpC(rim, 0xffffff, 0.5), 1).strokeTriangle(cx - 15, cy - 19, cx + 15, cy - 19, cx, cy).strokeTriangle(cx - 15, cy + 19, cx + 15, cy + 19, cx, cy);
    g.fillStyle(0xffffff, 0.12).fillRect(14, 12, S - 28, 8);
  });
}

// icon + its short label ("1h") on a dark plate at the bottom
export function speedupIcon(ui, c, id, x, y, size) {
  const im = ui.add.image(x, y, speedupIconKey(ui, id)); im.setScale(size / 96);
  const t = text(ui, x, y + size * 0.36, itemDef(id).short, Math.round(size * 0.24), '#fff3cf', { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5);
  c.add([im, t]);
  return { im, t };
}

export function jobLabel(job) {
  if (job.kind === 'build') return `${store.nameOf(job.id)} → Lv ${store.constructionJob(job.id)?.toLevel ?? ''}`;
  if (job.kind === 'research') { const j = store.researchJob(); return j ? `${RESEARCH[j.id].name} Lv ${j.toLevel}` : 'Research'; }
  if (job.kind === 'lane') { const l = store.lane(job.id); return `Training ${l?.count ?? 0} ${TROOP_CLASSES[l?.unit]?.plural ?? ''}`; }
  return 'Healing queue';
}

const doneToast = (ui, job) => ui.toast(`${jobLabel(job).split(' →')[0]} finished!`, 1600);

// Finishes now: free when allowed, else Cores (with a confirm at SPEEDUPS.confirmAt or more).
export function finishNow(ui, job, after = null) {
  if (store.canFreeFinish(job)) {
    const lbl = jobLabel(job);
    const r = store.freeFinish(job);
    if (r.ok) { audio.play('reward'); ui.toast(`${lbl.split(' →')[0]} finished free`, 1600); after?.(); }
    return r;
  }
  const cost = store.finishCoreCost(job);
  const go = () => {
    const lbl = jobLabel(job);
    const r = store.coreFinish(job);
    if (!r.ok) { ui.toast(r.reason); return; }
    audio.play('reward'); ui.toast(`${lbl.split(' →')[0]} finished  (−${r.cores} Beacon Core${r.cores === 1 ? '' : 's'})`, 1800);
    after?.();
  };
  if (store.state.resources.cores < cost) { ui.toast(`Needs ${cost} Beacon Cores (you have ${fmt(store.state.resources.cores)})`); return { ok: false }; }
  if (cost >= SPEEDUPS.confirmAt) {
    ui.openModal({
      title: `Finish for ${cost} Cores?`,
      body: `${jobLabel(job)} has ${fmtClock(store.jobLeft(job))} left.\nSpend ${cost} Beacon Cores to finish it now? You have ${fmt(store.state.resources.cores)}.`,
      buttons: [{ label: 'Cancel' }, { label: `Finish · ${cost}`, style: 'gold', onClick: go }],
    });
    return { ok: true, confirm: true };
  }
  go();
  return { ok: true };
}

// Speed Up picker. Training lanes + healing have no items: just Free / Core finish.
export function openSpeedUp(ui, job) {
  if (!store.jobActive(job)) { ui.toast('Nothing running'); return; }
  const items = store.itemsAllowed(job);
  const reopen = () => { if (store.jobActive(job)) openSpeedUp(ui, job); else { ui.closeModal(true); doneToast(ui, job); } };
  ui.openOverlay({
    title: 'Speed Up', h: items ? 1110 : 520, tab: ui.activeTab,
    build: (c, r) => {
      const x0 = r.x + 28, w0 = r.w - 56;
      // job + live countdown
      let y = r.y + 88;
      const jg = ui.add.graphics(); c.add(jg);
      drawCard(jg, x0, y, w0, 96, { accent: SKIN.teal });
      const jt = text(ui, x0 + 18, y + 12, jobLabel(job), 22, '#ffe2a6', { fontStyle: 'bold' });
      if (jt.width > w0 - 190) jt.setScale((w0 - 190) / jt.width);
      const lt = text(ui, x0 + w0 - 18, y + 12, '', 22, PALETTE.textCyan, { fontStyle: 'bold' }).setOrigin(1, 0);
      const bar = ui.add.graphics();
      c.add([jt, lt, bar]);
      const upd = () => {
        if (!c.active) return;
        const left = store.jobLeft(job);
        lt.setText(`${fmtClock(left)} left`);
        const tot = job.kind === 'build' ? store.constructionJob(job.id)?.total : job.kind === 'research' ? store.researchJob()?.total : null;
        bar.clear(); drawBar(bar, x0 + 18, y + 58, w0 - 36, 18, tot ? Math.min(1, 1 - left / tot) : 0.5, { color: SKIN.gold });
      };
      upd();
      const tick = ui.time.addEvent({ delay: 250, loop: true, callback: () => { if (!c.active) { tick.remove(); return; } upd(); if (!store.jobActive(job)) { tick.remove(); reopen(); } } });
      c.once('destroy', () => tick.remove());
      y += 112;
      if (items) {
        // Auto-use
        const plan = planAuto(store.jobLeft(job), store.state.items);
        const ag = ui.add.graphics(); c.add(ag);
        drawCard(ag, x0, y, w0, 84, { accent: SKIN.gold });
        const desc = plan.count ? Object.entries(plan.use).map(([id, n]) => `${n}× ${itemDef(id).short}`).join(' + ') : 'No speed-ups yet';
        c.add(text(ui, x0 + 18, y + 12, 'AUTO-USE', 16, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
        const dt = text(ui, x0 + 18, y + 38, `${desc}${plan.count ? (plan.covers ? '  ·  finishes it' : `  ·  −${fmtClock(plan.seconds)}`) : ''}`, 18, PALETTE.text, { wordWrap: { width: w0 - 230 } });
        c.add(dt);
        const ab = button(ui, x0 + w0 - 100, y + 42, 180, 62, 'Auto-use', () => {
          const res = store.autoUseSpeedups(job);
          if (!res.ok) { ui.toast(res.reason); return; }
          audio.play('reward'); ui.toast(`Used ${res.used} speed-up${res.used === 1 ? '' : 's'}  (−${fmtClock(res.seconds)})`, 1600);
          reopen();
        }, { style: 'gold', size: 22 });
        ab.chip = 'su-auto'; ab.setEnabled(plan.count > 0); c.add(ab);
        y += 100;
        sectionHeader(ui, c, x0, y, 'SPEED-UPS', { w: w0, right: `${store.itemsTotal()} owned` });
        y += 36;
        for (const it of SPEEDUPS.items) {
          const n = store.itemCount(it.id), rh = 80;
          const g = ui.add.graphics(); c.add(g);
          drawCard(g, x0, y, w0, rh - 8, { state: n ? 'normal' : 'locked' });
          speedupIcon(ui, c, it.id, x0 + 40, y + 36, 62);
          c.add(text(ui, x0 + 82, y + 10, it.name, 20, n ? PALETTE.text : PALETTE.textDim, { fontStyle: 'bold' }));
          c.add(text(ui, x0 + 82, y + 38, `Owned ${n}  ·  −${fmtClock(it.seconds)}`, 16, n ? PALETTE.textCyan : PALETTE.textDim));
          const left = store.jobLeft(job);
          const k = Math.max(1, Math.min(n, Math.ceil((left - SPEEDUPS.autoWaste) / it.seconds)));
          const use = (cnt) => { const res = store.useSpeedups(job, { [it.id]: cnt }); if (!res.ok) { ui.toast(res.reason); return; } audio.play('reward'); ui.toast(`−${fmtClock(res.seconds)}`, 1200); reopen(); };
          const b1 = button(ui, x0 + w0 - 222, y + 36, 100, 56, 'Use', () => use(1), { style: 'cyan', size: 20 });
          b1.chip = `su-use-${it.id}`; b1.setEnabled(n > 0);
          const bn = button(ui, x0 + w0 - 64, y + 36, 112, 56, `Use ×${k}`, () => use(k), { style: 'ghost', size: 19 });
          bn.chip = `su-usen-${it.id}`; bn.setVisible(n > 1 && k > 1);
          c.add([b1, bn]);
          y += rh;
        }
        y += 6;
      } else {
        c.add(text(ui, x0, y, 'Speed-up items work on construction and research. Training and healing can be finished free in the last 5 minutes, or with Beacon Cores.', 18, PALETTE.textDim, { wordWrap: { width: w0 }, lineSpacing: 4 }));
        y += 90;
      }
      // finish now
      const free = store.canFreeFinish(job), cost = store.finishCoreCost(job);
      const fb = button(ui, x0 + w0 / 2, y + 40, w0, 72, free ? 'Finish now  ·  FREE' : `Finish now  ·  ${cost} Beacon Core${cost === 1 ? '' : 's'}`, () => finishNow(ui, job, () => { if (ui.modal === c) ui.closeModal(true); }), { style: free ? 'gold' : 'cyan', size: 24 });
      fb.chip = free ? 'su-free' : 'su-cores';
      fb.setEnabled(free || store.state.resources.cores >= cost);
      c.add(fb);
      c.add(text(ui, x0 + w0 / 2, y + 86, free ? `Under ${SPEEDUPS.freeSeconds / 60} min left: finishing is free.` : `You have ${fmt(store.state.resources.cores)} Beacon Cores  ·  free in the last ${SPEEDUPS.freeSeconds / 60} min`, 16, PALETTE.textDim).setOrigin(0.5, 0));
    },
  });
  ui.modal.isSpeedUp = job;
}

// More → Items: the speed-up inventory.
export function openItems(ui) {
  ui.openOverlay({
    title: 'Items', h: 900, tab: 'more',
    build: (c, r) => {
      const x0 = r.x + 28, w0 = r.w - 56;
      let y = r.y + 90;
      sectionHeader(ui, c, x0, y, 'SPEED-UPS', { w: w0, right: `${store.itemsTotal()} owned` });
      y += 40;
      const cols = 2, gap = 14, tw = (w0 - gap) / cols, th = 92;
      SPEEDUPS.items.forEach((it, i) => {
        const tx = x0 + (i % cols) * (tw + gap), ty = y + Math.floor(i / cols) * (th + 10), n = store.itemCount(it.id);
        const g = ui.add.graphics(); c.add(g);
        drawCard(g, tx, ty, tw, th, { state: n ? 'normal' : 'locked' });
        speedupIcon(ui, c, it.id, tx + 46, ty + th / 2, 70);
        c.add(text(ui, tx + 92, ty + 16, it.name, 19, n ? PALETTE.text : PALETTE.textDim, { fontStyle: 'bold' }));
        c.add(text(ui, tx + 92, ty + 48, `×${fmt(n)}`, 24, n ? PALETTE.textGold : PALETTE.textDim, { fontStyle: 'bold' }));
      });
      y += Math.ceil(SPEEDUPS.items.length / cols) * (th + 10) + 8;
      c.add(text(ui, x0, y, [
        'Use speed-ups from the Speed Up button on a building upgrade or a research project.',
        `Anything with ${SPEEDUPS.freeSeconds / 60} min or less left finishes free, and Beacon Cores can finish any timer.`,
        'Earn them from daily mission chests, the daily login, event milestones, Beacon level rewards and the Rift Exchange.',
      ].join('\n\n'), 17, PALETTE.textDim, { wordWrap: { width: w0 }, lineSpacing: 4 }));
    },
  });
}
void glyph;
