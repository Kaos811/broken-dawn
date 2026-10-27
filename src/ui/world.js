// World-map UI (lives in the UI scene, drawn over the World scene): stamina + Auto strip, squad march
// bar, creature attack sheet, battle report card, battle replay and the reports list.
import Phaser from 'phaser';
import { GAME_WIDTH as W, PALETTE, CREATURES, SQUADS, TROOPS, TROOP_CLASSES, STAMINA, WORLD, CORES, GATHER } from '../config.js';
import { store } from '../state/store.js';
import { text, button, fmt, fmtClock, panelBg } from './widgets.js';
import { drawBar, drawCard } from './skin.js';
import { sectionHeader } from './kit.js';
import { tapZone } from './screens/common.js';
import { ringOfLevel } from '../world/worldState.js';
import { audio } from '../audio/audio.js';

import { NAV_H, HERO_RISE, SAFE } from './layout.js';
const sqName = (id) => SQUADS[id].name;
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const classLabel = (t, n) => (n === 1 ? TROOP_CLASSES[t].name : TROOP_CLASSES[t].plural);

export function createWorldHud(ui, TOP_H, H) {
  const hud = { visible: false };
  const c = ui.add.container(0, 0).setDepth(20).setVisible(false);
  hud.c = c;
  // --- top strip: stamina + Auto + Reports
  const sy = TOP_H + 10, sh = 84;
  hud.stripRect = new Phaser.Geom.Rectangle(16, sy, W - 32, sh);
  const g = ui.add.graphics();
  panelBg(g, 16, sy, W - 32, sh, { accent: 0x4dff9a, fill: 0x0d1117 });
  const block = ui.add.rectangle(W / 2, sy + sh / 2, W - 32, sh, 0, 0.001).setInteractive();
  const stIcon = ui.add.image(40, sy + sh / 2, 'hud-stamina'); stIcon.setScale(48 / stIcon.width); // stage 8: painted Stamina orb
  hud.stIcon = stIcon;
  const stLabel = text(ui, 66, sy + 10, 'STAMINA', 15, PALETTE.textDim, { letterSpacing: 2 });
  const stVal = text(ui, 66, sy + 28, '', 28, PALETTE.text, { fontStyle: 'bold' });
  const stSub = text(ui, 200, sy + 14, '', 16, '#8fffc1');
  const stBar = ui.add.graphics();
  const auto = button(ui, 498, sy + sh / 2, 168, 58, 'AUTO: OFF', () => {
    const on = store.setAuto(!store.state.hunt.auto);
    ui.toast(on ? `Auto hunt ON: idle squads attack the strongest creature they out-power by ${Math.round((WORLD.autoMargin - 1) * 100)}%+, until stamina runs low. Keeps going offline (8 h cap).` : 'Auto hunt OFF', on ? 3400 : 1400);
  }, { style: 'ghost', size: 22 });
  auto.chip = 'auto';
  const rep = button(ui, 640, sy + sh / 2, 112, 58, 'Reports', () => openReports(ui), { style: 'cyan', size: 19 });
  rep.chip = 'reports';
  c.add([g, block, stIcon, stLabel, stVal, stSub, stBar, auto, rep]);

  // --- bottom squad bar
  const by = H - NAV_H - HERO_RISE - 120, bh = 114;
  hud.barRect = new Phaser.Geom.Rectangle(16, by, W - 32, bh);
  const bg = ui.add.graphics();
  panelBg(bg, 16, by, W - 32, bh, { accent: PALETTE.cyan, fill: 0x0d1117 });
  c.add([bg, ui.add.rectangle(W / 2, by + bh / 2, W - 32, bh, 0, 0.001).setInteractive()]);
  const chipW = (W - 32 - 24) / 3;
  hud.chips = TROOPS.squadIds.map((id, i) => {
    const x = 24 + i * (chipW + 4);
    const cg = ui.add.graphics();
    const name = text(ui, x + 12, by + 10, sqName(id).toUpperCase(), 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 });
    const st = text(ui, x + 12, by + 40, '', 18, PALETTE.text);
    const sub = text(ui, x + 12, by + 68, '', 16, PALETTE.textDim);
    c.add([cg, name, st, sub]);
    tapZone(ui, c, x, by + 4, chipW, bh - 8, () => onChip(ui, hud, id), `chip-${id}`);
    return { id, x, cg, name, st, sub };
  });

  // --- creature sheet (rebuilt when a creature is selected)
  hud.sheet = null;
  hud.sheetRect = new Phaser.Geom.Rectangle(0, 0, 0, 0);

  hud.refresh = () => {
    const h = store.state.hunt;
    const SMAX = store.staminaMax();
    stVal.setText(`${Math.floor(h.stamina)} / ${SMAX}`);
    const nxt = store.staminaNext();
    stSub.setText(h.stamina >= SMAX ? `Full  ·  ${STAMINA.perAttack} per attack` : `+1 in ${fmtClock(nxt)}  ·  +${store.staminaRegenPerHour()}/h`);
    stBar.clear();
    const bx = 200, bw = 200, byy = sy + 46;
    drawBar(stBar, bx, byy, bw, 18, Math.min(1, h.stamina / SMAX), { color: h.stamina >= STAMINA.perAttack ? 0x4dff9a : 0xff4d5e });
    if (h.stamina > SMAX) stBar.fillStyle(PALETTE.gold, 1).fillRect(bx + 3, byy + 3, (bw - 6) * Math.min(1, (h.stamina - SMAX) / SMAX), 4);
    auto.setLabel(h.auto ? 'AUTO: ON' : 'AUTO: OFF').setStyle(h.auto ? 'gold' : 'ghost');
    rep.setLabel(h.reports.length ? `Reports (${h.reports.length})` : 'Reports');
    for (const ch of hud.chips) {
      const status = store.squadStatus(ch.id), m = store.squadMarch(ch.id);
      const col = { home: PALETTE.cyan, marching: PALETTE.cyan, gathering: 0x2fe0c8, returning: PALETTE.gold, locked: 0x3b4452, empty: 0xff4d5e }[status];
      ch.cg.clear(); drawCard(ch.cg, ch.x, by + 6, chipW, bh - 12, { state: status === 'locked' ? 'locked' : status === 'marching' || status === 'gathering' ? 'progress' : 'normal', color: col, cut: 8 });
      if (status === 'locked') { ch.st.setText(`Locked`).setColor('#5d6878'); ch.sub.setText(`CC Lv ${SQUADS[ch.id].unlockCC}`); continue; }
      if (m?.gather) { // stage 16: gathering march
        const g = m.gather, load = Math.floor(g.load);
        if (m.phase === 'out') { ch.st.setText(`→ Alloy Lv ${g.level}  ${fmtClock(m.travel - m.t)}`).setColor(PALETTE.textCyan); ch.sub.setText('tap to recall'); }
        else if (m.phase === 'gather') { ch.st.setText(`Gathering ${fmt(load)}/${fmt(g.cap)}`).setColor('#7ff5e2'); ch.sub.setText('tap to recall'); }
        else { ch.st.setText(`↩ home ${fmtClock(m.back - m.t)}`).setColor(PALETTE.textGold); ch.sub.setText(`carrying ${fmt(load)} Alloy`); }
      } else if (m) {
        const t = m.phase === 'out' ? m.travel - m.t : m.back - m.t;
        const tgt = store.world.get(m.targetId);
        ch.st.setText(m.phase === 'out' ? `→ ${tgt ? `Lv ${tgt.level}` : 'target'}  ${fmtClock(t)}` : `↩ home ${fmtClock(t)}`).setColor(m.phase === 'out' ? PALETTE.textCyan : PALETTE.textGold);
        ch.sub.setText(m.phase === 'out' ? 'tap to recall' : (m.recalled ? 'recalled' : 'returning'));
      } else if (status === 'empty') { ch.st.setText('No troops').setColor('#ff8a95'); ch.sub.setText('train / heal / formation'); }
      else {
        const add = store.refillable(ch.id);
        ch.st.setText(`Ready · ${fmt(store.squadSoldiers(ch.id) + add)} troops`).setColor(PALETTE.text);
        ch.sub.setText(`Power ${fmt(attackPower(ch.id))}${add ? `  (+${add} refill)` : ''}`);
      }
    }
    hud.sheetRefresh?.();
  };
  hud.show = () => { hud.visible = true; c.setVisible(true); hud.refresh(); };
  hud.hide = () => { hud.visible = false; c.setVisible(false); closeSheet(ui, hud); };
  hud.blocks = (x, y) => hud.visible && (hud.stripRect.contains(x, y) || hud.barRect.contains(x, y) || (hud.sheet && hud.sheetRect.contains(x, y)));
  hud.openSheet = (id) => openSheet(ui, hud, id, by);
  hud.closeSheet = () => closeSheet(ui, hud);
  return hud;
}

// Combat Power the squad would march with (after an automatic refill to its saved formation).
function attackPower(id) {
  const sq = store.state.squads[id];
  const saved = sq.lines.map((l) => l.count);
  for (const l of sq.lines) if (l.type && l.full > l.count) l.count += Math.min(l.full - l.count, store.readyCount(l.type));
  const p = store.squadCombatPower(id);
  sq.lines.forEach((l, i) => { l.count = saved[i]; });
  return p;
}

function onChip(ui, hud, id) {
  const m = store.squadMarch(id);
  const ws = ui.scene.get('World');
  if (!m) {
    if (store.squadStatus(id) === 'empty') ui.toast(`${sqName(id)} has no healthy troops. Train in the Barracks, heal in the Infirmary, or set a formation in Squads.`, 3000);
    ws.focusBase();
    return;
  }
  const k = m.phase === 'out' ? Math.min(1, m.t / m.travel) : 1 - m.t / m.back;
  ws.focusTile(m.from.x + (m.to.x - m.from.x) * k, m.from.y + (m.to.y - m.from.y) * k);
  if (m.gather && (m.phase === 'out' || m.phase === 'gather')) {
    const load = Math.floor(m.gather.load);
    ui.openModal({
      title: `Recall ${sqName(id)}?`,
      body: m.phase === 'gather' ? `It stops gathering and marches home with the ${fmt(load)} Alloy gathered so far (${fmtClock(m.travel)}).` : 'It turns around now and comes home empty-handed.',
      buttons: [{ label: 'Keep going', style: 'ghost' }, { label: 'Recall', style: 'danger', onClick: () => { const r = store.recall(id); ui.toast(r.ok ? `${sqName(id)} is heading home` : r.reason); } }],
      kind: 'recall',
    });
    return;
  }
  if (m.phase === 'out') {
    ui.openModal({
      title: `Recall ${sqName(id)}?`,
      body: `It turns around now and takes as long to come home as it has been out. The ${STAMINA.perAttack} stamina is refunded.`,
      buttons: [{ label: 'Keep going', style: 'ghost' }, { label: 'Recall', style: 'danger', onClick: () => { const r = store.recall(id); ui.toast(r.ok ? `${sqName(id)} is heading home` : r.reason); } }],
    });
  }
}

function closeSheet(ui, hud) {
  if (hud.sheet) { hud.sheet.destroy(); hud.sheet = null; }
  hud.sheetRefresh = null;
  hud.sheetFor = null;
  hud.sheetRect.setTo(0, 0, 0, 0);
}

function openSheet(ui, hud, id, barY) {
  closeSheet(ui, hud);
  const e = store.world.get(id);
  if (e?.kind === 'node') { openNodeSheet(ui, hud, e, barY); return; }
  if (!e || e.kind !== 'creature') return;
  const T = CREATURES[e.type];
  const sh = 470, x = 16, w = W - 32, y = barY - 10 - sh;
  hud.sheetRect.setTo(x, y, w, sh);
  const c = ui.add.container(0, 0).setDepth(25);
  hud.sheet = c; hud.sheetFor = id;
  const g = ui.add.graphics();
  panelBg(g, x, y, w, sh, { accent: T.color, stroke: T.color });
  c.add([g, ui.add.rectangle(x + w / 2, y + sh / 2, w, sh, 0, 0.001).setInteractive()]);
  const art = ui.add.image(x + 80, y + 82, `cr-${e.type}`).setScale(T.elite ? 0.58 : 0.5); c.add(art);
  c.add(text(ui, x + 160, y + 18, `Lv ${e.level}  ·  ${T.name}`, 30, T.hex, { fontStyle: 'bold' }));
  if (T.elite) c.add(text(ui, x + 160, y + 56, 'ELITE', 16, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 }));
  c.add(text(ui, x + 160, y + (T.elite ? 80 : 60), T.desc, 17, PALETTE.textDim, { wordWrap: { width: w - 230 }, lineSpacing: 3 }));
  c.add(button(ui, x + w - 38, y + 36, 52, 52, '✕', () => { ui.scene.get('World').select(null); }, { style: 'ghost', size: 24 }));
  const power = store.creaturePowerOf(e), loot = store.killRewards(e), fk = store.firstKillCores(e.level);
  const info = text(ui, x + 24, y + 170, '', 19, PALETTE.text, { lineSpacing: 6 });
  c.add(info);
  const lock = text(ui, x + 24, y + 252, '', 18, '#ff8a95');
  c.add(lock);
  const rows = TROOPS.squadIds.map((sid, i) => {
    const ry = y + 286 + i * 60;
    const b = button(ui, x + 24 + 150, ry + 26, 300, 54, `Attack · ${sqName(sid)}`, () => {
      const r = store.attack(sid, id);
      if (!r.ok) { ui.toast(r.reason); return; }
      ui.toast(`${sqName(sid)} marching to Lv ${e.level} ${T.short} (${Math.ceil(r.travel)}s)  ·  −${STAMINA.perAttack} stamina`, 1800);
      ui.scene.get('World').select(null);
    }, { style: 'gold', size: 22 });
    b.chip = `attack-${sid}`;
    const t = text(ui, x + 340, ry + 12, '', 18, PALETTE.text);
    c.add([b, t]);
    return { sid, b, t };
  });
  hud.sheetRefresh = () => {
    if (!store.world.get(id)) { ui.scene.get('World').select(null); return; }
    const z = ringOfLevel(e.level) + 1;
    info.setText([
      `Power ${fmt(power)}   ·   Zone ${z}   ·   March ${Math.ceil(store.attackInfo('alpha', id).travel)}s each way`,
      `Kill: +${fmt(loot.energy)} Energy  +${fmt(loot.alloy)} Alloy  +${fmt(loot.shards)} Shards`,
      fk ? `First Lv ${e.level} kill: +${fk} Beacon ${fk === 1 ? 'Core' : 'Cores'}` : `First-kill Core for Lv ${e.level} already earned`,
    ].join('\n'));
    const maxL = store.maxAttackLevel();
    lock.setText(e.level > maxL ? `🔒 Locked: defeat a Lv ${e.level - 1} creature first (you can attack up to Lv ${maxL})` : (e.busy ? '⚔ A squad is already on its way' : ''));
    for (const r of rows) {
      const a = store.attackInfo(r.sid, id);
      r.b.setEnabled(a.can);
      if (store.squadStatus(r.sid) === 'locked') r.t.setText(`Locked (CC Lv ${SQUADS[r.sid].unlockCC})`).setColor('#5d6878');
      else if (a.can || /stamina/.test(a.reason ?? '')) r.t.setText(`${fmt(a.power)} vs ${fmt(power)}  ·  ${a.odds.label}${a.can ? '' : '  · low stamina'}`).setColor(a.can ? a.odds.color : '#ff8a95');
      else r.t.setText(a.reason).setColor('#ff8a95');
    }
  };
  hud.sheetRefresh();
  ui.flushInput();
}

// Stage 16: Alloy node sheet (level, Alloy left, one Gather button per squad).
function openNodeSheet(ui, hud, e, barY) {
  const id = e.id;
  const sh = 430, x = 16, w = W - 32, y = barY - 10 - sh;
  hud.sheetRect.setTo(x, y, w, sh);
  const c = ui.add.container(0, 0).setDepth(25);
  hud.sheet = c; hud.sheetFor = id;
  const g = ui.add.graphics();
  panelBg(g, x, y, w, sh, { accent: 0x2fe0c8, stroke: 0x2fe0c8 });
  c.add([g, ui.add.rectangle(x + w / 2, y + sh / 2, w, sh, 0, 0.001).setInteractive()]);
  const art = ui.add.image(x + 80, y + 78, 'node-full'); art.setScale(132 / art.width); c.add(art);
  c.add(text(ui, x + 160, y + 18, `Lv ${e.level}  ·  Alloy Node`, 30, '#7ff5e2', { fontStyle: 'bold' }));
  c.add(text(ui, x + 160, y + 60, 'Send a squad to mine Alloy. No stamina and no fighting: troops come home safe. Higher-level nodes are farther out, richer and faster to mine.', 17, PALETTE.textDim, { wordWrap: { width: w - 230 }, lineSpacing: 3 }));
  c.add(button(ui, x + w - 38, y + 36, 52, 52, '✕', () => { ui.scene.get('World').select(null); }, { style: 'ghost', size: 24 }));
  const pile = ui.add.image(x + 40, y + 170, 'ic-alloy-pile'); pile.setScale(40 / pile.width); c.add(pile);
  const left = text(ui, x + 68, y + 156, '', 22, PALETTE.text, { fontStyle: 'bold' });
  const barG = ui.add.graphics();
  const info = text(ui, x + 24, y + 200, '', 18, PALETTE.textDim, { lineSpacing: 5 });
  const note = text(ui, x + 24, y + 250, '', 18, '#7ff5e2');
  c.add([left, barG, info, note]);
  const rows = TROOPS.squadIds.map((sid, i) => {
    const ry = y + 282 + i * 48;
    const b = button(ui, x + 24 + 140, ry + 22, 280, 44, `Gather · ${sqName(sid)}`, () => {
      const r = store.gather(sid, id);
      if (!r.ok) { ui.toast(r.reason); return; }
      ui.toast(`${sqName(sid)} marching to the Lv ${e.level} Alloy node (${Math.ceil(r.travel)}s)  ·  carries up to ${fmt(r.cap)}`, 2000);
      ui.scene.get('World').select(null);
    }, { style: 'cyan', size: 20 });
    b.chip = `gather-${sid}`;
    const t = text(ui, x + 320, ry + 10, '', 17, PALETTE.text);
    c.add([b, t]);
    return { sid, b, t };
  });
  hud.sheetRefresh = () => {
    const n = store.world.get(id);
    if (!n) { ui.scene.get('World').select(null); return; }
    const amt = Math.floor(n.amount);
    art.setTexture(amt >= 1 ? 'node-full' : 'node-depleted');
    left.setText(`${fmt(amt)} / ${fmt(n.max)} Alloy left`);
    barG.clear(); drawBar(barG, x + 360, y + 160, w - 384, 18, n.max ? amt / n.max : 0, { color: 0x2fe0c8 });
    const travel = store.gatherInfo('alpha', id).travel;
    info.setText(`March ${Math.ceil(travel)}s each way   ·   Speed +${Math.round(GATHER.rateLevel * 100 * (n.level - 1))}% (node level)\nCarry ${GATHER.capBase} + ${GATHER.capPerTroop} per troop   ·   more troops mine faster`);
    const m = n.busy ? store.world.marches().find((x) => x.id === n.busy) : null;
    if (amt < 1) note.setText(`Drained: regrows in ${fmtClock(Math.max(0, n.regrowAt - store.world.snapshot().clock))}`).setColor('#ff8a95');
    else if (m?.gather) note.setText(m.phase === 'gather' ? `${sqName(m.squadId)} is gathering: ${fmt(Math.floor(m.gather.load))}/${fmt(m.gather.cap)}` : `${sqName(m.squadId)} is on the way`).setColor('#7ff5e2');
    else note.setText('');
    for (const r of rows) {
      const a = store.gatherInfo(r.sid, id);
      r.b.setEnabled(a.can);
      if (store.squadStatus(r.sid) === 'locked') r.t.setText(`Locked (CC Lv ${SQUADS[r.sid].unlockCC})`).setColor('#5d6878');
      else if (a.can) r.t.setText(`${fmt(a.troops)} troops · carries ${fmt(a.cap)} · ${fmtClock(a.fill)}`).setColor(PALETTE.text);
      else r.t.setText(a.reason).setColor('#ff8a95');
    }
  };
  hud.sheetRefresh();
  ui.flushInput();
}

// ------------------------------------------------------------ report card --
export function openReport(ui, report) {
  const T = CREATURES[report.target.type];
  ui.openOverlay({
    title: null, h: 980,
    build: (c, r, close) => {
      const x0 = r.x + 32, cx = r.x + r.w / 2;
      const g = ui.add.graphics(); c.add(g);
      const col = report.win ? PALETTE.gold : 0xff4d5e;
      g.fillGradientStyle(col, col, col, col, 0.28, 0.28, 0, 0).fillRect(r.x + 6, r.y + 6, r.w - 12, 130);
      for (let k = 0; k < 5; k++) g.lineStyle(2, col, 0.8 - k * 0.15).lineBetween(cx - 60 - (k + 1) * 50, r.y + 52, cx - 60 - k * 50, r.y + 52).lineBetween(cx + 60 + k * 50, r.y + 52, cx + 60 + (k + 1) * 50, r.y + 52);
      c.add(text(ui, cx, r.y + 22, report.win ? 'VICTORY' : 'DEFEAT', 52, report.win ? '#ffd27f' : '#ff6f7b', { fontStyle: 'bold', letterSpacing: 6, stroke: report.win ? '#2e1e06' : '#2a0508', strokeThickness: 6 }).setOrigin(0.5, 0));
      c.add(text(ui, cx, r.y + 86, `${sqName(report.squadId)} vs Lv ${report.target.level} ${T.name}  ·  ${report.rounds} rounds${report.auto ? '  ·  Auto' : ''}${report.offline ? '  ·  while away' : ''}`, 18, PALETTE.textDim).setOrigin(0.5, 0));
      c.add(ui.add.image(r.x + 90, r.y + 210, `cr-${report.target.type}`).setScale(0.45));
      c.add(text(ui, r.x + 170, r.y + 150, 'COMBAT POWER', 16, PALETTE.textDim, { letterSpacing: 2 }));
      c.add(text(ui, r.x + 170, r.y + 172, `${fmt(report.power.squad)}  vs  ${fmt(report.power.enemy)}`, 34, PALETTE.text, { fontStyle: 'bold' }));
      c.add(text(ui, r.x + 170, r.y + 218, `${ago(report.at)}`, 16, PALETTE.textDim));
      // loot
      let y = r.y + 290;
      sectionHeader(ui, c, x0, y, 'REWARDS', { w: r.w - 64 });
      const L = report.loot;
      const lootT = text(ui, x0, y + 32, '', 21, report.win ? PALETTE.text : PALETTE.textDim); c.add(lootT);
      if (report.win) {
        // count-up reward line + pops (fresh reports only; old ones show the totals right away)
        const fresh = Date.now() - (report.at ?? 0) < 15000;
        const show = (k) => lootT.setText(`+${fmt(L.energy * k)} Energy    +${fmt(L.alloy * k)} Alloy    +${fmt(L.shards * k)} Shards`);
        if (fresh) {
          const o = { k: 0 }; show(0);
          ui.tweens.add({ targets: o, k: 1, duration: 700, ease: 'Cubic.easeOut', onUpdate: () => lootT.active && show(o.k), onComplete: () => lootT.active && show(1) });
          ui.time.delayedCall(150, () => { if (c.active) { c.add(ui.floatText(x0 + 120, y + 30, `+${fmt(L.energy)}`, PALETTE.textCyan)); audio.play('reward'); } });
          if (L.cores) ui.time.delayedCall(420, () => { if (c.active) c.add(ui.floatText(x0 + 260, y + 62, `+${L.cores} Core`, CORES.hex, 34)); });
        } else show(1);
      } else lootT.setText('None. The creature held its ground.');
      if (L.cores) c.add(text(ui, x0, y + 64, `+${L.cores} Beacon ${L.cores === 1 ? 'Core' : 'Cores'}  ·  first Lv ${report.target.level} kill`, 21, CORES.hex, { fontStyle: 'bold' }));
      // casualties
      y += 118;
      const cs = report.casualties;
      sectionHeader(ui, c, x0, y, 'CASUALTIES', { w: r.w - 64, color: '#ff9a8a', rule: 0xff6f7b });
      const sent = report.attacker.lines.reduce((n, l) => n + (l.count || 0), 0);
      c.add(text(ui, r.x + r.w - 32, y + 2, `${cs.total ?? 0} of ${sent} sent (${sent ? Math.round(((cs.total ?? 0) / sent) * 100) : 0}%)`, 17, PALETTE.textDim).setOrigin(1, 0));
      const types = [...new Set([...Object.keys(cs.wounded ?? {}), ...Object.keys(cs.dead ?? {})])].filter((t) => (cs.wounded?.[t] ?? 0) + (cs.dead?.[t] ?? 0) > 0);
      if (!types.length) c.add(text(ui, x0, y + 34, 'No losses.', 20, PALETTE.textDim));
      types.forEach((t, i) => {
        const yy = y + 34 + i * 40;
        g.fillStyle(TROOP_CLASSES[t].color, 1).fillCircle(x0 + 8, yy + 13, 7);
        c.add(text(ui, x0 + 26, yy, TROOP_CLASSES[t].plural, 21, TROOP_CLASSES[t].colorHex, { fontStyle: 'bold' }));
        c.add(text(ui, x0 + 220, yy, `${cs.wounded?.[t] ?? 0} wounded`, 21, '#8fffc1'));
        c.add(text(ui, x0 + 420, yy, `${cs.dead?.[t] ?? 0} fallen`, 21, '#ff8a95'));
      });
      y += 34 + Math.max(1, types.length) * 40 + 8;
      const notes = [];
      if (cs.overflow) notes.push(`${cs.overflow} wounded died: the Infirmary was full.`);
      if ((cs.woundedTotal ?? 0) > 0) notes.push(`Wounded wait in the Infirmary (${store.woundedTotal()}/${store.infirmaryCapacity()} beds). Heal them to send them back to ${sqName(report.squadId)}.`);
      if ((cs.deadTotal ?? 0) > 0) notes.push('Fallen troops are gone: retrain them in the Barracks.');
      c.add(text(ui, x0, y, notes.join('\n'), 17, PALETTE.textDim, { wordWrap: { width: r.w - 64 }, lineSpacing: 5 }));
      const yb = r.y + r.h - 150;
      const wb = button(ui, cx - 150, yb, 280, 72, '▶ Watch Replay', () => { close(); playReplay(ui, report); }, { style: 'gold', size: 25 });
      const ib = button(ui, cx + 150, yb, 280, 72, 'Infirmary', () => { close(); ui.openScreen('infirmary'); }, { style: 'cyan', size: 25 });
      c.add([wb, ib]);
    },
  });
}

export function openReports(ui) {
  const list = store.state.hunt.reports;
  const h = store.state.hunt;
  ui.openOverlay({
    title: 'Battle Reports', h: 240 + Math.max(1, list.length) * 74 + 60,
    build: (c, r) => {
      c.add(text(ui, r.x + 28, r.y + 74, `${h.kills} kills · ${h.losses} defeats · ${h.dead} fallen · best kill Lv ${h.bestKill} · first-kill Cores ${h.firstKills.length}/${WORLD.maxLevel} levels`, 16, PALETTE.textDim, { wordWrap: { width: r.w - 56 } }));
      if (!list.length) c.add(text(ui, r.x + 28, r.y + 120, 'No battles yet. Tap a creature on the map to attack it.', 20, PALETTE.textDim));
      list.forEach((rep, i) => {
        const y = r.y + 112 + i * 74, x = r.x + 24, w = r.w - 48;
        const g = ui.add.graphics(); drawCard(g, x, y, w, 66, { state: rep.win ? 'ready' : 'normal', accent: rep.win ? PALETTE.gold : 0xff4d5e, cut: 8 }); c.add(g);
        c.add(ui.add.image(x + 36, y + 33, `cr-${rep.target.type}`).setScale(0.225));
        c.add(text(ui, x + 76, y + 8, `${rep.win ? 'Victory' : 'Defeat'} · ${sqName(rep.squadId)} vs Lv ${rep.target.level} ${CREATURES[rep.target.type].short}`, 20, rep.win ? PALETTE.textGold : '#ff8a95', { fontStyle: 'bold' }));
        const lootTxt = rep.win ? `+${fmt(rep.loot.energy)} E  +${fmt(rep.loot.alloy)} A  +${fmt(rep.loot.shards)} S${rep.loot.cores ? `  +${rep.loot.cores} Core` : ''}` : 'no loot';
        c.add(text(ui, x + 76, y + 38, `${lootTxt}  ·  −${rep.casualties.total ?? 0} troops  ·  ${rep.auto ? 'auto · ' : ''}${ago(rep.at)}`, 15, PALETTE.textDim));
        tapZone(ui, c, x, y, w, 66, () => openReport(ui, rep), `report-${i}`);
      });
    },
  });
}

// --------------------------------------------------------------- replay --
// Re-runs the deterministic battle from the report and animates it volley by volley.
export function playReplay(ui, report) {
  ui.closeReplay?.();
  const res = store.replayOf(report);
  const H = ui.scale.height;
  const c = ui.add.container(0, 0).setDepth(320);
  ui.replay = c;
  c.add(ui.add.rectangle(W / 2, H / 2, W, H, 0x020305, 0.94).setInteractive());
  const T = CREATURES[report.target.type];
  c.add(text(ui, W / 2, 60, 'BATTLE REPLAY', 30, '#ffd27f', { fontStyle: 'bold', letterSpacing: 4, stroke: '#2e1e06', strokeThickness: 5 }).setOrigin(0.5));
  c.add(text(ui, W / 2, 100, `${sqName(report.squadId)} vs Lv ${report.target.level} ${T.name}`, 20, PALETTE.textDim).setOrigin(0.5));
  const roundT = text(ui, W / 2, H / 2 - 18, 'Round 1', 26, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0.5);
  c.add(roundT);
  const fx = ui.add.graphics(); c.add(fx);
  const flash = ui.add.graphics(); c.add(flash);
  const impact = ui.add.particles(0, 0, 'spark', { speed: { min: 60, max: 240 }, lifespan: 380, scale: { start: 0.9, end: 0 }, tint: [0xffffff, PALETTE.gold, 0xff8a5c], blendMode: 'ADD', emitting: false });
  c.add(impact);
  const sides = { A: report.attacker.lines, D: report.defender.lines };
  // row layout: enemy front row sits just above centre, squad front row just below
  const rows = { A: [], D: [] };
  const mkRows = (k) => {
    const lines = sides[k];
    let slot = 0;
    lines.forEach((l, i) => {
      if (!(l.count > 0)) return;
      const y = k === 'D' ? H / 2 - 110 - slot * 150 : H / 2 + 80 + slot * 150;
      slot++;
      const g = ui.add.graphics();
      const color = k === 'A' ? (TROOP_CLASSES[l.type]?.color ?? PALETTE.cyan) : (CREATURES[l.type]?.color ?? 0xff6f3c);
      const label = text(ui, 40, y - 52, k === 'A' ? `${SQUADS.lineNames[i].toUpperCase()} · ${l.label}` : l.label, 18, k === 'A' ? PALETTE.textCyan : '#ff9a8a', { fontStyle: 'bold', letterSpacing: 1 });
      const count = text(ui, W - 40, y - 52, '', 20, PALETTE.text, { fontStyle: 'bold' }).setOrigin(1, 0);
      const icons = [];
      const n = Math.min(l.count, 10);
      const key = k === 'A' ? `portrait-${l.type}` : `cr-${l.type}`;
      for (let j = 0; j < n; j++) {
        const img = ui.add.image(70 + j * 60, y, key);
        img.setScale(k === 'A' ? 0.25 : (l.count === 1 ? 0.45 : 0.21));
        if (k === 'D' && l.count === 1) img.x = W / 2;
        icons.push(img);
      }
      c.add([g, label, count, ...icons]);
      rows[k][i] = { y, g, count, icons, l, color, pool: res.hp[k].start[i], max: res.hp[k].start[i] };
    });
  };
  mkRows('D'); mkRows('A');
  const drawRow = (r) => {
    const alive = r.pool <= 0 ? 0 : Math.ceil(r.pool / r.l.hp - 1e-9);
    r.count.setText(`×${alive}`).setColor(alive ? PALETTE.text : '#5d6878');
    const frac = r.max ? r.pool / r.max : 0;
    r.g.clear();
    drawBar(r.g, 40, r.y + 38, W - 80, 14, frac, { color: r.color });
    const shown = Math.ceil(r.icons.length * (alive / Math.max(1, r.l.count)));
    r.icons.forEach((img, j) => img.setAlpha(j < shown ? 1 : 0.18));
  };
  Object.values(rows).forEach((rs) => rs.forEach((r) => r && drawRow(r)));
  // group events by round + phase
  const groups = [];
  for (const ev of res.events) {
    const last = groups[groups.length - 1];
    if (last && last.r === ev.r && last.phase === ev.phase) last.evs.push(ev); else groups.push({ r: ev.r, phase: ev.phase, evs: [ev] });
  }
  let speed = 1, i = 0, done = false, closed = false;
  const base = Math.max(380, Math.min(1100, 13000 / Math.max(1, groups.length)));
  const banner = text(ui, W / 2, H / 2 - 18, '', 60, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 6, stroke: '#000', strokeThickness: 8 }).setOrigin(0.5).setVisible(false);
  c.add(banner);
  const apply = (ev, animate) => {
    const fk = ev.side === 'A' ? 'D' : 'A';
    const src = rows[ev.side][ev.from], dst = rows[fk][ev.to];
    if (!dst) return;
    dst.pool = Math.max(0, dst.pool - ev.dmg);
    drawRow(dst);
    if (!animate || !src) return;
    const sx = W / 2 + (Math.random() - 0.5) * 300, tx = W / 2 + (Math.random() - 0.5) * 300;
    fx.lineStyle(ev.crit ? 5 : 3, ev.side === 'A' ? PALETTE.cyan : 0xff4d5e, 0.9).lineBetween(sx, src.y, tx, dst.y);
    const t = text(ui, tx, dst.y - 20, `${ev.crit ? 'CRIT ' : ''}-${fmt(ev.dmg)}${ev.kills ? `  ✖${ev.kills}` : ''}`, ev.crit ? 34 : 24, ev.crit ? PALETTE.textGold : (ev.side === 'A' ? '#ffffff' : '#ff8a95'), { fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setScale(0.3);
    c.add(t);
    // hit number pops in, then floats away
    ui.tweens.add({ targets: t, scale: ev.crit ? 1.25 : 1, duration: 140 / speed, ease: 'Back.easeOut' });
    ui.tweens.add({ targets: t, y: t.y - 60, alpha: 0, delay: 260 / speed, duration: 800 / speed, onComplete: () => t.destroy() });
    // impact sparks + a white flash on the row that got hit
    impact.explode(ev.crit ? 18 : 8, tx, dst.y);
    flash.fillStyle(ev.side === 'A' ? 0xffffff : 0xff4d5e, ev.crit ? 0.22 : 0.1).fillRect(40, dst.y - 40, W - 80, 80);
    dst.icons.forEach((img) => { if (img.alpha > 0.5) { ui.tweens.add({ targets: img, x: img.x + (ev.crit ? 12 : 6), duration: 50, yoyo: true }); } });
    if (ev.kills) { const n = dst.icons.filter((im) => im.alpha > 0.5); const last = n[n.length - 1]; if (last) { last.setTintFill(0xff4d5e); ui.time.delayedCall(120, () => last.active && last.clearTint()); } }
    ui.fx.hits++;
    audio.play(ev.crit ? 'crit' : 'hit', { gap: 70 });
    if (ev.crit || ev.kills >= 3) { ui.cameras.main.shake(110, ev.crit ? 0.006 : 0.003); ui.fx.shakes++; audio.haptic(ev.crit ? 18 : 8); }
  };
  const finish = () => {
    if (done) return;
    done = true;
    while (i < groups.length) { groups[i].evs.forEach((ev) => apply(ev, false)); i++; }
    fx.clear(); flash.clear();
    roundT.setText(`${res.rounds} rounds`);
    const won = res.winner === 'attacker';
    banner.setText(won ? 'VICTORY' : 'DEFEAT').setColor(won ? PALETTE.textGold : '#ff6f7b').setVisible(true).setScale(0.6);
    ui.tweens.add({ targets: banner, scale: 1, duration: 300, ease: 'Back.easeOut' });
    audio.play(won ? 'win' : 'lose');
    if (won) {
      impact.explode(50, W / 2, H / 2 - 18);
      if (report.loot?.energy) ui.time.delayedCall(250, () => { if (!closed) { const p = ui.floatText(W / 2, H / 2 + 50, `+${fmt(report.loot.energy)} Energy`, PALETTE.textCyan, 32); c.add(p); } });
    }
    skip.setLabel('Report'); 
  };
  const step = () => {
    if (closed || done) return;
    if (i >= groups.length) { finish(); return; }
    const gp = groups[i++];
    fx.clear(); flash.clear();
    roundT.setText(`Round ${gp.r}${gp.phase === 1 ? '  ·  first strike' : ''}`);
    if (gp.evs[0] && (i === 1 || groups[i - 2]?.r !== gp.r)) { roundT.setScale(1.3); ui.tweens.add({ targets: roundT, scale: 1, duration: 200, ease: 'Quad.easeOut' }); }
    gp.evs.forEach((ev) => apply(ev, true));
    ui.time.delayedCall(base / speed, step);
  };
  const by = H - 90 - SAFE.bottom;
  const sp = button(ui, 130, by, 200, 70, 'Speed 1x', () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; sp.setLabel(`Speed ${speed}x`); }, { style: 'cyan', size: 24 });
  const skip = button(ui, 360, by, 200, 70, 'Skip', () => { if (!done) finish(); else { ui.closeReplay(); openReport(ui, report); } }, { style: 'gold', size: 24 });
  const cl = button(ui, 590, by, 200, 70, 'Close', () => ui.closeReplay(), { style: 'ghost', size: 24 });
  c.add([sp, skip, cl]);
  ui.closeReplay = () => {
    closed = true;
    if (!ui.replay) return;
    const all = []; const walk = (o) => { all.push(o); (o.list ?? []).forEach(walk); }; walk(ui.replay);
    ui.tweens.killTweensOf(all);
    ui.replay.destroy(); ui.replay = null;
  };
  ui.replayState = () => ({ i, groups: groups.length, done, speed });
  c.alpha = 0;
  ui.tweens.add({ targets: c, alpha: 1, duration: 150 });
  ui.time.delayedCall(500, step);
  ui.flushInput();
}
