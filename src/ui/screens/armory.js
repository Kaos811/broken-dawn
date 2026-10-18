import { PALETTE, GACHA, RARITY, RARITIES, LEADERS, LEADER_IDS, GEAR, GEAR_IDS, TROOP_CLASSES, SQUADS, TROOPS, CORES, UPGRADES } from '../../config.js';
import { store } from '../../state/store.js';
import { text, button, fmt } from '../widgets.js';
import { gearTexture } from '../../art/portraits.js';
import { header, tabRow, card, tapZone, fmtBuff, fmtGearBuff, itemName } from './common.js';

export function renderArmory(ui, c, a, api, st) {
  const sub = header(ui, c, a, 'ARMORY', '');
  api.dyn(() => sub.setText(`Cores ${fmt(store.state.resources.cores)}  ·  Shards ${fmt(store.state.resources.shards)}`));
  const nLeaders = Object.keys(store.state.leaders).length;
  const nGear = Object.values(store.state.gear).reduce((n, v) => n + v, 0);
  tabRow(ui, c, 16, a.y + 78, 688, 70, [
    { id: 'leaders', label: 'Leaders', sub: `${nLeaders}/${LEADER_IDS.length}` },
    { id: 'gear', label: 'Gear', sub: `${nGear} items` },
    { id: 'recruit', label: 'Recruitment', sub: `${GACHA.costX1} Core per pull` },
  ], st.armoryTab, (id) => { st.armoryTab = id; api.rerender(); });
  const y0 = a.y + 162;
  ({ leaders: renderLeaders, gear: renderGear, recruit: renderRecruit })[st.armoryTab](ui, c, a, api, st, y0);
}

// ------------------------------------------------------------ recruitment --
function renderRecruit(ui, c, a, api, st, y0) {
  const g = store.state.gacha;
  card(ui, c, 16, y0, 688, 292, { accent: PALETTE.gold, stroke: PALETTE.gold });
  const glow = ui.add.image(360, y0 + 120, 'glow').setBlendMode('ADD').setScale(1.3).setAlpha(0.8); c.add(glow);
  glow.once('destroy', () => ui.tweens.killTweensOf(glow));
  ui.tweens.add({ targets: glow, scale: 1.55, alpha: 1, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const gfx = ui.add.graphics();
  gfx.fillStyle(0xffd27f, 1).fillCircle(360, y0 + 112, 22);
  gfx.fillStyle(PALETTE.cyan, 1).fillPoints([{ x: 360, y: y0 + 140 }, { x: 410, y: y0 + 164 }, { x: 360, y: y0 + 188 }, { x: 310, y: y0 + 164 }], true);
  c.add(gfx);
  c.add(text(ui, 40, y0 + 16, 'BEACON CALL', 30, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 }));
  c.add(text(ui, 40, y0 + 54, 'Leaders · Armor · Weapons', 19, PALETTE.textDim));
  c.add(text(ui, 360, y0 + 204, RARITIES.map((r) => `${RARITY[r].name} ${Math.round(GACHA.rates[r] * 100)}%`).join('   '), 18, PALETTE.text).setOrigin(0.5, 0));
  const pity = text(ui, 360, y0 + 234, '', 18, PALETTE.textCyan).setOrigin(0.5, 0);
  c.add(pity);
  c.add(text(ui, 360, y0 + 260, 'Pulls cost Beacon Cores. Duplicate leaders add a star (max 5★), then give Shards', 15, PALETTE.textDim).setOrigin(0.5, 0));
  api.dyn(() => pity.setText(`Epic+ guaranteed within ${GACHA.pityEpic - g.sinceEpic}  ·  Legendary within ${GACHA.pityLegendary - g.sinceLegendary}`));

  const yb = y0 + 306;
  const doPull = (n) => {
    const r = store.pull(n);
    if (!r.ok) { api.toast(r.reason); return; }
    api.reveal(r.results);
  };
  const b1 = button(ui, 186, yb + 42, 340, 84, `Pull x1  ·  ${GACHA.costX1} Core`, () => doPull(1), { style: 'cyan', size: 26 });
  const b10 = button(ui, 534, yb + 42, 340, 84, `Pull x10  ·  ${GACHA.costX10} Cores`, () => doPull(10), { style: 'gold', size: 26 });
  c.add([b1, b10]);
  api.dyn(() => { b1.setEnabled(store.state.resources.cores >= GACHA.costX1); b10.setEnabled(store.state.resources.cores >= GACHA.costX10); });

  // How to earn Cores (they're never bought and never trickle in over time)
  const ye = yb + 100, eh = 182;
  card(ui, c, 16, ye, 688, eh, { accent: CORES.color, stroke: CORES.color });
  const eg = ui.add.graphics(); drawCoreIcon(eg, 44, ye + 26, 13); c.add(eg);
  c.add(text(ui, 66, ye + 12, 'HOW TO EARN BEACON CORES', 20, CORES.hex, { fontStyle: 'bold', letterSpacing: 2 }));
  const D = CORES.daily, msTotal = CORES.milestones.reduce((n, m) => n + m.cores, 0);
  c.add(text(ui, 36, ye + 48, [
    `• Daily login: ${D.base}/day, every ${D.streakEvery}th day in a row +${D.streakBonus} bonus`,
    `• Each Beacon level reached: +${CORES.beaconLevel} (once per level)`,
    `• ${CORES.milestones.length} first-time milestones: ${msTotal} Cores total`,
    '• First kills on the World Map pay Cores (24 in all). Cores can\'t be bought.',
  ].join('\n'), 17, PALETTE.text, { lineSpacing: 7 }));
  const rb = button(ui, 588, ye + 26, 210, 44, 'Rewards', () => ui.openRewards(), { style: 'gold', size: 20 });
  c.add(rb);
  api.dyn(() => { const n = store.rewardsReady(); rb.setLabel(n ? `Rewards (${n})` : 'Rewards'); });

  const yh = ye + eh + 12, hh = a.y + a.h - yh - 12;
  card(ui, c, 16, yh, 688, hh);
  c.add(text(ui, 36, yh + 14, 'RECRUIT HISTORY', 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2 }));
  c.add(text(ui, 684, yh + 16, `${g.total} pulls total`, 17, PALETTE.textDim).setOrigin(1, 0));
  const rows = Math.max(0, Math.floor((hh - 52) / 32));
  if (!g.history.length) c.add(text(ui, 36, yh + 56, `No recruits yet. Your ${CORES.start} starter Cores are enough for one x10 pull.`, 19, PALETTE.textDim, { wordWrap: { width: 640 } }));
  g.history.slice(0, rows).forEach((h, i) => {
    const y = yh + 52 + i * 32;
    const R = RARITY[h.rarity];
    const dot = ui.add.graphics(); dot.fillStyle(R.color, 1).fillRect(36, y + 8, 12, 12); c.add(dot);
    c.add(text(ui, 58, y, `${itemName(h.id)}`, 19, R.hex, { fontStyle: 'bold' }));
    c.add(text(ui, 270, y, `${R.name} ${h.kind === 'leader' ? 'leader' : GEAR[h.id].slot}`, 17, PALETTE.textDim));
    c.add(text(ui, 684, y, resultTag(h), 17, h.result === 'new' ? PALETTE.textGold : PALETTE.textCyan).setOrigin(1, 0));
  });
}

export function resultTag(h) {
  if (h.result === 'new') return 'NEW';
  if (h.result === 'star') return `★${h.stars}`;
  if (h.result === 'shards') return `+${h.refund} Shards`;
  return `x${h.count}`;
}

// ---------------------------------------------------------------- leaders --
function renderLeaders(ui, c, a, api, st, y0) {
  const order = [...LEADER_IDS].sort((x, y) => RARITIES.indexOf(LEADERS[y].rarity) - RARITIES.indexOf(LEADERS[x].rarity));
  const CW = 166, CH = 236, GAP = 8;
  order.forEach((lid, k) => {
    const L = LEADERS[lid], R = RARITY[L.rarity];
    const own = store.state.leaders[lid];
    const col = k % 4, row = Math.floor(k / 4);
    const x = 16 + col * (CW + GAP) + 1, y = y0 + row * (CH + GAP);
    card(ui, c, x, y, CW, CH, { stroke: own ? R.color : 0x2e3540, cut: 8, fill: own ? 0x12171f : 0x0b0e13 });
    const img = ui.add.image(x + CW / 2, y + 8, `leader-${lid}`).setOrigin(0.5, 0).setScale(0.62);
    if (!own) img.setTint(0x1c2028);
    c.add(img);
    const tc = TROOP_CLASSES[L.affinity];
    const g = ui.add.graphics();
    g.fillStyle(R.color, own ? 1 : 0.35).fillRect(x + 8, y + 8, 6, 149);
    g.fillStyle(tc.color, own ? 1 : 0.35).fillCircle(x + 22, y + 22, 8);
    c.add(g);
    c.add(text(ui, x + CW / 2, y + 160, L.name, 21, own ? R.hex : '#5d6878', { fontStyle: 'bold' }).setOrigin(0.5, 0));
    c.add(text(ui, x + CW / 2, y + 186, own ? `${'★'.repeat(own.stars)}${'☆'.repeat(GACHA.maxStars - own.stars)}` : R.name, 15, own ? PALETTE.textGold : '#5d6878').setOrigin(0.5, 0));
    c.add(text(ui, x + CW / 2, y + 207, own ? fmtBuff(L.buff, store.leaderMultiplier(lid)) : 'Not recruited', 13, own ? PALETTE.textCyan : '#4a5260', { align: 'center' }).setOrigin(0.5, 0));
    const sq = store.leaderSquad(lid);
    if (sq) {
      const bg = ui.add.graphics(); bg.fillStyle(0x0b0e13, 0.9).fillRect(x + CW - 64, y + 132, 58, 24); bg.lineStyle(1, PALETTE.gold, 1).strokeRect(x + CW - 64, y + 132, 58, 24); c.add(bg);
      c.add(text(ui, x + CW - 35, y + 135, SQUADS[sq].name, 14, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(0.5, 0));
    }
    tapZone(ui, c, x, y, CW, CH, () => (own ? leaderDetail(ui, api, lid) : api.toast(`${L.name} hasn't been recruited yet. Try Recruitment.`)), `leader-${lid}`);
  });
}

export function leaderDetail(ui, api, lid) {
  const L = LEADERS[lid], R = RARITY[L.rarity], own = store.state.leaders[lid];
  const mult = store.leaderMultiplier(lid);
  api.overlay({
    title: `${L.name} · ${L.title}`, h: 900,
    build: (c, r, close) => {
      const img = ui.add.image(r.x + 28, r.y + 86, `leader-${lid}`).setOrigin(0, 0).setScale(1.1); c.add(img);
      const g = ui.add.graphics(); g.lineStyle(3, R.color, 1).strokeRect(r.x + 28, r.y + 86, 220, 264); c.add(g);
      const tc = TROOP_CLASSES[L.affinity];
      const nextBuff = own.stars < GACHA.maxStars ? `\nNext ★: ${fmtBuff(L.buff, 1 + GACHA.starBonus * own.stars)}` : '\nMax stars';
      c.add(text(ui, r.x + 272, r.y + 88, R.name.toUpperCase(), 22, R.hex, { fontStyle: 'bold', letterSpacing: 2 }));
      c.add(text(ui, r.x + 272, r.y + 120, `${'★'.repeat(own.stars)}${'☆'.repeat(GACHA.maxStars - own.stars)}`, 28, PALETTE.textGold));
      c.add(text(ui, r.x + 272, r.y + 162, `Affinity: ${tc.plural}`, 22, tc.colorHex, { fontStyle: 'bold' }));
      c.add(text(ui, r.x + 272, r.y + 200, `Buff: ${fmtBuff(L.buff, mult)}${nextBuff}`, 20, PALETTE.textCyan, { wordWrap: { width: r.w - 300 }, lineSpacing: 4 }));
      c.add(text(ui, r.x + 272, r.y + 268, L.debuff ? `Debuff: ${fmtBuff(L.debuff)}` : 'No debuff', 20, L.debuff ? '#ff8a95' : PALETTE.textDim));
      const where = store.leaderSquad(lid);
      c.add(text(ui, r.x + 272, r.y + 304, where ? `Leading ${SQUADS[where].name} Squad` : 'Not assigned', 20, where ? PALETTE.textGold : PALETTE.textDim, { fontStyle: 'bold' }));
      c.add(text(ui, r.x + 28, r.y + 366, `Each star adds +${GACHA.starBonus * 100}% of the base buff. Get stars from duplicates or buy them with Shards. Past ${GACHA.maxStars}★, duplicates give ${R.dupShards} Shards.`, 17, PALETTE.textDim, { wordWrap: { width: r.w - 300 } }));
      const su = store.starUpInfo(lid);
      const sb = button(ui, r.x + r.w - 140, r.y + 400, 230, 60, su.maxed ? 'Max stars' : `★ Up · ${fmt(su.cost)} Shards`, () => {
        const res = store.starUpLeader(lid);
        if (!res.ok) { api.toast(res.reason); return; }
        close(); api.toast(`${L.name} is now ${res.stars}★ (−${fmt(res.cost)} Shards)`); leaderDetail(ui, api, lid);
      }, { style: 'gold', size: 18 });
      sb.setEnabled(su.can); sb.starUp = lid;
      c.add(sb);
      c.add(text(ui, r.x + 28, r.y + 440, 'ASSIGN TO SQUAD', 18, PALETTE.textDim, { letterSpacing: 2 }));
      TROOPS.squadIds.forEach((sid, i) => {
        const unlocked = store.squadUnlocked(sid);
        const cur = store.state.squads[sid].leader;
        const b = button(ui, r.x + 28 + 100 + i * 214, r.y + 506, 200, 72, unlocked ? SQUADS[sid].name : `${SQUADS[sid].name} (CC ${SQUADS[sid].unlockCC})`, () => {
          const res = store.assignLeader(lid, sid);
          if (!res.ok) { api.toast(res.reason); return; }
          close(); api.toast(`${L.name} now leads ${SQUADS[sid].name} Squad`);
        }, { style: where === sid ? 'gold' : 'cyan', size: unlocked ? 24 : 18 });
        b.setEnabled(unlocked && where !== sid);
        c.add(b);
        if (unlocked) c.add(text(ui, r.x + 128 + i * 214, r.y + 550, cur ? `now: ${LEADERS[cur].name}` : 'no leader', 15, PALETTE.textDim).setOrigin(0.5, 0));
      });
      if (where) {
        c.add(button(ui, r.x + r.w / 2, r.y + 640, 300, 64, 'Unassign', () => { store.assignLeader(null, where); close(); api.toast(`${L.name} unassigned`); }, { style: 'danger', size: 22 }));
      }
    },
  });
}

// ------------------------------------------------------------------- gear --
function renderGear(ui, c, a, api, st, y0) {
  const order = [...GEAR_IDS].sort((x, y) => RARITIES.indexOf(GEAR[y].rarity) - RARITIES.indexOf(GEAR[x].rarity) || GEAR[x].slot.localeCompare(GEAR[y].slot));
  const CW = 340, CH = 116, GAP = 8;
  c.add(text(ui, 24, y0, 'Each squad equips one armor and one weapon. Tap an item to equip it.', 18, PALETTE.textDim));
  order.forEach((gid, k) => {
    const G = GEAR[gid], R = RARITY[G.rarity];
    const n = store.state.gear[gid] ?? 0;
    const col = k % 2, row = Math.floor(k / 2);
    const x = 16 + col * (CW + GAP), y = y0 + 34 + row * (CH + GAP);
    card(ui, c, x, y, CW, CH, { stroke: n ? R.color : 0x2e3540, cut: 8, fill: n ? 0x12171f : 0x0b0e13 });
    const img = ui.add.image(x + 8, y + 8, gearTexture(gid)).setOrigin(0, 0).setScale(0.83);
    if (!n) img.setTint(0x1c2028);
    c.add(img);
    c.add(text(ui, x + 116, y + 10, G.name, 20, n ? R.hex : '#5d6878', { fontStyle: 'bold' }));
    c.add(text(ui, x + 116, y + 38, `${R.name} ${G.slot}`, 15, n ? PALETTE.textDim : '#4a5260'));
    c.add(text(ui, x + 116, y + 60, fmtGearBuff(G), 16, n ? PALETTE.textCyan : '#4a5260'));
    const used = n - store.gearFree(gid);
    c.add(text(ui, x + 116, y + 86, n ? `Owned ${n}  ·  Equipped ${used}` : 'Not found yet', 15, n ? PALETTE.text : '#4a5260'));
    tapZone(ui, c, x, y, CW, CH, () => (n ? gearDetail(ui, api, gid) : api.toast('Find gear through Recruitment.')), `gearcard-${gid}`);
  });
}

export function gearDetail(ui, api, gid) {
  const G = GEAR[gid], R = RARITY[G.rarity];
  api.overlay({
    title: G.name, h: 760,
    build: (c, r, close) => {
      c.add(ui.add.image(r.x + 28, r.y + 86, gearTexture(gid)).setOrigin(0, 0).setScale(1.5));
      c.add(text(ui, r.x + 230, r.y + 92, `${R.name.toUpperCase()} ${G.slot.toUpperCase()}`, 22, R.hex, { fontStyle: 'bold', letterSpacing: 2 }));
      c.add(text(ui, r.x + 230, r.y + 132, fmtGearBuff(G), 24, PALETTE.textCyan));
      c.add(text(ui, r.x + 230, r.y + 172, `Owned ${store.state.gear[gid]}  ·  Free ${store.gearFree(gid)}`, 21, PALETTE.text));
      const gu = store.gearUpgradeInfo(gid), lv = store.gearLevel(gid);
      c.add(text(ui, r.x + 230, r.y + 208, `Level ${lv} / ${UPGRADES.gearMaxLevel}${gu.maxed ? '' : `  ·  next: +${store.gearBuffPct(gid, lv + 1)}%`}`, 19, PALETTE.textGold));
      const ub = button(ui, r.x + 345, r.y + 258, 230, 54, gu.maxed ? 'Max level' : `Upgrade · ${fmt(gu.cost)} Shards`, () => {
        const res = store.upgradeGear(gid);
        if (!res.ok) { api.toast(res.reason); return; }
        close(); api.toast(`${G.name} is now Lv ${res.level} (−${fmt(res.cost)} Shards)`); gearDetail(ui, api, gid);
      }, { style: 'gold', size: 18 });
      ub.setEnabled(gu.can); ub.gearUp = gid;
      c.add(ub);
      c.add(text(ui, r.x + 28, r.y + 300, `EQUIP ON SQUAD (${G.slot} slot)`, 18, PALETTE.textDim, { letterSpacing: 2 }));
      TROOPS.squadIds.forEach((sid, i) => {
        const unlocked = store.squadUnlocked(sid);
        const cur = store.state.squads[sid][G.slot];
        const b = button(ui, r.x + 128 + i * 214, r.y + 370, 200, 72, unlocked ? SQUADS[sid].name : `${SQUADS[sid].name} (CC ${SQUADS[sid].unlockCC})`, () => {
          const res = store.equipGear(sid, G.slot, cur === gid ? null : gid);
          if (!res.ok) { api.toast(res.reason); return; }
          close(); api.toast(cur === gid ? `Unequipped from ${SQUADS[sid].name}` : `${G.name} equipped on ${SQUADS[sid].name}`);
        }, { style: cur === gid ? 'gold' : 'cyan', size: unlocked ? 24 : 18 });
        b.setEnabled(unlocked && (cur === gid || store.gearFree(gid, sid) > 0));
        c.add(b);
        if (unlocked) c.add(text(ui, r.x + 128 + i * 214, r.y + 414, cur === gid ? 'equipped (tap to remove)' : cur ? `now: ${GEAR[cur].name}` : 'empty', 14, PALETTE.textDim).setOrigin(0.5, 0));
      });
    },
  });
}

// Beacon Core icon: a hot-pink hexagonal core with a white-hot centre (distinct from purple Shards).
export function drawCoreIcon(g, x, y, r) {
  const pts = Array.from({ length: 6 }, (_, k) => ({ x: x + r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), y: y + r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3) }));
  g.fillStyle(CORES.color, 0.35).fillCircle(x, y, r * 1.35);
  g.fillStyle(CORES.color, 1).fillPoints(pts, true);
  g.lineStyle(2, 0xffd0dc, 1).strokePoints(pts, true);
  g.fillStyle(0xffffff, 1).fillCircle(x, y, r * 0.38);
}
