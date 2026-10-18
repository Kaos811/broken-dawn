import { PALETTE, TROOP_CLASSES, TROOP_IDS, INFIRMARY, SQUADS, TROOPS } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { header, card, portrait } from './common.js';

const GREEN = 0x4dff9a;

export function renderInfirmary(ui, c, a, api) {
  const lv = store.infirmaryLevel;
  const sub = header(ui, c, a, 'INFIRMARY', '', GREEN);
  api.dyn(() => sub.setText(`Lv ${lv}  ·  ${store.infirmaryCapacity()} beds  ·  heal x${INFIRMARY.healSpeed(lv).toFixed(2)}`));

  // --- beds
  const y0 = a.y + 80;
  card(ui, c, 16, y0, 688, 110, { accent: GREEN, stroke: GREEN });
  c.add(text(ui, 36, y0 + 12, 'BEDS', 18, PALETTE.textDim, { letterSpacing: 2 }));
  const beds = text(ui, 36, y0 + 34, '', 30, PALETTE.text, { fontStyle: 'bold' });
  const bar = ui.add.graphics();
  c.add([beds, bar]);
  c.add(text(ui, 36, y0 + 80, `Wounded beyond capacity die. Lv ${lv + 1}: ${INFIRMARY.capacity(lv + 1)} beds, x${INFIRMARY.healSpeed(lv + 1).toFixed(2)} speed.`, 16, PALETTE.textDim));
  const healAll = button(ui, 588, y0 + 50, 200, 64, 'Heal all', () => {
    const r = store.healAll();
    api.toast(r.ok ? `Healing ${r.n} troops  (−${fmt(r.cost)} Energy)` : r.reason);
  }, { style: 'gold', size: 22 });
  healAll.chip = 'heal-all';
  c.add(healAll);
  api.dyn(() => {
    const used = store.woundedTotal(), cap = store.infirmaryCapacity();
    beds.setText(`${used} / ${cap}`).setColor(used >= cap ? '#ff8a95' : PALETTE.text);
    bar.clear().fillStyle(0x05070a, 1).fillRect(200, y0 + 44, 260, 20).fillStyle(used >= cap ? 0xff4d5e : GREEN, 1).fillRect(202, y0 + 46, 256 * Math.min(1, used / cap), 16).lineStyle(1.5, PALETTE.metalEdge, 1).strokeRect(200, y0 + 44, 260, 20);
    const waiting = TROOP_IDS.reduce((n, t) => n + store.woundedPool(t), 0);
    healAll.setEnabled(waiting > 0 && TROOP_IDS.some((t) => store.maxHealable(t) > 0)).setLabel(waiting ? `Heal all (${waiting})` : 'Heal all');
  });

  // --- per class
  const CH = 150;
  TROOP_IDS.forEach((t, i) => {
    const def = TROOP_CLASSES[t], H = INFIRMARY.heal[t];
    const y = y0 + 122 + i * (CH + 10);
    card(ui, c, 16, y, 688, CH, { accent: def.color, stroke: def.color });
    portrait(ui, c, `portrait-${t}`, 30, y + 14, 96, def.color);
    c.add(text(ui, 142, y + 12, def.plural, 26, def.colorHex, { fontStyle: 'bold' }));
    const wl = text(ui, 142, y + 46, '', 19, '#8fffc1');
    const cost = text(ui, 142, y + 74, '', 17, PALETTE.textDim);
    c.add([wl, cost]);
    const b1 = button(ui, 142 + 60, y + 118, 120, 46, 'Heal 1', () => { const r = store.heal(t, 1); if (!r.ok) api.toast(r.reason); }, { style: 'cyan', size: 20 });
    const bAll = button(ui, 142 + 250, y + 118, 230, 46, 'Heal all', () => { const r = store.heal(t, store.maxHealable(t)); api.toast(r.ok ? `Healing ${r.n} ${r.n === 1 ? def.name : def.plural}  (−${fmt(r.cost)} Energy)` : r.reason); }, { style: 'gold', size: 20 });
    b1.chip = `heal1-${t}`; bAll.chip = `heal-${t}`;
    c.add([b1, bAll]);
    api.dyn(() => {
      const w = store.state.infirmary.wounded[t];
      const from = [...TROOPS.squadIds, 'reserve'].filter((o) => w[o] > 0).map((o) => `${o === 'reserve' ? 'Reserve' : SQUADS[o].name} ${w[o]}`).join(' · ');
      const pool = store.woundedPool(t), q = store.woundedQueued(t);
      wl.setText(`Waiting ${pool}${from ? `  (${from})` : ''}${q ? `   ·   healing ${q}` : ''}`).setColor(pool || q ? '#8fffc1' : PALETTE.textDim);
      cost.setText(`${H.energy} Energy  ·  ${store.healUnitTime(t).toFixed(1)}s each  ·  rejoins its squad`);
      const m = store.maxHealable(t);
      b1.setEnabled(store.healInfo(t, 1).can);
      bAll.setEnabled(m > 0).setLabel(m > 0 ? `Heal all (${m})` : 'Heal all');
    });
  });

  // --- healing queue
  const qy = y0 + 122 + 3 * (CH + 10), qh = a.y + a.h - qy - 12;
  card(ui, c, 16, qy, 688, qh, { accent: GREEN });
  c.add(text(ui, 36, qy + 14, 'HEALING QUEUE', 20, '#8fffc1', { fontStyle: 'bold', letterSpacing: 2 }));
  const qInfo = text(ui, 684, qy + 16, '', 17, PALETTE.textDim).setOrigin(1, 0);
  c.add(qInfo);
  const qg = ui.add.graphics(); c.add(qg);
  const maxRows = Math.max(1, Math.floor((qh - 120) / 58));
  const rowsUi = Array.from({ length: maxRows }, (_, k) => {
    const ry = qy + 52 + k * 58;
    const lbl = text(ui, 40, ry, '', 20, PALETTE.text, { fontStyle: 'bold' });
    const tm = text(ui, 600, ry + 2, '', 17, PALETTE.textCyan).setOrigin(1, 0);
    const x = button(ui, 652, ry + 20, 56, 42, '✕', () => {
      const r = store.cancelHeal(k);
      if (r.ok) api.toast(`Cancelled ${r.n}. Refunded ${fmt(r.refund)} Energy`);
    }, { style: 'ghost', size: 18 });
    x.chip = `cancel-heal-${k}`;
    c.add([lbl, tm, x]);
    return { ry, lbl, tm, x };
  });
  const foot = text(ui, 36, qy + qh - 60, '', 17, PALETTE.textDim, { wordWrap: { width: 460 } });
  c.add(foot);
  c.add(button(ui, 598, qy + qh - 40, 190, 56, 'Barracks', () => api.go('troops'), { style: 'cyan', size: 21 }));
  api.dyn(() => {
    const q = store.state.infirmary.queue;
    qInfo.setText(q.length ? `${q.reduce((n, b) => n + b.count, 0)} healing  ·  all done ${fmtClock(store.healQueueSeconds())}` : 'Idle');
    qg.clear();
    rowsUi.forEach((r, k) => {
      const b = q[k];
      r.lbl.setVisible(!!b); r.tm.setVisible(!!b); r.x.setVisible(!!b);
      if (!b) return;
      const def = TROOP_CLASSES[b.type];
      const to = [...TROOPS.squadIds, 'reserve'].filter((o) => b.from[o] > 0).map((o) => (o === 'reserve' ? 'Reserve' : SQUADS[o].name)).join(', ');
      r.lbl.setText(`${def.plural} ×${b.count}  →  ${to}`).setColor(def.colorHex);
      const ut = store.healUnitTime(b.type);
      r.tm.setText(k === 0 ? `next ${fmtClock(ut - b.progress)}  ·  ${fmtClock(b.count * ut - b.progress)}` : `${fmtClock(b.count * ut)}  (refund ${fmt(b.count * b.energyPer)})`);
      qg.fillStyle(0x05070a, 1).fillRect(40, r.ry + 30, 556, 8);
      if (k === 0) qg.fillStyle(def.color, 1).fillRect(40, r.ry + 30, 556 * Math.min(1, b.progress / ut), 8);
    });
    if (q.length > rowsUi.length) qg.fillStyle(0, 0); // (more batches than rows: they're still processed in order)
    foot.setText(`Fallen in battle: ${store.state.hunt.dead}. Dead troops are gone; retrain them in the Barracks. Healing keeps going offline.`);
  });
}
