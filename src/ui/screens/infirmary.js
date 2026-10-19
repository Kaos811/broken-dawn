import { PALETTE, TROOP_CLASSES, TROOP_IDS, INFIRMARY, SQUADS, TROOPS, TIERS } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { header, card, portrait, sectionHeader } from './common.js';
import { troopFigure } from './troops.js';
import { SKIN, drawBar, glyph } from '../skin.js';

const GREEN = 0x4dff9a;

export function renderInfirmary(ui, c, a, api) {
  const lv = store.infirmaryLevel;
  const sub = header(ui, c, a, 'INFIRMARY', '', GREEN, { art: 'art-infirmary' });
  api.dyn(() => sub.setText(`Lv ${lv}  ·  ${store.infirmaryCapacity()} beds  ·  heal x${store.healSpeed().toFixed(2)}`));

  // --- beds
  const y0 = a.y + 80;
  card(ui, c, 16, y0, 688, 110, { stroke: 0x2f8a5c, accent: GREEN, glow: GREEN });
  const bedG = ui.add.graphics(); glyph(bedG, 'beds', 44, y0 + 26, 10, GREEN); c.add(bedG);
  c.add(text(ui, 62, y0 + 14, 'BEDS', 18, '#8fffc1', { fontStyle: 'bold', letterSpacing: 2.5 }));
  const beds = text(ui, 36, y0 + 34, '', 30, PALETTE.text, { fontStyle: 'bold' });
  const bar = ui.add.graphics();
  c.add([beds, bar]);
  c.add(text(ui, 36, y0 + 80, `Wounded beyond capacity die. Lv ${lv + 1}: ${Math.floor(INFIRMARY.capacity(lv + 1) * store.mods.beds)} beds, x${(INFIRMARY.healSpeed(lv + 1) * store.mods.healSpeed).toFixed(2)} speed.`, 16, PALETTE.textDim));
  const healAll = button(ui, 588, y0 + 50, 200, 70, 'Heal all', () => {
    const r = store.healAll();
    api.toast(r.ok ? `Healing ${r.n} troops  (−${fmt(r.cost)} Energy)` : r.reason);
  }, { style: 'gold', size: 22 });
  healAll.chip = 'heal-all';
  c.add(healAll);
  api.dyn(() => {
    const used = store.woundedTotal(), cap = store.infirmaryCapacity();
    beds.setText(`${used} / ${cap}`).setColor(used >= cap ? '#ff8a95' : PALETTE.text);
    bar.clear(); drawBar(bar, 200, y0 + 44, 260, 20, used / cap, { color: used >= cap ? SKIN.red : 0x2fd27a });
    const waiting = TROOP_IDS.reduce((n, t) => n + store.woundedPool(t), 0);
    healAll.setEnabled(waiting > 0 && TROOP_IDS.some((t) => store.maxHealable(t) > 0)).setLabel(waiting ? `Heal all (${waiting})` : 'Heal all');
  });

  // --- per unit: T1 rows always, T2/T3 rows only while some are wounded (compact when there are more than 3)
  const units = TROOP_IDS.filter((t) => TROOP_CLASSES[t].tier === 1 || store.woundedPool(t) + store.woundedQueued(t) > 0);
  const compact = units.length > 3;
  const CH = compact ? Math.max(84, Math.floor((470 - (units.length - 1) * 8) / units.length)) : 150;
  units.forEach((t, i) => {
    const def = TROOP_CLASSES[t];
    const y = y0 + 122 + i * (CH + (compact ? 8 : 10));
    card(ui, c, 16, y, 688, CH, { stroke: 0x8a6a3a, accent: def.color });
    if (compact) portrait(ui, c, `portrait-${t}`, 30, y + 8, (CH - 16) * 0.83, def.color);
    else troopFigure(ui, c, t, 28, y + 10, 104, CH - 20);
    const nx = compact ? 30 + CH - 6 : 148;
    c.add(text(ui, nx, y + (compact ? 6 : 12), `${def.plural}${def.tier > 1 ? ` · ${TIERS[def.tier].label}` : ''}`, compact ? 21 : 26, def.colorHex, { fontStyle: 'bold' }));
    const wl = text(ui, nx, y + (compact ? 34 : 42), '', compact ? 16 : 19, '#8fffc1', { wordWrap: { width: compact ? 330 : 540 } });
    const cost = text(ui, nx, y + (compact ? CH - 26 : 66), '', compact ? 15 : 17, PALETTE.textDim);
    c.add([wl, cost]);
    const by = compact ? y + CH / 2 : y + 117;
    const b1 = button(ui, compact ? 530 : 148 + 62, by, compact ? 100 : 124, compact ? 46 : 56, 'Heal 1', () => { const r = store.heal(t, 1); if (!r.ok) api.toast(r.reason); }, { style: 'cyan', size: compact ? 17 : 20 });
    const bAll = button(ui, compact ? 640 : 148 + 254, by, compact ? 110 : 236, compact ? 46 : 56, 'Heal all', () => { const r = store.heal(t, store.maxHealable(t)); api.toast(r.ok ? `Healing ${r.n} ${r.n === 1 ? def.name : def.plural}  (−${fmt(r.cost)} Energy)` : r.reason); }, { style: 'gold', size: compact ? 16 : 20 });
    b1.chip = `heal1-${t}`; bAll.chip = `heal-${t}`;
    c.add([b1, bAll]);
    api.dyn(() => {
      const w = store.state.infirmary.wounded[t];
      const from = [...TROOPS.squadIds, 'reserve'].filter((o) => w[o] > 0).map((o) => `${o === 'reserve' ? 'Reserve' : SQUADS[o].name} ${w[o]}`).join(' · ');
      const pool = store.woundedPool(t), q = store.woundedQueued(t);
      wl.setText(`Waiting ${pool}${from ? `  (${from})` : ''}${q ? `   ·   healing ${q}` : ''}`).setColor(pool || q ? '#8fffc1' : PALETTE.textDim);
      cost.setText(`${fmt(store.healEnergy(t))} Energy  ·  ${store.healUnitTime(t).toFixed(1)}s each${compact ? '' : '  ·  rejoins its squad'}`);
      const m = store.maxHealable(t);
      b1.setEnabled(store.healInfo(t, 1).can);
      bAll.setEnabled(m > 0).setLabel(m > 0 ? (compact ? `All (${m})` : `Heal all (${m})`) : (compact ? 'All' : 'Heal all'));
    });
  });

  // --- healing queue
  const qy = compact ? y0 + 122 + 482 : y0 + 122 + 3 * (CH + 10), qh = a.y + a.h - qy - 12;
  card(ui, c, 16, qy, 688, qh, { stroke: 0x8a6a3a });
  const qInfo = sectionHeader(ui, c, 32, qy + 14, 'HEALING QUEUE', { w: 656, color: '#8fffc1', rule: GREEN, right: '' }).rightText;
  const qg = ui.add.graphics(); c.add(qg);
  const maxRows = Math.max(1, Math.floor((qh - 120) / 58));
  const rowsUi = Array.from({ length: maxRows }, (_, k) => {
    const ry = qy + 52 + k * 58;
    const lbl = text(ui, 40, ry, '', 20, PALETTE.text, { fontStyle: 'bold' });
    const tm = text(ui, 600, ry + 2, '', 17, PALETTE.textCyan).setOrigin(1, 0);
    const x = button(ui, 652, ry + 20, 60, 44, '✕', () => {
      const r = store.cancelHeal(k);
      if (r.ok) api.toast(`Cancelled ${r.n}. Refunded ${fmt(r.refund)} Energy`);
    }, { style: 'ghost', size: 18 });
    x.chip = `cancel-heal-${k}`;
    c.add([lbl, tm, x]);
    return { ry, lbl, tm, x };
  });
  const foot = text(ui, 36, qy + qh - 60, '', 17, PALETTE.textDim, { wordWrap: { width: 460 } });
  c.add(foot);
  c.add(button(ui, 598, qy + qh - 42, 190, 62, 'Barracks', () => api.go('troops'), { style: 'cyan', size: 21 }));
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
      drawBar(qg, 40, r.ry + 30, 556, 10, k === 0 ? Math.min(1, b.progress / ut) : 0, { color: 0x2fd27a });
    });
    if (q.length > rowsUi.length) qg.fillStyle(0, 0); // (more batches than rows: they're still processed in order)
    foot.setText(`Fallen in battle: ${store.state.hunt.dead}. Dead troops are gone; retrain them in the Barracks. Healing keeps going offline.`);
  });
}
