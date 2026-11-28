// Stage 13: the new-player first 10 minutes. Ten action-driven steps narrated by Lyra (painted busts in a
// speech bubble), with a soft spotlight and a painted index-finger pointer on the one thing to tap. Each step advances
// only when the player actually does it (detected from game state). HUD parts stay hidden until their
// step introduces them (ui.unlocked(id), see TUTORIAL.unlockAt). Painted celebrations mark the milestones.
// Skip (with a confirm) unlocks everything and pays the completion reward. After it: a "Next goal" chip and
// one-time Lyra tips (Infirmary, Research, Edit Formation). Replayable from Settings.
import { GAME_WIDTH as W, GAME_HEIGHT, PALETTE, TUTORIAL, BEACON, TROOP_IDS, LEADERS, BUILDINGS, CREATURES } from '../config.js';
import { store } from '../state/store.js';
import { text, button, panelBg, fmt } from '../ui/widgets.js';
import { audio } from '../audio/audio.js';
import { TOP_H, NAV_H, HERO_RISE, SAFE } from '../ui/layout.js';
import { syntheticClickFilter } from '../ui/gesture.js';

// helpers to locate things on screen (game coordinates)
function findButton(ui, pred) {
  let hit = null;
  const visible = (o) => { for (let p = o; p; p = p.parentContainer) if (!p.visible || !p.active) return false; return true; };
  const walk = (o) => {
    if (hit) return;
    if (o.isButton && visible(o) && pred(o)) {
      const b = o.hit.getBounds();
      hit = { x: b.centerX, y: b.centerY, r: Math.max(b.width, b.height) / 2 + 8, obj: o };
      return;
    }
    (o.list ?? []).forEach(walk);
  };
  ui.children.list.forEach(walk);
  return hit;
}
const label = (o) => o.labelText?.text ?? '';
const point = (hit) => (hit ? { x: hit.x, y: hit.y, r: hit.r } : null);
function tab(ui, id) { const t = ui.tabs.find((x) => x.id === id); return t ? { x: t.cx, y: t.cy, r: t.hero ? 78 : 56 } : null; }

// A button inside a scrolling sheet can sit above or below the mask. Nudge the scroller so its
// centre is in the view, and let the next frame measure it again.
function scrollIntoView(ui, hit) {
  const s = ui.scroller, o = hit?.obj;
  if (!s?.body?.active || !o) return false;
  let inside = false;
  for (let p = o; p; p = p.parentContainer) if (p === s.body) inside = true;
  if (!inside) return false;
  const b = o.hit.getBounds(), v = s.view;
  const top = v.y + 28, bot = v.y + v.height - 28;
  if (b.centerY >= top && b.centerY <= bot && b.centerX >= v.x + 8 && b.centerX <= v.x + v.width - 8) return false;
  s.set(s.offset + (b.centerY - (v.y + v.height / 2)));
  return true;
}

// Where a building tap is actually reachable: below the top HUD, above the nav / open panel,
// and clear of the side columns (queue buttons on the left, Missions on the right).
function buildingClear(ui, tg, loose = false) {
  const H = GAME_HEIGHT;
  const top = TOP_H + (loose ? 16 : 40);
  const panelTop = ui.panel?.visible && ui.panel.active ? ui.panelRect.y : H;
  const bot = Math.min(panelTop - 20, H - NAV_H - (loose ? 16 : HERO_RISE + 20));
  const left = loose ? 28 : 120, right = loose ? W - 28 : W - 120;
  return tg.x > left && tg.x < right && tg.y > top && tg.y < bot;
}
function buildingPos(ui, id) {
  const base = ui.scene.get('Base');
  if (ui.worldMode || ui.screen || !base?.sprites) return null;
  const img = id === BEACON.id ? base.beaconSprite : base.sprites[id]?.img;
  if (!img?.active) return null;
  const p = base.worldToScreen(img.x, img.y - img.displayHeight * 0.35);
  const r = Math.max(46, Math.min(72, img.displayWidth * base.zl * 0.28));
  const tg = { x: p.x, y: p.y, r };
  const cam = base.cameras.main;
  if (cam.panEffect.isRunning) return null;
  if (buildingClear(ui, tg)) { base._tutAim = null; return tg; }
  // One pan at the current zoom used to give up when the tap point stayed under the HUD
  // (zoomed-in base, or the map edge stopping the camera short). Frame it, zooming out, a few times.
  const n = base._tutAim?.id === id ? base._tutAim.n : 0;
  if (n >= 3) return buildingClear(ui, tg, true) ? tg : null;
  base._tutAim = { id, n: n + 1 };
  const sy = TOP_H + Math.min(460, (GAME_HEIGHT - NAV_H - HERO_RISE - TOP_H) * 0.36);
  base.frameTutorial(id, W / 2, sy, 420);
  return null;
}
const goBase = (ui) => (ui.worldMode || ui.screen ? tab(ui, 'base') : null);
const readyTroops = () => TROOP_IDS.reduce((n, t) => n + store.readyCount(t), 0);


const huntTotal = () => store.state.hunt.kills + store.state.hunt.losses;
const ensureEnergy = (n) => { if (store.state.resources.energy < n) store.state.resources.energy = n; };

// Safe band on the World map: below the stamina strip, above the squad bar and the Lyra card,
// and clear of the search / home buttons on the right.
function worldBand() {
  const H = GAME_HEIGHT;
  const barTop = H - NAV_H - HERO_RISE - 120;
  return { top: TOP_H + 112, bottom: barTop - 172 - 28, left: 40, right: W - 120 };
}
function inBand(p, band) { return p.x > band.left && p.x < band.right && p.y > band.top && p.y < band.bottom; }

// nearest attackable creature (not a rally-only behemoth). Pans, and zooms out, until one sits in the band.
function creatureTarget(ui) {
  const atk = findButton(ui, (o) => o.chip === 'attack-alpha' && o.isEnabled());
  if (atk) return scrollIntoView(ui, atk) ? null : point(atk);
  const ws = ui.scene.get('World');
  if (!ws?.crSprites) return null;
  // A sheet with no usable Attack covers the map. Close it so the creature itself can be tapped.
  if (ui.worldHud?.sheet) { ui.worldHud.closeSheet(); return null; }
  const maxL = store.maxAttackLevel();
  const band = worldBand();
  const attackable = (e) => e && e.kind === 'creature' && e.level <= maxL && !e.busy && !CREATURES[e.type]?.rallyOnly;
  let best = null;
  for (const [id, s] of ws.crSprites) {
    const e = store.world.get(id);
    if (!attackable(e)) continue;
    const p = ws.worldToScreen(s.img.x, s.img.y - 20);
    if (!inBand(p, band)) continue;
    const d = (p.x - W / 2) ** 2 + (p.y - (band.top + band.bottom) / 2) ** 2;
    if (!best || d < best.d) best = { x: p.x, y: p.y, r: 46, d };
  }
  if (best) { ws._tutAim = 0; return best; }
  if (ui.time.now - (ws._tutAt ?? 0) < 480) return null;
  const n = ws._tutAim ?? 0;
  if (n >= 4) return null;
  const home = store.world.homeOf('local');
  const near = store.creatures().filter(attackable).sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
  if (!near) return null;
  ws._tutAim = n + 1;
  ws._tutAt = ui.time.now;
  // wider zoom on later tries, and a small upward bias so the body clears the squad bar
  ws.focusTile(near.x, near.y, n === 0 ? Math.min(ws.zl, 0.62) : 0.45, 40);
  return null;
}

// Button targets (Pull x1, x10, Free, Missions) can be scrolled off the sheet. Bring them in first.
function present(ui, hit) {
  if (!hit) return null;
  if (hit.obj && scrollIntoView(ui, hit)) return null;
  return point(hit);
}

// Pointer sits above every tutorial-relevant overlay (building panels 10, screens 50,
// modals 100, reveals 300, story 600, celebrations 700, loot flies 710). The TEST
// MODE banner stays above it at 820.
const SPOT_DEPTH = 790;
const POINTER_DEPTH = 800;
const HAND_DEPTH = 805;
const CARD_DEPTH = 810;
// Painted index-finger hand from the walkthrough mockup (ee0fc46). Display width
// matches the mockup's 56 CSS px on a 390-wide phone: 56 * (720 / 390) ≈ 103.
const HAND_DISPLAY_W = 104;
const HAND_ORIGIN_X = 0.5;
const HAND_ORIGIN_Y = 1; // index fingertip is at the bottom-center of the painting

function inContainer(o, root) {
  if (!root || !o) return false;
  for (let p = o; p; p = p.parentContainer) if (p === root) return true;
  return false;
}

const POPUP_ACTION = /^(Free|Upgrade|Collect|Claim|Continue|Reveal All|Got it|Speed Up|Train\b|x10)|Assign|Pull x1/i;

// Button on an open pop-up (celebration, reveal, report, speed-up, and so on).
// Returns null for the Skip-tutorial confirm so the finger does not aim at Skip.
function popupAction(ui, tut) {
  if (ui.modal && findButton(ui, (o) => label(o) === 'Keep going' && inContainer(o, ui.modal))) return null;
  const pick = (pred) => present(ui, findButton(ui, (o) => o.isEnabled() && pred(o)));
  if (tut.celebrating) {
    return pick((o) => o.chip === 'celebrate-btn' || o.chip === 'celebrate-continue');
  }
  if (ui.reveal) {
    return pick((o) => inContainer(o, ui.reveal) && /^(Continue|Reveal All)$/.test(label(o)));
  }
  if (ui.replay) {
    return pick((o) => inContainer(o, ui.replay) && /^(Continue|Skip)$/.test(label(o)));
  }
  if (ui.modal) {
    return pick((o) => inContainer(o, ui.modal) && POPUP_ACTION.test(label(o)))
      ?? pick((o) => inContainer(o, ui.modal) && !/^(Close|Cancel|✕|Keep going|Later)$/i.test(label(o)));
  }
  return null;
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
    target: (ui) => goBase(ui) ?? (ui.panelOpenFor === 'barracks' ? present(ui, findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled())) : buildingPos(ui, 'barracks')),
  },
  {
    id: 'finish', face: 'smile', title: 'Finish it free',
    body: () => (store.canFreeFinish({ kind: 'build', id: 'barracks' }) ? 'Jobs under 5 minutes finish free. Tap Free!' : 'The builders are on it…'),
    done: () => store.state.buildings.barracks.level > 1,
    target: (ui) => {
      if (ui.modal?.isSpeedUp) return present(ui, findButton(ui, (o) => o.chip === 'su-free' && o.isEnabled()));
      if (goBase(ui)) return goBase(ui);
      return ui.panelOpenFor === 'barracks' ? present(ui, findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled())) : buildingPos(ui, 'barracks');
    },
    after: (ui) => ui.tutorial.celebrate({ art: 'ob-victory-banner', title: 'Barracks rebuilt!', sub: 'New: Troops' }),
  },
  {
    id: 'train', face: 'neutral', title: 'Train Sentinels',
    body: () => (store.queuedUnits() > 0
      ? (Object.keys(store.state.training).some((id) => store.canFreeFinish({ kind: 'lane', id }))
        ? 'Under 5 minutes left finishes free. Tap Free!'
        : 'Training… our Sentinels will be ready in a moment.')
      : 'Open Troops and train 10 Sentinels (x10).'),
    enter: (ui) => {
      ensureEnergy(300);
      if (!store.state.hints.tutTrainGift) { store.state.hints.tutTrainGift = true; store.grantItems(TUTORIAL.trainGift); store.save(); ui.toast('New: Items. Here are 3× 1m Speed-ups.', 2400); }
    },
    done: () => store.state.troops.sentinel >= 10 && store.lane('sentinel').count === 0,
    // Fallback if the player never taps Free: training still runs at the tutorial's 3x speed.
    tick: (dt) => { if (store.queuedUnits() > 0) store.processTraining((dt / 1000) * (TUTORIAL.trainSpeed - 1)); },
    target: (ui) => {
      if (ui.modal?.isSpeedUp) return present(ui, findButton(ui, (o) => o.chip === 'su-free' && o.isEnabled()));
      if (store.queuedUnits() > 0) {
        // The troops sheet covers the left queue column; close it so FREE is tappable.
        if (ui.screen) ui.closeScreen();
        if (goBase(ui)) return goBase(ui);
        return present(ui, findButton(ui, (o) => o.chip === 'q-training' && o.visible));
      }
      if (ui.screen?.id !== 'troops') return tab(ui, 'troops');
      return present(ui, findButton(ui, (o) => o.trainType === 'sentinel' && /^x10/.test(label(o)) && o.isEnabled()) ?? findButton(ui, (o) => o.trainType === 'sentinel' && o.isEnabled()));
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
    // The march and the battle report have nothing to tap. A missing creature is not this wait.
    hold: (ui) => !!ui.reveal || !!ui.replay || store.world.marches().some((m) => m.owner === 'local'),
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
      return present(ui, findButton(ui, (o) => /^Pull x1/.test(label(o)) && o.isEnabled()) ?? findButton(ui, (o) => /^Pull x1/.test(label(o))) ?? findButton(ui, (o) => o.tabLabel === 'Recruit'));
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
      if (ui.modal?.isSpeedUp) return present(ui, findButton(ui, (o) => o.chip === 'su-free' && o.isEnabled()));
      if (goBase(ui)) return goBase(ui);
      return ui.panelOpenFor === BEACON.id ? present(ui, findButton(ui, (o) => o === ui.pUpgrade && o.isEnabled())) : buildingPos(ui, BEACON.id);
    },
    after: (ui) => ui.tutorial.celebrate({ art: 'ob-victory-banner', title: 'Beacon Lv 2!', sub: 'New: Squads, Missions, Builder and More', loot: true }),
  },
  {
    id: 'missions', face: 'smile', title: 'Daily Missions',
    body: 'Last thing: Daily Missions fill chests every day. Tap Missions on the right.',
    enter: () => { store.state.hints.missions = false; },
    done: () => store.state.hints.missions === true,
    target: (ui) => (ui.modal ? null : goBase(ui) ?? present(ui, findButton(ui, (o) => o.chip === 'q-missions' && o.visible))),
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
    this.spot = ui.add.graphics().setDepth(SPOT_DEPTH).setVisible(false);
    this.pointer = ui.add.graphics().setDepth(POINTER_DEPTH).setVisible(false);
    this.hand = ui.add.image(0, 0, 'ob-pointer').setDepth(HAND_DEPTH).setVisible(false);
    this.hand.setOrigin(HAND_ORIGIN_X, HAND_ORIGIN_Y);
    this.hand.setScale(HAND_DISPLAY_W / this.hand.width);
    try {
      this.hand.preFX?.addGlow(0xffb347, 3, 0, false, 0.15, 8);
      this.hand.preFX?.addShadow(0, 6, 0.08, 0.45, 0x000000, 6);
    } catch { /* FX needs WebGL; the painted hand is enough without it */ }
    const c = this.card = ui.add.container(0, 0).setDepth(CARD_DEPTH).setVisible(false);
    this.cardH = 172;
    const bx = 168;
    this.bg = ui.add.graphics();
    // The painted bubble starts at x=150. A full-width invisible hit used to swallow taps on the
    // left queue column and the right Missions button whenever the card shared their height.
    const bubbleW = W - 166;
    this.block = ui.add.rectangle(150 + bubbleW / 2, this.cardH / 2, bubbleW, this.cardH, 0, 0.001).setInteractive();
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
    const S = STEPS[this.step];
    if (S?.cont) { this.t.ok = true; this.lastCheck = 999; return; }
    // No tappable target for a while: advance rather than leave the player stuck on the coach.
    if (this.fallback) this.advance();
  }

  hide() { this.card.setVisible(false); this.pointer.setVisible(false); this.hand.setVisible(false); this.spot.setVisible(false); }

  blocks(x, y) {
    if (this.story || this.celebrating) return true;
    if (!this.card.visible) return false;
    const y0 = this.rect.y, y1 = y0 + this.rect.h;
    const bubble = x >= 140 && x <= W - 8 && y >= y0 && y <= y1;
    const face = x >= 8 && x <= 185 && y >= y0 - 8 && y <= y1 + 16; // Lyra's bust hangs left of the bubble
    return bubble || face;
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
    this.syncContinue(S);
    this.skip.setVisible(true);
  }

  // Continue is the step's own button, or "Skip step" once a target has been missing long enough.
  syncContinue(S) {
    const own = S?.cont;
    const show = !!own || !!this.fallback;
    this.cont.setVisible(show);
    if (!show) return;
    this.cont.setLabel(own || 'Skip step');
    this.cont.chip = own ? 'tutorial-continue' : 'tutorial-skip-step';
  }

  covers(rect, tg) {
    if (!tg || !rect) return false;
    const hit = (r) => {
      const rr = (tg.r ?? 36) + 8;
      const cx = Math.max(r.x, Math.min(tg.x, r.x + r.w));
      const cy = Math.max(r.y, Math.min(tg.y, r.y + r.h));
      return (tg.x - cx) ** 2 + (tg.y - cy) ** 2 < rr * rr;
    };
    // bubble plus Lyra's bust, which hangs off the left of the bubble
    return hit(rect) || hit({ x: 8, y: rect.y - 8, w: 178, h: rect.h + 24 });
  }

  // Sit the card on the opposite side of the target from where it is, and on the other side
  // when that would still cover the tap point (or the open panel / world squad bar).
  placeCard(target) {
    const ui = this.ui, H = GAME_HEIGHT;
    const topY = TOP_H + 28;
    let botY = H - NAV_H - HERO_RISE - this.cardH - 12;
    if (ui.worldMode && ui.worldHud?.barRect) botY = Math.min(botY, ui.worldHud.barRect.y - this.cardH - 12);
    if (ui.panel?.visible && ui.panel.active && target && !ui.panelRect.contains(target.x, target.y)) {
      const above = ui.panelRect.y - this.cardH - 12;
      if (above > topY) botY = Math.min(botY, above);
    }
    const slot = (y) => ({ x: 140, y, w: W - 148, h: this.cardH });
    const preferBottom = !target || target.y < H * 0.48;
    const ordered = preferBottom ? [botY, topY] : [topY, botY];
    const y = ordered.find((yy) => !this.covers(slot(yy), target)) ?? ordered[0];
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

  drawTarget(tg, opts = {}) {
    const ui = this.ui, g = this.pointer, sp = this.spot;
    g.clear(); sp.clear();
    this.spot.setDepth(SPOT_DEPTH);
    this.pointer.setDepth(POINTER_DEPTH);
    this.hand.setDepth(HAND_DEPTH);
    this.card.setDepth(CARD_DEPTH);
    if (!tg) { g.setVisible(false); this.hand.setVisible(false); sp.setVisible(false); return; }
    const k = (Math.sin(ui.time.now / 180) + 1) / 2;
    // soft spotlight: dim everything around a box on the target (taps still go through).
    // Skip it on already-dimmed pop-ups so the panel is not double-dimmed.
    const H = GAME_HEIGHT, R = tg.r + 14;
    if (opts.noSpot) {
      sp.setVisible(false);
    } else {
      const x0 = Math.max(0, tg.x - R), x1 = Math.min(W, tg.x + R), y0 = Math.max(0, tg.y - R), y1 = Math.min(H, tg.y + R);
      sp.fillStyle(0x020306, 0.42).fillRect(0, 0, W, y0).fillRect(0, y1, W, H - y1).fillRect(0, y0, x0, y1 - y0).fillRect(x1, y0, W - x1, y1 - y0);
      sp.setVisible(true);
    }
    g.lineStyle(4, PALETTE.gold, 0.9).strokeCircle(tg.x, tg.y, tg.r + k * 8);
    g.lineStyle(10, PALETTE.cyan, 0.16).strokeCircle(tg.x, tg.y, tg.r + 10 + k * 8);
    g.setVisible(true);
    // Index fingertip is the origin: the rest pose lands on the target, then the hand bobs away.
    // Flipped to point up when the target is near the top.
    const up = tg.y - tg.r - 150 < TOP_H - 40;
    const bob = k * 14;
    this.hand.setFlipY(up).setOrigin(HAND_ORIGIN_X, up ? 0 : HAND_ORIGIN_Y).setPosition(tg.x, up ? tg.y + bob : tg.y - bob).setVisible(true);
    ui.children.bringToTop(sp); ui.children.bringToTop(g); ui.children.bringToTop(this.hand);
    if (this.card.visible) ui.children.bringToTop(this.card);
    if (ui.testBanner) ui.children.bringToTop(ui.testBanner);
  }

  // Point at the active control on an open pop-up, with the coach card tucked away
  // so the hand sits on top of the sheet, modal, reveal, or celebration.
  pointAtPopup(tg) {
    if (!tg) return false;
    this.card.setVisible(false);
    this.drawTarget(tg, { noSpot: true });
    this.target = tg;
    this.reach = { ok: true, reason: 'popup' };
    this.missT = 0;
    this.noTargetAt = 0;
    return true;
  }

  update(dtMs) {
    const ui = this.ui;
    if (!this.active) {
      if (this.story) this.closeStory();
      if (this.celebrating && this.pointAtPopup(popupAction(ui, this))) { this.goal.setVisible(false); return; }
      // Once the onboarding is done, drop any pop-up pointer so it cannot linger
      // on a dismissed celebration or the Missions sheet that just opened.
      if (!this.tip) this.hide();
      this.updateAfter(dtMs);
      return;
    }
    this.goal.setVisible(false);
    if (this.tip) this.endTip(); // a replay starts clean
    if (this.step === 0) { this.hide(); if (!this.story) this.openStory(); return; }
    if (this.celebrating) {
      if (this.pointAtPopup(popupAction(ui, this))) return;
      this.hide();
      return;
    }
    if (this.entered !== this.step) {
      this.entered = this.step; this.t = {}; this.missT = 0; this.noTargetAt = 0; this.fallback = false;
      const base = ui.scene.get('Base'); if (base) base._tutAim = null;
      const ws = ui.scene.get('World'); if (ws) { ws._tutAim = 0; ws._tutAt = 0; }
      STEPS[this.step]?.enter?.(ui, this.t); this.refreshCard(true);
    }
    const S = STEPS[this.step];
    S?.tick?.(dtMs);
    this.lastCheck += dtMs;
    if (this.lastCheck > 150) {
      this.lastCheck = 0;
      if (S?.done(ui, this.t)) { this.advance(); return; }
      this.refreshCard(false);
    }
    const popup = popupAction(ui, this);
    if (popup) { this.pointAtPopup(popup); this.fallback = false; return; }
    const busy = ui.reveal || ui.replay || (ui.modal && !ui.modal.isSpeedUp && !ui.modal.isMissions);
    if (busy) { this.hide(); this.missT = 0; return; }
    let tg = (typeof window !== 'undefined' && window.__BD_TEST?.tutorialMiss) ? null : (S?.target(ui) ?? null);
    this.placeCard(tg);
    // A point under the card, the HUD, or another sheet is not a target. Counting it as missing
    // is what brings up Skip step, so a bad pointer can never hard-lock the tutorial.
    if (tg && !this.judge(tg, false).ok) tg = null;
    const base = ui.scene.get('Base'), ws = ui.scene.get('World');
    const seeking = !!base?.cameras?.main?.panEffect?.isRunning || (ws && ui.time.now - (ws._tutAt ?? 0) < 480);
    if (tg || S?.cont) { this.missT = 0; this.noTargetAt = 0; }
    else {
      this.noTargetAt = this.noTargetAt || ui.time.now;
      if (!seeking) this.missT = (this.missT ?? 0) + dtMs;
    }
    // A stuck camera pan must not hold the fallback off forever.
    const limit = S?.hold?.(ui) ? 45000 : 3200;
    const wall = !tg && !S?.cont && this.noTargetAt && ui.time.now - this.noTargetAt > (S?.hold?.(ui) ? 45000 : 4000);
    this.fallback = !S?.cont && !tg && ((this.missT > limit && !seeking) || wall);
    this.syncContinue(S);
    this.card.setVisible(true);
    this.drawTarget(tg);
    this.target = tg;
    this.reach = this.judge(tg, seeking);
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
    let tg = this.tip.target(ui) ?? null;
    if (tg?.obj) tg = present(ui, tg);
    this.placeCard(tg);
    if (tg && !this.judge(tg, false).ok) tg = null;
    this.drawTarget(tg);
    this.target = tg;
    this.reach = this.judge(tg, false);
  }

  // Is the pointer's tap point actually on screen and not under the coach, the HUD, or another sheet?
  judge(tg, seeking) {
    if (!tg) {
      if (this.tip || STEPS[this.step]?.cont) return { ok: true, reason: 'continue' };
      return { ok: !!this.fallback, reason: this.fallback ? 'fallback' : (seeking ? 'seeking' : 'no-target') };
    }
    const ui = this.ui, H = GAME_HEIGHT;
    if (tg.x < 10 || tg.y < 10 || tg.x > W - 10 || tg.y > H - 10) return { ok: false, reason: 'offscreen' };
    if (this.covers(this.rect, tg)) return { ok: false, reason: 'under-card' };
    if (tg.y < TOP_H - 2) return { ok: false, reason: 'under-hud' };
    if (tg.y > H - 8) return { ok: false, reason: 'under-nav' };
    const onButton = !!findButton(ui, (o) => Math.hypot(o.hit.getBounds().centerX - tg.x, o.hit.getBounds().centerY - tg.y) < 28);
    if (ui.panel?.visible && ui.panel.active && ui.panelRect.contains(tg.x, tg.y) && !onButton) return { ok: false, reason: 'under-panel' };
    if (ui.worldHud?.visible && ui.worldHud.blocks?.(tg.x, tg.y) && !onButton) return { ok: false, reason: 'under-world-hud' };
    if (!onButton && ui.sideBlocks?.(tg.x, tg.y)) return { ok: false, reason: 'under-side-button' };
    const ban = ui.testBannerRect;
    if (ban && tg.x >= ban.x && tg.x <= ban.x + ban.width && tg.y >= ban.y && tg.y <= ban.y + ban.height) return { ok: false, reason: 'under-test-banner' };
    return { ok: true, reason: 'clear' };
  }

  startTip(T) {
    this.tip = T;
    store.state.hints[`tip_${T.id}`] = true; store.save();
    this.setFace('smile');
    this.title.setText('A tip from Lyra');
    this.body.setText(T.text);
    this.cont.chip = 'tutorial-continue';
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
    const cap = text(ui, W / 2, H - 250, '', 30, '#f3e6c8', { fontStyle: 'bold', align: 'center', wordWrap: { width: W - 100 }, lineSpacing: 8, stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0.5);
    const dots = ui.add.graphics();
    // Test-mode banner occupies the top of the HUD; keep Skip intro below its hit area.
    const skip = button(ui, W - 100, (store.tutorialTest ? 118 : 70) + SAFE.top, 150, 52, 'Skip intro', () => this.finishStory(), { style: 'ghost', size: 19 });
    skip.chip = 'story-skip';
    // The page stays until Continue. A tap on the picture does not skip it, and a
    // compatibility mouse click after a touch cannot turn one press into two pages.
    const allow = syntheticClickFilter(null);
    const cont = button(ui, W / 2, H - 118, 300, 70, 'Continue', () => c.advance(), { style: 'gold', size: 24, allow });
    cont.chip = 'story-continue';
    c.add([bg, img, shade, cap, dots, cont, skip]);
    if (ui.testBanner) ui.children.bringToTop(ui.testBanner);
    const show = (i) => {
      c.page = i;
      img.setTexture(`ob-story-${i + 1}`);
      img.setScale(Math.max(W / img.width, H / img.height));
      img.setAlpha(0); ui.tweens.add({ targets: img, alpha: 1, duration: 450 });
      ui.tweens.add({ targets: img, scale: img.scale * 1.05, duration: 9000 });
      cap.setText(STORY[i]); cap.setAlpha(0); ui.tweens.add({ targets: cap, alpha: 1, duration: 600, delay: 200 });
      cont.setLabel(i === STORY.length - 1 ? 'Begin' : 'Continue');
      dots.clear();
      for (let k = 0; k < STORY.length; k++) dots.fillStyle(k === i ? PALETTE.gold : 0x4a5260, 1).fillCircle(W / 2 + (k - 1) * 28, H - 52, k === i ? 8 : 6);
      audio.play('tap');
    };
    c.advance = () => { if (c.page + 1 >= STORY.length) this.finishStory(); else show(c.page + 1); };
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
  // Painted banner (or the open chest) with a title and a line under it. It stays until Continue
  // (or the action button). The backdrop does not dismiss it.
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
    // Stays until an explicit button. The backdrop is not a dismiss control, and nothing
    // auto-closes: a new player has to be able to read the line. `quick` only lightens the dim.
    const close = () => { if (this.celebrating !== c) return; this.closeCelebrate(); };
    const allow = syntheticClickFilter(null);
    if (btn) {
      const b = button(ui, W / 2, Math.min(H - 90, chest ? cy + 360 : cy + 230), 340, 76, btn, () => { onBtn?.(); close(); }, { style: 'gold', size: 26, allow });
      b.chip = 'celebrate-btn'; c.add(b);
    } else {
      const b = button(ui, W / 2, Math.min(H - 90, chest ? cy + 380 : cy + 250), 300, 72, 'Continue', () => close(), { style: 'gold', size: 26, allow });
      b.chip = 'celebrate-continue'; c.add(b);
    }
    c.sticky = true;
    c.onBtn = btn ? () => { onBtn?.(); close(); } : null;
    c.close = () => close();
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
    const tg = this.target && (this.card.visible || this.tip || this.hand.visible) ? { x: Math.round(this.target.x), y: Math.round(this.target.y), r: Math.round(this.target.r ?? 0) } : null;
    return {
      active: this.active, step: this.step, id: STEPS[this.step]?.id ?? 'done', visible: this.card.visible, title: this.title.text, body: this.body.text,
      target: tg, cardY: this.rect.y,
      card: this.card.visible ? { x: this.rect.x, y: Math.round(this.rect.y), w: this.rect.w, h: this.rect.h } : null,
      reach: this.reach ?? null, fallback: !!this.fallback, missMs: Math.round(this.missT || 0),
      testMode: !!store.tutorialTest,
      story: this.story ? this.story.page : null, celebrating: this.celebrating ? true : false, hold: !!this.celebrating?.sticky, tip: this.tip?.id ?? null,
      goal: this.goal.visible ? this.goalText.text : null,
      locked: Object.keys(TUTORIAL.unlockAt).filter((id) => !this.unlocked(id)),
    };
  }
}
