import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H, PALETTE, BEACON, BUILDINGS, ECONOMY, BARRACKS, TROOP_CLASSES, TROOP_IDS, SQUADS, TROOPS } from '../config.js';
import { fmtClock } from '../ui/widgets.js';
import { store } from '../state/store.js';
import { buildingPower } from '../systems/power.js';
import { text, fmt, fmtDuration, panelBg, button } from '../ui/widgets.js';
import { SKIN, drawBar, drawCard, drawFrame, drawBadge, glyph, diamond, oct, lerpC } from '../ui/skin.js';
import { statLine, priceTag, sectionHeader, tile } from '../ui/kit.js';
import { renderTroops } from '../ui/screens/troops.js';
import { renderSquads } from '../ui/screens/squads.js';
import { renderArmory, resultTag, drawCoreIcon } from '../ui/screens/armory.js';
import { gearTexture, leaderBig } from '../art/portraits.js';
import { RARITY, LEADERS, GEAR, CORES, INFIRMARY, STAMINA, CREATURES, SQUADS as SQ } from '../config.js';
import { renderInfirmary } from '../ui/screens/infirmary.js';
import { renderArchive } from '../ui/screens/archive.js';
import { RESEARCH } from '../config.js';
import { createWorldHud, openReport } from '../ui/world.js';
import { createRightColumn, refreshRightColumn, openMissions, openEvents, openExchange } from '../ui/stage8.js';
import { audio } from '../audio/audio.js';
import { Tutorial } from '../tutorial/tutorial.js';
import { PERF, AUDIO, TUTORIAL } from '../config.js';

import { SAFE, TOP_H, NAV_H, NAV_BODY, HERO_R, HERO_RISE } from '../ui/layout.js';
const HERO_TAB = 'base'; // the big centre emblem
export { TOP_H };
const SCREENS = { troops: renderTroops, squads: renderSquads, armory: renderArmory, infirmary: renderInfirmary, archive: renderArchive };

export default class UIScene extends Phaser.Scene {
  constructor() { super('UI'); }

  create() {
    this.panelOpenFor = null;
    this.modal = null;
    this.screen = null;        // { id, container, dyn: [fn] }
    this.screenState = { armoryTab: 'recruit', squadId: 'alpha', edit: null };
    this.reveal = null;
    this.navNew = { troops: 0 };
    this.createTopBar();
    this.createNav();
    this.createPanel();
    this.createBanner();
    this.createSideColumns();
    this.createPlaceChip();
    this.worldMode = false;
    this.replay = null;
    this.worldHud = createWorldHud(this, TOP_H, H);
    this.createToast();
    this.fx = { floats: 0, bursts: 0, hits: 0, shakes: 0 };
    audio.init();
    audio.setTrack('base');
    this.tutorial = new Tutorial(this);
    // idle frame cap (phones): drop to ~30 fps after a while without input
    this.lastInput = performance.now();
    const poke = () => { this.lastInput = performance.now(); };
    this.input.on('pointerdown', poke); this.input.on('pointermove', (p) => { if (p.isDown) poke(); }); this.input.on('wheel', poke);
    window.addEventListener('keydown', poke);
    this.idleCapped = false;

    const ev = this.game.events;
    ev.on('base:select', (id) => this.openPanel(id), this);
    ev.on('base:deselect', () => this.closePanel(false), this);
    ev.on('base:moveMode', (id, o) => this.showBanner(id, o), this);
    ev.on('base:placeTarget', (valid) => this.bannerPlace?.setEnabled(valid), this);
    ev.on('toast', (msg) => this.toast(msg), this);
    ev.on('world:select', (id) => this.worldHud.openSheet(id), this);
    ev.on('world:deselect', () => this.worldHud.closeSheet(), this);
    this.unsubs = [
      store.on('upgrade', (id) => {
        this.bump(this.powerText); this.refreshPanel();
        audio.play('levelup'); audio.haptic([20, 40, 30]);
        const lv = store.levelOf(id);
        this.toast(id === BEACON.id ? `${BEACON.name} reached Lv ${lv}. +${CORES.beaconLevel} Beacon Cores ready: tap the Cores counter to claim.` : `${BUILDINGS[id].name} reached Lv ${lv}`, 2600);
      }),
      store.on('upgradeStart', () => { this.refreshPanel(); audio.play('build'); }),
      store.on('upgradeCancel', () => this.refreshPanel()),
      store.on('reset', () => { this.closePanel(false); this.screenState.edit = null; if (this.screen) this.renderScreen(); }),
      store.on('change', () => { this.screenDirty = true; }),
      store.on('trained', (done, d) => {
        if (this.screen?.id !== 'troops') this.navNew.troops += Object.values(done).reduce((a, b) => a + b, 0);
        if (d.after > d.before) { this.bump(this.powerText); this.floatText(this.powerText.x + this.powerText.width + 40, SAFE.top + 60, `+${fmt(d.after - d.before)}`, PALETTE.textGold); }
        if (!store.simulating) audio.play('train', { gap: 400 });
      }),
      store.on('trainStart', () => audio.play('train', { gap: 150 })),
      store.on('pull', () => audio.play('open')),
      store.on('cores', (n) => { if (store.simulating) return; audio.play('reward'); audio.haptic(12); this.floatText(this.coreText.x + this.coreText.width + 30, SAFE.top + 70, `+${n}`, CORES.hex); }),
      store.on('settings', () => this.refreshSettings?.()),
      store.on('squad', (_id, d) => { if (d && d.after !== d.before) this.bump(this.powerText); }),
      store.on('hunt', (r) => this.onHunt(r)),
      store.on('marchHome', (m) => { if (!m.meta?.auto) this.toast(`${SQ[m.squadId].name} is back at base`, 1400); }),
      store.on('research', (id, lv, d) => {
        if (d && d.after !== d.before) this.bump(this.powerText);
        audio.play('research'); audio.haptic([15, 30, 15]);
        this.refreshPanel();
        const R = RESEARCH[id];
        this.toast(R.effect === 'tier' ? `Research done: ${R.name}. New troops in the Barracks!` : `Research done: ${R.name} Lv ${lv}`, 2600);
      }),
      store.on('researchStart', () => { this.refreshPanel(); audio.play('build'); }),
      store.on('healed', (h) => { const n = Object.values(h).reduce((a, b) => a + b, 0); if (this.screen?.id !== 'troops' && this.screen?.id !== 'infirmary') this.navNew.troops += n; if (n && !this.screen) this.bumpTroops = true; if (n && !store.simulating) audio.play('heal', { gap: 600 }); }),
      store.on('march', () => audio.play('march')),
      store.on('unlocked', (id) => this.onUnlocked(id)),
      store.on('placed', (id) => { audio.play('levelup'); this.toast(`${BUILDINGS[id].name} built. Tap it to open.`, 2000); }),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));
    createRightColumn(this); // stage 8: Missions (+ live event) on the right edge

    // autosave + save on hide
    this.time.addEvent({ delay: ECONOMY.autosaveMs, loop: true, callback: () => store.save() });
    const saveNow = () => store.save();
    document.addEventListener('visibilitychange', saveNow);
    window.addEventListener('pagehide', saveNow);

    const off = store.offlineReport;
    if (off && off.energy >= 1) {
      const trained = Object.entries(off.trained ?? {}).map(([t, n]) => `${n} ${TROOP_CLASSES[t].plural}`).join(', ');
      const built = [...(off.built ?? []).map((b) => `${store.nameOf(b.id)} Lv ${b.level}`), ...(off.researched ?? []).map((r) => `${RESEARCH[r.id].name} ${RESEARCH[r.id].maxLevel === 1 ? '' : `Lv ${r.level}`}`.trim())].join(', ');
      const hu = off.hunts;
      const hunts = hu?.fights ? `\nHunts while away: ${hu.wins}/${hu.fights} won${hu.cores ? `, +${hu.cores} Cores` : ''}, ${hu.wounded} wounded, ${hu.dead} fallen` : '';
      this.time.delayedCall(400, () => this.toast(`Welcome back, Commander. Away ${fmtDuration(off.seconds)}${off.capped ? ' (capped)' : ''}: +${fmt(off.energy)} Energy, +${fmt(off.shards)} Shards, +${fmt(off.alloy)} Alloy${trained ? `\nTrained while away: ${trained}` : ''}${built ? `\nUpgrades finished: ${built}` : ''}${hunts}`, hunts ? 6000 : 4600));
    } else if (store.migratedFrom && store.migratedFrom < 4) {
      this.time.delayedCall(400, () => this.toast(`Recruitment now uses Beacon Cores. Here are ${CORES.migrationGrant} to start. Your Shards stay for upgrades.`, 4600));
    }
    // stage 5: one-time hint for existing players (their tutorial was marked done in the v8 migration)
    if (store.migratedFrom && store.migratedFrom < 8) {
      this.time.delayedCall(off && off.energy >= 1 ? 5200 : 500, () => this.toast('New: sound, music and a tutorial. Replay the tutorial any time from More → Settings.', 4200));
    }
    this.panelTimer = 0;
  }

  openMissions() { return openMissions(this); }
  openEvents() { return openEvents(this); }
  openExchange() { return openExchange(this); }

  // Lets BaseScene know a screen point belongs to the UI.
  blocksPointer(x, y) {
    if (this.modal || this.screen || this.reveal || this.replay) return true;
    if (y < TOP_H || y > H - NAV_H) return true;
    if (this.hero && (x - this.hero.x) ** 2 + (y - this.hero.y) ** 2 <= (HERO_R + 10) ** 2) return true;
    if (this.tip && this.tipBox.visible && x >= this.tipBox.x && x <= this.tipBox.x + 420 && y >= this.tipBox.y - 12 && y <= this.tipBox.y + 200) return true;
    if (this.worldHud?.blocks(x, y)) return true;
    if (this.tutorial?.blocks(x, y)) return true;
    if (this.panel.visible && Phaser.Geom.Rectangle.Contains(this.panelRect, x, y)) return true;
    if (this.banner.visible && Phaser.Geom.Rectangle.Contains(this.bannerRect, x, y)) return true;
    if (this.placeChip?.visible && Phaser.Geom.Rectangle.Contains(this.placeChipRect, x, y)) return true;
    if (this.sideBlocks(x, y)) return true;
    return false;
  }

  // ------------------------------------------------------------ HUD -----
  // Bake static HUD chrome (gradients, bevels, filigree) into a texture once: a Graphics object would
  // be re-tessellated every frame.
  // (RenderTexture, not generateTexture: that goes through the Canvas renderer, which drops gradients.)
  bake(key, w, h, draw) {
    if (this.textures.exists(key)) this.textures.remove(key);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    const rt = this.make.renderTexture({ x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) }, false);
    rt.draw(g);
    rt.saveTexture(key);
    g.destroy();
    return key;
  }

  // Gold beveled frame with cut corners (Power plaque, Cores pill).
  goldFrame(g, x, y, w, h, cut = 18) {
    const pts = (i) => [{ x: x + cut + i, y: y + i }, { x: x + w - cut - i, y: y + i }, { x: x + w - i, y: y + h / 2 }, { x: x + w - cut - i, y: y + h - i }, { x: x + cut + i, y: y + h - i }, { x: x + i, y: y + h / 2 }];
    g.fillStyle(0x000000, 0.5).fillPoints(pts(-3).map((p) => ({ x: p.x + 3, y: p.y + 5 })), true);
    g.fillStyle(0x6b4a16, 1).fillPoints(pts(-3), true);                 // dark gold rim
    g.fillStyle(PALETTE.gold, 1).fillPoints(pts(0), true);              // bright gold bevel
    g.fillStyle(0xffe2a6, 1).fillPoints(pts(1).slice(0, 3), true);
    g.fillStyle(0x3a2608, 1).fillPoints(pts(4), true);                  // inner groove
    g.fillGradientStyle(0x1f2630, 0x1f2630, 0x0b0e13, 0x0b0e13, 1, 1, 1, 1).fillPoints(pts(6), true);
    g.lineStyle(1.5, 0xffffff, 0.10).strokePoints(pts(8), true);
  }

  createTopBar() {
    const T = SAFE.top;
    this.bake('hud-top-bg', W, TOP_H + 14, (g) => {
      g.fillGradientStyle(0x10141b, 0x10141b, 0x07090d, 0x07090d, 0.97, 0.97, 0.9, 0.9).fillRect(0, 0, W, TOP_H);
      // gold filigree edge: double rule, studs, small scrolls
      g.lineStyle(4, 0x3a2608, 1).lineBetween(0, TOP_H - 1, W, TOP_H - 1);
      g.lineStyle(2, PALETTE.gold, 0.95).lineBetween(0, TOP_H - 2, W, TOP_H - 2);
      g.lineStyle(1, 0xffe2a6, 0.5).lineBetween(0, TOP_H - 4, W, TOP_H - 4);
      for (const x of [150, W / 2, W - 150]) {
        g.fillStyle(PALETTE.gold, 1).fillPoints([{ x, y: TOP_H - 9 }, { x: x + 9, y: TOP_H - 2 }, { x, y: TOP_H + 5 }, { x: x - 9, y: TOP_H - 2 }], true);
        g.lineStyle(2, PALETTE.gold, 0.8);
        g.beginPath().arc(x - 22, TOP_H + 2, 9, Math.PI * 1.1, Math.PI * 1.9).strokePath();
        g.beginPath().arc(x + 22, TOP_H + 2, 9, Math.PI * 1.1, Math.PI * 1.9).strokePath();
      }
      g.fillStyle(0x000000, 0.35).fillRect(0, TOP_H + 2, W, 6);
      // Power plaque + Cores pill frames
      this.goldFrame(g, 152, T + 14, 312, 96, 20);
      this.goldFrame(g, 478, T + 22, 232, 80, 18);
      // Beacon gauge pill (under the portrait)
      g.fillStyle(0x05070a, 0.92).fillRoundedRect(8, T + 138, 136, 34, 12);
      g.lineStyle(1.5, PALETTE.gold, 0.55).strokeRoundedRect(8, T + 138, 136, 34, 12);
      // glass capsules
      for (const [x, w] of this.capsuleSlots()) {
        const y = T + 124, h = 44;
        g.fillStyle(0x020305, 0.9).fillRoundedRect(x, y, w, h, 20);
        g.fillStyle(0x000000, 0.55).fillRoundedRect(x + 2, y + 2, w - 4, 10, { tl: 18, tr: 18, bl: 0, br: 0 }); // inner shadow
        g.fillStyle(0xffffff, 0.05).fillRoundedRect(x + 4, y + h - 14, w - 8, 10, { tl: 0, tr: 0, bl: 16, br: 16 });
        g.lineStyle(1.5, 0x56606f, 0.75).strokeRoundedRect(x, y, w, h, 20);
        g.lineStyle(1, 0xffffff, 0.10).lineBetween(x + 18, y + h - 1, x + w - 18, y + h - 1);
      }
      // portrait backing + ring
      g.fillStyle(0x000000, 0.5).fillCircle(77, T + 74, 64);
      g.fillStyle(0x6b4a16, 1).fillCircle(74, T + 70, 64);
      g.fillStyle(PALETTE.gold, 1).fillCircle(74, T + 70, 61);
      g.fillStyle(0x3a2608, 1).fillCircle(74, T + 70, 57);
      g.fillStyle(0x05070a, 1).fillCircle(74, T + 70, 55);
    });
    this.add.image(0, 0, 'hud-top-bg').setOrigin(0, 0);
    this.add.rectangle(W / 2, TOP_H / 2, W, TOP_H, 0, 0.001).setInteractive(); // swallow taps

    // Commander portrait (tap -> Base Power / profile) with the commander (Beacon) level badge
    const ax = 74, ay = T + 70, ar = 54;
    this.avatar = this.add.image(ax, ay, 'art-avatar').setDisplaySize(ar * 2, ar * 2);
    const hf = this.hudFront = this.add.graphics();
    hf.lineStyle(2, 0xffe2a6, 0.7).strokeCircle(ax, ay, ar + 1);
    hf.fillStyle(0x3a2608, 1).fillCircle(ax + 42, ay + 44, 21).fillStyle(PALETTE.gold, 1).fillCircle(ax + 42, ay + 44, 18);
    hf.lineStyle(2, 0xffe2a6, 0.9).strokeCircle(ax + 42, ay + 44, 18);
    this.avatarLv = text(this, ax + 42, ay + 44, '1', 19, '#140d04', { fontStyle: 'bold' }).setOrigin(0.5);
    const avHit = this.add.circle(ax, ay, ar + 8, 0, 0.001).setInteractive({ useHandCursor: true });
    avHit.on('pointerup', () => this.openPowerBreakdown());
    this.avHit = avHit;

    // Beacon level + charge gauge (tap -> glide to the Beacon)
    this.beaconLv = text(this, 18, T + 142, 'BEACON Lv 1', 13, PALETTE.textGold, { fontStyle: 'bold' });
    this.chargeText = text(this, 136, T + 142, '0%', 13, PALETTE.textDim, { fontStyle: 'bold' }).setOrigin(1, 0);
    this.chargeBar = this.add.graphics();
    const beaconHit = this.add.rectangle(76, T + 155, 140, 40, 0, 0.001).setInteractive({ useHandCursor: true });
    beaconHit.on('pointerup', () => { this.closeModal(); this.closeScreen(); this.hideWorld(); this.game.events.emit('ui:focus', BEACON.id); this.game.events.emit('ui:focusBeacon'); });
    this.beaconHit = beaconHit;

    // Power plaque (tap -> breakdown)
    this.add.image(204, T + 62, 'hud-power').setDisplaySize(54, 62);
    text(this, 240, T + 20, 'POWER', 14, '#d9b26a', { fontStyle: 'bold', letterSpacing: 3 });
    this.powerText = text(this, 240, T + 38, '0', 35, PALETTE.textGold, { fontStyle: 'bold', stroke: '#2a1a06', strokeThickness: 3 });
    this.powerSub = text(this, 240, T + 85, 'Bldg 0 · Troops 0', 14, PALETTE.textDim);
    const powerHit = this.add.rectangle(308, T + 62, 312, 96, 0, 0.001).setInteractive({ useHandCursor: true });
    powerHit.on('pointerup', () => this.openPowerBreakdown());
    this.powerHit = powerHit;

    // Beacon Cores pill with "+" (tap either -> Beacon Core Rewards)
    this.add.image(516, T + 62, 'hud-core').setDisplaySize(46, 54);
    text(this, 548, T + 34, 'Beacon Cores', 16, '#e7c8ff', { fontStyle: 'bold' });
    this.coreText = text(this, 548, T + 54, '0', 28, CORES.hex, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 3 });
    const coreHit = this.add.rectangle(594, T + 62, 232, 80, 0, 0.001).setInteractive({ useHandCursor: true });
    coreHit.on('pointerup', () => this.openRewards());
    this.coreHit = coreHit;
    this.corePlus = this.roundButton(676, T + 62, 21, '', 'cores-plus', (g) => {
      g.fillStyle(0xffe2a6, 1).fillRect(-10, -3, 20, 6).fillRect(-3, -10, 6, 20);
    }, () => this.openRewards(), PALETTE.gold);
    this.corePlus.labelText.setText('+').setVisible(false);
    this.coreBadge = this.add.graphics().setDepth(7);
    this.coreBadgeText = text(this, 0, 0, '', 14, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);

    // Resource capsules: Energy (+rate), Alloy, Shards, Troops (+ training). Tap -> source tooltip.
    const [en, al, sh, tr] = this.capsuleSlots();
    const cy = T + 146;
    this.add.image(en[0] + 24, cy, 'hud-energy').setDisplaySize(19, 32);
    this.energyText = text(this, en[0] + 42, cy, '0', 21, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.rateText = text(this, en[0] + en[1] - 14, cy, '+1.0/s', 13, PALETTE.textCyan, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    this.add.image(al[0] + 26, cy, 'hud-alloy').setDisplaySize(36, 25);
    this.alloyText = text(this, al[0] + 48, cy, '0', 21, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.image(sh[0] + 24, cy, 'hud-shards').setDisplaySize(22, 32);
    this.shardText = text(this, sh[0] + 42, cy, '0', 21, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.image(tr[0] + 24, cy, 'nav-troops').setDisplaySize(29, 34);
    this.troopText = text(this, tr[0] + 44, cy, '0', 20, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.capsules = {};
    [['energy', en], ['alloy', al], ['shards', sh], ['troops', tr]].forEach(([id, [x, w]]) => {
      const hit = this.add.rectangle(x + w / 2, cy, w, 48, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.showTip(id));
      hit.capsule = id;
      this.capsules[id] = { x, w, hit };
    });
    this.createTip();
  }
  capsuleSlots() {
    // x, width (from x 152 to 712, 6 px gaps)
    return [[152, 176], [334, 122], [462, 122], [590, 122]];
  }

  // Resource tooltip: what it is and where it comes from. Closes on the next tap or after a few seconds.
  createTip() {
    const c = this.tipBox = this.add.container(0, 0).setDepth(430).setVisible(false);
    this.tipBg = this.add.graphics();
    this.tipText = text(this, 0, 0, '', 18, PALETTE.text, { wordWrap: { width: 380 }, lineSpacing: 4 });
    this.tipTitle = text(this, 0, 0, '', 20, PALETTE.textGold, { fontStyle: 'bold' });
    c.add([this.tipBg, this.tipTitle, this.tipText]);
    this.tip = null;
    this.input.on('pointerdown', (p, over) => {
      if (!this.tip) return;
      if (over?.some((o) => o.capsule)) return; // the capsule handler toggles / switches
      this.hideTip();
    });
  }
  tipContent(id) {
    const s = store.state, r = s.resources;
    const q = store.queuedUnits(), tot = TROOP_IDS.reduce((n, t) => n + s.troops[t], 0), wounded = store.woundedTotal();
    switch (id) {
      case 'energy': return [`Energy  ${fmt(r.energy)}`, `+${store.energyRate.toFixed(2)}/s from the Beacon (Lv ${s.beacon.level}), also while you're away. Spent on upgrades, training and healing. Upgrade the Beacon to earn more.`];
      case 'alloy': return [`Alloy  ${fmt(r.alloy)}`, `+${fmt(store.alloyRate * 3600)}/h from the Command Center (Lv ${s.buildings.commandCenter.level}). Used to train higher-tier troops and for research.`];
      case 'shards': return [`Shards  ${fmt(r.shards)}`, `+${fmt(store.shardRate * 3600)}/h from the Armory (Lv ${s.buildings.armory.level}). Upgrade gear and star up leaders. Duplicate recruits turn into Shards.`];
      default: return [`Troops  ${fmt(tot)}`, `${fmt(tot)} ready${q ? ` · ${fmt(q)} training` : ''}${wounded ? ` · ${fmt(wounded)} wounded` : ''}. Train them in the Barracks (Troops tab), then put them in Squads. Troop Power +${fmt(store.power.troop)}.`];
    }
  }
  showTip(id) {
    if (this.tip?.kind === id) { this.hideTip(); return; }
    const cap = this.capsules[id];
    const [title, body] = this.tipContent(id);
    const w = 420, pad = 18;
    this.tipTitle.setText(title).setPosition(pad, pad);
    this.tipText.setText(body).setPosition(pad, pad + 32);
    const h = pad * 2 + 32 + this.tipText.height;
    const ax = cap.x + cap.w / 2;
    const x = Phaser.Math.Clamp(ax - w / 2, 10, W - w - 10), y = SAFE.top + 180;
    const g = this.tipBg; g.clear();
    g.fillStyle(0x000000, 0.4).fillRoundedRect(4, 6, w, h, 14);
    g.fillStyle(SKIN.goldDk, 1).fillRoundedRect(-2, -2, w + 4, h + 4, 15);
    g.fillGradientStyle(0x1b222c, 0x1b222c, 0x07090d, 0x07090d, 0.98, 0.98, 0.98, 0.98).fillRoundedRect(0, 0, w, h, 14);
    g.lineStyle(2, PALETTE.gold, 0.95).strokeRoundedRect(0, 0, w, h, 14);
    g.lineStyle(1, SKIN.goldHi, 0.2).strokeRoundedRect(5, 5, w - 10, h - 10, 10);
    g.fillStyle(0x0b0e13, 1).fillTriangle(ax - x - 12, 1, ax - x + 12, 1, ax - x, -12);
    g.lineStyle(2, PALETTE.gold, 0.85).lineBetween(ax - x - 12, 0, ax - x, -12).lineBetween(ax - x, -12, ax - x + 12, 0);
    this.tipBox.setPosition(x, y).setVisible(true).setAlpha(0);
    this.children.bringToTop(this.tipBox);
    this.tweens.killTweensOf(this.tipBox);
    this.tweens.add({ targets: this.tipBox, alpha: 1, duration: 120 });
    this.tip = { kind: id, title, text: body, until: this.time.now + 4200 };
    audio.play('tap');
  }
  hideTip() {
    if (!this.tip) return;
    this.tip = null;
    this.tweens.killTweensOf(this.tipBox);
    this.tweens.add({ targets: this.tipBox, alpha: 0, duration: 140, onComplete: () => { if (!this.tip) this.tipBox.setVisible(false); } });
  }

  // Round HUD button (queue / quick buttons). Exposes the same shape as widgets.button for tests,
  // the tutorial pointer and __BD.controls().
  roundButton(x, y, r, caption, chip, draw, onClick, ring = PALETTE.gold) {
    const c = this.add.container(x, y).setDepth(6);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.45).fillCircle(3, 5, r + 2);
    g.fillStyle(0x0b0e13, 0.94).fillCircle(0, 0, r);
    g.lineStyle(3, ring, 0.95).strokeCircle(0, 0, r);
    g.lineStyle(1.5, 0xffffff, 0.12).strokeCircle(0, 0, r - 6);
    // draw: a function (procedural icon) or a texture key (illustrated icon)
    let icon;
    if (typeof draw === 'string') { icon = this.add.image(0, -2, draw); icon.setScale((r * 1.5) / Math.max(icon.width, icon.height)); }
    else { icon = this.add.graphics(); draw(icon, ring); }
    const arc = this.add.graphics();
    const cap = text(this, 0, r + 1, caption, 14, PALETTE.text, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5, 0);
    const timer = text(this, 0, r + 32, '', 14, '#ffffff', { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5);
    const badge = this.add.graphics();
    const hit = this.add.circle(0, 0, r + 4, 0, 0.001).setInteractive({ useHandCursor: true });
    c.add([g, arc, icon, timer, cap, badge, hit]);
    let pressed = false;
    hit.on('pointerdown', () => { pressed = true; this.tweens.add({ targets: c, scale: 0.92, duration: 70 }); audio.play('tap'); audio.haptic(8); });
    hit.on('pointerout', () => { pressed = false; this.tweens.add({ targets: c, scale: 1, duration: 120 }); });
    hit.on('pointerup', () => { this.tweens.add({ targets: c, scale: 1, duration: 200, ease: 'Back.easeOut' }); if (pressed) this.time.delayedCall(0, onClick); pressed = false; });
    Object.assign(c, { isButton: true, hit, labelText: cap, chip, isEnabled: () => true, r, arc, timer, badge, ring });
    return c;
  }

  // Left: queue buttons (builder, research, training, healing). (The old right-hand quick buttons moved
  // into the HUD redesign: Hunt -> World emblem, Rewards -> Cores +, Armory -> tab, Events -> More.)
  createSideColumns() {
    const r = 36, xl = 52, y0 = TOP_H + 104, dy = 114;
    const ic = {
      builder: (g, col) => { g.fillStyle(col, 1).fillRect(-14, -16, 22, 10).fillRect(-4, -8, 6, 26); g.fillRect(8, -14, 6, 6); },
      research: 'more-research',
      training: (g, col) => { g.lineStyle(3, col, 1).strokeCircle(0, -10, 7); g.strokePoints([{ x: -13, y: 14 }, { x: -9, y: 2 }, { x: 9, y: 2 }, { x: 13, y: 14 }], false); },
      healing: (g, col) => { g.fillStyle(col, 1).fillRect(-5, -16, 10, 28).fillRect(-14, -7, 28, 10); },
      hunt: (g, col) => { g.lineStyle(3, col, 1).strokeCircle(0, -2, 16); g.lineBetween(-22, -2, -10, -2); g.lineBetween(10, -2, 22, -2); g.lineBetween(0, -24, 0, -12); g.lineBetween(0, 8, 0, 20); g.fillStyle(col, 1).fillCircle(0, -2, 4); },
      rewards: (g) => { drawCoreIcon(g, 0, -2, 16); },
      armory: (g, col) => { g.lineStyle(3, col, 1).strokePoints([{ x: 0, y: -22 }, { x: 14, y: -4 }, { x: 0, y: 16 }, { x: -14, y: -4 }], true); g.fillStyle(col, 0.5).fillPoints([{ x: 0, y: -14 }, { x: 7, y: -4 }, { x: 0, y: 7 }, { x: -7, y: -4 }], true); },
      events: (g, col) => { g.lineStyle(3, col, 1).strokeRect(-14, -14, 28, 26); g.lineBetween(-14, -5, 14, -5); g.fillStyle(col, 1).fillRect(-8, -20, 4, 9).fillRect(4, -20, 4, 9); },
    };
    this.queueBtns = {
      builder: this.roundButton(xl, y0, r, 'Builder', 'q-builder', ic.builder, () => this.onQueue('builder'), PALETTE.gold),
      research: this.roundButton(xl, y0 + dy, r, 'Research', 'q-research', ic.research, () => this.onQueue('research'), 0xb58cff),
      training: this.roundButton(xl, y0 + dy * 2, r, 'Training', 'q-training', ic.training, () => this.onQueue('training'), PALETTE.blue),
      healing: this.roundButton(xl, y0 + dy * 3, r, 'Healing', 'q-healing', ic.healing, () => this.onQueue('healing'), 0x4dff9a),
    };
    this.sideBtns = Object.values(this.queueBtns);
    this.queueTaps = {};
  }
  sideVisible() { return !this.worldMode; }
  sideBlocks(x, y) {
    if (!this.sideVisible()) return false;
    return this.sideBtns.some((b) => b.visible && (x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 8) ** 2);
  }

  // Queue buttons jump to the matching screen (or explain why there's nothing there yet).
  onQueue(kind) {
    this.queueTaps[kind] = (this.queueTaps[kind] ?? 0) + 1;
    this.closeReplay?.();
    if (kind === 'builder') {
      const j = store.state.construction[0];
      this.closeModal(); this.closeScreen(); this.hideWorld();
      if (!j) { this.toast('Builder idle: tap a building, then Upgrade.'); return; }
      this.game.events.emit('ui:focus', j.id);
      if (j.id === BEACON.id) this.game.events.emit('ui:focusBeacon');
      else this.game.events.emit('base:select', j.id), this.scene.get('Base').select(j.id);
      return;
    }
    if (kind === 'research') {
      if (!store.archiveUnlocked()) { this.toast(`Research happens in the Archive. It appears on your base at Beacon Lv ${BUILDINGS.archive.unlockBeacon}.`, 2800); return; }
      if (!store.isPlaced('archive')) { this.closeModal(); this.closeScreen(); this.hideWorld(); this.startPlacement('archive'); return; }
      this.openScreen('archive');
      return;
    }
    if (kind === 'training') { this.openScreen('troops'); return; }
    if (kind === 'healing') { this.openScreen('infirmary'); }
  }

  refreshSide() {
    const vis = this.sideVisible();
    for (const b of this.sideBtns) b.setVisible(vis);
    if (!vis) return;
    const s = store.state;
    const setQ = (b, label, pct, color = '#ffffff') => {
      b.timer.setText(label).setColor(color);
      b.arc.clear();
      if (pct != null) {
        b.arc.lineStyle(6, 0x05070a, 0.9).beginPath().arc(0, 0, b.r + 6, 0, Math.PI * 2).strokePath();
        b.arc.lineStyle(5, b.ring, 1).beginPath().arc(0, 0, b.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, pct)).strokePath();
      }
    };
    const j = s.construction[0];
    setQ(this.queueBtns.builder, j ? fmtClock(j.total - j.progress) : 'Idle', j ? j.progress / j.total : null, j ? PALETTE.textGold : PALETTE.textDim);
    const rj = store.researchJob();
    if (!store.archiveUnlocked()) setQ(this.queueBtns.research, `Beacon ${BUILDINGS.archive.unlockBeacon}`, null, PALETTE.textDim);
    else if (!store.isPlaced('archive')) setQ(this.queueBtns.research, 'Build!', null, PALETTE.textGold);
    else setQ(this.queueBtns.research, rj ? fmtClock(store.researchLeft()) : 'Idle', rj ? rj.progress / rj.total : null, rj ? '#d9c2ff' : PALETTE.textDim);
    const q = store.queuedUnits();
    setQ(this.queueBtns.training, q ? fmtClock(store.trainingSecondsLeft()) : 'Idle', null, q ? '#a8c8ff' : PALETTE.textDim);
    const hq = s.infirmary.queue.length;
    const wounded = store.woundedTotal();
    setQ(this.queueBtns.healing, hq ? fmtClock(store.healQueueSeconds()) : (wounded ? `${wounded} hurt` : 'Idle'), null, hq ? '#a8ffcc' : (wounded ? '#ff8a95' : PALETTE.textDim));
  }

  // ------------------------------------------- new buildings: placement -----
  // Gated buildings stay hidden until unlocked. On unlock the player is told and dropped into
  // placement mode; if they postpone it, a "New building" chip under the top bar offers it again.
  createPlaceChip() {
    const c = this.placeChip = this.add.container(W / 2, TOP_H + 44).setDepth(8).setVisible(false);
    this.placeChipBtn = button(this, 0, 0, 360, 62, '', () => { const id = store.pendingPlacements()[0]; if (id) this.startPlacement(id); }, { style: 'gold', size: 22 });
    this.placeChipBtn.chip = 'place-new';
    c.add(this.placeChipBtn);
    this.placeChipRect = new Phaser.Geom.Rectangle(W / 2 - 180, TOP_H + 13, 360, 62);
  }
  startPlacement(id) {
    this.closePanel(true);
    this.closeModal();
    this.closeScreen();
    this.hideWorld();
    this.game.events.emit('ui:place', id);
  }
  onUnlocked(id) {
    audio.play('reward'); audio.haptic([20, 40, 20]);
    const canNow = !this.screen && !this.modal && !this.reveal && !this.replay && !this.worldMode;
    this.toast(`${BUILDINGS[id].name} unlocked! ${canNow ? 'Choose a spot and tap Place.' : 'Build it from the Base view.'}`, 3200);
    if (canNow) this.time.delayedCall(300, () => { if (store.pendingPlacements().includes(id) && !this.scene.get('Base').placeId) this.startPlacement(id); });
  }
  refreshPlaceChip() {
    const pend = store.pendingPlacements();
    const base = this.scene.get('Base');
    const show = pend.length > 0 && !this.worldMode && !this.screen && !base?.moveId;
    this.placeChip.setVisible(show);
    if (show) this.placeChipBtn.setLabel(`🏗  New: build the ${BUILDINGS[pend[0]].name}`);
  }

  // Bottom nav: sculpted gunmetal bar with gold filigree, illustrated tab icons, a big Base emblem in
  // the centre. Tabs: World, Troops, [Base], Armory, Squads, More.
  createNav() {
    const y0 = H - NAV_H, hy = y0 - HERO_RISE + HERO_R; // hero centre
    const texTop = y0 - HERO_RISE - 16;                  // texture covers the emblem socket too
    this.bake('hud-nav-bg', W, H - texTop, (g) => {
      const o = -texTop, top = y0 + o;
      g.fillStyle(0x000000, 0.35).fillRect(0, top - 8, W, 8);
      g.fillGradientStyle(0x2c333d, 0x2c333d, 0x0d1015, 0x0d1015, 1, 1, 1, 1).fillRect(0, top, W, NAV_H);
      g.fillStyle(0xffffff, 0.06).fillRect(0, top + 6, W, 3);                    // upper bevel
      g.fillStyle(0x000000, 0.35).fillRect(0, top + 9, W, 2);
      // tab separators: engraved line + gold stud
      for (const x of this.navSlots().slice(0, -1).map((sl) => sl.x1)) {
        if (Math.abs(x - W / 2) < HERO_R + 20) continue;
        g.lineStyle(2, 0x05070a, 0.8).lineBetween(x, top + 20, x, top + NAV_BODY - 18);
        g.lineStyle(1, 0xffffff, 0.08).lineBetween(x + 2, top + 20, x + 2, top + NAV_BODY - 18);
        g.fillStyle(0xb88a3a, 1).fillPoints([{ x: x + 1, y: top + 14 }, { x: x + 6, y: top + 20 }, { x: x + 1, y: top + 26 }, { x: x - 4, y: top + 20 }], true);
      }
      // emblem socket (rises above the bar)
      const sy = hy + o;
      g.fillStyle(0x000000, 0.45).fillCircle(W / 2 + 3, sy + 5, HERO_R + 14);
      g.fillStyle(0x6b4a16, 1).fillCircle(W / 2, sy, HERO_R + 14);
      g.fillGradientStyle(0x3a424d, 0x3a424d, 0x14181e, 0x14181e, 1, 1, 1, 1).fillCircle(W / 2, sy, HERO_R + 11);
      // gold filigree along the top edge, sweeping up around the socket
      g.lineStyle(4, 0x3a2608, 1).lineBetween(0, top + 1, W, top + 1);
      g.lineStyle(2.5, PALETTE.gold, 1).lineBetween(0, top, W, top);
      g.lineStyle(1, 0xffe2a6, 0.6).lineBetween(0, top + 3, W, top + 3);
      g.lineStyle(3, PALETTE.gold, 1).beginPath().arc(W / 2, sy, HERO_R + 13, Math.PI * 0.86, Math.PI * 2.14).strokePath();
      g.lineStyle(1, 0xffe2a6, 0.6).beginPath().arc(W / 2, sy, HERO_R + 10, Math.PI * 0.9, Math.PI * 2.1).strokePath();
      for (const side of [-1, 1]) {
        const cx = W / 2 + side * (HERO_R + 34);
        g.lineStyle(2, PALETTE.gold, 0.9);
        g.beginPath().arc(cx, top + 14, 12, side < 0 ? Math.PI * 1.0 : Math.PI * 1.5, side < 0 ? Math.PI * 1.5 : Math.PI * 2.0).strokePath();
        g.beginPath().arc(cx + side * 28, top + 10, 8, Math.PI * 0.9, Math.PI * 2.1).strokePath();
        g.fillStyle(PALETTE.gold, 1).fillCircle(cx + side * 46, top + 6, 3);
        g.lineStyle(1.5, PALETTE.gold, 0.6).lineBetween(cx + side * 58, top + 8, cx + side * 150, top + 8);
      }
      // bottom rim
      g.lineStyle(2, 0x000000, 0.6).lineBetween(0, H + o - 1, W, H + o - 1);
    });
    this.add.image(0, texTop, 'hud-nav-bg').setOrigin(0, 0);
    this.navBlock = this.add.rectangle(W / 2, y0 + NAV_H / 2, W, NAV_H, 0, 0.001).setInteractive();
    this.navActive = this.add.graphics();
    this.navGlow = this.add.image(0, y0 + 46, 'glow').setBlendMode('ADD').setTint(PALETTE.gold).setAlpha(0).setScale(1.2);
    this.navBadges = this.add.graphics().setDepth(1);
    const iconY = y0 + 50, labelY = y0 + 96;
    this.tabs = this.navSlots().map((sl) => {
      const cx = (sl.x0 + sl.x1) / 2;
      if (sl.hero) return { ...sl, cx, cy: hy, label: null };
      const icon = this.add.image(cx, iconY, `nav-${sl.id}`);
      const k = 62 / Math.max(icon.width, icon.height); icon.setScale(k); icon.baseScale = k;
      const label = text(this, cx, labelY, sl.label, 19, PALETTE.textDim, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 3 }).setOrigin(0.5, 0);
      const badgeText = text(this, cx + 30, iconY - 28, '', 15, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5).setDepth(2);
      const hit = this.add.rectangle(cx, y0 + NAV_H / 2, sl.x1 - sl.x0, NAV_H, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { audio.play('tap'); audio.haptic(8); });
      hit.on('pointerup', () => this.onTab(sl.id));
      return { ...sl, cx, cy: iconY, icon, label, badgeText, badge: '' };
    });
    // Base hero emblem (centre)
    const hc = this.hero = this.add.container(W / 2, hy).setDepth(2);
    const glow = this.add.image(0, 0, 'glow').setBlendMode('ADD').setTint(0xffc45a).setScale(2.2).setAlpha(0.45);
    const em = this.add.image(0, 0, 'hud-base-emblem');
    em.setScale((HERO_R * 2 + 6) / Math.max(em.width, em.height));
    const ring = this.add.graphics();
    const lab = text(this, 0, HERO_R + 2, 'BASE', 17, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 2, stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5, 0);
    const hit = this.add.circle(0, 0, HERO_R + 8, 0, 0.001).setInteractive({ useHandCursor: true });
    const hb = this.add.graphics();
    const hbt = text(this, 50, -48, '', 15, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5);
    hc.add([glow, em, ring, lab, hb, hbt, hit]);
    Object.assign(hc, { glow, em, ring, lab, hit, badgeG: hb, baseScale: em.scale });
    const heroTab = this.tabs.find((t) => t.hero);
    Object.assign(heroTab, { badgeText: hbt, badge: '' });
    let pressed = false;
    hit.on('pointerdown', () => { pressed = true; this.tweens.add({ targets: hc, scale: 0.92, duration: 70 }); audio.play('tap'); audio.haptic(12); });
    hit.on('pointerout', () => { pressed = false; this.tweens.add({ targets: hc, scale: 1, duration: 120 }); });
    hit.on('pointerup', () => { this.tweens.add({ targets: hc, scale: 1, duration: 220, ease: 'Back.easeOut' }); if (pressed) this.onTab(HERO_TAB); pressed = false; });
    this.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.6 }, scale: { from: 2.1, to: 2.35 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.activeTab = 'base';
    this.drawNav();
  }
  // tab slots (game x ranges): two tabs left of the emblem, three to the right
  navSlots() {
    const L = W / 2 - HERO_R - 14, R = W / 2 + HERO_R + 14;
    const left = ['world', 'troops'], right = ['armory', 'squads', 'more'];
    const lw = L / left.length, rw = (W - R) / right.length;
    const names = { base: 'Base', troops: 'Troops', armory: 'Armory', squads: 'Squads', more: 'More', world: 'World' };
    return [
      ...left.map((id, i) => ({ id, label: names[id], x0: i * lw, x1: (i + 1) * lw })),
      { id: HERO_TAB, label: names[HERO_TAB], x0: L, x1: R, hero: true },
      ...right.map((id, i) => ({ id, label: names[id], x0: R + i * rw, x1: R + (i + 1) * rw })),
    ];
  }

  drawNav() {
    const g = this.navActive; if (!g) return;
    g.clear();
    const y0 = H - NAV_H;
    let glowX = null;
    for (const t of this.tabs) {
      if (t.hero) continue;
      const on = t.id === this.activeTab;
      this.tweens.killTweensOf(t.icon);
      t.icon.setScale(t.icon.baseScale * (on ? 1.16 : 1)).setY(on ? y0 + 42 : y0 + 50).setAlpha(on ? 1 : 0.82);
      t.label.setColor(on ? PALETTE.textGold : '#8a96a8');
      if (on) {
        // raised plate: lifted bevel + gold border + glow
        const w = t.x1 - t.x0 - 10, x = t.x0 + 5, y = y0 - 10, h = NAV_BODY + 4;
        g.fillStyle(0x000000, 0.45).fillRoundedRect(x + 2, y + 6, w, h, 14);
        g.fillGradientStyle(0x4a535f, 0x4a535f, 0x1a1f26, 0x1a1f26, 1, 1, 1, 1).fillRoundedRect(x, y, w, h, 14);
        g.lineStyle(3, PALETTE.gold, 1).strokeRoundedRect(x, y, w, h, 14);
        g.lineStyle(1, 0xffe2a6, 0.7).strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 11);
        g.fillStyle(PALETTE.gold, 0.18).fillRoundedRect(x + 4, y + 4, w - 8, 30, { tl: 11, tr: 11, bl: 0, br: 0 });
        glowX = t.cx;
      }
    }
    this.navGlow.setVisible(glowX != null).setAlpha(glowX != null ? 0.55 : 0).setX(glowX ?? 0);
    const hc = this.hero;
    if (hc) {
      const on = this.activeTab === HERO_TAB;
      hc.ring.clear().lineStyle(on ? 5 : 3, on ? 0xffe2a6 : PALETTE.gold, 1).strokeCircle(0, 0, HERO_R + 3);
      if (on) hc.ring.lineStyle(10, PALETTE.gold, 0.25).strokeCircle(0, 0, HERO_R + 9);
      hc.lab.setColor(on ? '#fff1cf' : PALETTE.textGold);
      hc.em.setScale(hc.baseScale * (on ? 1.06 : 1));
      hc.glow.setTint(on ? 0xffd27f : 0xffc45a);
    }
  }

  // red notification badges: Troops (new troops trained / healed since your last visit), Armory ('!' when Cores buy a
  // recruit), More (rewards to claim), Base emblem (a new building waiting to be placed)
  navBadgeValues() {
    const n = (v) => (v > 99 ? '99+' : v > 0 ? String(v) : '');
    const pulls = Math.floor(store.state.resources.cores / store.pullCost(1));
    return {
      base: this.activeTab !== 'base' && store.pendingPlacements().length ? '!' : '',
      troops: n(this.navNew.troops),
      armory: pulls >= 1 ? '!' : '', // can afford at least one recruit
      squads: '',
      world: '',
      more: n(store.rewardsReady()),
    };
  }
  refreshNavBadges() {
    const vals = this.navBadgeValues();
    let dirty = false;
    for (const t of this.tabs) if (t.badge !== (vals[t.id] ?? '')) { t.badge = vals[t.id] ?? ''; dirty = true; }
    if (!dirty) return;
    const g = this.navBadges; g.clear();
    const hb = this.hero.badgeG; hb.clear();
    for (const t of this.tabs) {
      if (t.hero) {
        t.badgeText.setText(t.badge);
        if (t.badge) hb.fillStyle(0xe0263c, 1).fillCircle(50, -48, 15).lineStyle(2, 0xffd0d6, 0.9).strokeCircle(50, -48, 15);
        continue;
      }
      const bx = t.cx + 30, by = H - NAV_H + 24;
      t.badgeText.setText(t.badge).setPosition(bx, by);
      if (!t.badge) continue;
      const w = Math.max(28, t.badgeText.width + 14);
      g.fillStyle(0x000000, 0.4).fillRoundedRect(bx - w / 2 + 1, by - 12, w, 28, 14);
      g.fillStyle(0xe0263c, 1).fillRoundedRect(bx - w / 2, by - 14, w, 28, 14);
      g.lineStyle(2, 0xffd0d6, 0.9).strokeRoundedRect(bx - w / 2, by - 14, w, 28, 14);
    }
  }

  onTab(id) {
    if (this.reveal) return;
    this.closeReplay?.();
    this.hideTip();
    if (id === 'base') { this.closeModal(); this.closeScreen(); this.hideWorld(); return; }
    if (id === 'world') { this.closeModal(); this.closeScreen(); this.showWorld(); return; }
    if (id === 'more') { if (this.modal?.isMore) { this.closeModal(); return; } this.openMore(); return; }
    if (id === 'settings') { this.openSettings(); return; }
    this.openScreen(id);
  }

  // "More" sheet: Settings plus room for more (Rewards, Profile, Research, Leaders, Events).
  openMore() {
    this.closeModal(true);
    this.closePanel(true);
    const items = [
      { id: 'settings', label: 'Settings', icon: 'nav-more', go: () => this.openSettings() },
      { id: 'rewards', label: 'Rewards', icon: 'hud-core', badge: () => store.rewardsReady(), go: () => this.openRewards() },
      { id: 'profile', label: 'Power', icon: 'hud-power', go: () => this.openPowerBreakdown() },
      { id: 'leaders', label: 'Leaders', icon: 'nav-troops', go: () => this.openScreen('armory', { armoryTab: 'leaders' }) },
      { id: 'research', label: 'Research', icon: 'more-research', go: () => { this.closeModal(); this.onQueue('research'); } },
      { id: 'events', label: 'Events', icon: 'more-events', badge: () => store.eventsReady(), go: () => openEvents(this) },
    ];
    const c = this.add.container(0, 0).setDepth(100);
    const bottom = H - NAV_H - HERO_RISE - 10;
    const cols = 3, tw = 208, th = 156, gap = 14;
    const rows = Math.ceil(items.length / cols);
    const w = W - 32, x = 16, h = 92 + rows * th + (rows - 1) * gap + 24, y = bottom - h;
    const dim = this.add.rectangle(W / 2, (H - NAV_H) / 2, W, H - NAV_H, 0x000000, 0.55).setInteractive();
    dim.on('pointerup', () => this.closeModal());
    const g = this.add.graphics();
    panelBg(g, x, y, w, h, { accent: PALETTE.gold });
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    c.add([dim, g, block, text(this, x + 28, y + 24, 'More', 32, PALETTE.textGold, { fontStyle: 'bold' })]);
    c.add(button(this, x + w - 40, y + 40, 56, 56, '✕', () => this.closeModal(), { style: 'ghost', size: 26 }));
    const x0 = x + (w - (cols * tw + (cols - 1) * gap)) / 2;
    items.forEach((it, i) => {
      const cx = x0 + (i % cols) * (tw + gap) + tw / 2, cy = y + 92 + Math.floor(i / cols) * (th + gap) + th / 2;
      const b = button(this, cx, cy, tw, th, it.label, () => { if (!it.soon) this.closeModal(true); it.go(); }, { style: 'ghost', size: 22 });
      b.chip = `more-${it.id}`;
      b.labelText.setY(44);
      c.add(b);
      if (it.icon) { const im = this.add.image(cx, cy - 18, it.icon); im.setScale(74 / Math.max(im.width, im.height)); c.add(im); }
      else {
        const ig = this.add.graphics(); c.add(ig);
        if (it.id === 'research') { ig.lineStyle(4, 0xb58cff, 1).strokeCircle(cx, cy - 18, 22).strokeEllipse(cx, cy - 18, 60, 22); ig.fillStyle(0xb58cff, 1).fillCircle(cx, cy - 18, 7); }
        else { ig.lineStyle(4, 0x8a96a8, 1).strokeRect(cx - 24, cy - 40, 48, 44); ig.lineBetween(cx - 24, cy - 26, cx + 24, cy - 26); ig.fillStyle(0x8a96a8, 1).fillRect(cx - 14, cy - 48, 6, 14).fillRect(cx + 8, cy - 48, 6, 14); }
      }
      if (it.soon) c.add(text(this, cx, cy + 60, 'coming soon', 14, PALETTE.textDim).setOrigin(0.5, 0.5));
      const n = it.badge?.() ?? 0;
      if (n) {
        const bg = this.add.graphics(); c.add(bg);
        bg.fillStyle(0xe0263c, 1).fillCircle(cx + tw / 2 - 22, cy - th / 2 + 22, 16).lineStyle(2, 0xffd0d6, 0.9).strokeCircle(cx + tw / 2 - 22, cy - th / 2 + 22, 16);
        c.add(text(this, cx + tw / 2 - 22, cy - th / 2 + 22, String(n), 16, '#ffffff', { fontStyle: 'bold' }).setOrigin(0.5));
      }
    });
    c.isMore = true;
    c.sheetRect = new Phaser.Geom.Rectangle(x, y, w, h);
    c.alpha = 0; c.y = 24;
    this.tweens.add({ targets: c, alpha: 1, y: 0, duration: 160, ease: 'Cubic.easeOut' });
    this.modal = c;
    this.activeTab = 'more'; this.drawNav();
    audio.play('open');
    this.flushInput();
    return c;
  }

  // ------------------------------------------------- full screens -----
  // screens end above the World emblem, which rises out of the nav bar
  get area() { return { x: 0, y: TOP_H, w: W, h: H - TOP_H - NAV_H - HERO_RISE - 4 }; }

  openScreen(id, opts = {}) {
    if (id === 'troops' || id === 'infirmary') this.navNew.troops = 0;
    this.hideTip?.();
    this.closeModal(true);
    this.closePanel(true);
    this.game.events.emit('ui:moveDone');
    Object.assign(this.screenState, opts);
    if (!this.screen || this.screen.id !== id) {
      this.screen?.container.destroy();
      const c = this.add.container(0, 0).setDepth(50);
      this.screen = { id, container: c, dyn: [] };
      if (id !== 'squads') this.screenState.edit = null;
      // transition: quick fade (no movement, so taps always land where the controls are drawn)
      c.alpha = 0; this.tweens.add({ targets: c, alpha: 1, duration: 140, ease: 'Quad.easeOut' });
      audio.play('open');
    }
    this.activeTab = this.tabFor(id); this.drawNav();
    this.renderScreen();
  }

  // nav tab that lights up for a screen (Infirmary sits with Troops, the Archive with the Base)
  tabFor(id) { return id ? ({ infirmary: 'troops', archive: 'base' }[id] ?? id) : null; }

  renderScreen() {
    if (!this.screen) return;
    const c = this.screen.container;
    c.removeAll(true);
    const a = this.area;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1117, 0x0d1117, 0x07090d, 0x07090d, 0.985, 0.985, 0.985, 0.985).fillRect(a.x, a.y, a.w, a.h + HERO_RISE + 4);
    bg.lineStyle(1, PALETTE.gold, 0.05);
    for (let yy = a.y + 12; yy < a.y + a.h; yy += 24) bg.lineBetween(0, yy, W, yy);
    const block = this.add.rectangle(a.x + a.w / 2, a.y + a.h / 2, a.w, a.h, 0, 0.001).setInteractive();
    c.add([bg, block]);
    this.screen.dyn = [];
    const api = this.screenApi();
    SCREENS[this.screen.id](this, c, a, api, this.screenState);
    this.screenDirty = false;
    this.flushInput();
  }

  // Phaser only makes newly created interactive objects hittable at the start of the next frame.
  // Screens are rebuilt on state changes, so flush that queue right away; otherwise a tap that lands
  // just after a rebuild would hit nothing. (Mirrors InputPlugin.preUpdate without re-emitting events.)
  flushInput() {
    const ip = this.input;
    if (!ip._pendingInsertion || (!ip._pendingInsertion.length && !ip._pendingRemoval.length)) return;
    let list = ip._list;
    for (const o of ip._pendingRemoval) { const i = list.indexOf(o); if (i > -1) { list.splice(i, 1); ip.clear(o, true); } }
    ip._pendingRemoval.length = 0;
    ip._list = list.concat(ip._pendingInsertion.splice(0));
  }

  screenApi() {
    const ui = this;
    return {
      dyn: (fn) => { ui.screen.dyn.push(fn); fn(); },
      rerender: () => ui.renderScreen(),
      toast: (m, ms) => ui.toast(m, ms),
      go: (id, opts) => ui.openScreen(id, opts),
      overlay: (opts) => ui.openOverlay(opts),
      closeOverlay: () => ui.closeModal(true),
      modal: (opts) => ui.openModal(opts),
      reveal: (results) => ui.playReveal(results),
      bumpPower: () => ui.bump(ui.powerText),
    };
  }

  closeScreen() {
    if (!this.screen) return;
    this.screen.container.destroy();
    this.screen = null;
    this.screenState.edit = null;
    this.activeTab = this.worldMode ? 'world' : 'base'; this.drawNav();
  }

  // ------------------------------------------------------- world view -----
  showWorld() {
    this.closePanel(true);
    this.game.events.emit('ui:moveDone');
    this.worldMode = true;
    if (this.scene.isSleeping('World')) this.scene.wake('World');
    else if (!this.scene.isActive('World')) this.scene.run('World');
    this.scene.sleep('Base');
    this.scene.get('World').cameras?.main?.fadeIn(220, 7, 9, 13);
    audio.play('open');
    this.worldHud.show();
    this.activeTab = 'world'; this.drawNav();
  }
  hideWorld() {
    if (!this.worldMode) return;
    this.worldMode = false;
    this.scene.get('World')?.select?.(null);
    this.worldHud.hide();
    this.scene.sleep('World');
    this.scene.wake('Base');
    this.scene.get('Base').cameras?.main?.fadeIn(220, 7, 9, 13);
    this.activeTab = this.tabFor(this.screen?.id) ?? 'base'; this.drawNav();
  }

  // A hunt finished: manual attacks pop the report card (if nothing else is open), Auto ones just toast.
  onHunt(r) {
    const T = CREATURES[r.target.type];
    if (r.loot.cores) this.bump(this.coreText);
    if (!store.simulating) {
      audio.play(r.win ? 'win' : 'lose', { gap: 300 });
      if (r.win) { this.floatText(240, SAFE.top + 140, `+${fmt(r.loot.energy)}`, PALETTE.textCyan); if (r.loot.cores) this.floatText(600, SAFE.top + 70, `+${r.loot.cores} Core`, CORES.hex); }
    }
    const msg = `${SQ[r.squadId].name} ${r.win ? 'defeated' : 'lost to'} Lv ${r.target.level} ${T.short}${r.win ? `  ·  +${fmt(r.loot.energy)} Energy${r.loot.cores ? `  ·  +${r.loot.cores} Core!` : ''}` : ''}  ·  ${r.casualties.woundedTotal ?? 0} wounded, ${r.casualties.deadTotal ?? 0} fallen`;
    if (!r.auto && this.worldMode && !this.modal && !this.screen && !this.reveal && !this.replay) openReport(this, r);
    else this.toast(msg, 2600);
  }

  // Generic overlay sheet with custom content: build(container, rect) adds objects.
  openOverlay({ title, h = 760, build, closeLabel = 'Close', tab }) {
    this.closeModal(true);
    if (tab) { this.activeTab = tab; this.drawNav(); }
    const c = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x020305, 0.72).setInteractive();
    const w = W - 48, x = 24;
    h = Math.min(h, H - 80);
    const y = Math.max(40, (H - h) / 2);
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    c.add([dim, g, block]);
    if (title) {
      const tt = text(this, x + 30, y + 22, title, 32, '#ffd27f', { fontStyle: 'bold', stroke: '#2e1e06', strokeThickness: 4 });
      if (tt.width > w - 120) tt.setScale((w - 120) / tt.width);
      c.add(tt);
      const rg = this.add.graphics(); c.add(rg);
      const ry = y + 70;
      for (let k = 0; k < 5; k++) rg.lineStyle(2, SKIN.gold, 0.7 - k * 0.13).lineBetween(x + 28 + k * (w - 56) / 5, ry, x + 28 + (k + 1) * (w - 56) / 5, ry);
      diamond(rg, x + 28, ry, 5);
    }
    c.add(button(this, x + w - 40, y + 40, 56, 56, '✕', () => this.closeModal(true), { style: 'ghost', size: 26 }));
    const rect = { x, y, w, h };
    build(c, rect, () => this.closeModal(true));
    if (closeLabel) c.add(button(this, x + w / 2, y + h - 54, 260, 70, closeLabel, () => this.closeModal(true), { style: 'ghost', size: 26 }));
    c.alpha = 0;
    this.tweens.add({ targets: c, alpha: 1, duration: 120 });
    this.modal = c;
    this.flushInput();
    return c;
  }

  // ------------------------------------------------ gacha reveal -----
  playReveal(results) {
    this.closeModal(true);
    const c = this.add.container(0, 0).setDepth(300);
    this.reveal = c;
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x020305, 0.9).setInteractive();
    c.add(dim);
    const rays = this.add.image(W / 2, H / 2 - 40, 'glow').setBlendMode('ADD').setScale(4).setAlpha(0.35);
    c.add(rays);
    const best = results.reduce((b, r) => Math.max(b, ['common', 'rare', 'epic', 'legendary'].indexOf(r.rarity)), 0);
    const bannerImg = this.add.image(W / 2, 150, 'banner-beacon-call').setAlpha(0.35); bannerImg.setDisplaySize(W, W * 320 / 720); c.add(bannerImg);
    const rg = this.add.graphics(); c.add(rg);
    for (let k = 0; k < 5; k++) rg.lineStyle(2, SKIN.gold, 0.8 - k * 0.15).lineBetween(W / 2 - 200 - (k + 1) * 30, 186, W / 2 - 200 - k * 30, 186).lineBetween(W / 2 + 200 + k * 30, 186, W / 2 + 200 + (k + 1) * 30, 186);
    diamond(rg, W / 2 - 200, 186, 6); diamond(rg, W / 2 + 200, 186, 6);
    c.add(text(this, W / 2, 150, results.length > 1 ? 'RECRUITMENT  ·  x10' : 'RECRUITMENT', 34, '#ffd27f', { fontStyle: 'bold', letterSpacing: 4, stroke: '#2e1e06', strokeThickness: 6 }).setOrigin(0.5));
    const single = results.length === 1;
    const CW = single ? 300 : 128, CH = single ? 445 : 190, cols = single ? 1 : 5;
    const rowsN = Math.ceil(results.length / cols);
    const gapX = 10, gapY = 18;
    const totalW = cols * CW + (cols - 1) * gapX, totalH = rowsN * (CH + 64) + (rowsN - 1) * gapY;
    const x0 = (W - totalW) / 2 + CW / 2, y0 = Math.max(220, H / 2 - totalH / 2 - 20) + CH / 2;
    const cards = results.map((r, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = x0 + col * (CW + gapX), cy = y0 + row * (CH + 64 + gapY);
      const R = RARITY[r.rarity];
      const holder = this.add.container(cx, cy);
      const glow = this.add.image(0, 0, 'glow-white').setTint(R.color).setBlendMode('ADD').setScale((CW / 128) * (r.rarity === 'legendary' ? 3 : r.rarity === 'epic' ? 2.4 : 1.6)).setAlpha(0);
      const back = this.add.image(0, 0, 'card-back').setDisplaySize(CW, CH);
      const front = this.add.container(0, 0).setVisible(false);
      const fg = this.add.graphics();
      fg.fillStyle(lerpC(R.color, 0x000000, 0.45), 1).fillRect(-CW / 2 - 3, -CH / 2 - 3, CW + 6, CH + 6);
      fg.fillGradientStyle(0x1b222c, 0x1b222c, 0x07090d, 0x07090d, 1, 1, 1, 1).fillRect(-CW / 2, -CH / 2, CW, CH);
      fg.fillGradientStyle(R.color, R.color, R.color, R.color, 0, 0, 0.35, 0.35).fillRect(-CW / 2, CH / 2 - CH * 0.32, CW, CH * 0.32);
      fg.lineStyle(single ? 5 : 3, R.color, 1).strokeRect(-CW / 2, -CH / 2, CW, CH);
      fg.lineStyle(1, 0xffffff, 0.25).strokeRect(-CW / 2 + 5, -CH / 2 + 5, CW - 10, CH - 10);
      const key = r.kind === 'leader' ? (single ? leaderBig(this, r.id) : `leader-${r.id}`) : gearTexture(r.id);
      const art = this.add.image(0, -CH * 0.1, key);
      art.setScale(r.kind === 'leader' ? (CW - 12) / art.width : (CW * 0.8) / art.width);
      const fs = single ? 30 : 15;
      const name = text(this, 0, CH / 2 - CH * 0.25, (LEADERS[r.id] ?? GEAR[r.id]).name, fs, R.hex, { fontStyle: 'bold', align: 'center', wordWrap: { width: CW - 8 } }).setOrigin(0.5, 0);
      const rar = text(this, 0, CH / 2 - (single ? 40 : 22), R.name.toUpperCase(), single ? 20 : 12, R.hex, { letterSpacing: 2 }).setOrigin(0.5, 0);
      front.add([fg, art, name, rar]);
      const tag = text(this, 0, CH / 2 + 10, `${resultTag(r)}${r.kind === 'gear' ? `  ${GEAR[r.id].slot}` : ''}`, single ? 26 : 16, r.result === 'new' ? PALETTE.textGold : PALETTE.textCyan, { fontStyle: 'bold' }).setOrigin(0.5, 0).setAlpha(0);
      const pityTag = r.pity ? text(this, 0, CH / 2 + (single ? 44 : 32), 'PITY', single ? 18 : 12, '#c58aff', { letterSpacing: 2 }).setOrigin(0.5, 0).setAlpha(0) : null;
      holder.add([glow, back, front, tag, ...(pityTag ? [pityTag] : [])]);
      holder.setScale(0.6).setAlpha(0);
      c.add(holder);
      return { r, holder, back, front, glow, tag, pityTag, shown: false };
    });
    const flip = (cd) => {
      if (cd.shown || !cd.holder.active) return;
      cd.shown = true;
      this.tweens.add({
        targets: cd.holder, scaleX: 0, duration: 110, ease: 'Quad.easeIn',
        onComplete: () => {
          if (!cd.holder.active) return;
          cd.back.setVisible(false); cd.front.setVisible(true);
          this.tweens.add({ targets: cd.holder, scaleX: 1, duration: 140, ease: 'Back.easeOut' });
          this.tweens.add({ targets: [cd.tag, cd.pityTag].filter(Boolean), alpha: 1, duration: 200 });
          const big = cd.r.rarity === 'legendary' || cd.r.rarity === 'epic';
          this.tweens.add({ targets: cd.glow, alpha: big ? 0.9 : 0.45, duration: 260 });
          audio.play('reveal', { rarity: cd.r.rarity, gap: 30 });
          if (big) audio.haptic(cd.r.rarity === 'legendary' ? [30, 50, 60] : 25);
          if (big) {
            const burst = this.add.particles(cd.holder.x, cd.holder.y, 'spark', { speed: { min: 90, max: cd.r.rarity === 'legendary' ? 380 : 220 }, lifespan: 800, scale: { start: 1.4, end: 0 }, tint: [RARITY[cd.r.rarity].color, 0xffffff], blendMode: 'ADD', emitting: false });
            c.add(burst);
            burst.explode(cd.r.rarity === 'legendary' ? 60 : 28);
            if (cd.r.rarity === 'legendary') { rays.setTint(0xffd27f); this.tweens.add({ targets: rays, alpha: 0.75, duration: 200, yoyo: true }); }
          }
        },
      });
    };
    cards.forEach((cd, i) => {
      this.tweens.add({ targets: cd.holder, alpha: 1, scale: 1, duration: 180, delay: i * 40, ease: 'Back.easeOut' });
      this.time.delayedCall(450 + i * 190, () => flip(cd));
    });
    this.revealCards = cards;
    const by = Math.min(H - NAV_H - 60, y0 + (rowsN - 1) * (CH + 64 + gapY) + CH / 2 + 150);
    const summary = text(this, W / 2, by - 76, '', 20, PALETTE.textDim, { align: 'center' }).setOrigin(0.5, 0);
    c.add(summary);
    let done = false;
    const btn = button(this, W / 2, by, 320, 76, 'Reveal All', () => {
      if (!done) { cards.forEach(flip); done = true; btn.setLabel('Continue'); return; }
      this.closeReveal();
    }, { style: 'gold', size: 26 });
    c.add(btn);
    this.time.delayedCall(450 + cards.length * 190 + 200, () => { if (this.reveal === c && !done) { done = true; btn.setLabel('Continue'); } });
    const counts = results.reduce((m, r) => ((m[r.rarity] = (m[r.rarity] ?? 0) + 1), m), {});
    summary.setText(['legendary', 'epic', 'rare', 'common'].filter((k) => counts[k]).map((k) => `${counts[k]} ${RARITY[k].name}`).join('  ·  '));
    void best;
    c.alpha = 0;
    this.tweens.add({ targets: c, alpha: 1, duration: 150 });
  }

  closeReveal() {
    if (!this.reveal) return;
    const all = [];
    const walk = (o) => { all.push(o); (o.list ?? []).forEach(walk); };
    walk(this.reveal);
    this.tweens.killTweensOf(all);
    this.reveal.destroy();
    this.reveal = null;
    this.revealCards = null;
    this.screenDirty = true;
  }

  openPowerBreakdown() {
    const s = store.state, p = store.power, tp = store.troopPower;
    const bRows = [
      { icon: 'art-beacon', label: `Beacon Relay  Lv ${s.beacon.level}`, a: `+${buildingPower(BEACON.id, s.beacon.level)}` },
      ...Object.keys(BUILDINGS).map((id) => (BUILDINGS[id].unlockBeacon && s.beacon.level < BUILDINGS[id].unlockBeacon
        ? { icon: `art-${id}`, label: BUILDINGS[id].name, a: `unlocks at Beacon Lv ${BUILDINGS[id].unlockBeacon}` }
        : { icon: `art-${id}`, label: `${BUILDINGS[id].name}  Lv ${s.buildings[id].level}`, a: `+${buildingPower(id, s.buildings[id].level)}` })),
    ];
    const tRows = [
      ...TROOP_IDS.filter((t) => TROOP_CLASSES[t].tier === 1 || s.troops[t] > 0).map((t) => ({ icon: `portrait-${t}`, label: `${TROOP_CLASSES[t].plural}: ${s.troops[t]}`, a: `+${s.troops[t] * TROOP_CLASSES[t].power * TROOPS.powerPerSoldier}` })),
      { glyph: 'squad', label: 'Squad levels', a: `+${tp.levels}` },
    ];
    const RH = 50, h = 250 + (bRows.length + tRows.length) * RH + 150;
    this.openOverlay({
      title: 'Base Power', h,
      build: (c, r) => {
        const x0 = r.x + 28, w0 = r.w - 56;
        const pi = this.add.image(x0 + 26, r.y + 116, 'hud-power'); pi.setScale(52 / Math.max(pi.width, pi.height)); c.add(pi);
        c.add(text(this, x0 + 64, r.y + 92, fmt(p.total), 40, '#ffd27f', { fontStyle: 'bold', stroke: '#2e1e06', strokeThickness: 4 }));
        c.add(text(this, x0 + 66, r.y + 140, `Base Power ${fmt(p.total)} = Building ${fmt(p.building)} + Troop ${fmt(p.troop)}`, 17, PALETTE.textDim));
        let y = r.y + 180;
        sectionHeader(this, c, x0, y, 'BUILDING POWER', { w: w0, right: `+${fmt(p.building)}` });
        y += 34;
        for (const row of bRows) { statLine(this, c, x0, y, w0, RH - 6, { icon: row.icon, label: row.label, a: row.a, size: 19 }); y += RH; }
        y += 10;
        sectionHeader(this, c, x0, y, 'TROOP POWER', { w: w0, right: `+${fmt(p.troop)}` });
        c.add(text(this, x0, y + 26, '(T1 1 · T2 2 · T3 4 per soldier, +10 per squad level above 1)', 15, PALETTE.textDim));
        y += 52;
        for (const row of tRows) { statLine(this, c, x0, y, w0, RH - 6, { icon: row.icon ?? null, glyphKind: row.glyph, label: row.label, a: row.a, size: 19 }); y += RH; }
      },
    });
  }

  // Beacon Core rewards: daily login streak, Beacon level-ups, first-time milestones.
  openRewards() {
    const C = CORES, D = C.daily;
    const claimed = (res) => { if (res.ok) { this.toast(`+${res.cores} Beacon ${res.cores === 1 ? 'Core' : 'Cores'}`, 1600); this.bump(this.coreText); } else this.toast(res.reason); this.openRewards(); };
    this.openOverlay({
      title: 'Beacon Core Rewards', h: 1010,
      build: (c, r) => {
        const x0 = r.x + 28, xr = r.x + r.w - 28;
        const g = this.add.graphics(); c.add(g);
        c.add(text(this, x0, r.y + 76, `You have ${fmt(store.state.resources.cores)} Cores. Cores are earned only, never bought.`, 18, PALETTE.textDim));
        // daily
        const di = store.dailyInfo();
        sectionHeader(this, c, x0, r.y + 108, 'DAILY LOGIN', { w: r.w - 56, color: C.hex, rule: C.color, size: 19 });
        const shown = di.claimed ? di.streak : di.streak - 1; // days already banked in this cycle
        const inCycle = shown <= 0 ? 0 : ((shown - 1) % D.streakEvery) + 1;
        for (let k = 0; k < D.streakEvery; k++) {
          const cx = x0 + 22 + k * 52, cy = r.y + 166;
          const done = k < inCycle, bonus = k === D.streakEvery - 1;
          g.fillStyle(0x000000, 0.45).fillCircle(cx + 1, cy + 3, 21);
          g.fillStyle(done ? C.color : 0x141922, 1).fillCircle(cx, cy, 20);
          if (done) g.fillStyle(0xffffff, 0.25).fillEllipse(cx, cy - 8, 24, 10);
          g.lineStyle(2.5, bonus ? PALETTE.gold : (done ? 0xffd0dc : lerpC(C.color, 0x000000, 0.3)), 1).strokeCircle(cx, cy, 20);
          c.add(text(this, cx, cy - 10, bonus ? `+${D.base + D.streakBonus}` : `${k + 1}`, 16, done ? '#ffffff' : (bonus ? PALETTE.textGold : PALETTE.textDim), { fontStyle: 'bold' }).setOrigin(0.5, 0));
        }
        c.add(text(this, x0, r.y + 196, di.claimed ? `Claimed today · ${di.streak}-day streak · come back tomorrow` : `Day ${di.streak} of your streak: +${di.reward}${di.reward > D.base ? ' (streak bonus!)' : ''}`, 17, PALETTE.text));
        const bd = button(this, xr - 90, r.y + 166, 180, 56, di.claimed ? 'Claimed' : `Claim +${di.reward}`, () => claimed(store.claimDaily()), { style: 'gold', size: 21 });
        bd.setEnabled(di.can); bd.chip = 'daily'; c.add(bd);
        // beacon levels
        const br = store.beaconRewards(), open = br.filter((b) => !b.claimed);
        sectionHeader(this, c, x0, r.y + 240, 'BEACON LEVELS', { w: r.w - 260, color: C.hex, rule: C.color, size: 19 });
        c.add(text(this, x0, r.y + 274, `+${C.beaconLevel} Cores for each Beacon level reached, once each.\nBeacon Lv ${store.state.beacon.level}: ${br.length - open.length}/${br.length} claimed${open.length ? `, ${open.length} ready` : ''}. Next: Lv ${store.state.beacon.level + 1}.`, 17, PALETTE.text, { lineSpacing: 5 }));
        const bb = button(this, xr - 90, r.y + 262, 180, 56, open.length ? `Lv ${open[0].level} · +${C.beaconLevel}` : 'None ready', () => claimed(store.claimBeaconLevel(open[0].level)), { style: 'gold', size: 20 });
        bb.setEnabled(open.length > 0); bb.chip = open.length ? `beacon-${open[0].level}` : 'beacon-none'; c.add(bb);
        // milestones
        sectionHeader(this, c, x0, r.y + 336, 'FIRST-TIME MILESTONES', { w: r.w - 56, color: C.hex, rule: C.color, size: 19 });
        store.milestones().forEach((m, i) => {
          const y = r.y + 376 + i * 66;
          drawCard(g, x0, y, r.w - 56, 58, { state: m.claimed ? 'done' : m.done ? 'ready' : 'normal', cut: 8 });
          c.add(text(this, x0 + 14, y + 6, `${m.claimed ? '✓ ' : ''}${m.name}`, 19, m.claimed ? PALETTE.textDim : PALETTE.text, { fontStyle: 'bold' }));
          c.add(text(this, x0 + 14, y + 32, m.desc, 15, PALETTE.textDim));
          if (m.claimed) c.add(text(this, xr - 16, y + 18, `+${m.cores} claimed`, 17, PALETTE.textDim).setOrigin(1, 0));
          else {
            const b = button(this, xr - 84, y + 29, 150, 46, m.done ? `Claim +${m.cores}` : `+${m.cores}`, () => claimed(store.claimMilestone(m.id)), { style: m.done ? 'gold' : 'ghost', size: 19 });
            b.setEnabled(m.done); b.chip = `ms-${m.id}`; c.add(b);
          }
        });
        const yb = r.y + 376 + C.milestones.length * 66 + 16;
        c.add(text(this, x0, yb, `World hunts: the first kill of each creature level pays ${CORES.battle.firstKill} Core (Dusk Wyrms ${CORES.battle.firstKillElite}). Daily login also gives +${STAMINA.dailyBonus} stamina.`, 16, PALETTE.textDim, { wordWrap: { width: r.w - 56 } }));
        const n = store.rewardsReady();
        const all = button(this, r.x + r.w / 2, yb + 66, 320, 64, n ? `Claim all (${n})` : 'Nothing to claim', () => claimed(store.claimAllRewards()), { style: 'cyan', size: 22 });
        all.setEnabled(n > 0); c.add(all);
      },
    });
  }

  // ---------------------------------------------------------- panel -----
  createPanel() {
    // Stage 9 building panel: painted building art + title / level plaque, three stat rows with icons,
    // a cost row (Energy + time, or the countdown bar while upgrading), then Upgrade (gold), the
    // building's action (teal) and Move (metal). pStats keeps the full stat text (tests, a11y).
    const x = 16, w = W - 32, h = 556, y = H - NAV_H - HERO_RISE - h - 8;
    this.panelRect = new Phaser.Geom.Rectangle(x, y, w, h);
    const c = this.panel = this.add.container(0, 0).setVisible(false).setDepth(10);
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    c.add([g, block]);
    // art window
    const ax = x + 22, ay = y + 22, aw = 196, ah = 150;
    const ag = this.add.graphics();
    ag.fillStyle(0x000000, 0.4).fillRect(ax + 2, ay + 4, aw, ah);
    ag.fillStyle(SKIN.goldDk, 1).fillRect(ax - 3, ay - 3, aw + 6, ah + 6);
    ag.fillGradientStyle(0x2a3442, 0x2a3442, 0x07090d, 0x07090d, 1, 1, 1, 1).fillRect(ax, ay, aw, ah);
    this.pArt = this.add.image(ax + aw / 2, ay + ah / 2 + 6, 'art-barracks');
    const af = this.add.graphics();
    af.lineStyle(2, SKIN.gold, 1).strokeRect(ax, ay, aw, ah).lineStyle(1, SKIN.goldHi, 0.35).strokeRect(ax + 4, ay + 4, aw - 8, ah - 8);
    for (const [cx, cy] of [[ax, ay], [ax + aw, ay], [ax, ay + ah], [ax + aw, ay + ah]]) diamond(af, cx, cy, 6);
    this.pArtMask = this.make.graphics({}, false).fillRect(ax + 2, ay + 2, aw - 4, ah - 4);
    this.pArt.setMask(this.pArtMask.createGeometryMask());
    c.add([ag, this.pArt, af]);
    this.pArtRect = { ax, ay, aw, ah };
    const tx = ax + aw + 22;
    this.pTitle = text(this, tx, y + 20, '', 36, '#ffd27f', { fontStyle: 'bold', stroke: '#2e1e06', strokeThickness: 4 });
    this.pLvG = this.add.graphics();
    this.pLevel = text(this, tx + 18, y + 92, '', 25, '#ffe2a6', { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.pDesc = text(this, tx, y + 122, '', 17, PALETTE.textDim, { wordWrap: { width: x + w - 24 - tx }, lineSpacing: 3, maxLines: 3 });
    this.pStats = text(this, x + 28, y + 172, '', 23, PALETTE.text, { lineSpacing: 10 }).setVisible(false);
    c.add([this.pTitle, this.pLvG, this.pLevel, this.pDesc, this.pStats]);
    // stat rows
    this.pRows = [0, 1, 2].map((i) => statLine(this, c, x + 22, y + 190 + i * 58, w - 44, 50, { label: '', a: '' }));
    this.pRowIcons = this.pRows.map(() => null);
    // cost row
    const cy = y + 372;
    this.pCost = priceTag(this, c, x + 22, cy, { icon: 'hud-energy', label: '', h: 50, size: 22 });
    this.pTime = priceTag(this, c, x + w - 22 - 150, cy, { glyphKind: 'clock', label: '', h: 50, w: 150, size: 22 });
    this.pCap = text(this, x + w - 24, y + 432, '', 17, PALETTE.textDim).setOrigin(1, 0);
    this.pBar = this.add.graphics();
    this.pJob = text(this, x + 22, cy - 2, '', 19, '#ffe2a6', { fontStyle: 'bold' });
    this.pReason = text(this, x + 24, y + 432, '', 18, '#ff8a95');
    c.add([this.pCap, this.pBar, this.pJob, this.pReason]);
    const close = button(this, x + w - 40, y + 44, 56, 56, '✕', () => this.closePanel(true), { style: 'ghost', size: 26 });
    const by = y + h - 60;
    this.pUpgrade = button(this, x + 22 + 130, by, 260, 80, 'Upgrade', () => this.doUpgrade(), { style: 'gold', size: 28 });
    this.pOpen = button(this, x + 22 + 260 + 14 + 108, by, 216, 80, 'Open', () => {
      const id = this.panelOpenFor;
      const target = { barracks: 'troops', armory: 'armory', commandCenter: 'squads', infirmary: 'infirmary', archive: 'archive' }[id];
      if (target) this.openScreen(target);
    }, { style: 'cyan', size: 27 });
    this.pMove = button(this, x + w - 22 - 77, by, 154, 80, 'Move', () => {
      const id = this.panelOpenFor; this.closePanel(false); this.game.events.emit('ui:move', id);
    }, { style: 'ghost', size: 27 });
    c.add([close, this.pUpgrade, this.pMove, this.pOpen]);
  }

  openPanel(id) {
    this.panelOpenFor = id;
    this.panel.setVisible(true);
    this.panel.y = 30; this.panel.alpha = 0;
    this.tweens.add({ targets: this.panel, y: 0, alpha: 1, duration: 160, ease: 'Cubic.easeOut' });
    this.panelArtFor = null;
    this.refreshPanel();
  }

  closePanel(notifyBase) {
    if (!this.panelOpenFor) return;
    this.panelOpenFor = null;
    this.panel.setVisible(false);
    if (notifyBase) this.game.events.emit('ui:panelClosed');
  }

  refreshPanel() {
    const id = this.panelOpenFor;
    if (!id) return;
    const s = store.state;
    const info = store.upgradeInfo(id);
    const lv = info.level;
    const r = this.panelRect;
    if (this.panelArtFor !== id) {
      this.panelArtFor = id;
      const key = `art-${id === BEACON.id ? 'beacon' : id}`;
      const { aw, ah } = this.pArtRect;
      this.pArt.setTexture(this.textures.exists(key) ? key : 'art-beacon');
      this.pArt.setScale(Math.min((aw - 8) / this.pArt.width, (ah + 30) / this.pArt.height));
    }
    let rows, lines;
    if (id === BEACON.id) {
      this.pTitle.setText(BEACON.name);
      this.pDesc.setText(BEACON.description);
      const now = buildingPower(id, lv), next = buildingPower(id, lv + 1);
      const pct = Math.floor((s.beacon.charge / BEACON.maxCharge) * 100);
      const e0 = (ECONOMY.energyPerSec(lv) * store.mods.energy).toFixed(2), e1 = (ECONOMY.energyPerSec(lv + 1) * store.mods.energy).toFixed(2);
      lines = [
        `Power (Beacon Relay):  +${now}   →  +${next}`,
        `Charge:  ${pct}%   ·   Energy income ${e0}/s → ${e1}/s`,
        `Building level cap:  Lv ${store.buildingLevelCap()}   ·   Anchored (can't move)`,
        info.job ? `Upgrading to Lv ${info.job.toLevel}:  ${fmtClock(info.job.total - info.job.progress)} left` : `Upgrade:  ${fmt(info.cost)} Energy + full charge  ·  ${fmtClock(info.seconds)}`,
      ];
      rows = [
        { icon: 'hud-power', label: 'Power', a: `+${now}`, b: `+${next}`, up: next > now },
        { icon: 'hud-energy', label: 'Energy', a: `${e0}/s`, b: `${e1}/s`, up: +e1 > +e0 },
        { glyph: 'charge', label: 'Charge', a: `${pct}%${pct >= 100 ? '  ·  FULL' : ''}`, b: null, up: false },
      ];
      this.pMove.setVisible(false);
      this.pOpen.setVisible(false);
      this.pUpgrade.setPosition(r.x + r.width / 2, this.pUpgrade.y);
      this.pCap.setText(`Cap Lv ${store.buildingLevelCap()}  ·  anchored`);
    } else {
      const def = BUILDINGS[id];
      this.pTitle.setText(def.name);
      this.pDesc.setText(def.description);
      const sealed = def.unlockBeacon && s.beacon.level < def.unlockBeacon;
      const now = sealed ? 0 : buildingPower(id, lv), next = buildingPower(id, lv + 1);
      const extra = {
        barracks: `3 lanes · ${BARRACKS.laneCapacity(lv)} → ${BARRACKS.laneCapacity(lv + 1)} each  ·  Speed x${BARRACKS.trainSpeed(lv).toFixed(1)} → x${BARRACKS.trainSpeed(lv + 1).toFixed(1)}`,
        commandCenter: `Squad level cap Lv ${lv}  ·  Alloy ${(store.alloyRate * 3600).toFixed(0)}/h`,
        armory: `Cores ${fmt(s.resources.cores)} (pulls)  ·  Shards ${fmt(s.resources.shards)} (+${(store.shardRate * 3600).toFixed(0)}/h, upgrades)`,
        infirmary: `Beds ${store.woundedTotal()}/${store.infirmaryCapacity()} → ${Math.floor(INFIRMARY.capacity(lv + 1) * store.mods.beds)}  ·  Heal x${store.healSpeed().toFixed(2)} → x${(INFIRMARY.healSpeed(lv + 1) * store.mods.healSpeed).toFixed(2)}`,
        archive: !store.archiveUnlocked() ? `Sealed until Beacon Lv ${def.unlockBeacon}: no research, no Power yet` : (store.researchJob() ? `Researching ${RESEARCH[store.researchJob().id].name} Lv ${store.researchJob().toLevel}: ${fmtClock(store.researchLeft())} left` : `Research node cap Lv ${lv} → ${lv + 1}  ·  Archive idle`),
      }[id];
      lines = [
        `Power contribution:  +${now}   →  +${next} at Lv ${lv + 1}`,
        extra,
        `Level cap:  Lv ${store.buildingLevelCap()}  (Beacon Lv ${s.beacon.level} + 2)`,
        info.job ? `Upgrading to Lv ${info.job.toLevel}:  ${fmtClock(info.job.total - info.job.progress)} left` : `Upgrade:  ${fmt(info.cost)} Energy  ·  takes ${fmtClock(info.seconds)}`,
      ];
      const power = { icon: 'hud-power', label: 'Power', a: `+${now}`, b: `+${next}`, up: next > now };
      const rj = store.researchJob();
      const per = {
        barracks: [
          { glyph: 'lanes', label: 'Lanes', a: `${BARRACKS.laneCapacity(lv)}`, b: `${BARRACKS.laneCapacity(lv + 1)}`, up: true },
          { glyph: 'speed', label: 'Speed', a: `x${BARRACKS.trainSpeed(lv).toFixed(1)}`, b: `x${BARRACKS.trainSpeed(lv + 1).toFixed(1)}`, up: BARRACKS.trainSpeed(lv + 1) > BARRACKS.trainSpeed(lv) },
        ],
        commandCenter: [
          { glyph: 'squad', label: 'Squad level cap', a: `Lv ${lv}`, b: `Lv ${lv + 1}`, up: true },
          { icon: 'hud-alloy', label: 'Alloy', a: `${(store.alloyRate * 3600).toFixed(0)}/h`, b: null },
        ],
        armory: [
          { icon: 'hud-core', label: 'Beacon Cores', a: `${fmt(s.resources.cores)}  ·  pulls`, b: null },
          { icon: 'hud-shards', label: 'Shards', a: `${fmt(s.resources.shards)}  (+${(store.shardRate * 3600).toFixed(0)}/h)`, b: null },
        ],
        infirmary: [
          { glyph: 'beds', glyphColor: SKIN.green, label: 'Beds', a: `${store.woundedTotal()}/${store.infirmaryCapacity()}`, b: `${Math.floor(INFIRMARY.capacity(lv + 1) * store.mods.beds)}`, up: true },
          { glyph: 'speed', glyphColor: SKIN.green, label: 'Heal speed', a: `x${store.healSpeed().toFixed(2)}`, b: `x${(INFIRMARY.healSpeed(lv + 1) * store.mods.healSpeed).toFixed(2)}`, up: true },
        ],
        archive: !store.archiveUnlocked()
          ? [{ glyph: 'lock', label: 'Sealed', a: `until Beacon Lv ${def.unlockBeacon}`, b: null }, { glyph: 'research', glyphColor: 0xb07cff, label: 'Research', a: 'none yet', b: null }]
          : [
            { glyph: 'research', glyphColor: 0xb07cff, label: 'Node cap', a: `Lv ${lv}`, b: `Lv ${lv + 1}`, up: true },
            { glyph: 'clock', glyphColor: 0xb07cff, label: rj ? RESEARCH[rj.id].name : 'Archive', a: rj ? `${fmtClock(store.researchLeft())} left` : 'idle', b: null },
          ],
      }[id];
      rows = [power, ...per];
      this.pMove.setVisible(true);
      this.pOpen.setVisible(true).setLabel({ barracks: 'Train', armory: 'Recruit', commandCenter: 'Squads', infirmary: 'Heal', archive: 'Research' }[id]);
      this.pUpgrade.setPosition(r.x + 22 + 130, this.pUpgrade.y);
      this.pCap.setText(`Cap Lv ${store.buildingLevelCap()}`);
    }
    this.pStats.setText(lines.join('\n'));
    // stat rows: swap the icon only when it changes
    rows.forEach((row, i) => {
      const key = row.icon ?? `g:${row.glyph}:${row.glyphColor ?? ''}`;
      if (this.pRowIcons[i]?.key !== key) {
        this.pRowIcons[i]?.obj.destroy();
        const R = this.panelRect, yy = R.y + 190 + i * 58 + 25, xx = R.x + 22 + 30;
        let obj;
        if (row.icon) { obj = this.add.image(xx, yy, row.icon); obj.setScale(36 / Math.max(obj.width, obj.height)); }
        else { obj = this.add.graphics(); glyph(obj, row.glyph, xx, yy, 15, row.glyphColor ?? SKIN.gold); }
        this.panel.add(obj);
        this.pRowIcons[i] = { key, obj };
      }
      this.pRows[i].set({ label: row.label, a: row.a, b: row.b, up: !!row.up && !!row.b });
    });
    // level plaque "Lv 5 → 6"
    const lvTxt = `Lv ${lv}${info.job ? `  →  ${info.job.toLevel}` : `  →  ${lv + 1}`}`;
    if (this.pLevel.text !== lvTxt) {
      this.pLevel.setText(lvTxt);
      const px = this.pLevel.x - 18, py = this.pLevel.y - 22, pw = this.pLevel.width + 36, ph = 44;
      this.pLvG.clear();
      this.pLvG.fillStyle(SKIN.goldDk, 1).fillPoints(oct(px - 2, py - 2, pw + 4, ph + 4, 10), true);
      this.pLvG.fillGradientStyle(SKIN.goldHi, SKIN.goldHi, SKIN.goldMid, SKIN.goldMid, 1, 1, 1, 1).fillPoints(oct(px, py, pw, ph, 9), true);
      this.pLvG.fillGradientStyle(0x4a3412, 0x4a3412, 0x1c1306, 0x1c1306, 1, 1, 1, 1).fillPoints(oct(px + 3, py + 3, pw - 6, ph - 6, 7), true);
    }
    const bar = this.pBar;
    bar.clear();
    if (info.job) {
      // countdown bar in the panel; the button becomes Cancel (full refund)
      const pct = Math.min(1, info.job.progress / info.job.total), bx = r.x + 22, by = r.y + 400, bw = r.width - 44;
      drawBar(bar, bx, by, bw, 18, pct, { color: SKIN.gold });
      this.pJob.setText(`Upgrading to Lv ${info.job.toLevel}  ·  ${fmtClock(info.job.total - info.job.progress)} left`).setVisible(true);
      this.pCost.setVisible(false); this.pTime.setVisible(false);
      this.pCap.setVisible(false);
      this.pUpgrade.setLabel(`Cancel  ·  refund ${fmt(info.job.cost)}`).setStyle('danger').setEnabled(true);
      this.pReason.setText('');
    } else {
      this.pJob.setVisible(false);
      this.pCost.setVisible(true); this.pTime.setVisible(true);
      this.pCap.setVisible(true);
      const costStr = `${fmt(info.cost)} Energy${id === BEACON.id ? ' + full charge' : ''}`;
      const okE = s.resources.energy >= info.cost;
      if (this.pCost.t.text !== costStr || this.pCost.okE !== okE) { this.pCost.set(costStr, okE); this.pCost.okE = okE; }
      const tStr = fmtClock(info.seconds);
      if (this.pTime.t.text !== tStr) this.pTime.set(tStr);
      this.pUpgrade.setLabel('Upgrade').setStyle('gold').setEnabled(info.can);
      this.pReason.setText(info.reason ? `⚠ ${info.reason}` : '');
    }
  }

  doUpgrade() {
    const id = this.panelOpenFor;
    if (!id) return;
    if (store.constructionJob(id)) {
      const c = store.cancelUpgrade(id);
      if (c.ok) this.toast(`Upgrade cancelled. Refunded ${fmt(c.refund)} Energy`);
    } else {
      const r = store.upgrade(id);
      if (!r.ok) this.toast(r.reason);
      else this.toast(`${store.nameOf(id)} upgrading to Lv ${r.toLevel} (${fmtClock(r.seconds)})`, 1800);
    }
    this.refreshPanel();
  }

  // ---------------------------------------------------- move banner -----
  createBanner() {
    const x = 16, y = TOP_H + 14, w = W - 32, h = 84;
    this.bannerRect = new Phaser.Geom.Rectangle(x, y, w, h);
    const c = this.banner = this.add.container(0, 0).setVisible(false).setDepth(9);
    const g = this.add.graphics();
    panelBg(g, x, y, w, h, { accent: PALETTE.cyan, stroke: PALETTE.cyan, fill: 0x0c1a1f });
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    this.bannerText = text(this, x + 22, y + 14, '', 23, PALETTE.textCyan, { fontStyle: 'bold' });
    this.bannerSub = text(this, x + 22, y + 46, 'Drag it onto open ground', 18, PALETTE.textDim);
    this.bannerDone = button(this, x + w - 80, y + h / 2, 130, 58, 'Done', () => this.game.events.emit('ui:moveDone'), { style: 'cyan', size: 24 });
    this.bannerPlace = button(this, x + w - 80, y + h / 2, 130, 58, 'Place', () => this.game.events.emit('ui:placeConfirm'), { style: 'gold', size: 24 });
    this.bannerPlace.chip = 'place-confirm';
    this.bannerLater = button(this, x + w - 220, y + h / 2, 120, 58, 'Later', () => this.game.events.emit('ui:moveDone'), { style: 'ghost', size: 22 });
    this.bannerLater.chip = 'place-later';
    c.add([g, block, this.bannerText, this.bannerSub, this.bannerDone, this.bannerPlace, this.bannerLater]);
  }
  showBanner(id, o = {}) {
    if (!id) { this.banner.setVisible(false); return; }
    const placing = !!o?.placing;
    this.bannerText.setText(placing ? `Build the ${BUILDINGS[id].name}` : `Moving ${BUILDINGS[id].name}`);
    this.bannerSub.setText(placing ? 'Drag it or tap the ground, then Place' : 'Drag it onto open ground');
    this.bannerDone.setVisible(!placing);
    this.bannerPlace.setVisible(placing).setEnabled(o?.valid !== false);
    this.bannerLater.setVisible(placing);
    this.banner.setVisible(true);
  }

  // ---------------------------------------------------------- modal -----
  openModal({ title, body, buttons, tab }) {
    this.closeModal();
    const c = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x020305, 0.7).setInteractive();
    const w = 620, h = 420, x = (W - w) / 2, y = (H - h) / 2 - 40;
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    for (let k = 0; k < 5; k++) g.lineStyle(2, SKIN.gold, 0.7 - k * 0.13).lineBetween(x + 30 + k * (w - 60) / 5, y + 86, x + 30 + (k + 1) * (w - 60) / 5, y + 86);
    diamond(g, x + 30, y + 86, 5);
    const t = text(this, x + 32, y + 30, title, 36, '#ffd27f', { fontStyle: 'bold', stroke: '#2e1e06', strokeThickness: 4 });
    const b = text(this, x + 32, y + 106, body, 23, PALETTE.text, { wordWrap: { width: w - 64 }, lineSpacing: 6 });
    c.add([dim, g, t, b]);
    const bw = (w - 64 - (buttons.length - 1) * 20) / buttons.length;
    buttons.forEach((btn, i) => {
      c.add(button(this, x + 32 + bw / 2 + i * (bw + 20), y + h - 66, bw, 80, btn.label, () => {
        if (!btn.keepOpen) this.closeModal();
        btn.onClick?.();
      }, { style: btn.style ?? 'ghost', size: 26 }));
    });
    c.alpha = 0;
    this.tweens.add({ targets: c, alpha: 1, duration: 140 });
    this.modal = c;
    if (tab) { this.activeTab = tab; this.drawNav(); }
  }
  closeModal() {
    if (this.modal) { this.tweens.killTweensOf(this.modal); this.modal.destroy(); this.modal = null; }
    const want = this.tabFor(this.screen?.id) ?? (this.worldMode ? 'world' : 'base');
    if (this.activeTab !== want) { this.activeTab = want; this.drawNav(); }
  }

  // Settings: audio (music / effects volume, mute), haptics, tutorial replay, version + Reset Save.
  openSettings() {
    this.openOverlay({
      title: 'Settings', h: 1060, tab: 'more',
      build: (c, r, close) => {
        const x0 = r.x + 32, xr = r.x + r.w - 32;
        const g = this.add.graphics(); c.add(g);
        const S = () => store.state.settings;
        sectionHeader(this, c, x0, r.y + 92, 'AUDIO', { w: r.w - 64 });
        const rows = [['music', 'Music', 'synth score: base · world · battle'], ['sfx', 'Effects', 'taps, builds, battles, rewards']];
        const vals = {}, bars = {};
        rows.forEach(([key, name, sub], i) => {
          const y = r.y + 136 + i * 118;
          c.add(text(this, x0, y, name, 26, PALETTE.text, { fontStyle: 'bold' }));
          c.add(text(this, x0, y + 34, sub, 15, PALETTE.textDim));
          vals[key] = text(this, xr - 150, y + 2, '', 26, PALETTE.textCyan, { fontStyle: 'bold' }).setOrigin(0.5, 0); c.add(vals[key]);
          const dn = button(this, xr - 236, y + 16, 64, 56, '−', () => store.setSetting(key, S()[key] - AUDIO.step), { style: 'ghost', size: 30 }); dn.chip = `${key}-down`;
          const up = button(this, xr - 32, y + 16, 64, 56, '+', () => { store.setSetting(key, S()[key] + AUDIO.step); if (key === 'sfx') audio.play('reward'); }, { style: 'ghost', size: 30 }); up.chip = `${key}-up`;
          c.add([dn, up]);
          bars[key] = { x: x0, y: y + 66, w: r.w - 64 };
        });
        const mute = button(this, x0 + 150, r.y + 400, 300, 64, '', () => store.setSetting('muted', !S().muted), { style: 'cyan', size: 22 }); mute.chip = 'mute';
        const hap = button(this, xr - 150, r.y + 400, 300, 64, '', () => { store.setSetting('haptics', !S().haptics); audio.haptic(20); }, { style: 'cyan', size: 22 }); hap.chip = 'haptics';
        c.add([mute, hap]);
        c.add(text(this, x0, r.y + 444, 'Sound starts after your first tap (browser rule) and pauses when the game is hidden. Haptics need a phone that supports vibration.', 15, PALETTE.textDim, { wordWrap: { width: r.w - 64 } }));
        // tutorial
        sectionHeader(this, c, x0, r.y + 520, 'TUTORIAL', { w: r.w - 64 });
        const tuS = text(this, x0, r.y + 556, '', 19, PALETTE.text); c.add(tuS);
        const rep = button(this, xr - 150, r.y + 566, 300, 64, 'Replay Tutorial', () => {
          store.replayTutorial(); close(); this.closeScreen(); this.hideWorld();
          this.toast('Tutorial restarted. Follow the gold pointer.', 2200);
        }, { style: 'gold', size: 22 }); rep.chip = 'replay-tutorial'; c.add(rep);
        // game
        sectionHeader(this, c, x0, r.y + 650, 'GAME', { w: r.w - 64 });
        c.add(text(this, x0, r.y + 686, 'Broken Dawn · v0.9 (stage 9: painted menus)\nProgress saves automatically on this device. PvP: coming later.\nReset Save erases everything: base, troops, squads, leaders, gear,\nresearch and the world.', 17, PALETTE.textDim, { lineSpacing: 5 }));
        const rs = button(this, r.x + r.w / 2, r.y + 836, 300, 64, 'Reset Save', () => this.confirmReset(), { style: 'danger', size: 22 }); c.add(rs);
        this.refreshSettings = () => {
          if (!c.active) { this.refreshSettings = null; return; }
          const s = S();
          g.clear();
          for (const key of ['music', 'sfx']) {
            const b = bars[key], v = s[key];
            vals[key].setText(`${Math.round(v * 100)}%`).setColor(s.muted ? '#5d6878' : PALETTE.textCyan);
            drawBar(g, b.x, b.y, b.w, 16, v, { color: s.muted ? 0x3a414c : (key === 'music' ? PALETTE.gold : SKIN.teal) });
          }
          mute.setLabel(s.muted ? '🔇 Sound: Muted' : '🔊 Sound: On').setStyle(s.muted ? 'danger' : 'cyan');
          hap.setLabel(s.haptics ? '📳 Haptics: On' : '📴 Haptics: Off').setStyle(s.haptics ? 'cyan' : 'ghost');
          const t = store.state.tutorial;
          tuS.setText(t.done ? (t.skipped ? `Skipped at step ${t.step + 1} of ${TUTORIAL.steps}` : 'Completed') : `In progress: step ${t.step + 1} of ${TUTORIAL.steps}`).setColor(t.done ? PALETTE.textDim : PALETTE.textGold);
        };
        this.refreshSettings();
      },
    });
  }
  confirmReset() {
    this.openModal({
      title: 'Reset all progress?',
      body: 'This permanently erases your base, troops, squads, leaders, gear and all resources. This can\'t be undone.',
      tab: 'more',
      buttons: [
        { label: 'Cancel', style: 'ghost' },
        { label: 'Reset', style: 'danger', onClick: () => { store.reset(); this.closeScreen(); this.toast('Save reset. Fresh start, Commander.'); } },
      ],
    });
  }

  // ---------------------------------------------------------- toast -----
  createToast() {
    this.toastBox = this.add.container(W / 2, H - NAV_H - HERO_RISE - 52).setDepth(400).setVisible(false);
    this.toastBg = this.add.graphics();
    this.toastText = text(this, 0, 0, '', 22, PALETTE.text, { align: 'center', wordWrap: { width: W - 120 } }).setOrigin(0.5);
    this.toastBox.add([this.toastBg, this.toastText]);
  }
  toast(msg, ms = 2200) {
    (this.toastLog ??= []).push(msg); if (this.toastLog.length > 8) this.toastLog.shift(); // recent toasts (tests / debugging)
    this.toastText.setText(msg);
    audio.play('toast', { gap: 250 });
    const w = Math.min(W - 60, this.toastText.width + 48), h = this.toastText.height + 30;
    this.toastBg.clear(); drawFrame(this.toastBg, -w / 2, -h / 2, w, h, { cut: 10, studs: false, alpha: 0.95 });
    // lift above the panel if it's open
    this.toastBox.y = this.panel.visible ? this.panelRect.y - h / 2 - 12 : H - NAV_H - HERO_RISE - 52;
    this.children.bringToTop(this.toastBox);
    this.tweens.killTweensOf(this.toastBox);
    this.toastBox.setVisible(true).setAlpha(1);
    this.tweens.add({ targets: this.toastBox, alpha: 0, delay: ms, duration: 400, onComplete: () => this.toastBox.setVisible(false) });
  }

  bump(t) { this.tweens.add({ targets: t, scale: 1.18, duration: 120, yoyo: true }); }

  // Floating reward number that pops, rises and fades (game coords).
  floatText(x, y, str, color = PALETTE.textGold, size = 30) {
    const t = text(this, x, y, str, size, color, { fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(420).setScale(0.4);
    this.fx.floats++;
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 70, alpha: 0, delay: 350, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
    return t;
  }

  // Idle frame cap: Phaser runs with an fps limiter whose rate we switch between ~unlimited and 30.
  updateFrameCap() {
    const loop = this.game.loop;
    if (!loop.hasFpsLimit) return;
    const idle = performance.now() - this.lastInput > PERF.idleMs && !this.replay && !this.reveal && !this.modal;
    if (idle !== this.idleCapped) {
      this.idleCapped = idle;
      loop._limitRate = idle ? 1000 / (PERF.idleFps + 2) : 0;
    }
  }

  update(_t, dtMs) {
    store.tick(Math.min(dtMs, 1000) / 1000);
    this.tutorial.update(dtMs);
    this.updateFrameCap();
    const s = store.state, p = store.power;
    this.energyText.setText(fmt(s.resources.energy));
    this.rateText.setText(`+${store.energyRate.toFixed(2)}/s`);
    this.powerText.setText(fmt(p.total));
    this.powerSub.setText(`Bldg ${fmt(p.building)} · Troops ${fmt(p.troop)}`);
    const pct = s.beacon.charge / BEACON.maxCharge;
    this.beaconLv.setText(`BEACON Lv ${s.beacon.level}`);
    this.avatarLv.setText(String(s.beacon.level));
    this.chargeText.setText(pct >= 1 ? 'FULL' : `${Math.floor(pct * 100)}%`).setColor(pct >= 1 ? PALETTE.textGold : PALETTE.textDim);
    const bar = this.chargeBar, by = SAFE.top + 160; bar.clear();
    bar.fillStyle(0x05070a, 1).fillRect(20, by, 112, 7);
    bar.fillStyle(pct >= 1 ? PALETTE.gold : PALETTE.orange, 1).fillRect(20, by, 112 * pct, 7);
    if (pct >= 1) bar.fillStyle(0xffffff, 0.25 + 0.25 * Math.sin(this.time.now / 200)).fillRect(20, by, 112, 7);
    bar.lineStyle(1, PALETTE.metalEdge, 1).strokeRect(20, by, 112, 7);

    this.coreText.setText(fmt(s.resources.cores));
    this.shardText.setText(fmt(s.resources.shards));
    this.alloyText.setText(fmt(s.resources.alloy));
    const q = store.queuedUnits();
    const tot = TROOP_IDS.reduce((n, t) => n + s.troops[t], 0);
    this.troopText.setText(`${fmt(tot)}${q ? ` (+${q})` : ''}`);

    this.panelTimer += dtMs;
    if (this.panelTimer > 200) {
      this.panelTimer = 0;
      if (this.panelOpenFor) this.refreshPanel();
      const ready = store.rewardsReady();
      if (ready !== this.rewardsReadyCount) {
        const bx = this.corePlus.x + 18, by = this.corePlus.y - 20;
        this.coreBadge.clear();
        this.coreBadgeText.setText(ready ? String(ready) : '').setPosition(bx, by);
        if (ready) this.coreBadge.fillStyle(0xe0263c, 1).fillCircle(bx, by, 12).lineStyle(2, 0xffd0d6, 0.9).strokeCircle(bx, by, 12);
      }
      this.refreshNavBadges();
      if (this.tip && this.time.now > this.tip.until) this.hideTip();
      this.refreshSide();
      refreshRightColumn(this);
      this.refreshPlaceChip();
      this.rewardsReadyCount = ready;
      if (this.screen) {
        if (this.screenDirty && !this.modal && !this.reveal) this.renderScreen();
        else this.screen.dyn.forEach((fn) => fn());
      }
      if (this.worldMode) this.worldHud.refresh();
      audio.setTrack(this.replay ? 'battle' : this.worldMode ? 'world' : 'base');
    }
  }
}
