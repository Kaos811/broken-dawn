// Stage 14 UI: the Goal button (chapter goal chain) and the Help button (Crew Help), on the right edge
// under Missions / Event. Icons are drawn in the same style as the left queue buttons.
import { PALETTE } from '../config.js';
import { store } from '../state/store.js';
import { audio } from '../audio/audio.js';
import { fmtBundle } from './stage8.js';
import { fmtDuration } from './widgets.js';

const goalIcon = (g, col) => { // banner on a pole
  g.lineStyle(3, col, 1).lineBetween(-12, -20, -12, 20);
  g.fillStyle(col, 1).fillPoints([{ x: -10, y: -20 }, { x: 16, y: -13 }, { x: -10, y: -4 }], true);
  g.fillStyle(PALETTE.cyan, 0.9).fillCircle(-12, 20, 4);
};
const helpIcon = (g, col) => { // two clasped hands, simplified: two arcs + a spark
  g.lineStyle(4, col, 1).beginPath().arc(-7, 2, 12, Math.PI * 0.9, Math.PI * 1.9).strokePath();
  g.beginPath().arc(7, 2, 12, Math.PI * 1.1, Math.PI * 0.1, true).strokePath();
  g.fillStyle(PALETTE.gold, 1).fillCircle(0, -14, 4);
};

export function createStage14Buttons(ui, mk, xr, y) {
  ui.rightBtns.goal = mk(y, 'Goal', 'q-goal', goalIcon, () => onGoal(ui), PALETTE.gold).setVisible(false);
  ui.rightBtns.help = mk(y + 114, 'Help', 'q-help', helpIcon, () => onHelp(ui), PALETTE.cyan).setVisible(false);
  ui.sideBtns.push(ui.rightBtns.goal, ui.rightBtns.help);
  ui.unsubs.push(store.on('crewHelp', (h) => { if (!store.simulating && h.n === 1) ui.toast(`The crew is helping: ${h.name} −${fmtDuration(h.cut)} per help`, 1800); }));
}

function goTo(ui, go) {
  if (go === 'world') ui.onTab('world');
  else if (go === 'troops') ui.openScreen('troops');
  else if (go === 'armory') ui.openScreen('armory');
  else if (go === 'archive') { if (store.archiveUnlocked()) ui.onQueue('research'); else ui.toast('Build the Archive first (Beacon Lv 3).'); }
  else { ui.onTab('base'); ui.openPanel(go); }
}

function onGoal(ui) {
  const g = store.currentGoal();
  if (!g) { ui.toast('All chapter goals complete. More soon!', 2000); return; }
  if (g.done) {
    const res = store.claimGoal();
    if (res.ok) { audio.play('reward'); ui.toast(`Goal complete: ${g.text}\n${fmtBundle(res.reward)}${res.next ? `\nNext: ${res.next.text}` : ''}`, 3200); }
    return;
  }
  ui.toast(`Goal ${g.i + 1}/${g.n}: ${g.text} (${g.cur}/${g.goal})\nReward: ${fmtBundle(g.reward)}`, 2600);
  goTo(ui, g.go);
}

function onHelp(ui) {
  const res = store.requestHelp();
  ui.toast(res.ok ? `Help requested for ${res.n === 1 ? 'your upgrade' : `${res.n} jobs`}. The crew will cut the timer 5 times.` : 'Start an upgrade or research, then ask the crew for help.', 2200);
}

export function refreshStage14(ui, vis, drawBadge) {
  const on = ui.sideVisible() && store.goalsUnlocked();
  const gb = ui.rightBtns.goal, g = on ? store.currentGoal() : null;
  gb.setVisible(!!g);
  if (g) { gb.timer.setText(g.done ? 'Claim!' : `${g.cur}/${g.goal}`).setColor(g.done ? PALETTE.textGold : PALETTE.textDim); drawBadge(gb, g.done ? 1 : 0); }
  const hb = ui.rightBtns.help, n = on ? store.helpAskable() : 0;
  hb.setVisible(n > 0);
  if (n > 0) { hb.timer.setText('Ask crew').setColor(PALETTE.textDim); drawBadge(hb, n); }
}
