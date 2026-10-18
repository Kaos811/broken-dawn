import { PALETTE, TROOP_CLASSES, CLASS_IDS, BARRACKS, TIERS, MAX_TIER, PROMOTE, unitOf, nextTier } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { header, card, portrait, tapZone } from './common.js';

const costStr = (e, a) => `${fmt(e)} Energy${a ? ` + ${fmt(a)} Alloy` : ''}`;

export function renderTroops(ui, c, a, api, st) {
  const lv = store.barracksLevel;
  const sub = header(ui, c, a, 'BARRACKS', '');
  api.dyn(() => sub.setText(`Lv ${lv}  ·  Speed x${(BARRACKS.trainSpeed(lv) * store.mods.train).toFixed(2)}  ·  3 lanes × ${store.laneCapacity()}`));
  st.tierSel ??= {};

  const CH = 196, GAP = 10;
  CLASS_IDS.forEach((cls, i) => {
    const tier = Math.min(st.tierSel[cls] ?? 1, MAX_TIER);
    const t = unitOf(cls, tier);
    const def = TROOP_CLASSES[t];
    const y = a.y + 82 + i * (CH + GAP), x = 16, w = 688;
    card(ui, c, x, y, w, CH, { accent: def.color, stroke: def.color });
    portrait(ui, c, `portrait-${t}`, x + 14, y + 18, 116, def.color);
    tapZone(ui, c, x + 14, y + 18, 116, 140, () => showClassInfo(ui, api, t), `info-${t}`);
    c.add(text(ui, x + 148, y + 12, def.plural, 30, def.colorHex, { fontStyle: 'bold' }));
    // tier tabs (T1 / T2 / T3): a locked tier shows a lock but can still be viewed
    for (let k = 1; k <= MAX_TIER; k++) {
      const locked = !store.tierUnlocked(k);
      const tb = button(ui, x + w - 16 - (MAX_TIER - k) * 72 - 34, y + 30, 66, 40, `${locked ? '🔒' : ''}${TIERS[k].label}`, () => { st.tierSel[cls] = k; api.rerender(); }, { style: k === tier ? 'gold' : 'ghost', size: 17 });
      tb.chip = `tier-${cls}-${k}`;
      c.add(tb);
    }
    c.add(text(ui, x + 148, y + 50, `${TIERS[tier].label} ${def.role}  ·  HP ${def.hp}  ATK ${def.atk}  DEF ${def.def}  ·  ${def.power} Power`, 19, PALETTE.text));
    const counts = text(ui, x + 148, y + 76, '', 19, PALETTE.textCyan);
    const cost = text(ui, x + 148, y + 100, '', 18, PALETTE.textDim);
    const lock = text(ui, x + 148, y + 124, '', 17, '#ff8a93');
    c.add([counts, cost, lock]);
    const mk = (bx, bw, label, n, style) => {
      const b = button(ui, bx + bw / 2, y + 166, bw, 46, label, () => {
        const want = typeof n === 'function' ? n() : n;
        const r = store.train(t, want);
        if (!r.ok) api.toast(r.reason);
        else api.toast(`Training ${r.n} ${r.n === 1 ? def.name : def.plural}  (−${costStr(r.cost, r.alloy)})`, 1400);
      }, { style, size: 21 });
      b.trainType = t;
      c.add(b);
      return b;
    };
    const b1 = mk(x + 148, 96, 'x1', 1, 'cyan');
    const b10 = mk(x + 252, 96, 'x10', 10, 'cyan');
    const bMax = mk(x + 356, 150, 'Max', () => store.maxTrainable(t), 'gold');
    // Promote the tier below into this tier (T1→T2, T2→T3)
    const from = tier > 1 ? unitOf(cls, tier - 1) : null;
    let bPro = null;
    if (from) {
      bPro = button(ui, x + 514 + 80, y + 166, 160, 46, 'Promote', () => showPromote(ui, api, from), { style: 'cyan', size: 20 });
      bPro.chip = `promote-${from}`;
      c.add(bPro);
    }
    api.dyn(() => {
      const ready = store.readyCount(t), asg = store.assignedCount(t);
      counts.setText(`Ready ${ready}   ·   Assigned ${asg}   ·   Owned ${store.state.troops[t]}`);
      cost.setText(`${costStr(def.energy, def.alloy)}  ·  ${store.unitTime(t).toFixed(1)}s per unit${from ? `  ·  promote ${fmt(store.promoteCost(from).energy)} E${store.promoteCost(from).alloy ? ` + ${store.promoteCost(from).alloy} A` : ''}` : ''}`);
      const why = store.tierLockReason(tier);
      const busy = store.laneBusyWith(t);
      lock.setText(why ? `${why}${tier === 2 ? ' (needs Barracks Lv 5)' : tier === 3 ? ' (needs Barracks Lv 9)' : ''}` : busy ? `${def.className} lane busy: ${busy}` : '');
      const m = store.maxTrainable(t);
      b1.setEnabled(store.trainInfo(t, 1).can);
      b10.setEnabled(store.trainInfo(t, 10).can);
      bMax.setEnabled(m > 0 && store.trainInfo(t, m).can).setLabel(m > 0 ? `Max (${m})` : 'Max');
      if (bPro) { const pm = store.maxPromotable(from); bPro.setEnabled(pm > 0).setLabel(pm > 0 ? `Promote (${pm})` : 'Promote'); }
    });
  });

  // ---- Training lanes: one per class, all running at the same time
  const qy = a.y + 82 + 3 * (CH + GAP), qh = a.y + a.h - qy - 12;
  card(ui, c, 16, qy, 688, qh, { accent: PALETTE.gold });
  c.add(text(ui, 36, qy + 14, 'TRAINING LANES', 22, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  const qInfo = text(ui, 684, qy + 16, '', 19, PALETTE.textDim).setOrigin(1, 0);
  c.add(qInfo);
  const bar = ui.add.graphics();
  c.add(bar);
  const footH = 40;
  const rowH = Math.max(60, Math.min(100, Math.floor((qh - 54 - footH) / 3)));
  const rows = CLASS_IDS.map((cls, i) => {
    const def = TROOP_CLASSES[cls];
    const ry = qy + 52 + i * rowH;
    const dot = ui.add.graphics(); dot.fillStyle(def.color, 1).fillCircle(44, ry + 14, 7); c.add(dot);
    const label = text(ui, 62, ry + 2, def.plural, 21, def.colorHex, { fontStyle: 'bold' });
    const amount = text(ui, 316, ry + 3, '', 20, PALETTE.text);
    const time = text(ui, 600, ry + 3, '', 19, PALETTE.textCyan).setOrigin(1, 0);
    c.add([label, amount, time]);
    const x = button(ui, 652, ry + 22, 56, 42, '✕', () => {
      const l = store.lane(cls);
      const what = TROOP_CLASSES[l.unit];
      const r = store.cancelLane(cls);
      if (r.ok) api.toast(`Cancelled ${r.n} ${r.n === 1 ? what.name : what.plural}. Refunded ${costStr(r.refund, r.alloy)}`);
    }, { style: 'ghost', size: 18 });
    x.cancelLane = cls;
    c.add(x);
    return { cls, def, ry, label, amount, time, x };
  });
  const foot = text(ui, 36, qy + qh - 34, '', 17, PALETTE.textDim);
  c.add(foot);
  api.dyn(() => {
    const cap = store.laneCapacity();
    const active = store.activeLanes().length;
    qInfo.setText(active ? `${active}/3 lanes active  ·  all done ${fmtClock(store.trainingSecondsLeft())}` : 'All lanes idle');
    bar.clear();
    for (const r of rows) {
      const l = store.lane(r.cls);
      const ut = store.laneUnitTime(r.cls);
      const job = TROOP_CLASSES[l.unit];
      r.label.setText(l.count ? (l.from ? `${TROOP_CLASSES[l.from].name} → ${job.name}` : job.plural) : r.def.plural);
      r.amount.setText(`${l.count} / ${cap}`).setColor(l.count ? PALETTE.text : PALETTE.textDim);
      r.time.setText(l.count ? `next ${fmtClock(store.laneNextSeconds(r.cls))}  ·  all ${fmtClock(store.laneSecondsLeft(r.cls))}` : 'idle').setColor(l.count ? PALETTE.textCyan : PALETTE.textDim);
      r.x.setEnabled(l.count > 0);
      const by = r.ry + 34;
      bar.fillStyle(0x05070a, 1).fillRect(62, by, 540, 8);
      if (l.count) bar.fillStyle(l.from ? PALETTE.cyan : r.def.color, 1).fillRect(62, by, 540 * Math.min(1, l.progress / ut), 8);
      bar.fillStyle(0x05070a, 1).fillRect(62, by + 11, 540, 3);
      bar.fillStyle(PALETTE.gold, 0.7).fillRect(62, by + 11, 540 * Math.min(1, l.count / cap), 3);
    }
    foot.setText(`Lanes run in parallel, offline too (8h cap)  ·  one job per lane  ·  Lv ${lv + 1}: ${BARRACKS.laneCapacity(lv + 1)}/lane`);
  });
}

// Promotion picker: x1 / x10 / Max of the ready troops one tier below.
function showPromote(ui, api, from) {
  const to = nextTier(from), A = TROOP_CLASSES[from], B = TROOP_CLASSES[to];
  api.overlay({
    title: `Promote ${A.plural} → ${B.plural}`, h: 560,
    build: (c, r) => {
      const per = store.promoteCost(from);
      c.add(text(ui, r.x + 28, r.y + 96, [
        `${A.name}  HP ${A.hp}  ATK ${A.atk}  DEF ${A.def}`,
        `→ ${B.name}  HP ${B.hp}  ATK ${B.atk}  DEF ${B.def}`,
        '',
        `Cost per troop: ${costStr(per.energy, per.alloy)} (the difference)`,
        `Time per troop: ${store.promoteTime(to).toFixed(1)}s (${Math.round(PROMOTE.timeShare * 100)}% of training) in the ${A.className} lane`,
        `Only ready troops can be promoted (not assigned to a squad, not wounded).`,
      ].join('\n'), 21, PALETTE.text, { lineSpacing: 8, wordWrap: { width: r.w - 56 } }));
      const info = text(ui, r.x + 28, r.y + 352, '', 20, PALETTE.textCyan);
      c.add(info);
      const go = (n) => {
        const k = typeof n === 'function' ? n() : n;
        const res = store.promote(from, k);
        if (!res.ok) { api.toast(res.reason); return; }
        api.toast(`Promoting ${res.n} ${res.n === 1 ? A.name : A.plural} → ${B.plural}  (−${costStr(res.cost, res.alloy)})`, 1600);
        api.closeOverlay();
      };
      const bw = (r.w - 56 - 24) / 3;
      const mkb = (i, label, n, style) => { const b = button(ui, r.x + 28 + bw / 2 + i * (bw + 12), r.y + 440, bw, 60, label, () => go(n), { style, size: 22 }); b.chip = `promote-go-${label.split(' ')[0].toLowerCase()}`; c.add(b); return b; };
      const m = store.maxPromotable(from);
      mkb(0, 'x1', 1, 'cyan').setEnabled(store.promoteInfo(from, 1).can);
      mkb(1, 'x10', 10, 'cyan').setEnabled(store.promoteInfo(from, 10).can);
      mkb(2, m > 0 ? `Max (${m})` : 'Max', () => store.maxPromotable(from), 'gold').setEnabled(m > 0);
      info.setText(m > 0 ? `Ready ${A.plural}: ${store.readyCount(from)}  ·  can promote ${m} now` : (store.promoteInfo(from, 1).reason ?? ''));
    },
  });
}

function showClassInfo(ui, api, t) {
  const def = TROOP_CLASSES[t];
  api.overlay({
    title: `${def.plural} · ${TIERS[def.tier].label}`, h: 720,
    build: (c, r) => {
      portrait(ui, c, `portrait-${t}`, r.x + 28, r.y + 90, 250, def.color);
      c.add(text(ui, r.x + 300, r.y + 92, def.role, 26, def.colorHex, { fontStyle: 'bold' }));
      c.add(text(ui, r.x + 300, r.y + 136, `HP   ${def.hp}\nATK  ${def.atk}\nDEF  ${def.def}\n\nCost  ${costStr(def.energy, def.alloy)}\nTime  ${store.unitTime(t).toFixed(1)}s`, 24, PALETTE.text, { lineSpacing: 8 }));
      c.add(text(ui, r.x + 28, r.y + 410, def.description, 22, PALETTE.textDim, { wordWrap: { width: r.w - 56 }, lineSpacing: 6 }));
      c.add(text(ui, r.x + 28, r.y + 500, `Each soldier adds ${def.power} Troop Power. Ready: ${store.readyCount(t)}  ·  Assigned: ${store.assignedCount(t)}`, 20, PALETTE.textCyan, { wordWrap: { width: r.w - 56 } }));
    },
  });
}
