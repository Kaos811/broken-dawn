import { PALETTE, TROOP_CLASSES, CLASS_IDS, BARRACKS, TIERS, MAX_TIER, PROMOTE, unitOf, nextTier } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { header, card, portrait, tapZone, sectionHeader, statLine, priceTag } from './common.js';
import { SKIN, drawBar, glyph, diamond, lerpC, TIER_RIM, TIER_TINT } from '../skin.js';

const costStr = (e, a) => `${fmt(e)} Energy${a ? ` + ${fmt(a)} Alloy` : ''}`;

// Painted troop figure in a framed window (tier rim + tint). Used by the Barracks cards and overlays.
export function troopFigure(ui, c, t, x, y, w, h, { onTap = null, zone = null } = {}) {
  const def = TROOP_CLASSES[t];
  const g = ui.add.graphics(); c.add(g);
  g.fillStyle(0x000000, 0.45).fillRect(x + 2, y + 4, w, h);
  g.fillStyle(lerpC(TIER_RIM[def.tier], 0x000000, 0.55), 1).fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillGradientStyle(0x222b37, 0x222b37, 0x06080b, 0x06080b, 1, 1, 1, 1).fillRect(x, y, w, h);
  for (let k = 12; k >= 1; k--) g.fillStyle(def.color, 0.028).fillEllipse(x + w / 2, y + h * 0.42, w * (0.3 + k * 0.07), h * (0.25 + k * 0.05));
  g.fillStyle(0x000000, 0.35).fillEllipse(x + w / 2, y + h - 12, w * 0.7, 18);
  const img = ui.add.image(0, 0, `troop-${def.cls}`).setOrigin(0, 0);
  // bottom-centred in the window; crop (not a mask) so it scrolls with the screen
  const sc = Math.min((h - 10) / img.height, (w * 1.15) / img.width);
  img.setScale(sc);
  const dw = img.width * sc, dh = img.height * sc;
  const ox = x + w / 2 - dw / 2, oy = y + h - 4 - dh;
  const cx0 = Math.max(0, (x + 2 - ox) / sc), cx1 = Math.min(img.width, (x + w - 2 - ox) / sc), cy0 = Math.max(0, (y + 2 - oy) / sc);
  img.setCrop(cx0, cy0, cx1 - cx0, img.height - cy0);
  img.setPosition(ox, oy);
  if (def.tier > 1) img.setTint(TIER_TINT[def.tier]);
  c.add(img);
  const f = ui.add.graphics(); c.add(f);
  f.lineStyle(2.5, TIER_RIM[def.tier], 1).strokeRect(x, y, w, h);
  f.lineStyle(1, 0xffffff, 0.18).strokeRect(x + 4, y + 4, w - 8, h - 8);
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) diamond(f, cx, cy, 6, TIER_RIM[def.tier], 0xffffff);
  if (def.tier > 1) {
    f.fillStyle(0x07090d, 0.9).fillRect(x + 8, y + 8, 40, 26).lineStyle(1.5, TIER_RIM[def.tier], 1).strokeRect(x + 8, y + 8, 40, 26);
    c.add(text(ui, x + 28, y + 21, TIERS[def.tier].label, 16, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5));
  }
  if (onTap) tapZone(ui, c, x, y, w, h, onTap, zone);
  return img;
}

// small stat glyph + value (HP / ATK / DEF / Power)
function statChip(ui, c, x, y, kind, value, color) {
  const g = ui.add.graphics(); c.add(g);
  glyph(g, kind, x + 11, y + 12, 10, color);
  const t = text(ui, x + 26, y + 12, value, 18, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  c.add(t);
  return x + 26 + t.width + 18;
}

export function renderTroops(ui, c, a, api, st) {
  const lv = store.barracksLevel;
  const sub = header(ui, c, a, 'BARRACKS', '', PALETTE.gold, { art: 'art-barracks' });
  // lanes are one per class: each card shows its own; the header chip counts the busy ones
  const chipG = ui.add.graphics(); c.add(chipG);
  const chipT = text(ui, 0, a.y + 75, '', 16, PALETTE.textCyan, { fontStyle: 'bold' }).setOrigin(1, 0.5); c.add(chipT);
  api.dyn(() => {
    sub.setText(`Lv ${lv}  ·  Speed x${(BARRACKS.trainSpeed(lv) * store.mods.train).toFixed(2)}  ·  ${store.laneCapacity()}/lane`);
    const active = store.activeLanes().length;
    chipT.setText(`Lanes ${active}/${CLASS_IDS.length}`).setColor(active ? PALETTE.textCyan : PALETTE.textDim).setX(a.x + a.w - 30);
    chipG.clear().fillStyle(0x07090d, 0.9).fillRoundedRect(chipT.x - chipT.width - 12, a.y + 63, chipT.width + 24, 24, 12)
      .lineStyle(1.5, active ? SKIN.teal : 0x3b4452, 1).strokeRoundedRect(chipT.x - chipT.width - 12, a.y + 63, chipT.width + 24, 24, 12);
  });
  st.tierSel ??= {};

  const CH = 304, GAP = 10;
  const cap = () => store.laneCapacity();
  CLASS_IDS.forEach((cls, i) => {
    const tier = Math.min(st.tierSel[cls] ?? 1, MAX_TIER);
    const t = unitOf(cls, tier);
    const def = TROOP_CLASSES[t];
    const y = a.y + 90 + i * (CH + GAP), x = 16, w = 688;
    card(ui, c, x, y, w, CH, { stroke: 0x8a6a3a, accent: def.color, glow: def.color });
    troopFigure(ui, c, t, x + 12, y + 12, 196, CH - 24, { onTap: () => showClassInfo(ui, api, t), zone: `info-${t}` });
    const rx = x + 226, rw = x + w - 16 - rx;
    const name = text(ui, rx, y + 12, def.plural, 30, def.colorHex, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 });
    const tabsW = MAX_TIER * 74;
    if (name.width > rw - tabsW - 8) name.setScale((rw - tabsW - 8) / name.width);
    c.add(name);
    for (let k = 1; k <= MAX_TIER; k++) {
      const locked = !store.tierUnlocked(k);
      const tb = button(ui, x + w - 16 - (MAX_TIER - k) * 74 - 34, y + 34, 68, 46, `${locked ? '🔒' : ''}${TIERS[k].label}`, () => { st.tierSel[cls] = k; api.rerender(); }, { style: k === tier ? 'gold' : 'ghost', size: 18 });
      tb.chip = `tier-${cls}-${k}`;
      c.add(tb);
    }
    c.add(text(ui, rx, y + 52, `${TIERS[tier].label} ${def.role}`, 18, PALETTE.textDim));
    let sx = rx;
    sx = statChip(ui, c, sx, y + 82, 'hp', `${def.hp}`, 0xff6f7b);
    sx = statChip(ui, c, sx, y + 82, 'atk', `${def.atk}`, SKIN.gold);
    sx = statChip(ui, c, sx, y + 82, 'def', `${def.def}`, 0x5fa8ff);
    statChip(ui, c, sx, y + 82, 'star', `${def.power} Power`, SKIN.goldHi);
    const counts = text(ui, rx, y + 114, '', 18, PALETTE.textCyan, { wordWrap: { width: rw } });
    const eIcon = ui.add.image(rx + 11, y + 150, 'hud-energy'); eIcon.setScale(24 / Math.max(eIcon.width, eIcon.height));
    const cost = text(ui, rx + 28, y + 140, '', 16, PALETTE.textDim, { wordWrap: { width: rw - 28 } });
    c.add([counts, eIcon, cost]);
    // ---- this class's training lane, inline
    const ly = y + 172;
    const laneG = ui.add.graphics(); c.add(laneG);
    const laneL = text(ui, rx + 10, ly + 6, '', 17, PALETTE.text, { fontStyle: 'bold' });
    const laneT = text(ui, x + w - 86, ly + 6, '', 15, PALETTE.textCyan).setOrigin(1, 0);
    c.add([laneL, laneT]);
    const xb = button(ui, x + w - 44, ly + 26, 52, 46, '✕', () => {
      const l = store.lane(cls);
      const what = TROOP_CLASSES[l.unit];
      const r = store.cancelLane(cls);
      if (r.ok) api.toast(`Cancelled ${r.n} ${r.n === 1 ? what.name : what.plural}. Refunded ${costStr(r.refund, r.alloy)}`);
    }, { style: 'ghost', size: 18 });
    xb.cancelLane = cls;
    c.add(xb);
    const by = y + CH - 40;
    const mk = (bx, bw, label, n, style) => {
      const b = button(ui, bx + bw / 2, by, bw, 58, label, () => {
        const want = typeof n === 'function' ? n() : n;
        const r = store.train(t, want);
        if (!r.ok) api.toast(r.reason);
        else api.toast(`Training ${r.n} ${r.n === 1 ? def.name : def.plural}  (−${costStr(r.cost, r.alloy)})`, 1400);
      }, { style, size: 22 });
      b.trainType = t;
      c.add(b);
      return b;
    };
    const b1 = mk(rx, 82, 'x1', 1, 'cyan');
    const b10 = mk(rx + 90, 82, 'x10', 10, 'cyan');
    const bMax = mk(rx + 180, 150, 'Max', () => store.maxTrainable(t), 'gold');
    const from = tier > 1 ? unitOf(cls, tier - 1) : null;
    let bPro = null;
    if (from) {
      bPro = button(ui, rx + 338 + 62, by, 124, 58, 'Promote', () => showPromote(ui, api, from), { style: 'cyan', size: 19 });
      bPro.chip = `promote-${from}`;
      c.add(bPro);
    }
    api.dyn(() => {
      const ready = store.readyCount(t), asg = store.assignedCount(t);
      const why = store.tierLockReason(tier);
      counts.setText(why ? `${why}${tier === 2 ? ' (needs Barracks Lv 5)' : tier === 3 ? ' (needs Barracks Lv 9)' : ''}` : `Ready ${fmt(ready)}  ·  Assigned ${fmt(asg)}  ·  Owned ${fmt(store.state.troops[t])}`).setColor(why ? '#ff8a93' : PALETTE.textCyan);
      cost.setText(`${costStr(def.energy, def.alloy)}  ·  ${store.unitTime(t).toFixed(1)}s per unit${from ? `  ·  promote ${fmt(store.promoteCost(from).energy)} E${store.promoteCost(from).alloy ? ` + ${store.promoteCost(from).alloy} A` : ''}` : ''}`);
      const l = store.lane(cls), job = TROOP_CLASSES[l.unit];
      const ut = store.laneUnitTime(cls);
      laneG.clear();
      laneG.fillStyle(0x05070a, 0.55).fillRoundedRect(rx, ly, x + w - 16 - rx - 58, 52, 8);
      laneG.lineStyle(1, l.count ? SKIN.teal : 0x2e3540, l.count ? 0.8 : 1).strokeRoundedRect(rx, ly, x + w - 16 - rx - 58, 52, 8);
      const bw = x + w - 16 - rx - 58 - 20;
      if (l.count) {
        const what = l.from ? `${TROOP_CLASSES[l.from].name} → ${job.name}` : job.plural;
        laneL.setText(`Training ${l.count}/${cap()} ${what}`).setColor(PALETTE.text);
        laneT.setText(`next ${fmtClock(store.laneNextSeconds(cls))}  ·  all ${fmtClock(store.laneSecondsLeft(cls))}`);
        drawBar(laneG, rx + 10, ly + 32, bw, 12, Math.min(1, l.progress / ut), { color: l.from ? SKIN.cyan : SKIN.teal });
        laneG.fillStyle(SKIN.gold, 0.75).fillRect(rx + 12, ly + 46, (bw - 4) * Math.min(1, l.count / cap()), 3);
      } else {
        laneL.setText(`Lane idle  ·  0/${cap()}`).setColor(PALETTE.textDim);
        laneT.setText('');
        drawBar(laneG, rx + 10, ly + 32, bw, 12, 0, { color: SKIN.teal });
      }
      if (laneL.width + (laneT.text ? laneT.width + 16 : 0) > bw) laneL.setScale(Math.max(0.6, (bw - (laneT.text ? laneT.width + 16 : 0)) / (laneL.width / laneL.scaleX)));
      xb.setEnabled(l.count > 0);
      const m = store.maxTrainable(t);
      b1.setEnabled(store.trainInfo(t, 1).can);
      b10.setEnabled(store.trainInfo(t, 10).can);
      bMax.setEnabled(m > 0 && store.trainInfo(t, m).can).setLabel(m > 0 ? `Max (${fmt(m)})` : 'Max');
      if (bPro) { const pm = store.maxPromotable(from); bPro.setEnabled(pm > 0).setLabel(pm > 0 ? `Promote (${fmt(pm)})` : 'Promote'); }
    });
  });
  const fy = a.y + 90 + 3 * (CH + GAP);
  c.add(text(ui, 32, fy + 2, `Lanes run in parallel, offline too (8h cap)  ·  one job per lane  ·  Lv ${lv + 1}: ${BARRACKS.laneCapacity(lv + 1)}/lane`, 15, PALETTE.textDim, { wordWrap: { width: 656 } }));
}

// Promotion picker: x1 / x10 / Max of the ready troops one tier below.
function showPromote(ui, api, from) {
  const to = nextTier(from), A = TROOP_CLASSES[from], B = TROOP_CLASSES[to];
  api.overlay({
    title: `Promote ${A.plural} → ${B.plural}`, h: 720,
    build: (c, r) => {
      const per = store.promoteCost(from);
      const fw = 170, fh = 210, fy = r.y + 92;
      troopFigure(ui, c, from, r.x + 40, fy, fw, fh);
      troopFigure(ui, c, to, r.x + r.w - 40 - fw, fy, fw, fh);
      const ag = ui.add.graphics(); c.add(ag);
      const mx = r.x + r.w / 2;
      ag.fillStyle(SKIN.gold, 1).fillTriangle(mx + 34, fy + fh / 2, mx - 10, fy + fh / 2 - 30, mx - 10, fy + fh / 2 + 30).fillRect(mx - 46, fy + fh / 2 - 10, 40, 20);
      c.add(text(ui, r.x + 40 + fw / 2, fy + fh + 10, A.name, 20, A.colorHex, { fontStyle: 'bold' }).setOrigin(0.5, 0));
      c.add(text(ui, r.x + r.w - 40 - fw / 2, fy + fh + 10, B.name, 20, B.colorHex, { fontStyle: 'bold' }).setOrigin(0.5, 0));
      const sy = fy + fh + 46;
      const rows = [['hp', 'HP', A.hp, B.hp], ['atk', 'ATK', A.atk, B.atk], ['def', 'DEF', A.def, B.def]];
      rows.forEach(([k, lab, x0, x1], i) => statLine(ui, c, r.x + 28, sy + i * 50, r.w - 56, 44, { glyphKind: k, glyphColor: k === 'hp' ? 0xff6f7b : k === 'atk' ? SKIN.gold : 0x5fa8ff, label: lab, a: x0, b: x1, up: x1 > x0, size: 19 }));
      c.add(text(ui, r.x + 28, sy + 156, [
        `Cost per troop: ${costStr(per.energy, per.alloy)} (the difference)`,
        `Time per troop: ${store.promoteTime(to).toFixed(1)}s (${Math.round(PROMOTE.timeShare * 100)}% of training) in the ${A.className} lane`,
        `Only ready troops can be promoted (not assigned to a squad, not wounded).`,
      ].join('\n'), 17, PALETTE.textDim, { lineSpacing: 5, wordWrap: { width: r.w - 56 } }));
      const info = text(ui, r.x + 28, sy + 236, '', 19, PALETTE.textCyan);
      c.add(info);
      const go = (n) => {
        const k = typeof n === 'function' ? n() : n;
        const res = store.promote(from, k);
        if (!res.ok) { api.toast(res.reason); return; }
        api.toast(`Promoting ${res.n} ${res.n === 1 ? A.name : A.plural} → ${B.plural}  (−${costStr(res.cost, res.alloy)})`, 1600);
        api.closeOverlay();
      };
      const bw = (r.w - 56 - 24) / 3;
      const mkb = (i, label, n, style) => { const b = button(ui, r.x + 28 + bw / 2 + i * (bw + 12), r.y + r.h - 140, bw, 64, label, () => go(n), { style, size: 22 }); b.chip = `promote-go-${label.split(' ')[0].toLowerCase()}`; c.add(b); return b; };
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
    title: `${def.plural} · ${TIERS[def.tier].label}`, h: 760,
    build: (c, r) => {
      troopFigure(ui, c, t, r.x + 28, r.y + 90, 250, 330);
      const x0 = r.x + 300, w0 = r.w - 328;
      c.add(text(ui, x0, r.y + 92, def.role, 26, def.colorHex, { fontStyle: 'bold' }));
      [['hp', 'HP', def.hp, 0xff6f7b], ['atk', 'ATK', def.atk, SKIN.gold], ['def', 'DEF', def.def, 0x5fa8ff]].forEach(([k, lab, v, col], i) => statLine(ui, c, x0, r.y + 136 + i * 54, w0, 46, { glyphKind: k, glyphColor: col, label: lab, a: v, size: 20 }));
      priceTag(ui, c, x0, r.y + 312, { icon: 'hud-energy', label: costStr(def.energy, def.alloy), h: 44, size: 19 });
      priceTag(ui, c, x0, r.y + 366, { glyphKind: 'clock', label: `${store.unitTime(t).toFixed(1)}s`, h: 44, size: 19 });
      c.add(text(ui, r.x + 28, r.y + 440, def.description, 21, PALETTE.textDim, { wordWrap: { width: r.w - 56 }, lineSpacing: 6 }));
      c.add(text(ui, r.x + 28, r.y + 540, `Each soldier adds ${def.power} Troop Power. Ready: ${store.readyCount(t)}  ·  Assigned: ${store.assignedCount(t)}`, 20, PALETTE.textCyan, { wordWrap: { width: r.w - 56 } }));
    },
  });
}
