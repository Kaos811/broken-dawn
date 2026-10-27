// Stage 13: the new-player first 10 minutes. Ten action-driven steps narrated by Lyra (painted busts in a
// speech bubble), with a soft spotlight and a gauntlet pointer on the one thing to tap. Each step advances
// only when the player actually does it (detected from game state). HUD parts stay hidden until their
// step introduces them (ui.unlocked(id), see TUTORIAL.unlockAt). Painted celebrations mark the milestones.
// Skip (with a confirm) unlocks everything and pays the completion reward. After it: a "Next goal" chip and
// one-time Lyra tips (Infirmary, Research, Edit Formation). Replayable from Settings.
import { GAME_WIDTH as W, GAME_HEIGHT, PALETTE, TUTORIAL, BEACON, TROOP_IDS, LEADERS, BUILDINGS } from '../config.js';
import { store } from '../state/store.js';
import { text, button, panelBg, fmt } from '../ui/widgets.js';
import { audio } from '../audio/audio.js';
import { TOP_H, NAV_H, HERO_RISE, SAFE } from '../ui/layout.js';

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
function tab(ui, id) { const t = ui.tabs.find((x) => x.id === id); return { x: t.cx, y: t.cy, r: t.hero ? 78 : 56 }; }
function buildingPos(ui, id) {
  const base = ui.scene.get('Base');
  if (ui.worldMode || ui.screen || !base?.sprites) return null;
  const img = id === BEACON.id ? base.beaconSprite : base.sprites[id]?.img;
  if (!img) return null;
  const p = base.worldToScreen(img.x, img.y - img.displayHeight * 0.35);
  const r = Math.max(50, img.displayWidth * base.zl * 0.35);
  const H = GAME_HEIGHT;
  // stay clear of the HUD side columns (queue / quick buttons, ~100 px wide each) and the bottom panel
  const clear = p.y > TOP_H + 174 && p.y < H - NAV_H - 388 && p.x > 150 && p.x < W - 150;
  if (clear) { base._tutPan = null; return { x: p.x, y: p.y, r }; }
  // off-screen or under the HUD/panel: glide the camera over to it first, then point
  const cam = base.cameras.main;
  if (cam.panEffect.isRunning) return null;
  if (base._tutPan !== id) { base._tutPan = id; base.focus(id, 450); return null; }
  // already glided once (the map edge can stop the camera short): point if it's at least tappable
  return p.y > TOP_H + 34 && p.y < H - NAV_H - 8 && p.x > 130 && p.x < W - 130 ? { x: p.x, y: p.y, r } : null;
}
const goBase = (ui) => (ui.worldMode || ui.screen ? tab(ui, 'base') : null);
const readyTroops = () => TROOP_IDS.reduce((n, t) => n + store.readyCount(t), 0);


const huntTotal = () => store.state.hunt.kills + store.state.hunt.losses;
const ensureEnergy = (n) => { if (store.state.resources.energy < n) store.state.resources.energy = n; };

// nearest attackable creature on screen (pans the World camera to one once if none is visible)
function creatureTarget(ui) {
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
    if (p.y < TOP_H + 74 || p.y > GAME_HEIGHT - NAV_H - 170 || p.x < 30 || p.x > W - 30) continue;
    const d = (p.x - W / 2) ** 2 + (p.y - GAME_HEIGHT / 2) ** 2;
    if (!best || d < best.d) best = { x: p.x, y: p.y, r: 46, d };
  }
  if (!best && !ws.tutFocused) {
    const home = store.world.homeOf('local');
    const near = store.creatures().filter((e) => e.level <= maxL && !e.busy).sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
    if (near) { ws.tutFocused = true; ws.focusTile(near.x, near.y); }
  }
  return best;
}

// Step list. face = Lyra's expression; body may be a function (live text); cont = shows a Continue button.
export const STEPS = [
  { id: 'story', face: 'neutral', title: 'Broken Dawn', body: '', done: () => false, target: () => null },
  {
    id: 'beacon', face: 'neutral', title: 'Relight the Beacon',
    body: "Commander, the Beacon is our last light. Tap it to wake it up.",
    done: (ui) => ui.panelOpenFor === BEACON.id,
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor ? null : buildingPos(ui, BEACON.id)),
    after: (ui) => { ui.closePanel?.(true); ui.scene.get('Base')?.relightFx?.(); ui.tutorial.celebrate({ art: 'ob-victory-banner', title: 'The Beacon burns again', sub: 'It makes Energy and charges your upgrades.', quick: true }); },
  },
  {
    id: 'rebuild', face: 'determined', title: 'Rebuild the Barracks',
    body: 'Our Barracks is in ruins. Tap it, then Upgrade to rebuild it.',
    enter: () => ensureEnergy(store.upgradeInfo('barracks').cost + 50),
    done: () => store.state.construction.some((j) => j.id === 'barracks') || store.state.buildings.barracks.level > 1,
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor === 'barracks' ? findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled()) : buildingPos(ui, 'barracks')),
  },
  {
    id: 'finish', face: 'smile', title: 'Finish it free',
    body: () => (store.canFreeFinish({ kind: 'build', id: 'barracks' }) ? 'Jobs under 5 minutes finish free. Tap Free!' : 'The builders are on it…'),
    done: () => store.state.buildings.barracks.level > 1,
    target: (ui) => {
      if (ui.modal?.isSpeedUp) return findButton(ui, (o) => o.chip === 'su-free');
      if (goBase(ui)) return goBase(ui);
      return ui.panelOpenFor === 'barracks' ? findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled()) : buildingPos(ui, 'barracks');
    },
    after: (ui) => ui.tutorial.celebrate({ art: 'ob-victory-banner', title: 'Barracks rebuilt!', sub: 'New: Troops' }),
  },
  {
    id: 'train', face: 'neutral', title: 'Train Sentinels',
    body: () => (store.queuedUnits() > 0 ? 'Training… our Sentinels will be ready in a moment.' : 'Open Troops and train 10 Sentinels (x10).'),
    enter: (ui) => {
      ensureEnergy(300);
      if (!store.state.hints.tutTrainGift) { store.state.hints.tutTrainGift = true; store.grantItems(TUTORIAL.trainGift); store.save(); ui.toast('New: Items. Here are 3× 1m Speed-ups.', 2400); }
    },
    done: () => store.state.troops.sentinel >= 10 && store.lane('sentinel').count === 0,
    tick: (dt) => { if (store.queuedUnits() > 0) store.processTraining((dt / 1000) * (TUTORIAL.trainSpeed - 1)); },
    target: (ui) => {
      if (store.queuedUnits() > 0) return null;
      if (ui.screen?.id !== 'troops') return tab(ui, 'troops');
      return findButton(ui, (o) => o.trainType === 'sentinel' && /^x10/.test(label(o)) && o.isEnabled()) ?? findButton(ui, (o) => o.trainType === 'sentinel' && o.isEnabled());
    },
  },
  {
    id: 'squad', face: 'smile', title: 'Squad Alpha', cont: 'Continue',
    body: "I've formed Squad Alpha with your Sentinels. They're ready to march.",
    enter: () => {
      if (readyTroops() < 1) store.state.troops.sentinel += 10;
      const sq = store.state.squads.alpha;
      if (!sq.lines.some((l) => l.type && l.count > 0)) {
        const lines = sq.lines.map(() => ({ type: null, count: 0 }));
        lines[0] = { type: 'sentinel', count: Math.min(10, store.availableFor('sentinel', 'alpha')) };
        store.saveFormation('alpha', lines);
      }
    },
    done: (ui, t) => !!t.ok,
    target: () => null,
    after: (ui) => ui.toast('New: World', 1800),
  },
  {
    id: 'hunt', face: 'determined', title: 'First hunt',
    body: () => (store.world.marches().some((m) => m.owner === 'local') ? 'Squad Alpha is marching…' : 'A Scuttler is right outside. Open World, tap it, then Attack.'),
    enter: (ui, t) => { t.mark = huntTotal(); if (store.state.hunt.stamina < 10) store.state.hunt.stamina = 10; },
    done: (ui, t) => huntTotal() > (t.mark ?? Infinity) && !ui.replay,
    target: (ui) => {
      if (ui.reveal || ui.modal || store.world.marches().some((m) => m.owner === 'local')) return null;
      if (!ui.worldMode) return tab(ui, 'world');
      return creatureTarget(ui);
    },
    after: (ui) => {
      const r = store.state.hunt.reports?.[0];
      const win = r ? r.win !== false : true;
      ui.closeModal?.();
      ui.tutorial.celebrate({ art: 'ob-victory-banner', title: win ? 'Victory!' : 'A hard fight', sub: win ? 'Loot is on its way home. New: Armory + Beacon Cores' : 'Wounded troops heal over time. New: Armory', loot: win });
    },
  },
  {
    id: 'recruit', face: 'excited', title: 'Recruit a leader',
    body: 'Beacon Cores call leaders to our side. Open the Armory and Pull x1, it is on me.',
    enter: () => { if (store.state.resources.cores < 1) store.state.resources.cores = 1; },
    done: (ui) => !!store.state.leaders[TUTORIAL.firstPull] && !ui.reveal,
    target: (ui) => {
      if (ui.reveal) return null;
      if (ui.screen?.id !== 'armory') return tab(ui, 'armory');
      return findButton(ui, (o) => /^Pull x1/.test(label(o))) ?? findButton(ui, (o) => o.tabLabel === 'Recruit');
    },
    after: (ui) => {
      const L = LEADERS[TUTORIAL.firstPull];
      ui.tutorial.celebrate({
        art: 'ob-victory-banner', title: `${L.name} joins you!`, sub: `${L.title} · Legendary leader`,
        btn: 'Assign to Alpha', onBtn: () => { const r = store.assignLeader(L.id, 'alpha'); if (r.ok) ui.toast(`${L.name} now leads Squad Alpha`, 1800); },
      });
    },
  },
  {
    id: 'beacon2', face: 'excited', title: 'Beacon Lv 2',
    body: () => (store.constructionJob(BEACON.id) ? 'Almost there. Tap Free to finish it!' : 'The Beacon is fully charged. Tap it, then Upgrade.'),
    enter: () => {
      if (!store.constructionJob(BEACON.id)) store.state.beacon.charge = BEACON.maxCharge;
      ensureEnergy(store.upgradeInfo(BEACON.id).cost + 50);
    },
    done: () => store.state.beacon.level >= 2,
    target: (ui) => {
      if (ui.modal?.isSpeedUp) return findButton(ui, (o) => o.chip === 'su-free');
      if (goBase(ui)) return goBase(ui);
      return ui.panelOpenFor === BEACON.id ? findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled()) : buildingPos(ui, BEACON.id);
    },
    after: (ui) => ui.tutorial.celebrate({ art: 'ob-victory-banner', title: 'Beacon Lv 2!', sub: 'New: Squads, Missions, Builder and More', loot: true }),
  },
  {
    id: 'missions', face: 'smile', title: 'Daily Missions',
    body: 'Last thing: Daily Missions fill chests every day. Tap Missions on the right.',
    enter: () => { store.state.hints.missions = false; },
    done: () => store.state.hints.missions === true,
    target: (ui) => (ui.modal ? null : goBase(ui) ?? findButton(ui, (o) => o.chip === 'q-missions')),
  },
];
if (STEPS.length !== TUTORIAL.steps || STEPS.some((s, i) => s.id !== TUTORIAL.ids[i])) throw new Error('tutorial steps out of sync');

const STORY = [
  'The Rift tore the sky open. Our cities fell in a single night.',
  'The last survivors held on around a dying Beacon, waiting for someone to lead them.',
  'That someone is you, Commander. Relight the Beacon. Rebuild. Fight back.',
];

// one-time tips once the onboarding is over (and the "Next goal" chip)
const TIPS = [
  { id: 'infirmary', when: () => store.woundedTotal() > 0, text: 'Some of our troops came back wounded. The Infirmary heals them: tap Healing on the left.', target: (ui) => findButton(ui, (o) => o.chip === 'q-healing') },
  { id: 'research', when: () => store.archiveUnlocked(), text: 'Beacon Lv 3 opens the Archive. Research there gives permanent bonuses.', target: (ui) => findButton(ui, (o) => o.chip === 'q-research') },
  { id: 'formation', when: (ui) => ui.screen?.id === 'squads', text: 'Edit Formation lets you choose which troops fill each line of a squad.', target: (ui) => findButton(ui, (o) => label(o) === 'Edit Formation') },
];
function nextGoal() {
  const lv = store.state.beacon.level;
  const want = lv + 1;
  const unlock = Object.values(BUILDINGS).find((b) => b.unlockBeacon === want);
  return `Next goal: Beacon Lv ${want}${unlock ? `  ·  unlocks the ${unlock.name}` : ''}`;
}

export class Tutorial {
  constructor(ui) {
    this.ui = ui;
    this.entered = -1;
    this.t = {};
    this.disabled = !!(typeof window !== 'undefined' && window.__BD_TEST?.noTutorial);
    this.build();
    this.unsub = store.on('tutorial', (step, done) => { if (!done && step === 0) this.entered = -1; this.refreshCard(true); });
    this.lastCheck = 0;
    this.story = null;
    this.celebrating = null;
    this.tip = null;
  }

  get active() { return !this.disabled && !store.state.tutorial.done; }
  get step() { return store.state.tutorial.step; }
  // HUD gate: a part shows once its step has been reached (always when the tutorial is off or done)
  unlocked(id) { return !this.active || this.step >= (TUTORIAL.unlockAt[id] ?? 0); }

  build() {
    const ui = this.ui;
    this.spot = ui.add.graphics().setDepth(447).setVisible(false);
    this.pointer = ui.add.graphics().setDepth(449).setVisible(false);
    this.hand = ui.add.image(0, 0, 'ob-pointer').setDepth(449).setVisible(false);
    this.hand.setScale(130 / this.hand.height);
    const c = this.card = ui.add.container(0, 0).setDepth(450).setVisible(false);
    this.cardH = 172;
    const bx = 168;
    this.bg = ui.add.graphics();
    this.block = ui.add.rectangle(W / 2, this.cardH / 2, W - 32, this.cardH, 0, 0.001).setInteractive();
    this.face = ui.add.image(92, this.cardH + 4, 'ob-lyra-neutral').setOrigin(0.5, 1);
    this.kicker = text(ui, bx + 20, 14, 'LYRA', 16, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 });
    this.title = text(ui, bx + 20, 36, '', 25, PALETTE.text, { fontStyle: 'bold' });
    this.body = text(ui, bx + 20, 74, '', 20, '#d7dde6', { wordWrap: { width: W - bx - 64 }, lineSpacing: 4 });
    this.skip = button(ui, W - 76, 30, 96, 40, 'Skip', () => this.confirmSkip(), { style: 'ghost', size: 17 });
    this.skip.chip = 'tutorial-skip';
    this.cont = button(ui, W - 120, this.cardH - 40, 170, 52, 'Continue', () => this.onContinue(), { style: 'gold', size: 21 });
    this.cont.chip = 'tutorial-continue';
    this.bar = ui.add.graphics();
    c.add([this.bg, this.block, this.bar, this.face, this.kicker, this.title, this.body, this.skip, this.cont]);
    this.rect = { x: 16, y: 0, w: W - 32, h: this.cardH };
    // "Next goal" chip (after the onboarding)
    const g = this.goal = ui.add.container(W / 2, TOP_H + 22).setDepth(6).setVisible(false);
    this.goalBg = ui.add.graphics();
    this.goalText = text(ui, 0, 0, '', 17, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(0.5);
    this.goalHit = ui.add.rectangle(0, 0, 10, 36, 0, 0.001).setInteractive({ useHandCursor: true });
    this.goalHit.on('pointerup', () => { ui.closeModal(); ui.closeScreen(); ui.hideWorld(); ui.game.events.emit('ui:focus', BEACON.id); ui.game.events.emit('ui:focusBeacon'); });
    g.add([this.goalBg, this.goalText, this.goalHit]);
  }

  setFace(f) {
    const k = `ob-lyra-${f ?? 'neutral'}`;
    if (this.face.texture.key !== k) this.face.setTexture(k);
    this.face.setScale(Math.min(198 / this.face.height, 170 / this.face.width));
  }

  confirmSkip() {
    const ui = this.ui;
    ui.openModal({
      title: 'Skip the tutorial?',
      body: `Everything unlocks now and you still get the completion reward (+${fmt(TUTORIAL.reward.energy)} Energy, +${TUTORIAL.reward.cores} Beacon Cores).\nYou can replay it from More → Settings.`,
      buttons: [{ label: 'Keep going' }, { label: 'Skip', style: 'gold', onClick: () => this.skipNow() }],
    });
  }

  skipNow() {
    const paid = store.state.tutorial.rewarded;
    this.closeStory();
    store.skipTutorial();
    this.hide();
    this.ui.toast(paid ? 'Tutorial skipped: everything is unlocked.' : `Tutorial skipped: everything is unlocked. +${fmt(TUTORIAL.reward.energy)} Energy, +${TUTORIAL.reward.cores} Beacon Cores.`, 3000);
  }

  onContinue() {
    if (this.tip) { this.endTip(); return; }
    this.t.ok = true;
    this.lastCheck = 999;
  }

  hide() { this.card.setVisible(false); this.pointer.setVisible(false); this.hand.setVisible(false); this.spot.setVisible(false); }

  blocks(x, y) {
    if (this.story || this.celebrating) return true;
    return this.card.visible && x >= this.rect.x && x <= this.rect.x + this.rect.w && y >= this.rect.y && y <= this.rect.y + this.rect.h;
  }

  refreshCard(force) {
    if (this.tip) return;
    if (!this.active) { this.hide(); return; }
    const S = STEPS[this.step];
    if (!S) return;
    const body = typeof S.body === 'function' ? S.body() : S.body;
    if (force || this.shownStep !== this.step) {
      this.shownStep = this.step;
      this.title.setText(S.title);
      this.setFace(S.face);
      this.card.setAlpha(0);
      this.ui.tweens.add({ targets: this.card, alpha: 1, duration: 220 });
    }
    if (this.body.text !== body) this.body.setText(body);
    this.cont.setVisible(!!S.cont);
    this.skip.setVisible(true);
  }

  placeCard(target) {
    const H = GAME_HEIGHT;
    const topY = TOP_H + 34, botY = H - NAV_H - HERO_RISE - this.cardH - 10;
    let y = topY;
    if (target && target.y < H * 0.5) y = botY;
    if (this.ui.panel.visible && y === botY) y = target ? Math.min(target.y + 90, botY) : topY; // keep clear of the open panel and the target
    if (this.ui.worldMode && y === botY) y = botY - 96;
    this.rect.y = y;
    this.card.y = y;
    const g = this.bg; g.clear();
    panelBg(g, 150, 0, W - 166, this.cardH, { fill: 0x0c1118, alpha: 0.96, stroke: PALETTE.gold, accent: PALETTE.cyan });
    // bubble tail toward Lyra
    g.fillStyle(0x0c1118, 0.96).fillTriangle(152, this.cardH - 70, 152, this.cardH - 36, 128, this.cardH - 40);
    g.lineStyle(2, PALETTE.gold, 0.9).lineBetween(152, this.cardH - 70, 128, this.cardH - 40).lineBetween(128, this.cardH - 40, 152, this.cardH - 36);
    const done = this.tip ? 0 : this.step, n = TUTORIAL.steps;
    const b = this.bar.clear();
    if (!this.tip) for (let i = 1; i < n; i++) {
      const x = 188 + (i - 1) * 22, on = i < done, cur = i === done;
      b.fillStyle(on ? PALETTE.gold : cur ? PALETTE.cyan : 0x2a313b, 1).fillCircle(x, this.cardH - 18, cur ? 6 : 5);
    }
  }

  drawTarget(tg) {
    const ui = this.ui, g = this.pointer, sp = this.spot;
    g.clear(); sp.clear();
    if (!tg) { g.setVisible(false); this.hand.setVisible(false); sp.setVisible(false); return; }
    const k = (Math.sin(ui.time.now / 180) + 1) / 2;
    // soft spotlight: dim everything around a box on the target (taps still go through)
    const H = GAME_HEIGHT, R = tg.r + 14;
    const x0 = Math.max(0, tg.x - R), x1 = Math.min(W, tg.x + R), y0 = Math.max(0, tg.y - R), y1 = Math.min(H, tg.y + R);
    sp.fillStyle(0x020306, 0.42).fillRect(0, 0, W, y0).fillRect(0, y1, W, H - y1).fillRect(0, y0, x0, y1 - y0).fillRect(x1, y0, W - x1, y1 - y0);
    sp.setVisible(true);
    g.lineStyle(4, PALETTE.gold, 0.9).strokeCircle(tg.x, tg.y, tg.r + k * 8);
    g.lineStyle(10, PALETTE.cyan, 0.16).strokeCircle(tg.x, tg.y, tg.r + 10 + k * 8);
    g.setVisible(true);
    // gauntlet pointer: points down at the target (flipped to point up when the target is near the top)
    const up = tg.y - tg.r - 150 < TOP_H - 40;
    const off = tg.r * 0.55 + 6 + k * 14;
    this.hand.setFlipY(up).setOrigin(0.5, up ? 0 : 1).setPosition(tg.x, up ? tg.y + off : tg.y - off).setVisible(true);
    ui.children.bringToTop(sp); ui.children.bringToTop(g); ui.children.bringToTop(this.hand);
  }

  update(dtMs) {
    const ui = this.ui;
    if (!this.active) {
      if (this.story) this.closeStory();
      if (this.card.visible && !this.tip) this.hide();
      this.updateAfter(dtMs);
      return;
    }
    this.goal.setVisible(false);
    if (this.tip) this.endTip(); // a replay starts clean
    if (this.step === 0) { this.hide(); if (!this.story) this.openStory(); return; }
    if (this.celebrating) { this.hide(); return; }
    if (this.entered !== this.step) { this.entered = this.step; this.t = {}; STEPS[this.step]?.enter?.(ui, this.t); this.refreshCard(true); }
    const S = STEPS[this.step];
    S?.tick?.(dtMs);
    this.lastCheck += dtMs;
    if (this.lastCheck > 150) {
      this.lastCheck = 0;
      if (S?.done(ui, this.t)) { this.advance(); return; }
      this.refreshCard(false);
    }
    const busy = ui.reveal || ui.replay || (ui.modal && !ui.modal.isSpeedUp && !ui.modal.isMissions);
    if (busy) { this.hide(); return; }
    const tg = S?.target(ui) ?? null;
    this.card.setVisible(true);
    this.placeCard(tg);
    this.drawTarget(tg);
    this.target = tg;
  }

  // after the onboarding: Next goal chip + one-time tips
  updateAfter() {
    const ui = this.ui;
    if (this.disabled) { this.goal.setVisible(false); return; }
    const base = ui.scene.get('Base');
    const show = !ui.worldMode && !ui.screen && !ui.modal && !ui.reveal && !ui.placeChip?.visible && !base?.moveId && !base?.placeId && !this.tip;
    this.goal.setVisible(show);
    if (show) {
      const s = nextGoal();
      if (this.goalText.text !== s) {
        this.goalText.setText(s);
        const w = this.goalText.width + 40;
        this.goalBg.clear().fillStyle(0x05070a, 0.85).fillRoundedRect(-w / 2, -18, w, 36, 18).lineStyle(2, PALETTE.gold, 0.8).strokeRoundedRect(-w / 2, -18, w, 36, 18);
        this.goalHit.setSize(w, 36); this.goalHit.input.hitArea.setSize(w, 36); this.goalHit.setDisplayOrigin(w / 2, 18);
      }
    }
    if (this.celebrating) return;
    const h = store.state.hints;
    if (!this.tip) {
      if (ui.reveal || ui.replay || (ui.modal && !ui.modal.isMore)) return;
      const T = TIPS.find((x) => !h[`tip_${x.id}`] && x.when(ui));
      if (T) this.startTip(T);
      return;
    }
    const tg = this.tip.target(ui) ?? null;
    this.placeCard(tg);
    this.drawTarget(tg);
  }

  startTip(T) {
    this.tip = T;
    store.state.hints[`tip_${T.id}`] = true; store.save();
    this.setFace('smile');
    this.title.setText('A tip from Lyra');
    this.body.setText(T.text);
    this.cont.setLabel?.('Got it'); this.cont.setVisible(true); this.skip.setVisible(false);
    this.card.setVisible(true).setAlpha(0);
    this.ui.tweens.add({ targets: this.card, alpha: 1, duration: 220 });
    audio.play('tap');
  }
  endTip() {
    this.tip = null;
    this.cont.setLabel?.('Continue');
    this.hide();
  }

  advance() {
    const S = STEPS[this.step];
    const next = this.step + 1;
    store.tutorialAdvance(next);
    audio.play(next >= TUTORIAL.steps ? 'levelup' : 'reward');
    audio.haptic(15);
    this.hide();
    S?.after?.(this.ui);
    if (next >= TUTORIAL.steps) {
      this.ui.toast('Tutorial complete! Replay it any time from More → Settings.', 3200);
      this.celebrate({ art: 'ob-chest-open', title: 'Training complete!', sub: `Supply chest: +${fmt(TUTORIAL.reward.energy)} Energy, +${TUTORIAL.reward.cores} Beacon Cores`, loot: true, chest: true });
    }
  }

  // ---------------------------------------------------------------- story panels --
  openStory() {
    const ui = this.ui, H = GAME_HEIGHT;
    const c = this.story = ui.add.container(0, 0).setDepth(600);
    c.page = 0;
    const bg = ui.add.rectangle(W / 2, H / 2, W, H, 0x000000, 1).setInteractive();
    const img = ui.add.image(W / 2, H / 2, 'ob-story-1');
    const shade = ui.add.graphics();
    shade.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.92, 0.92).fillRect(0, H - 460, W, 260).fillStyle(0x000000, 0.92).fillRect(0, H - 200, W, 200);
    const cap = text(ui, W / 2, H - 230, '', 30, '#f3e6c8', { fontStyle: 'bold', align: 'center', wordWrap: { width: W - 100 }, lineSpacing: 8, stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0.5);
    const hint = text(ui, W / 2, H - 110, 'Tap to continue', 20, PALETTE.textGold).setOrigin(0.5);
    const dots = ui.add.graphics();
    const skip = button(ui, W - 100, 70 + SAFE.top, 150, 52, 'Skip intro', () => this.finishStory(), { style: 'ghost', size: 19 });
    skip.chip = 'story-skip';
    c.add([bg, img, shade, cap, hint, dots, skip]);
    const show = (i) => {
      c.page = i;
      img.setTexture(`ob-story-${i + 1}`);
      img.setScale(Math.max(W / img.width, H / img.height));
      img.setAlpha(0); ui.tweens.add({ targets: img, alpha: 1, duration: 450 });
      ui.tweens.add({ targets: img, scale: img.scale * 1.05, duration: 9000 });
      cap.setText(STORY[i]); cap.setAlpha(0); ui.tweens.add({ targets: cap, alpha: 1, duration: 600, delay: 200 });
      hint.setText(i === STORY.length - 1 ? 'Tap to begin' : 'Tap to continue');
      dots.clear();
      for (let k = 0; k < STORY.length; k++) dots.fillStyle(k === i ? PALETTE.gold : 0x4a5260, 1).fillCircle(W / 2 + (k - 1) * 28, H - 66, k === i ? 8 : 6);
      audio.play('tap');
    };
    c.advance = () => { if (c.page + 1 >= STORY.length) this.finishStory(); else show(c.page + 1); };
    bg.on('pointerup', () => c.advance());
    show(0);
  }
  closeStory() {
    if (!this.story) return;
    this.ui.tweens.killTweensOf(this.story.list);
    this.story.destroy(); this.story = null;
  }
  finishStory() {
    this.closeStory();
    if (this.active && this.step === 0) store.tutorialAdvance(1);
  }

  // ---------------------------------------------------------------- celebrations --
  // Painted banner (or the open chest) with a title, a line under it, sparkles; tap (or the button) to close.
  celebrate({ art = 'ob-victory-banner', title, sub = '', btn = null, onBtn = null, loot = false, chest = false, quick = false }) {
    const ui = this.ui, H = GAME_HEIGHT;
    this.closeCelebrate();
    const c = this.celebrating = ui.add.container(0, 0).setDepth(700);
    const dim = ui.add.rectangle(W / 2, H / 2, W, H, 0x020306, quick ? 0.45 : 0.7).setInteractive();
    const cy = H * 0.42;
    const glow = ui.add.image(W / 2, cy, 'glow').setBlendMode('ADD').setTint(chest ? 0x5ff0d8 : 0xffc45a).setScale(6).setAlpha(0.5);
    const im = ui.add.image(W / 2, cy, art);
    const k = (chest ? 340 : 600) / im.width; im.setScale(k * 0.6);
    const tt = text(ui, W / 2, chest ? cy + 210 : cy - 4, title, chest ? 40 : 38, '#fff1cf', { fontStyle: 'bold', stroke: '#1a1004', strokeThickness: 6, align: 'center' }).setOrigin(0.5);
    if (!chest && tt.width > 380) tt.setScale(380 / tt.width);
    const st = text(ui, W / 2, chest ? cy + 262 : cy + 130, sub, 24, PALETTE.textCyan, { fontStyle: 'bold', align: 'center', wordWrap: { width: W - 120 }, stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0);
    c.add([dim, glow, im, tt, st]);
    ui.tweens.add({ targets: im, scale: k, duration: 420, ease: 'Back.easeOut' });
    ui.tweens.add({ targets: glow, alpha: 0.25, scale: 7, duration: 1400, yoyo: true, repeat: -1 });
    for (let i = 0; i < 16; i++) { // sparkles
      const s = ui.add.image(W / 2, cy, 'glow').setBlendMode('ADD').setTint(i % 2 ? PALETTE.gold : PALETTE.cyan).setScale(0.25);
      c.add(s);
      const a = (i / 16) * Math.PI * 2, d = 220 + (i % 3) * 60;
      ui.tweens.add({ targets: s, x: W / 2 + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7, alpha: 0, duration: 900 + (i % 4) * 150, ease: 'Cubic.easeOut' });
    }
    if (loot) this.flyLoot();
    audio.play('levelup'); audio.haptic([20, 40, 30]);
    let canClose = false;
    ui.time.delayedCall(quick ? 300 : 650, () => { canClose = true; });
    const close = () => { if (!canClose || this.celebrating !== c) return; this.closeCelebrate(); };
    if (btn) {
      const b = button(ui, W / 2, chest ? cy + 360 : cy + 230, 340, 76, btn, () => { onBtn?.(); canClose = true; close(); }, { style: 'gold', size: 26 });
      b.chip = 'celebrate-btn'; c.add(b);
    } else {
      c.add(text(ui, W / 2, chest ? cy + 330 : cy + 200, 'Tap to continue', 20, PALETTE.textGold).setOrigin(0.5, 0));
      dim.on('pointerup', close);
      if (quick) ui.time.delayedCall(1600, () => { canClose = true; close(); });
    }
    c.onBtn = btn ? () => { onBtn?.(); canClose = true; close(); } : null;
    c.close = () => { canClose = true; close(); };
  }
  closeCelebrate() {
    const c = this.celebrating; if (!c) return;
    this.ui.tweens.killTweensOf(c.list);
    c.destroy(); this.celebrating = null;
  }
  flyLoot() {
    const ui = this.ui, H = GAME_HEIGHT;
    const dest = [[ui.energyText, 'hud-energy'], [ui.alloyText, 'hud-alloy'], [ui.shardText, 'hud-shards'], [ui.coreText, 'hud-core']];
    dest.forEach(([t, key], j) => {
      if (!t || !ui.textures.exists(key)) return;
      for (let i = 0; i < 3; i++) {
        const s = ui.add.image(W / 2 + (i - 1) * 40, H * 0.5, key).setDepth(710).setDisplaySize(34, 40);
        ui.tweens.add({ targets: s, x: t.x + 10, y: t.y + 6, scale: s.scale * 0.6, duration: 700, delay: 250 + j * 120 + i * 70, ease: 'Cubic.easeIn', onComplete: () => { s.destroy(); ui.bump?.(t); } });
      }
    });
  }

  stateForTest() {
    return {
      active: this.active, step: this.step, id: STEPS[this.step]?.id ?? 'done', visible: this.card.visible, title: this.title.text, body: this.body.text,
      target: this.target && this.card.visible ? { x: Math.round(this.target.x), y: Math.round(this.target.y) } : null, cardY: this.rect.y,
      story: this.story ? this.story.page : null, celebrating: this.celebrating ? true : false, tip: this.tip?.id ?? null,
      goal: this.goal.visible ? this.goalText.text : null,
      locked: Object.keys(TUTORIAL.unlockAt).filter((id) => !this.unlocked(id)),
    };
  }
}
