// Archive: the research tree. Four branches, one research slot, nodes capped by the Archive's level.
import { PALETTE, RESEARCH, RESEARCH_IDS, RESEARCH_BRANCHES, BUILDINGS } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt, fmtClock } from '../widgets.js';
import { drawBar, diamond } from '../skin.js';
import { header, card, tabRow } from './common.js';
import { researchEffectText } from '../../systems/research.js';

const costText = (c) => [c.energy ? `${fmt(c.energy)} E` : null, c.alloy ? `${fmt(c.alloy)} Alloy` : null, c.shards ? `${fmt(c.shards)} Shards` : null].filter(Boolean).join(' · ');

export function renderArchive(ui, c, a, api, st) {
  const lv = store.archiveLevel;
  const sub = header(ui, c, a, 'ARCHIVE', '', 0xb07cff);
  api.dyn(() => sub.setText(store.archiveUnlocked() ? `Lv ${lv}  ·  research up to Lv ${lv}  ·  1 slot` : `Sealed · Beacon Lv ${BUILDINGS.archive.unlockBeacon}`));

  // ---- current project
  const py = a.y + 82, ph = 118;
  card(ui, c, 16, py, 688, ph, { accent: 0xb07cff, stroke: 0x6b5a8f });
  const pTitle = text(ui, 36, py + 14, '', 24, '#d6c2ff', { fontStyle: 'bold' });
  const pSub = text(ui, 36, py + 48, '', 16, PALETTE.textDim, { wordWrap: { width: 470 } });
  const pTime = text(ui, 520, py + 16, '', 20, PALETTE.textCyan).setOrigin(1, 0);
  const pBar = ui.add.graphics();
  c.add([pTitle, pSub, pTime, pBar]);
  const cancel = button(ui, 618, py + ph / 2, 150, 56, 'Cancel', () => {
    const r = store.cancelResearch();
    if (r.ok) api.toast(`Research cancelled. Refunded ${costText(r.refund)}`);
  }, { style: 'danger', size: 20 });
  cancel.chip = 'cancel-research';
  c.add(cancel);
  api.dyn(() => {
    const j = store.researchJob();
    pBar.clear();
    if (!store.archiveUnlocked()) {
      pTitle.setText('The Archive is sealed');
      pSub.setText(`Raise the Beacon to Lv ${BUILDINGS.archive.unlockBeacon} to decode its signal. Until then there's no research and the Archive adds no Power.`);
      pTime.setText(''); cancel.setVisible(false);
      return;
    }
    cancel.setVisible(!!j).setEnabled(!!j);
    if (!j) {
      pTitle.setText('No research running');
      pSub.setText('Pick a project below. One runs at a time, online and offline. Cancel refunds it in full.');
      pTime.setText('');
      return;
    }
    const R = RESEARCH[j.id];
    pTitle.setText(`${R.name}${R.maxLevel === 1 ? '' : `  →  Lv ${j.toLevel}`}`);
    pSub.setText(`${R.desc}  ·  paid ${costText(j.cost)}`);
    pTime.setText(`${fmtClock(j.total - j.progress)} left`);
    const bx = 36, by = py + ph - 26, bw = 480;
    drawBar(pBar, bx, by - 2, bw, 16, Math.min(1, j.progress / j.total), { color: 0xb07cff });
  });

  // ---- branch tabs
  const branch = st.archiveBranch ?? 'economy';
  const done = (b) => RESEARCH_IDS.filter((id) => RESEARCH[id].branch === b).reduce((n, id) => n + store.researchLevel(id), 0);
  const total = (b) => RESEARCH_IDS.filter((id) => RESEARCH[id].branch === b).reduce((n, id) => n + store.researchMax(id), 0);
  const ty = py + ph + 14;
  tabRow(ui, c, 16, ty, 688, 70, RESEARCH_BRANCHES.map((b) => ({ id: b.id, label: b.name, sub: `${done(b.id)}/${total(b.id)}` })), branch, (id) => { st.archiveBranch = id; api.rerender(); });

  // ---- nodes (the tree: a spine connecting each node of the branch)
  const B = RESEARCH_BRANCHES.find((b) => b.id === branch);
  const ids = RESEARCH_IDS.filter((id) => RESEARCH[id].branch === branch);
  const ny0 = ty + 88, avail = a.y + a.h - ny0 - 10;
  const NH = Math.min(150, Math.floor(avail / ids.length) - 10), GAP = 10;
  const spine = ui.add.graphics();
  c.add(spine);
  const nodes = ids.map((id, i) => {
    const R = RESEARCH[id];
    const y = ny0 + i * (NH + GAP);
    const g = card(ui, c, 64, y, 640, NH, { accent: B.color });
    const name = text(ui, 84, y + 10, R.name, 24, B.hex, { fontStyle: 'bold' });
    const lvT = text(ui, 520, y + 14, '', 18, PALETTE.textDim).setOrigin(1, 0);
    const eff = text(ui, 84, y + 42, '', 19, PALETTE.text);
    const cost = text(ui, 84, y + 68, '', 17, PALETTE.textDim);
    const why = text(ui, 84, y + NH - 30, '', 16, '#ff8a93');
    const pips = ui.add.graphics();
    c.add([name, lvT, eff, cost, why, pips]);
    const b = button(ui, 612, y + NH / 2, 160, 58, 'Research', () => {
      const r = store.startResearch(id);
      if (!r.ok) api.toast(r.reason);
      else api.toast(`Researching ${R.name}${R.maxLevel === 1 ? '' : ` Lv ${r.toLevel}`}  (${fmtClock(r.seconds)})`, 1600);
    }, { style: 'gold', size: 20 });
    b.chip = `research-${id}`;
    c.add(b);
    return { id, R, y, lvT, eff, cost, why, pips, b };
  });
  api.dyn(() => {
    spine.clear();
    spine.lineStyle(4, B.color, 0.35).lineBetween(36, ny0 + NH / 2, 36, ny0 + (ids.length - 1) * (NH + GAP) + NH / 2);
    for (const n of nodes) {
      const info = store.researchInfo(n.id), L = info.level, max = info.max, running = store.researchJob()?.id === n.id;
      const cy = n.y + NH / 2;
      spine.lineStyle(3, B.color, L > 0 ? 0.9 : 0.35).lineBetween(36, cy, 64, cy);
      spine.fillStyle(L >= max ? B.color : 0x141922, 1).fillCircle(36, cy, 12);
      spine.lineStyle(3, running ? 0xffffff : B.color, 1).strokeCircle(36, cy, 12);
      n.lvT.setText(n.R.maxLevel === 1 ? (L ? 'DONE' : '') : `Lv ${L}/${max}`).setColor(L >= max ? B.hex : PALETTE.textDim);
      n.pips.clear();
      if (n.R.maxLevel !== 1) for (let k = 0; k < max; k++) {
        diamond(n.pips, 378 + k * 16, n.y + 24, 6, k < L ? B.color : 0x232a35);
        if (running && k === L) n.pips.lineStyle(2, 0xffffff, 1).strokeCircle(378 + k * 16, n.y + 24, 8);
      }
      const reqs = n.R.req ? [n.R.req.barracks ? `Barracks Lv ${n.R.req.barracks}` : null, n.R.req.archive ? `Archive Lv ${n.R.req.archive}` : null, n.R.req.research ? RESEARCH[n.R.req.research].name : null].filter(Boolean).join(' · ') : '';
      if (n.R.effect === 'tier') n.eff.setText(`${n.R.desc}`).setWordWrapWidth(420).setFontSize(17);
      else n.eff.setText(L >= max ? `${n.R.desc}  ${researchEffectText(n.id, L)}  (max)` : `${n.R.desc}  ${researchEffectText(n.id, L)} → ${researchEffectText(n.id, L + 1)}`).setFontSize(18).setWordWrapWidth(430);
      n.cost.setText(L >= max ? 'Fully researched' : `${costText(info.cost)}  ·  ${fmtClock(info.seconds)}`).setY(n.y + 72).setWordWrapWidth(440);
      const showWhy = !info.can && L < max && !running && !/^Archive busy/.test(info.reason ?? '');
      n.why.setText(showWhy ? info.reason : (reqs && L < max ? `Requires ${reqs}` : '')).setColor(showWhy ? '#ff8a93' : PALETTE.textDim).setY(n.y + NH - 26);
      n.b.setEnabled(info.can).setLabel(running ? 'Running' : L >= max ? 'Done' : n.R.maxLevel === 1 ? 'Research' : `Lv ${L + 1}`);
    }
  });
}
