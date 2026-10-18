import { PALETTE, TROOP_CLASSES, TROOP_IDS, SQUADS, TROOPS, LEADERS, GEAR, GEAR_IDS, RARITY } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt } from '../widgets.js';
import { gearTexture } from '../../art/portraits.js';
import { header, tabRow, card, portrait, tapZone, fmtBuff, fmtGearBuff, STAT_NAMES } from './common.js';

export function renderSquads(ui, c, a, api, st) {
  const cc = store.state.buildings.commandCenter.level;
  header(ui, c, a, 'SQUADS', `Command Center Lv ${cc}`);
  const tabs = TROOPS.squadIds.map((id) => ({
    id, label: SQUADS[id].name, locked: !store.squadUnlocked(id),
    sub: store.squadUnlocked(id) ? `Power ${fmt(store.squadPower(id))}` : `CC Lv ${SQUADS[id].unlockCC}`,
  }));
  const pick = (id) => { if (st.edit && st.edit.squadId !== id) st.edit = null; st.squadId = id; api.rerender(); };
  tabRow(ui, c, 16, a.y + 78, 688, 74, tabs, st.squadId, st.edit ? () => api.toast('Save or cancel your formation first') : pick);
  const id = st.squadId;
  const y0 = a.y + 166;
  if (!store.squadUnlocked(id)) return renderLocked(ui, c, a, api, id, y0);
  if (st.edit && st.edit.squadId === id) return renderEdit(ui, c, a, api, st, y0);
  renderDetails(ui, c, a, api, st, y0);
}

function renderLocked(ui, c, a, api, id, y0) {
  card(ui, c, 16, y0, 688, 300, { accent: PALETTE.metalEdge });
  const g = ui.add.graphics();
  g.lineStyle(6, 0x6c788a, 1).strokeRoundedRect(330, y0 + 50, 60, 54, 10);
  g.beginPath(); g.arc(360, y0 + 50, 20, Math.PI, 0); g.strokePath();
  c.add(g);
  c.add(text(ui, 360, y0 + 130, `${SQUADS[id].name} Squad is locked`, 30, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0.5, 0));
  c.add(text(ui, 360, y0 + 176, `Upgrade the Command Center to Lv ${SQUADS[id].unlockCC} to unlock it.`, 21, PALETTE.textDim).setOrigin(0.5, 0));
  c.add(button(ui, 360, y0 + 248, 300, 66, 'Go to Base', () => ui.onTab('base'), { style: 'cyan', size: 24 }));
}

function renderDetails(ui, c, a, api, st, y0) {
  const id = st.squadId;
  const sq = store.state.squads[id];
  // --- summary
  card(ui, c, 16, y0, 688, 196, { accent: PALETTE.gold });
  c.add(text(ui, 36, y0 + 14, 'SQUAD POWER', 18, PALETTE.textDim, { letterSpacing: 2 }));
  c.add(text(ui, 36, y0 + 38, fmt(store.squadPower(id)), 54, PALETTE.textGold, { fontStyle: 'bold' }));
  c.add(text(ui, 36, y0 + 100, `${store.squadSoldiers(id)} soldiers + ${sq.level} × ${TROOPS.powerPerSquadLevel}`, 18, PALETTE.textDim));
  const stats = store.squadStats(id);
  c.add(text(ui, 36, y0 + 128, `HP ${fmt(stats.hp)}   ATK ${fmt(stats.atk)}   DEF ${fmt(stats.def)}`, 21, PALETTE.textCyan));
  c.add(text(ui, 684, y0 + 14, `Lv ${sq.level}`, 34, PALETTE.text, { fontStyle: 'bold' }).setOrigin(1, 0));
  c.add(text(ui, 684, y0 + 56, `cap Lv ${store.state.buildings.commandCenter.level} (CC level)`, 17, PALETTE.textDim).setOrigin(1, 0));
  const info = store.levelUpInfo(id);
  const lvl = button(ui, 560, y0 + 112, 268, 58, `Level Up`, () => {
    const r = store.levelUpSquad(id);
    if (!r.ok) api.toast(r.reason); else api.toast(`${SQUADS[id].name} reached Lv ${store.state.squads[id].level}  (+${TROOPS.powerPerSquadLevel} power)`);
  }, { style: 'gold', size: 24 });
  c.add(lvl);
  const lvlCost = text(ui, 560, y0 + 148, '', 16, PALETTE.textDim).setOrigin(0.5, 0);
  c.add(lvlCost);
  api.dyn(() => {
    const i = store.levelUpInfo(id);
    lvl.setEnabled(i.can);
    lvlCost.setText(i.reason && i.reason.startsWith('Upgrade') ? i.reason.replace('Upgrade the ', '') : `${fmt(i.cost.energy)} Energy + ${fmt(i.cost.alloy)} Alloy`).setColor(i.can ? PALETTE.textDim : '#ff8a95');
  });
  void info;

  // --- leader + gear
  const y1 = y0 + 208;
  card(ui, c, 16, y1, 688, 176);
  const slot = (x, label, key, name, sub, color, onTap, zone) => {
    c.add(text(ui, x, y1 + 10, label, 16, PALETTE.textDim, { letterSpacing: 2 }));
    if (key) {
      const img = ui.add.image(x, y1 + 34, key).setOrigin(0, 0); img.setScale(key.startsWith('leader') ? 0.46 : 0.8); c.add(img);
      const g = ui.add.graphics(); g.lineStyle(2, color, 1).strokeRect(x, y1 + 34, img.width * img.scaleX, img.height * img.scaleY); c.add(g);
    } else {
      const g = ui.add.graphics(); g.lineStyle(2, PALETTE.metalEdge, 0.8).strokeRect(x, y1 + 34, 92, 96);
      g.lineStyle(3, 0x56606f, 1).lineBetween(x + 46, y1 + 66, x + 46, y1 + 98).lineBetween(x + 30, y1 + 82, x + 62, y1 + 82); c.add(g);
    }
    c.add(text(ui, x + 104, y1 + 40, name, 20, key ? PALETTE.text : PALETTE.textDim, { fontStyle: 'bold', wordWrap: { width: 116 } }));
    c.add(text(ui, x + 104, y1 + 92, sub, 15, PALETTE.textCyan, { wordWrap: { width: 116 } }));
    tapZone(ui, c, x - 6, y1 + 4, 224, 166, onTap, zone);
  };
  const L = sq.leader ? LEADERS[sq.leader] : null;
  slot(30, 'LEADER', L ? `leader-${L.id}` : null, L ? `${L.name} ${'★'.repeat(store.state.leaders[L.id].stars)}` : 'No leader', L ? fmtBuff(L.buff, store.leaderMultiplier(L.id)) : 'Tap to assign', L ? RARITY[L.rarity].color : 0,
    () => leaderPicker(ui, api, id, (lid) => { const r = store.assignLeader(lid, id); if (!r.ok) api.toast(r.reason); }), 'slot-leader');
  for (const [i, s] of [['armor', 'ARMOR'], ['weapon', 'WEAPON']].entries()) {
    const gid = sq[s[0]];
    const G = gid ? GEAR[gid] : null;
    slot(258 + i * 226, s[1], G ? gearTexture(gid) : null, G ? G.name : 'Empty', G ? fmtGearBuff(G) : 'Tap to equip', G ? RARITY[G.rarity].color : 0,
      () => gearPicker(ui, api, id, s[0]), `slot-${s[0]}`);
  }

  // --- formation
  const y2 = y1 + 188;
  const fh = 276;
  card(ui, c, 16, y2, 688, fh);
  c.add(text(ui, 36, y2 + 14, 'FORMATION', 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  sq.lines.forEach((l, i) => {
    const ly = y2 + 50 + i * 74;
    const g = ui.add.graphics(); g.fillStyle(0x0b0e13, 1).fillRect(32, ly, 656, 66); g.lineStyle(1, PALETTE.metalEdge, 0.6).strokeRect(32, ly, 656, 66); c.add(g);
    c.add(text(ui, 46, ly + 20, SQUADS.lineNames[i].toUpperCase(), 18, PALETTE.textDim, { letterSpacing: 2 }));
    if (l.type) {
      const d = TROOP_CLASSES[l.type];
      const img = ui.add.image(170, ly + 4, `portrait-${l.type}`).setOrigin(0, 0).setScale(0.24); c.add(img);
      const short = l.full > l.count;
      c.add(text(ui, 230, ly + 8, `${d.plural}  ×${l.count}${short ? ` / ${l.full}` : ''}`, 24, short ? '#ff8a95' : d.colorHex, { fontStyle: 'bold' }));
      c.add(text(ui, 230, ly + 38, short ? `${d.role}  ·  ${l.full - l.count} missing (wounded / fallen)` : d.role, 16, PALETTE.textDim));
      c.add(text(ui, 672, ly + 20, `+${l.count}`, 22, PALETTE.textGold).setOrigin(1, 0));
    } else c.add(text(ui, 170, ly + 20, 'Empty line', 21, '#5d6878'));
  });

  const y3 = y2 + fh + 14;
  const march = store.squadMarch(id);
  c.add(button(ui, 154, y3 + 40, 260, 76, 'Edit Formation', () => {
    if (store.squadMarch(id)) { api.toast(`${SQUADS[id].name} is out on a march. Edit it when it's back.`); return; }
    st.edit = { squadId: id, lines: sq.lines.map((l) => ({ ...l })), leader: sq.leader };
    api.rerender();
  }, { style: 'gold', size: 24 }));
  const refill = button(ui, 392, y3 + 40, 196, 76, 'Refill', () => {
    const r = store.refillSquad(id);
    api.toast(r.ok ? `${SQUADS[id].name}: +${r.added} troops from reserve` : r.reason);
  }, { style: 'cyan', size: 22 });
  c.add(refill);
  c.add(button(ui, 594, y3 + 40, 196, 76, 'World', () => ui.onTab('world'), { style: 'ghost', size: 24 }));
  const status = text(ui, 24, y3 + 86, '', 16, PALETTE.textDim, { wordWrap: { width: 672 } });
  c.add(status);
  api.dyn(() => {
    const n = store.refillable(id), m = store.squadMarch(id);
    refill.setEnabled(n > 0 && !m).setLabel(n > 0 ? `Refill +${n}` : 'Refill');
    const tgt = m && store.world.get(m.targetId);
    status.setText(m ? `${m.phase === 'out' ? `Marching to Lv ${tgt?.level ?? '?'}` : 'Returning to base'} · formation locked until it's back` : `Combat Power ${fmt(store.squadCombatPower(id))} (used on World hunts)  ·  only healthy troops march; Refill tops lines up from reserve`);
  });
  void march;
}

function renderEdit(ui, c, a, api, st, y0) {
  const e = st.edit, id = e.squadId;
  const draftUse = (t, skip = -1) => e.lines.reduce((n, l, i) => n + (i !== skip && l.type === t ? l.count : 0), 0);
  const maxFor = (i, t) => Math.max(0, store.availableFor(t, id) - draftUse(t, i));
  c.add(text(ui, 24, y0 + 2, `EDIT FORMATION · ${SQUADS[id].name.toUpperCase()}`, 22, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  c.add(text(ui, 24, y0 + 32, 'Available:  ' + TROOP_IDS.map((t) => `${TROOP_CLASSES[t].plural} ${store.availableFor(t, id) - draftUse(t)}`).join('   '), 19, PALETTE.textCyan));
  const LH = 168;
  e.lines.forEach((l, i) => {
    const ly = y0 + 64 + i * (LH + 8);
    card(ui, c, 16, ly, 688, LH, { accent: l.type ? TROOP_CLASSES[l.type].color : null });
    c.add(text(ui, 32, ly + 12, `${SQUADS.lineNames[i].toUpperCase()} LINE`, 18, PALETTE.textDim, { letterSpacing: 2 }));
    // type chips
    const opts = [{ t: null, label: 'None' }, ...TROOP_IDS.map((t) => ({ t, label: TROOP_CLASSES[t].plural }))];
    opts.forEach((o, k) => {
      const on = l.type === o.t;
      const b = button(ui, 32 + 82 + k * 164, ly + 64, 156, 50, o.label, () => {
        if (o.t === null) { l.type = null; l.count = 0; }
        else { const m = maxFor(i, o.t); l.type = o.t; l.count = Math.min(m, l.count > 0 ? l.count : 10); }
        api.rerender();
      }, { style: on ? 'gold' : 'ghost', size: 20 });
      b.chip = `line${i}-${o.t ?? 'none'}`;
      c.add(b);
    });
    // count stepper
    const cy = ly + 128;
    if (l.type) {
      const m = maxFor(i, l.type);
      const set = (n) => { l.count = Math.max(0, Math.min(m, n)); api.rerender(); };
      const steps = [['−10', -10], ['−1', -1]];
      steps.forEach(([lab, d], k) => { const b = button(ui, 72 + k * 92, cy, 84, 50, lab, () => set(l.count + d), { style: 'ghost', size: 22 }); b.step = `line${i}${d}`; c.add(b); });
      c.add(text(ui, 290, cy, `${l.count}`, 32, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0.5));
      [['+1', 1], ['+10', 10]].forEach(([lab, d], k) => { const b = button(ui, 380 + k * 92, cy, 84, 50, lab, () => set(l.count + d), { style: 'ghost', size: 22 }); b.step = `line${i}+${d}`; c.add(b); });
      const mb = button(ui, 610, cy, 140, 50, `Max ${m}`, () => set(m), { style: 'cyan', size: 20 }); mb.step = `line${i}max`; c.add(mb);
    } else c.add(text(ui, 32, cy - 12, 'Pick a troop type for this line.', 19, '#5d6878'));
  });
  // leader row
  const yl = y0 + 64 + 3 * (LH + 8);
  card(ui, c, 16, yl, 688, 80);
  const L = e.leader ? LEADERS[e.leader] : null;
  c.add(text(ui, 32, yl + 12, 'LEADER (optional)', 16, PALETTE.textDim, { letterSpacing: 2 }));
  c.add(text(ui, 32, yl + 38, L ? `${L.name} · ${fmtBuff(L.buff, store.leaderMultiplier(L.id))}` : 'None', 22, L ? RARITY[L.rarity].hex : PALETTE.textDim, { fontStyle: 'bold' }));
  c.add(button(ui, 616, yl + 40, 160, 56, 'Change', () => leaderPicker(ui, api, id, (lid) => { e.leader = lid; api.rerender(); }, e.leader), { style: 'cyan', size: 22 }));
  // actions
  const yb = yl + 92;
  c.add(button(ui, 190, yb + 40, 330, 72, 'Cancel', () => { st.edit = null; api.rerender(); }, { style: 'ghost', size: 26 }));
  c.add(button(ui, 532, yb + 40, 330, 72, 'Save Formation', () => {
    const r = store.saveFormation(id, e.lines, e.leader);
    if (!r.ok) { api.toast(r.reason); return; }
    st.edit = null; api.toast(`${SQUADS[id].name} formation saved  ·  Squad Power ${fmt(store.squadPower(id))}`); api.rerender();
  }, { style: 'gold', size: 26 }));
}

// Leader picker overlay. onPick(leaderId|null). `current` = currently selected leader.
export function leaderPicker(ui, api, squadId, onPick, current) {
  const owned = Object.keys(LEADERS).filter((lid) => store.state.leaders[lid]);
  const rows = Math.ceil((owned.length + 1) / 4);
  api.overlay({
    title: `Leader for ${SQUADS[squadId].name}`, h: 230 + rows * 236,
    build: (c, r, close) => {
      if (!owned.length) c.add(text(ui, r.x + 28, r.y + 84, 'No leaders yet. Recruit them in the Armory.', 21, PALETTE.textDim));
      const items = [null, ...owned];
      items.forEach((lid, k) => {
        const col = k % 4, row = Math.floor(k / 4);
        const x = r.x + 24 + col * 156, y = r.y + 86 + row * 236, w = 146;
        const sel = lid === (current === undefined ? store.state.squads[squadId].leader : current);
        card(ui, c, x, y, w, 226, { stroke: sel ? PALETTE.gold : lid ? RARITY[LEADERS[lid].rarity].color : PALETTE.metalEdge, cut: 8 });
        if (lid) {
          const L = LEADERS[lid];
          const img = ui.add.image(x + 8, y + 8, `leader-${lid}`).setOrigin(0, 0).setScale(0.65); c.add(img);
          c.add(text(ui, x + w / 2, y + 166, L.name, 20, RARITY[L.rarity].hex, { fontStyle: 'bold' }).setOrigin(0.5, 0));
          const where = store.leaderSquad(lid);
          c.add(text(ui, x + w / 2, y + 192, where && where !== squadId ? `Leads ${SQUADS[where].name}` : fmtBuff(L.buff, store.leaderMultiplier(lid)), 13, PALETTE.textDim, { align: 'center', wordWrap: { width: w - 8 } }).setOrigin(0.5, 0));
        } else c.add(text(ui, x + w / 2, y + 100, 'No\nleader', 22, PALETTE.textDim, { align: 'center' }).setOrigin(0.5, 0));
        tapZone(ui, c, x, y, w, 226, () => { close(); onPick(lid); }, `pick-${lid ?? 'none'}`);
      });
    },
  });
}

export function gearPicker(ui, api, squadId, slot) {
  const sq = store.state.squads[squadId];
  const owned = GEAR_IDS.filter((g) => GEAR[g].slot === slot && store.state.gear[g]);
  api.overlay({
    title: `${slot === 'armor' ? 'Armor' : 'Weapon'} for ${SQUADS[squadId].name}`, h: 260 + (owned.length + 1) * 104,
    build: (c, r, close) => {
      const items = [null, ...owned];
      items.forEach((gid, k) => {
        const y = r.y + 84 + k * 104, x = r.x + 24, w = r.w - 48;
        const free = gid ? store.gearFree(gid, squadId) : 1;
        const sel = sq[slot] === gid;
        card(ui, c, x, y, w, 94, { stroke: sel ? PALETTE.gold : gid ? RARITY[GEAR[gid].rarity].color : PALETTE.metalEdge, cut: 8 });
        if (gid) {
          const G = GEAR[gid];
          c.add(ui.add.image(x + 10, y + 7, gearTexture(gid)).setOrigin(0, 0).setScale(0.67));
          c.add(text(ui, x + 104, y + 12, G.name, 23, RARITY[G.rarity].hex, { fontStyle: 'bold' }));
          c.add(text(ui, x + 104, y + 50, `${RARITY[G.rarity].name} · ${fmtGearBuff(G)}`, 18, PALETTE.textDim));
          c.add(text(ui, x + w - 16, y + 34, free > 0 ? `${free} free` : 'all equipped', 18, free > 0 ? PALETTE.textCyan : '#ff8a95').setOrigin(1, 0));
        } else c.add(text(ui, x + 24, y + 32, 'Unequip (empty slot)', 22, PALETTE.textDim));
        tapZone(ui, c, x, y, w, 94, () => {
          const res = store.equipGear(squadId, slot, gid);
          if (!res.ok) { api.toast(res.reason); return; }
          close();
          api.toast(gid ? `${GEAR[gid].name} equipped on ${SQUADS[squadId].name}` : 'Slot cleared');
        }, `gear-${gid ?? 'none'}`);
      });
      if (!owned.length) c.add(text(ui, r.x + 28, r.y + 200, `No ${slot} yet. Recruit gear in the Armory.`, 20, PALETTE.textDim));
    },
  });
}
export { STAT_NAMES };
