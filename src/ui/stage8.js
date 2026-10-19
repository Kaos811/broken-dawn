// Stage 8 UI: the right-edge Missions + Event buttons, the Daily Missions screen (task list + activity
// chest track), and one-time pointers. Lives in the UI scene; `ui` is the UIScene.
import { GAME_WIDTH as W, PALETTE, MISSIONS, CORES } from '../config.js';
import { store } from '../state/store.js';
import { text, button, fmt, fmtDuration } from './widgets.js';
import { audio } from '../audio/audio.js';
import { TOP_H } from './layout.js';

const testFlags = () => (typeof window !== 'undefined' ? window.__BD_TEST ?? {} : {});

// "+900 Energy · +40 Alloy · +1 Core"
export function fmtBundle(b, sep = '  ·  ') {
  const names = { energy: 'Energy', alloy: 'Alloy', shards: 'Shards', stamina: 'Stamina', marks: 'Rift Marks', cores: 'Core' };
  return Object.entries(b ?? {}).filter(([, v]) => v).map(([k, v]) => `+${fmt(v)} ${k === 'cores' ? (v === 1 ? 'Beacon Core' : 'Beacon Cores') : names[k] ?? k}`).join(sep);
}

function drawBadge(btn, n) {
  const g = btn.badge; g.clear();
  btn.badgeText.setText(n ? String(n) : '');
  if (!n) return;
  const bx = btn.r - 4, by = -btn.r + 4;
  g.fillStyle(0xe0263c, 1).fillCircle(bx, by, 14).lineStyle(2, 0xffd0d6, 0.9).strokeCircle(bx, by, 14);
  btn.badgeText.setPosition(bx, by);
}

// Right edge, mirroring the left queue column.
export function createRightColumn(ui) {
  const r = 36, xr = W - 52, y0 = TOP_H + 104, dy = 114;
  const mk = (y, caption, chip, icon, onClick, ring) => {
    const b = ui.roundButton(xr, y, r, caption, chip, icon, onClick, ring);
    b.badgeText = text(ui, 0, 0, '', 15, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5);
    b.add(b.badgeText);
    return b;
  };
  ui.rightBtns = {
    missions: mk(y0, 'Missions', 'q-missions', 'hud-missions', () => { markHint('missions'); ui.hintTarget = null; ui.hintG.clear().setVisible(false); openMissions(ui); }, PALETTE.cyan).setVisible(false),
  };
  ui.sideBtns.push(...Object.values(ui.rightBtns));
  ui.hintG = ui.add.graphics().setDepth(7).setVisible(false);
  const toast = (msg, ms) => { if (!store.simulating && store.missionsUnlocked()) ui.toast(msg, ms); };
  ui.unsubs.push(
    store.on('missionDone', (id) => { const T = MISSIONS.tasks.find((t) => t.id === id); toast(`Mission complete: ${store.missionName(T)}. Claim it in Missions.`, 2200); }),
    store.on('missionsReset', (rep) => toast(`A new day: Daily Missions reset.${rep.paid ? `\nUnclaimed rewards paid: ${fmtBundle(rep.paid)}` : ''}`, rep.paid ? 4200 : 2400)),
  );
  // a reset that happened while loading (before the UI existed)
  if (store.missionsReport?.paid && store.missionsUnlocked()) ui.time.delayedCall(5400, () => ui.toast(`A new day: Daily Missions reset.\nUnclaimed rewards paid: ${fmtBundle(store.missionsReport.paid)}`, 4200));
}

function markHint(id) { if (!store.state.hints[id]) { store.state.hints[id] = true; store.save(); } }

// Called with the side columns (every 200 ms).
export function refreshRightColumn(ui) {
  const vis = ui.sideVisible() && store.missionsUnlocked();
  const m = ui.rightBtns.missions;
  m.setVisible(vis);
  if (vis) {
    const pts = store.missionPoints();
    m.timer.setText(`${pts}/100`).setColor(pts >= 100 ? PALETTE.textGold : PALETTE.textDim);
    drawBadge(m, store.missionsReady());
  }
  if (ui.modal?.tick) ui.modal.tick();
  // one-time pointer (after the tutorial): pulse a ring on the Missions button until it's tapped
  const f = testFlags();
  const hint = vis && !store.state.hints.missions && (!f.noTutorial || f.hints) && !ui.modal && !ui.screen ? m : null;
  ui.hintTarget = hint ? 'missions' : null;
  const g = ui.hintG; g.clear().setVisible(!!hint);
  if (hint) {
    const k = (Math.sin(ui.time.now / 180) + 1) / 2;
    g.lineStyle(4, PALETTE.gold, 0.9).strokeCircle(hint.x, hint.y, hint.r + 10 + k * 8);
    g.lineStyle(10, PALETTE.gold, 0.18).strokeCircle(hint.x, hint.y, hint.r + 20 + k * 8);
  }
}

// Jump to where a mission is done.
function goFor(ui, id) {
  ui.closeModal(true);
  if (id === 'daily') ui.openRewards();
  else if (id === 'kills' || id === 'push') ui.onTab('world');
  else if (id === 'train') ui.openScreen('troops');
  else if (id === 'build') { ui.onTab('base'); ui.toast('Tap a building, then Upgrade.'); }
  else if (id === 'research') { if (store.archiveUnlocked()) ui.onQueue('research'); else ui.openScreen('armory', { armoryTab: 'leaders' }); }
  else if (id === 'heal') ui.openScreen('infirmary');
}

export function openMissions(ui) {
  const reopen = () => openMissions(ui);
  const c = ui.openOverlay({
    title: 'Daily Missions', h: 1190,
    build: (c, r) => {
      const x0 = r.x + 28, xr = r.x + r.w - 28, g = ui.add.graphics(); c.add(g);
      const resetT = text(ui, x0, r.y + 74, '', 18, PALETTE.textDim); c.add(resetT);
      const pts = store.missionPoints();
      c.add(text(ui, xr, r.y + 70, `Activity ${pts} / 100`, 22, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(1, 0));
      // chest track
      const ty = r.y + 236, tx0 = x0 + 50, tx1 = xr - 50, tw = tx1 - tx0;
      g.fillStyle(0x05070a, 1).fillRoundedRect(tx0 - 6, ty - 8, tw + 12, 16, 8);
      g.fillStyle(PALETTE.cyan, 1).fillRoundedRect(tx0 - 4, ty - 6, Math.max(8, (tw + 8) * Math.min(1, pts / 100)), 12, 6);
      store.missionChests().forEach((ch) => {
        const cx = tx0 + tw * (ch.at / 100) - (ch.at === 100 ? 14 : 0), cy = ty - 66;
        const ready = ch.reached && !ch.claimed;
        const hit = button(ui, cx, cy + 10, 104, 128, '', () => {
          const res = store.claimChest(ch.at);
          if (res.ok) { audio.play('reward'); ui.toast(`${ch.tier[0].toUpperCase() + ch.tier.slice(1)} chest: ${fmtBundle(res.reward)}`, 2400); }
          else ui.toast(res.reason + (ch.claimed ? '' : `\nInside: ${fmtBundle(ch.reward)}`), 2400);
          reopen();
        }, { style: 'ghost', size: 14 });
        hit.chip = `chest-${ch.at}`; hit.alpha = 0.01; c.add(hit);
        if (ready) { g.fillStyle(PALETTE.gold, 0.22).fillCircle(cx, cy, 56); g.lineStyle(3, PALETTE.gold, 0.9).strokeCircle(cx, cy, 56); }
        const im = ui.add.image(cx, cy, `chest-${ch.tier}${ch.claimed ? '-open' : ''}`);
        im.setScale((ch.tier === 'gold' ? 96 : 86) / im.width); if (!ch.reached) im.setTint(0x8a8f99); c.add(im);
        g.fillStyle(ch.reached ? PALETTE.cyan : 0x2a3140, 1).fillCircle(tx0 + tw * (ch.at / 100), ty, 11);
        c.add(text(ui, tx0 + tw * (ch.at / 100), ty + 18, ch.claimed ? '✓' : String(ch.at), 18, ch.claimed ? PALETTE.textDim : (ready ? PALETTE.textGold : PALETTE.text), { fontStyle: 'bold' }).setOrigin(0.5, 0));
      });
      c.add(text(ui, x0, ty + 50, `Tasks reset at local midnight. The 100-point chest holds 1 Beacon Core.`, 16, PALETTE.textDim));
      // tasks
      const list = store.missionList();
      list.forEach((t, i) => {
        const y = ty + 86 + i * 92, w = r.w - 56;
        g.fillStyle(0x12171f, 1).fillRect(x0, y, w, 82);
        g.lineStyle(1, t.claimed ? 0x2e3540 : (t.done ? PALETTE.gold : PALETTE.metalEdge), 1).strokeRect(x0, y, w, 82);
        c.add(text(ui, x0 + 14, y + 8, `${t.claimed ? '✓ ' : ''}${t.name}`, 19, t.claimed ? PALETTE.textDim : PALETTE.text, { fontStyle: 'bold', wordWrap: { width: w - 220 } }));
        const bw = 260, by = y + 56;
        g.fillStyle(0x05070a, 1).fillRect(x0 + 14, by, bw, 12);
        g.fillStyle(t.done ? PALETTE.gold : PALETTE.cyan, 1).fillRect(x0 + 14, by, bw * (t.progress / t.goal), 12);
        c.add(text(ui, x0 + 24 + bw, by - 5, `${t.progress}/${t.goal}`, 16, PALETTE.textDim));
        c.add(text(ui, xr - 196, y + 30, `+${t.pts}`, 20, PALETTE.textCyan ?? '#5ff3ff', { fontStyle: 'bold' }).setOrigin(0.5));
        if (t.claimed) c.add(text(ui, xr - 74, y + 30, 'Claimed', 17, PALETTE.textDim).setOrigin(0.5));
        else if (t.done) {
          const b = button(ui, xr - 74, y + 41, 128, 50, 'Claim', () => { const res = store.claimMission(t.id); if (res.ok) audio.play('reward'); reopen(); }, { style: 'gold', size: 20 });
          b.chip = `mission-${t.id}`; c.add(b);
        } else {
          const b = button(ui, xr - 74, y + 41, 128, 50, 'Go', () => goFor(ui, t.id), { style: 'ghost', size: 20 });
          b.chip = `mission-go-${t.id}`; c.add(b);
        }
      });
      const n = store.missionsReady();
      const yb = ty + 86 + list.length * 92 + 40;
      const all = button(ui, r.x + r.w / 2, yb, 320, 62, n ? `Claim all (${n})` : 'Nothing to claim', () => {
        const res = store.claimAllMissions();
        if (res.ok) { audio.play('reward'); ui.toast(`+${res.pts} activity${Object.keys(res.reward).length ? `\n${fmtBundle(res.reward)}` : ''}`, 2400); }
        reopen();
      }, { style: 'cyan', size: 22 });
      all.setEnabled(n > 0); all.chip = 'missions-all'; c.add(all);
      c.tick = () => resetT.setText(`Resets in ${fmtDuration(store.missionsResetIn())}`);
      c.tick();
    },
  });
  c.isMissions = true;
  return c;
}
