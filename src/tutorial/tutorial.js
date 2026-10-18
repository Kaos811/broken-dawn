// Stage 5: first-time guided tutorial. Eight action-driven steps: each one advances only when the
// player actually does the thing (detected from game state), with a coach card + pulsing pointer.
// If a step could get stuck (no Energy, no Cores, troops still training...), it quietly tops the
// player up. Skippable at any time; replayable from Settings. Saves on v7 or older are marked done.
import { GAME_WIDTH as W, PALETTE, TUTORIAL, BEACON, TROOP_IDS } from '../config.js';
import { store } from '../state/store.js';
import { text, button, panelBg, fmt } from '../ui/widgets.js';
import { audio } from '../audio/audio.js';

const TAB_Y = (ui) => ui.scale.height - 65;

// helpers to locate things on screen (game coordinates)
function findButton(ui, pred) {
  let hit = null;
  const visible = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active) return false; return true; };
  const walk = (o) => {
    if (hit) return;
    if (o.isButton && visible(o) && pred(o)) { const b = o.hit.getBounds(); hit = { x: b.centerX, y: b.centerY, r: Math.max(b.width, b.height) / 2 + 8 }; return; }
    (o.list ?? []).forEach(walk);
  };
  ui.children.list.forEach(walk);
  return hit;
}
const label = (o) => o.labelText?.text ?? '';
function tab(ui, id) { const t = ui.tabs.find((x) => x.id === id); return { x: t.cx, y: TAB_Y(ui), r: 60 }; }
function buildingPos(ui, id) {
  const base = ui.scene.get('Base');
  if (ui.worldMode || ui.screen || !base?.sprites) return null;
  const img = id === BEACON.id ? base.beaconSprite : base.sprites[id]?.img;
  if (!img) return null;
  const p = base.worldToScreen(img.x, img.y - img.displayHeight * 0.35);
  const r = Math.max(50, img.displayWidth * base.cameras.main.zoom * 0.35);
  const H = ui.scale.height;
  if (p.y > 360 && p.y < H - 520 && p.x > 60 && p.x < W - 60) return { x: p.x, y: p.y, r };
  // off-screen (or under the HUD/panel): glide the camera over to it, then point
  const cam = base.cameras.main;
  if (!cam.panEffect.isRunning && (p.y < 200 || p.y > H - 140 || p.x < 20 || p.x > W - 20)) cam.pan(img.x, img.y - img.displayHeight * 0.3, 450, 'Sine.easeInOut');
  return p.y > 200 && p.y < H - 140 && p.x > 20 && p.x < W - 20 ? { x: p.x, y: p.y, r } : null;
}
const goBase = (ui) => (ui.worldMode || ui.screen ? tab(ui, 'base') : null);
const readyTroops = () => TROOP_IDS.reduce((n, t) => n + store.readyCount(t), 0);

export const STEPS = [
  {
    id: 'beacon', title: 'The Beacon',
    body: 'Your Beacon powers the base: it makes Energy and charges up for upgrades. Tap it.',
    done: (ui) => ui.panelOpenFor === BEACON.id,
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor ? null : buildingPos(ui, BEACON.id)),
  },
  {
    id: 'build', title: 'Build & upgrade',
    body: 'Tap the Barracks, then Upgrade. Upgrades take a short while and raise Base Power.',
    enter: () => { const c = store.upgradeInfo('barracks').cost; if (store.state.resources.energy < c) store.state.resources.energy = c + 50; },
    done: () => store.state.construction.some((j) => j.id !== BEACON.id) || store.state.buildings.barracks.level > 1,
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor && ui.panelOpenFor !== BEACON.id ? findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled()) : buildingPos(ui, 'barracks')),
  },
  {
    id: 'train', title: 'Train troops',
    body: 'Open Troops and train some Sentinels (x10). Training keeps going while you are away.',
    enter: () => { if (store.state.resources.energy < 300) store.state.resources.energy = 300; },
    done: () => store.queuedUnits() > 0 || TROOP_IDS.some((t) => store.state.troops[t] > 0),
    target: (ui) => (ui.screen?.id !== 'troops' ? tab(ui, 'troops') : findButton(ui, (o) => o.trainType === 'sentinel' && /^x10/.test(label(o)) && o.isEnabled()) ?? findButton(ui, (o) => o.trainType && o.isEnabled())),
  },
  {
    id: 'squad', title: 'Form a squad',
    body: 'Open Squads, tap Edit Formation, fill a line (Max) and Save. (Your first batch was rushed for you.)',
    enter: () => { if (readyTroops() < 1) { store.processTraining(24 * 3600); if (readyTroops() < 1) store.state.troops.sentinel += 10; store.emit('change'); } },
    done: () => Object.values(store.state.squads).some((s) => s.lines.some((l) => l.type && l.count > 0)),
    target: (ui) => {
      if (ui.screen?.id !== 'squads') return tab(ui, 'squads');
      const e = ui.screenState.edit;
      if (!e) return findButton(ui, (o) => label(o) === 'Edit Formation');
      if (e.lines?.some((l) => l.type && l.count > 0)) return findButton(ui, (o) => label(o) === 'Save Formation');
      return findButton(ui, (o) => /^Max/.test(label(o)) && o.isEnabled()) ?? findButton(ui, (o) => o.chip === 'line0-sentinel');
    },
  },
  {
    id: 'recruit', title: 'Recruit',
    body: 'Open the Armory and Pull x1. Beacon Cores recruit leaders and gear for your squads.',
    enter: (ui, t) => { t.mark = store.state.gacha.total; if (store.state.resources.cores < 1) store.state.resources.cores = 1; },
    done: (ui, t) => store.state.gacha.total > (t.mark ?? Infinity),
    target: (ui) => {
      if (ui.reveal) return null;
      if (ui.screen?.id !== 'armory') return tab(ui, 'armory');
      return findButton(ui, (o) => /^Pull x1/.test(label(o))) ?? findButton(ui, (o) => o.tabLabel === 'Recruit');
    },
  },
  {
    id: 'hunt', title: 'Hunt on the World map',
    body: 'Open World, tap a creature, then Attack with your squad. Wins pay Energy, Alloy and Shards.',
    enter: (ui, t) => { t.mark = store.state.hunt.kills + store.state.hunt.losses; if (store.state.hunt.stamina < 10) store.state.hunt.stamina = 10; },
    done: (ui, t) => store.world.marches().some((m) => m.owner === 'local') || store.state.hunt.kills + store.state.hunt.losses > (t.mark ?? Infinity),
    target: (ui) => {
      if (ui.reveal || ui.modal) return null;
      if (!ui.worldMode) return tab(ui, 'world');
      const atk = findButton(ui, (o) => /^attack-/.test(o.chip ?? '') && o.isEnabled());
      if (atk) return atk;
      const ws = ui.scene.get('World');
      if (!ws?.crSprites) return null;
      const maxL = store.maxAttackLevel();
      let best = null;
      for (const [id, s] of ws.crSprites) {
        const e = store.world.get(id);
        if (!e || e.level > maxL || e.busy) continue;
        const p = ws.worldToScreen(s.img.x, s.img.y - 20);
        if (p.y < 260 || p.y > ui.scale.height - 300 || p.x < 30 || p.x > W - 30) continue;
        const d = (p.x - W / 2) ** 2 + (p.y - ui.scale.height / 2) ** 2;
        if (!best || d < best.d) best = { x: p.x, y: p.y, r: 46, d };
      }
      return best;
    },
  },
  {
    id: 'infirmary', title: 'Infirmary',
    body: 'Battles wound troops. They heal in the Infirmary: go to the Base, tap the Infirmary, then Heal.',
    done: (ui) => ui.screen?.id === 'infirmary',
    target: (ui) => (ui.panelOpenFor === 'infirmary' ? findButton(ui, (o) => o === ui.pOpen) : goBase(ui) ?? buildingPos(ui, 'infirmary')),
  },
  {
    id: 'research', title: 'Research',
    body: 'The Archive researches permanent bonuses. It unseals at Beacon Lv 3. Tap it to take a look.',
    done: (ui) => ui.panelOpenFor === 'archive' || ui.screen?.id === 'archive',
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor ? null : buildingPos(ui, 'archive')),
  },
];

export class Tutorial {
  constructor(ui) {
    this.ui = ui;
    this.entered = -1;
    this.t = {};                 // per-step scratch (marks)
    this.disabled = !!(typeof window !== 'undefined' && window.__BD_TEST?.noTutorial);
    this.build();
    this.unsub = store.on('tutorial', (step, done) => { if (!done && step === 0) this.entered = -1; this.refreshCard(true); });
    this.lastCheck = 0;
  }

  get active() { return !this.disabled && !store.state.tutorial.done; }
  get step() { return store.state.tutorial.step; }

  build() {
    const ui = this.ui;
    this.pointer = ui.add.graphics().setDepth(449).setVisible(false);
    this.arrow = text(ui, 0, 0, '▼', 40, PALETTE.textGold, { stroke: '#000', strokeThickness: 6 }).setOrigin(0.5, 1).setDepth(449).setVisible(false);
    const c = this.card = ui.add.container(0, 0).setDepth(450).setVisible(false);
    this.cardH = 168;
    this.bg = ui.add.graphics();
    this.block = ui.add.rectangle(W / 2, this.cardH / 2, W - 32, this.cardH, 0, 0.001).setInteractive();
    this.kicker = text(ui, 40, 16, '', 16, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 });
    this.title = text(ui, 40, 40, '', 28, PALETTE.text, { fontStyle: 'bold' });
    this.body = text(ui, 40, 80, '', 19, PALETTE.textDim, { wordWrap: { width: W - 120 }, lineSpacing: 4 });
    this.skip = button(ui, W - 92, 34, 120, 46, 'Skip', () => this.skipNow(), { style: 'ghost', size: 19 });
    this.skip.chip = 'tutorial-skip';
    this.bar = ui.add.graphics();
    c.add([this.bg, this.block, this.bar, this.kicker, this.title, this.body, this.skip]);
    this.rect = { x: 16, y: 0, w: W - 32, h: this.cardH };
  }

  skipNow() {
    store.skipTutorial();
    this.hide();
    this.ui.toast('Tutorial skipped. Replay it any time from Settings.', 2600);
  }

  hide() { this.card.setVisible(false); this.pointer.setVisible(false); this.arrow.setVisible(false); }

  blocks(x, y) { return this.card.visible && x >= this.rect.x && x <= this.rect.x + this.rect.w && y >= this.rect.y && y <= this.rect.y + this.rect.h; }

  refreshCard(force) {
    if (!this.active) { this.hide(); return; }
    const S = STEPS[this.step];
    if (!S) return;
    if (force || this.shownStep !== this.step) {
      this.shownStep = this.step;
      this.kicker.setText(`TUTORIAL  ·  STEP ${this.step + 1} / ${TUTORIAL.steps}`);
      this.title.setText(S.title);
      this.body.setText(S.body);
      const ui = this.ui;
      this.card.setAlpha(0);
      ui.tweens.add({ targets: this.card, alpha: 1, duration: 200 });
    }
  }

  placeCard(target) {
    const H = this.ui.scale.height;
    const topY = 196, botY = H - 130 - this.cardH - 14;
    // keep the card away from the pointer target and from the building panel
    let y = topY;
    if (target && target.y < H * 0.5) y = botY;
    if (this.ui.panel.visible && y === botY) y = topY;
    if (this.ui.worldMode && y === botY) y = botY - 96; // above the World squad bar
    this.rect.y = y;
    this.card.y = y;
    const g = this.bg; g.clear();
    panelBg(g, 16, 0, W - 32, this.cardH, { fill: 0x0c1118, alpha: 0.97, stroke: PALETTE.gold, accent: PALETTE.cyan });
    const pct = this.step / TUTORIAL.steps;
    this.bar.clear().fillStyle(0x05070a, 1).fillRect(40, this.cardH - 18, W - 80, 6).fillStyle(PALETTE.gold, 1).fillRect(40, this.cardH - 18, (W - 80) * pct, 6);
  }

  update(dtMs) {
    if (!this.active) { if (this.card.visible) this.hide(); return; }
    const ui = this.ui;
    // enter the current step once (assists / marks)
    if (this.entered !== this.step) { this.entered = this.step; this.t = {}; STEPS[this.step]?.enter?.(ui, this.t); this.refreshCard(true); }
    this.lastCheck += dtMs;
    if (this.lastCheck > 150) {
      this.lastCheck = 0;
      const S = STEPS[this.step];
      if (S?.done(ui, this.t)) { this.advance(); return; }
    }
    const busy = ui.reveal || ui.replay || ui.modal; // step aside for overlays (they block taps anyway)
    if (busy) { this.hide(); return; }
    const S = STEPS[this.step];
    const tg = S?.target(ui) ?? null;
    this.card.setVisible(true);
    this.placeCard(tg);
    // pulsing ring + bobbing arrow on the target
    const g = this.pointer; g.clear();
    if (tg) {
      const k = (Math.sin(ui.time.now / 180) + 1) / 2;
      g.lineStyle(4, PALETTE.gold, 0.9).strokeCircle(tg.x, tg.y, tg.r + k * 8);
      g.lineStyle(10, PALETTE.gold, 0.18).strokeCircle(tg.x, tg.y, tg.r + 10 + k * 8);
      g.setVisible(true);
      const below = tg.y - tg.r < 260;
      this.arrow.setText(below ? '▲' : '▼').setOrigin(0.5, below ? 0 : 1).setPosition(tg.x, below ? tg.y + tg.r + 6 + k * 10 : tg.y - tg.r - 6 - k * 10).setVisible(true);
      ui.children.bringToTop(this.pointer); ui.children.bringToTop(this.arrow);
    } else { g.setVisible(false); this.arrow.setVisible(false); }
    this.target = tg;
  }

  advance() {
    const next = this.step + 1;
    store.tutorialAdvance(next);
    audio.play(next >= TUTORIAL.steps ? 'levelup' : 'reward');
    audio.haptic(15);
    if (next >= TUTORIAL.steps) {
      this.hide();
      this.ui.toast(`Tutorial complete, Commander! +${fmt(TUTORIAL.reward.energy)} Energy, +${TUTORIAL.reward.cores} Beacon Cores.\nReplay it any time from Settings.`, 4200);
      this.ui.floatText?.(110, 96, `+${TUTORIAL.reward.energy}`, PALETTE.textCyan);
    }
  }

  stateForTest() {
    return { active: this.active, step: this.step, visible: this.card.visible, title: this.title.text, target: this.target ? { x: Math.round(this.target.x), y: Math.round(this.target.y) } : null, cardY: this.rect.y };
  }
}
