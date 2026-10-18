import { PALETTE, TROOP_CLASSES, TROOP_IDS, BARRACKS } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { header, card, portrait, tapZone } from './common.js';

export function renderTroops(ui, c, a, api) {
  const lv = store.barracksLevel;
  const sub = header(ui, c, a, 'BARRACKS', '');
  api.dyn(() => sub.setText(`Lv ${lv}  ·  Speed x${BARRACKS.trainSpeed(lv).toFixed(1)}  ·  Queue ${store.queuedUnits()}/${store.queueCapacity()}`));

  const CH = 176, GAP = 10;
  TROOP_IDS.forEach((t, i) => {
    const def = TROOP_CLASSES[t];
    const y = a.y + 86 + i * (CH + GAP), x = 16, w = 688;
    card(ui, c, x, y, w, CH, { accent: def.color, stroke: def.color });
    portrait(ui, c, `portrait-${t}`, x + 14, y + 18, 116, def.color);
    tapZone(ui, c, x + 14, y + 18, 116, 140, () => showClassInfo(ui, api, t), `info-${t}`);
    c.add(text(ui, x + 148, y + 12, def.plural, 30, def.colorHex, { fontStyle: 'bold' }));
    c.add(text(ui, x + w - 16, y + 20, def.role.toUpperCase(), 17, PALETTE.textDim, { letterSpacing: 2 }).setOrigin(1, 0));
    c.add(text(ui, x + 148, y + 48, `HP ${def.hp}   ATK ${def.atk}   DEF ${def.def}`, 21, PALETTE.text));
    const counts = text(ui, x + 148, y + 74, "", 21, PALETTE.textCyan);
    c.add(counts);
    const cost = text(ui, x + 148, y + 98, "", 19, PALETTE.textDim);
    c.add(cost);
    const mk = (bx, bw, label, n, style) => {
      const b = button(ui, bx + bw / 2, y + 146, bw, 48, label, () => {
        const want = typeof n === 'function' ? n() : n;
        const r = store.train(t, want);
        if (!r.ok) api.toast(r.reason);
        else api.toast(`Training ${r.n} ${r.n === 1 ? def.name : def.plural}  (−${fmt(r.cost)} Energy)`, 1400);
      }, { style, size: 22 });
      b.trainType = t;
      c.add(b);
      return b;
    };
    const b1 = mk(x + 148, 110, 'x1', 1, 'cyan');
    const b10 = mk(x + 266, 110, 'x10', 10, 'cyan');
    const bMax = mk(x + 384, 190, 'Max', () => store.maxTrainable(t), 'gold');
    api.dyn(() => {
      const ready = store.readyCount(t), asg = store.assignedCount(t);
      counts.setText(`Ready ${ready}   ·   Assigned ${asg}   ·   Owned ${store.state.troops[t]}`);
      cost.setText(`${def.energy} Energy  ·  ${store.unitTime(t).toFixed(1)}s per unit`);
      const m = store.maxTrainable(t);
      b1.setEnabled(store.trainInfo(t, 1).can);
      b10.setEnabled(store.trainInfo(t, 10).can);
      bMax.setEnabled(m > 0 && store.trainInfo(t, m).can).setLabel(m > 0 ? `Max (${m})` : 'Max');
    });
  });

  // ---- Training queue
  const qy = a.y + 86 + 3 * (CH + GAP), qh = a.y + a.h - qy - 12;
  card(ui, c, 16, qy, 688, qh, { accent: PALETTE.gold });
  c.add(text(ui, 36, qy + 16, 'TRAINING QUEUE', 22, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  const qInfo = text(ui, 684, qy + 18, '', 19, PALETTE.textDim).setOrigin(1, 0);
  c.add(qInfo);
  const bar = ui.add.graphics();
  c.add(bar);
  const q = store.state.training;
  const rows = q.map((b, i) => {
    const ry = qy + 64 + i * 38;
    const def = TROOP_CLASSES[b.type];
    const dot = ui.add.graphics(); dot.fillStyle(def.color, 1).fillCircle(44, ry + 15, 7); c.add(dot);
    const label = text(ui, 62, ry + 2, `${def.plural} x${b.count}`, 21, PALETTE.text, { fontStyle: 'bold' });
    const time = text(ui, 600, ry + 2, '', 20, PALETTE.textCyan).setOrigin(1, 0);
    c.add([label, time]);
    const x = button(ui, 650, ry + 14, 50, 36, '✕', () => {
      const r = store.cancelBatch(i);
      if (r.ok) api.toast(`Cancelled. Refunded ${fmt(r.refund)} Energy`);
    }, { style: 'ghost', size: 18 });
    x.cancelIndex = i;
    c.add(x);
    return { b, i, time, ry };
  });
  if (!q.length) {
    c.add(text(ui, 36, qy + 74, 'Queue empty. Train troops above.\nTraining keeps running while you\'re away (up to 8h).', 20, PALETTE.textDim, { lineSpacing: 6 }));
  }
  const foot = text(ui, 36, qy + qh - 38, '', 19, PALETTE.textDim);
  c.add(foot);
  api.dyn(() => {
    const used = store.queuedUnits(), cap = store.queueCapacity();
    qInfo.setText(`${used} / ${cap} units`);
    bar.clear();
    bar.fillStyle(0x05070a, 1).fillRect(36, qy + 48, 648, 8);
    bar.fillStyle(PALETTE.gold, 0.9).fillRect(36, qy + 48, 648 * Math.min(1, used / cap), 8);
    let acc = 0;
    for (const r of rows) {
      const ut = store.unitTime(r.b.type);
      const left = r.b.count * ut - (r.i === 0 ? r.b.progress : 0);
      acc += left;
      r.time.setText(r.i === 0 ? `next ${fmtClock(ut - r.b.progress)} · all ${fmtClock(left)}` : fmtClock(left));
      if (r.i === 0) {
        bar.fillStyle(0x05070a, 1).fillRect(62, r.ry + 32, 540, 5);
        bar.fillStyle(PALETTE.cyan, 1).fillRect(62, r.ry + 32, 540 * Math.min(1, r.b.progress / ut), 5);
      }
    }
    foot.setText(q.length ? `Queue finishes in ${fmtClock(acc)}  ·  Barracks Lv ${lv + 1}: ${BARRACKS.queueCapacity(lv + 1)} slots, x${BARRACKS.trainSpeed(lv + 1).toFixed(1)} speed` : `Upgrade the Barracks for more slots (${BARRACKS.queueCapacity(lv + 1)}) and faster training.`);
  });
}

function showClassInfo(ui, api, t) {
  const def = TROOP_CLASSES[t];
  api.overlay({
    title: def.plural, h: 720,
    build: (c, r) => {
      portrait(ui, c, `portrait-${t}`, r.x + 28, r.y + 90, 250, def.color);
      c.add(text(ui, r.x + 300, r.y + 92, def.role, 26, def.colorHex, { fontStyle: 'bold' }));
      c.add(text(ui, r.x + 300, r.y + 136, `HP   ${def.hp}\nATK  ${def.atk}\nDEF  ${def.def}\n\nCost  ${def.energy} Energy\nTime  ${store.unitTime(t).toFixed(1)}s`, 24, PALETTE.text, { lineSpacing: 8 }));
      c.add(text(ui, r.x + 28, r.y + 410, def.description, 22, PALETTE.textDim, { wordWrap: { width: r.w - 56 }, lineSpacing: 6 }));
      c.add(text(ui, r.x + 28, r.y + 500, `Each soldier adds 1 Troop Power. Ready: ${store.readyCount(t)}  ·  Assigned: ${store.assignedCount(t)}`, 20, PALETTE.textCyan, { wordWrap: { width: r.w - 56 } }));
    },
  });
}
