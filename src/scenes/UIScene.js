import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H, PALETTE, BEACON, BUILDINGS, ECONOMY, BARRACKS, TROOP_CLASSES, TROOP_IDS, SQUADS, TROOPS } from '../config.js';
import { fmtClock } from '../ui/widgets.js';
import { store } from '../state/store.js';
import { buildingPower } from '../systems/power.js';
import { text, fmt, fmtDuration, panelBg, button } from '../ui/widgets.js';
import { renderTroops } from '../ui/screens/troops.js';
import { renderSquads } from '../ui/screens/squads.js';
import { renderArmory, resultTag, drawCoreIcon } from '../ui/screens/armory.js';
import { gearTexture } from '../art/portraits.js';
import { RARITY, LEADERS, GEAR, CORES, INFIRMARY, STAMINA, CREATURES, SQUADS as SQ } from '../config.js';
import { renderInfirmary } from '../ui/screens/infirmary.js';
import { renderArchive } from '../ui/screens/archive.js';
import { RESEARCH } from '../config.js';
import { createWorldHud, openReport } from '../ui/world.js';
import { audio } from '../audio/audio.js';
import { Tutorial } from '../tutorial/tutorial.js';
import { PERF, AUDIO, TUTORIAL } from '../config.js';

export const TOP_H = 186;
const NAV_H = 130;
const TABS = [
  { id: 'base', label: 'Base' },
  { id: 'world', label: 'World' },
  { id: 'troops', label: 'Troops' },
  { id: 'armory', label: 'Armory' },
  { id: 'squads', label: 'Squads' },
  { id: 'settings', label: 'Settings' },
];
const SCREENS = { troops: renderTroops, squads: renderSquads, armory: renderArmory, infirmary: renderInfirmary, archive: renderArchive };

export default class UIScene extends Phaser.Scene {
  constructor() { super('UI'); }

  create() {
    this.panelOpenFor = null;
    this.modal = null;
    this.screen = null;        // { id, container, dyn: [fn] }
    this.screenState = { armoryTab: 'recruit', squadId: 'alpha', edit: null };
    this.reveal = null;
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
        if (d.after > d.before) { this.bump(this.powerText); this.floatText(330, 120, `+${fmt(d.after - d.before)}`, PALETTE.textGold); }
        if (!store.simulating) audio.play('train', { gap: 400 });
      }),
      store.on('trainStart', () => audio.play('train', { gap: 150 })),
      store.on('pull', () => audio.play('open')),
      store.on('cores', (n) => { if (store.simulating) return; audio.play('reward'); audio.haptic(12); this.floatText(80, 140, `+${n}`, CORES.hex); }),
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
      store.on('healed', (h) => { const n = Object.values(h).reduce((a, b) => a + b, 0); if (n && !this.screen) this.bumpTroops = true; if (n && !store.simulating) audio.play('heal', { gap: 600 }); }),
      store.on('march', () => audio.play('march')),
      store.on('unlocked', (id) => this.onUnlocked(id)),
      store.on('placed', (id) => { audio.play('levelup'); this.toast(`${BUILDINGS[id].name} built. Tap it to open.`, 2000); }),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));

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
      this.time.delayedCall(off && off.energy >= 1 ? 5200 : 500, () => this.toast('New: sound, music and a tutorial. Replay the tutorial any time from Settings.', 4200));
    }
    this.panelTimer = 0;
  }

  // Lets BaseScene know a screen point belongs to the UI.
  blocksPointer(x, y) {
    if (this.modal || this.screen || this.reveal || this.replay) return true;
    if (y < TOP_H || y > H - NAV_H) return true;
    if (this.worldHud?.blocks(x, y)) return true;
    if (this.tutorial?.blocks(x, y)) return true;
    if (this.panel.visible && Phaser.Geom.Rectangle.Contains(this.panelRect, x, y)) return true;
    if (this.banner.visible && Phaser.Geom.Rectangle.Contains(this.bannerRect, x, y)) return true;
    if (this.placeChip?.visible && Phaser.Geom.Rectangle.Contains(this.placeChipRect, x, y)) return true;
    if (this.sideBlocks(x, y)) return true;
    return false;
  }

  // ------------------------------------------------------------ HUD -----
  createTopBar() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x0b0e13, 0x0b0e13, 0x0b0e13, 0x0b0e13, 0.97, 0.97, 0.88, 0.88).fillRect(0, 0, W, TOP_H);
    g.lineStyle(2, PALETTE.gold, 0.6).lineBetween(0, TOP_H, W, TOP_H);
    g.lineStyle(6, PALETTE.gold, 0.12).lineBetween(0, TOP_H, W, TOP_H);
    this.add.rectangle(W / 2, TOP_H / 2, W, TOP_H, 0, 0.001).setInteractive(); // swallow taps

    // Commander avatar (tap -> Base Power breakdown) with the Beacon level as the commander badge
    const ax = 66, ay = 66, ar = 52;
    g.fillStyle(0x05070a, 1).fillCircle(ax, ay, ar + 6);
    const av = this.add.image(ax, ay, 'art-avatar').setDisplaySize(ar * 2, ar * 2);
    g.lineStyle(5, PALETTE.gold, 1).strokeCircle(ax, ay, ar + 3);
    this.hudFront = this.add.graphics();
    this.hudFront.fillStyle(PALETTE.gold, 1).fillCircle(ax + 40, ay + 42, 18).lineStyle(3, 0x2a1a06, 1).strokeCircle(ax + 40, ay + 42, 18);
    this.avatarLv = text(this, ax + 40, ay + 42, '1', 18, '#140d04', { fontStyle: 'bold' }).setOrigin(0.5);
    this.avatar = av;
    const avHit = this.add.circle(ax, ay, ar + 6, 0, 0.001).setInteractive({ useHandCursor: true });
    avHit.on('pointerup', () => this.openPowerBreakdown());

    // Commander + Base Power (tap -> breakdown)
    text(this, 138, 14, 'COMMANDER', 15, PALETTE.textDim, { letterSpacing: 3 });
    g.fillStyle(PALETTE.gold, 1).fillPoints([{ x: 152, y: 46 }, { x: 170, y: 51 }, { x: 170, y: 72 }, { x: 161, y: 92 }, { x: 152, y: 72 }], true);
    g.fillStyle(PALETTE.gold, 0.6).fillPoints([{ x: 152, y: 46 }, { x: 152, y: 72 }, { x: 161, y: 92 }, { x: 142, y: 72 }, { x: 142, y: 51 }], true);
    this.powerText = text(this, 182, 40, '0', 40, PALETTE.textGold, { fontStyle: 'bold' });
    text(this, 182, 30, 'POWER', 13, PALETTE.textGold, { letterSpacing: 3 }).setVisible(false);
    this.powerSub = text(this, 140, 98, 'Bldg 0 · Troops 0', 16, PALETTE.textDim);
    const powerHit = this.add.rectangle(290, 70, 320, 112, 0, 0.001).setInteractive({ useHandCursor: true });
    powerHit.on('pointerup', () => this.openPowerBreakdown());

    // Beacon pill (tappable -> beacon info)
    panelBg(g, 466, 14, 240, 104, { accent: null, cut: 12, fill: 0x141922 });
    text(this, 484, 24, 'BEACON', 15, PALETTE.textDim, { letterSpacing: 2 });
    this.beaconLv = text(this, 690, 22, 'Lv 1', 20, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(1, 0);
    this.chargeBar = this.add.graphics();
    this.chargeText = text(this, 484, 86, 'Charge 0%', 17, PALETTE.textDim);
    const beaconHit = this.add.rectangle(466 + 120, 66, 240, 104, 0, 0.001).setInteractive({ useHandCursor: true });
    beaconHit.on('pointerup', () => { this.closeScreen(); this.hideWorld(); this.game.events.emit('ui:focus', BEACON.id); this.game.events.emit('ui:focusBeacon'); });

    // Resource row: Energy (+rate), Beacon Cores (tap -> rewards), Shards, Alloy, Troops (+ training)
    const ry = 130, rh = 44, cy = ry + rh / 2;
    const slots = [['energy', 8, 168], ['cores', 182, 118], ['shards', 306, 128], ['alloy', 440, 112], ['troops', 558, 154]];
    const X = {};
    for (const [id, x, w] of slots) {
      g.fillStyle(0x05070a, 0.85).fillRoundedRect(x, ry, w, rh, 14);
      g.lineStyle(1.5, PALETTE.metalEdge, 0.7).strokeRoundedRect(x, ry, w, rh, 14);
      X[id] = { x, w };
    }
    const ex = X.energy.x + 22;
    g.fillStyle(PALETTE.cyan, 1).fillPoints([{ x: ex + 4, y: cy - 16 }, { x: ex - 7, y: cy + 2 }, { x: ex, y: cy + 2 }, { x: ex - 4, y: cy + 17 }, { x: ex + 9, y: cy - 4 }, { x: ex + 2, y: cy - 4 }, { x: ex + 8, y: cy - 16 }], true);
    this.energyText = text(this, ex + 18, cy, '0', 22, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.rateText = text(this, X.energy.x + X.energy.w - 10, cy, '+1.0/s', 14, PALETTE.textCyan).setOrigin(1, 0.5);
    drawCoreIcon(g, X.cores.x + 22, cy, 12);
    this.coreText = text(this, X.cores.x + 42, cy, '0', 22, CORES.hex, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.coreBadge = this.add.graphics();
    const coreHit = this.add.rectangle(X.cores.x + X.cores.w / 2, cy, X.cores.w, rh, 0, 0.001).setInteractive({ useHandCursor: true });
    coreHit.on('pointerup', () => this.openRewards());
    this.coreHit = coreHit;
    const sx = X.shards.x + 22;
    g.fillStyle(0xc58aff, 1).fillPoints([{ x: sx, y: cy - 14 }, { x: sx + 10, y: cy }, { x: sx, y: cy + 14 }, { x: sx - 10, y: cy }], true);
    this.shardText = text(this, sx + 20, cy, '0', 22, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    const axx = X.alloy.x + 24;
    g.fillStyle(0x9fb4c8, 1).fillPoints([{ x: axx, y: cy - 13 }, { x: axx + 12, y: cy - 7 }, { x: axx + 12, y: cy + 7 }, { x: axx, y: cy + 13 }, { x: axx - 12, y: cy + 7 }, { x: axx - 12, y: cy - 7 }], true);
    this.alloyText = text(this, axx + 20, cy, '0', 22, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    const tx = X.troops.x + 22;
    g.lineStyle(3, PALETTE.blue, 1).strokeCircle(tx, cy - 6, 6);
    g.strokePoints([{ x: tx - 11, y: cy + 14 }, { x: tx - 8, y: cy + 5 }, { x: tx + 8, y: cy + 5 }, { x: tx + 11, y: cy + 14 }], false);
    this.troopText = text(this, tx + 20, cy, '0', 21, PALETTE.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.resX = X;
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
    const icon = this.add.graphics();
    draw(icon, ring);
    const arc = this.add.graphics();
    const cap = text(this, 0, r + 3, caption, 14, PALETTE.text, { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5, 0);
    const timer = text(this, 0, r + 30, '', 14, '#ffffff', { fontStyle: 'bold', stroke: '#05070a', strokeThickness: 4 }).setOrigin(0.5);
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

  // Left: queue buttons (builder, research, training, healing). Right: quick buttons.
  createSideColumns() {
    const r = 36, xl = 52, xr = W - 52, y0 = TOP_H + 116, dy = 114;
    const ic = {
      builder: (g, col) => { g.fillStyle(col, 1).fillRect(-14, -16, 22, 10).fillRect(-4, -8, 6, 26); g.fillRect(8, -14, 6, 6); },
      research: (g, col) => { g.lineStyle(3, col, 1).strokeCircle(0, -2, 14); g.strokeEllipse(0, -2, 34, 12); g.fillStyle(col, 1).fillCircle(0, -2, 4); },
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
    this.quickBtns = {
      hunt: this.roundButton(xr, y0, r, 'Hunt', 'k-hunt', ic.hunt, () => { this.closeModal(); this.closeScreen(); this.showWorld(); }, 0xff7a1a),
      rewards: this.roundButton(xr, y0 + dy, r, 'Rewards', 'k-rewards', ic.rewards, () => this.openRewards(), CORES.color),
      armory: this.roundButton(xr, y0 + dy * 2, r, 'Armory', 'k-armory', ic.armory, () => this.openScreen('armory'), PALETTE.cyan),
      events: this.roundButton(xr, y0 + dy * 3, r, 'Events', 'k-events', ic.events, () => this.toast('Events are coming soon, Commander.'), 0x8a96a8),
    };
    this.sideBtns = [...Object.values(this.queueBtns), ...Object.values(this.quickBtns)];
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
    for (const b of Object.values(this.quickBtns)) b.timer.setText('');
    const rb = this.quickBtns.rewards.badge; rb.clear();
    const ready = store.rewardsReady();
    if (ready) { rb.fillStyle(0xff3355, 1).fillCircle(26, -26, 12).lineStyle(2, 0xffffff, 0.9).strokeCircle(26, -26, 12); }
    this.quickBtns.rewards.timer.setText(ready ? `${ready}` : '').setPosition(26, -26);
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

  createNav() {
    const y0 = H - NAV_H;
    const g = this.add.graphics();
    g.fillStyle(0x0b0e13, 0.98).fillRect(0, y0, W, NAV_H);
    g.lineStyle(2, PALETTE.metalEdge, 0.8).lineBetween(0, y0, W, y0);
    this.add.rectangle(W / 2, y0 + NAV_H / 2, W, NAV_H, 0, 0.001).setInteractive();
    this.navIcons = this.add.graphics();
    this.tabs = TABS.map((tab, i) => {
      const cx = (W / TABS.length) * (i + 0.5);
      const label = text(this, cx, y0 + 84, tab.label, 20, PALETTE.textDim, { fontStyle: 'bold' }).setOrigin(0.5, 0);
      const hit = this.add.rectangle(cx, y0 + NAV_H / 2, W / TABS.length, NAV_H, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.onTab(tab.id));
      return { ...tab, cx, label };
    });
    this.activeTab = 'base';
    this.drawNav();
  }

  drawNav() {
    const g = this.navIcons; g.clear();
    const y = H - NAV_H + 46;
    for (const t of this.tabs) {
      const on = t.id === this.activeTab;
      const col = on ? PALETTE.gold : 0x6c788a;
      t.label.setColor(on ? PALETTE.textGold : PALETTE.textDim);
      if (on) { g.fillStyle(PALETTE.gold, 0.12).fillRect(t.cx - W / TABS.length / 2, H - NAV_H, W / TABS.length, NAV_H); g.fillStyle(PALETTE.gold, 1).fillRect(t.cx - 36, H - NAV_H, 72, 4); }
      g.lineStyle(3, col, 1); g.fillStyle(col, 1);
      const x = t.cx;
      switch (t.id) {
        case 'base': g.strokePoints([{ x, y: y - 20 }, { x: x + 24, y: y - 6 }, { x, y: y + 8 }, { x: x - 24, y: y - 6 }], true); g.fillCircle(x, y - 22, 5); g.lineBetween(x, y - 18, x, y - 6); break;
        case 'world': g.strokeCircle(x, y - 6, 16); g.strokeEllipse(x, y - 6, 14, 32); g.lineBetween(x - 16, y - 6, x + 16, y - 6); break;
        case 'troops': g.strokeCircle(x, y - 14, 8); g.strokePoints([{ x: x - 16, y: y + 12 }, { x: x - 12, y: y - 2 }, { x: x + 12, y: y - 2 }, { x: x + 16, y: y + 12 }], false); break;
        case 'armory': g.strokePoints([{ x, y: y - 24 }, { x: x + 12, y: y - 6 }, { x, y: y + 12 }, { x: x - 12, y: y - 6 }], true); break;
        case 'squads': for (const dx of [-14, 0, 14]) g.strokeCircle(x + dx, y - 6 + (dx ? 6 : -4), 7); break;
        case 'settings': g.strokeCircle(x, y - 6, 9); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.lineBetween(x + Math.cos(a) * 12, y - 6 + Math.sin(a) * 12, x + Math.cos(a) * 17, y - 6 + Math.sin(a) * 17); } break;
        default:
      }
    }
  }

  onTab(id) {
    if (this.reveal) return;
    this.closeReplay?.();
    if (id === 'base') { this.closeModal(); this.closeScreen(); this.hideWorld(); return; }
    if (id === 'world') { this.closeModal(); this.closeScreen(); this.showWorld(); return; }
    if (id === 'settings') { this.openSettings(); return; }
    this.openScreen(id);
  }

  // ------------------------------------------------- full screens -----
  get area() { return { x: 0, y: TOP_H, w: W, h: H - TOP_H - NAV_H }; }

  openScreen(id, opts = {}) {
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
    this.activeTab = id; this.drawNav();
    this.renderScreen();
  }

  renderScreen() {
    if (!this.screen) return;
    const c = this.screen.container;
    c.removeAll(true);
    const a = this.area;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1117, 0x0d1117, 0x07090d, 0x07090d, 0.985, 0.985, 0.985, 0.985).fillRect(a.x, a.y, a.w, a.h);
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
    this.activeTab = this.screen?.id ?? 'base'; this.drawNav();
  }

  // A hunt finished: manual attacks pop the report card (if nothing else is open), Auto ones just toast.
  onHunt(r) {
    const T = CREATURES[r.target.type];
    if (r.loot.cores) this.bump(this.coreText);
    if (!store.simulating) {
      audio.play(r.win ? 'win' : 'lose', { gap: 300 });
      if (r.win) { this.floatText(120, 120, `+${fmt(r.loot.energy)}`, PALETTE.textCyan); if (r.loot.cores) this.floatText(70, 150, `+${r.loot.cores} Core`, CORES.hex); }
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
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.66).setInteractive();
    const w = W - 48, x = 24;
    h = Math.min(h, H - 80);
    const y = Math.max(40, (H - h) / 2);
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    c.add([dim, g, block]);
    if (title) c.add(text(this, x + 28, y + 24, title, 32, PALETTE.textGold, { fontStyle: 'bold' }));
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
    c.add(text(this, W / 2, 150, results.length > 1 ? 'RECRUITMENT  ·  x10' : 'RECRUITMENT', 32, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 4 }).setOrigin(0.5));
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
      fg.fillStyle(0x0d1117, 1).fillRect(-CW / 2, -CH / 2, CW, CH);
      fg.fillStyle(R.color, 0.18).fillRect(-CW / 2, CH / 2 - CH * 0.28, CW, CH * 0.28);
      fg.lineStyle(single ? 5 : 3, R.color, 1).strokeRect(-CW / 2, -CH / 2, CW, CH);
      const key = r.kind === 'leader' ? `leader-${r.id}` : gearTexture(r.id);
      const art = this.add.image(0, -CH * 0.1, key);
      art.setScale(r.kind === 'leader' ? (CW - 12) / 200 : (CW * 0.8) / 120);
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
    const lines = [
      `Base Power ${fmt(p.total)} = Building ${fmt(p.building)} + Troop ${fmt(p.troop)}`,
      '',
      'BUILDING POWER',
      `  Beacon Relay  Lv ${s.beacon.level}:  +${buildingPower(BEACON.id, s.beacon.level)}`,
      ...Object.keys(BUILDINGS).map((id) => (BUILDINGS[id].unlockBeacon && s.beacon.level < BUILDINGS[id].unlockBeacon
        ? `  ${BUILDINGS[id].name}:  unlocks at Beacon Lv ${BUILDINGS[id].unlockBeacon}`
        : `  ${BUILDINGS[id].name}  Lv ${s.buildings[id].level}:  +${buildingPower(id, s.buildings[id].level)}`)),
      '',
      'TROOP POWER  (T1 1 · T2 2 · T3 4 per soldier, +10 per squad level above 1)',
      ...TROOP_IDS.filter((t) => TROOP_CLASSES[t].tier === 1 || s.troops[t] > 0).map((t) => `  ${TROOP_CLASSES[t].plural}: ${s.troops[t]}  →  +${s.troops[t] * TROOP_CLASSES[t].power * TROOPS.powerPerSoldier}`),
      `  Squad levels:  +${tp.levels}`,
    ];
    this.openOverlay({
      title: 'Base Power', h: 760,
      build: (c, r) => c.add(text(this, r.x + 28, r.y + 90, lines.join('\n'), 23, PALETTE.text, { lineSpacing: 8 })),
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
        c.add(text(this, x0, r.y + 112, 'DAILY LOGIN', 20, C.hex, { fontStyle: 'bold', letterSpacing: 2 }));
        const shown = di.claimed ? di.streak : di.streak - 1; // days already banked in this cycle
        const inCycle = shown <= 0 ? 0 : ((shown - 1) % D.streakEvery) + 1;
        for (let k = 0; k < D.streakEvery; k++) {
          const cx = x0 + 22 + k * 52, cy = r.y + 166;
          const done = k < inCycle, bonus = k === D.streakEvery - 1;
          g.fillStyle(done ? C.color : 0x141922, 1).fillCircle(cx, cy, 20);
          g.lineStyle(2, bonus ? PALETTE.gold : C.color, 1).strokeCircle(cx, cy, 20);
          c.add(text(this, cx, cy - 10, bonus ? `+${D.base + D.streakBonus}` : `${k + 1}`, 16, done ? '#ffffff' : (bonus ? PALETTE.textGold : PALETTE.textDim), { fontStyle: 'bold' }).setOrigin(0.5, 0));
        }
        c.add(text(this, x0, r.y + 196, di.claimed ? `Claimed today · ${di.streak}-day streak · come back tomorrow` : `Day ${di.streak} of your streak: +${di.reward}${di.reward > D.base ? ' (streak bonus!)' : ''}`, 17, PALETTE.text));
        const bd = button(this, xr - 90, r.y + 166, 180, 56, di.claimed ? 'Claimed' : `Claim +${di.reward}`, () => claimed(store.claimDaily()), { style: 'gold', size: 21 });
        bd.setEnabled(di.can); bd.chip = 'daily'; c.add(bd);
        // beacon levels
        const br = store.beaconRewards(), open = br.filter((b) => !b.claimed);
        c.add(text(this, x0, r.y + 244, 'BEACON LEVELS', 20, C.hex, { fontStyle: 'bold', letterSpacing: 2 }));
        c.add(text(this, x0, r.y + 274, `+${C.beaconLevel} Cores for each Beacon level reached, once each.\nBeacon Lv ${store.state.beacon.level}: ${br.length - open.length}/${br.length} claimed${open.length ? `, ${open.length} ready` : ''}. Next: Lv ${store.state.beacon.level + 1}.`, 17, PALETTE.text, { lineSpacing: 5 }));
        const bb = button(this, xr - 90, r.y + 262, 180, 56, open.length ? `Lv ${open[0].level} · +${C.beaconLevel}` : 'None ready', () => claimed(store.claimBeaconLevel(open[0].level)), { style: 'gold', size: 20 });
        bb.setEnabled(open.length > 0); bb.chip = open.length ? `beacon-${open[0].level}` : 'beacon-none'; c.add(bb);
        // milestones
        c.add(text(this, x0, r.y + 340, 'FIRST-TIME MILESTONES', 20, C.hex, { fontStyle: 'bold', letterSpacing: 2 }));
        store.milestones().forEach((m, i) => {
          const y = r.y + 376 + i * 66;
          g.fillStyle(0x12171f, 1).fillRect(x0, y, r.w - 56, 58);
          g.lineStyle(1, m.claimed ? 0x2e3540 : (m.done ? C.color : PALETTE.metalEdge), 1).strokeRect(x0, y, r.w - 56, 58);
          c.add(text(this, x0 + 14, y + 6, `${m.claimed ? '✓ ' : ''}${m.name}`, 19, m.claimed ? PALETTE.textDim : PALETTE.text, { fontStyle: 'bold' }));
          c.add(text(this, x0 + 14, y + 32, m.desc, 15, PALETTE.textDim));
          if (m.claimed) c.add(text(this, xr - 16, y + 18, `+${m.cores} claimed`, 17, PALETTE.textDim).setOrigin(1, 0));
          else {
            const b = button(this, xr - 84, y + 29, 150, 44, m.done ? `Claim +${m.cores}` : `+${m.cores}`, () => claimed(store.claimMilestone(m.id)), { style: m.done ? 'gold' : 'ghost', size: 19 });
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
    const x = 16, w = W - 32, h = 452, y = H - NAV_H - h - 12;
    this.panelRect = new Phaser.Geom.Rectangle(x, y, w, h);
    const c = this.panel = this.add.container(0, 0).setVisible(false).setDepth(10);
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    const block = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0, 0.001).setInteractive();
    this.pTitle = text(this, x + 28, y + 26, '', 36, PALETTE.textGold, { fontStyle: 'bold' });
    this.pLevel = text(this, x + w - 90, y + 32, '', 26, PALETTE.text, { fontStyle: 'bold' }).setOrigin(1, 0);
    this.pDesc = text(this, x + 28, y + 80, '', 21, PALETTE.textDim, { wordWrap: { width: w - 56 }, lineSpacing: 4 });
    this.pStats = text(this, x + 28, y + 172, '', 23, PALETTE.text, { lineSpacing: 10 });
    this.pReason = text(this, x + 28, y + 330, '', 20, '#ff8a95');
    this.pBar = this.add.graphics();
    const close = button(this, x + w - 40, y + 44, 56, 56, '✕', () => this.closePanel(true), { style: 'ghost', size: 26 });
    this.pUpgrade = button(this, x + 28 + 210, y + h - 56, 420, 76, 'Upgrade', () => this.doUpgrade(), { style: 'gold', size: 28 });
    this.pMove = button(this, x + w - 28 - 105, y + h - 56, 210, 76, 'Move', () => {
      const id = this.panelOpenFor; this.closePanel(false); this.game.events.emit('ui:move', id);
    }, { style: 'cyan', size: 28 });
    this.pOpen = button(this, x + w - 28 - 105, y + h - 146, 210, 70, 'Open', () => {
      const id = this.panelOpenFor;
      const target = { barracks: 'troops', armory: 'armory', commandCenter: 'squads', infirmary: 'infirmary', archive: 'archive' }[id];
      if (target) this.openScreen(target);
    }, { style: 'cyan', size: 26 });
    c.add([g, block, this.pTitle, this.pLevel, this.pDesc, this.pStats, this.pReason, this.pBar, close, this.pUpgrade, this.pMove, this.pOpen]);
  }

  openPanel(id) {
    this.panelOpenFor = id;
    this.panel.setVisible(true);
    this.panel.y = 30; this.panel.alpha = 0;
    this.tweens.add({ targets: this.panel, y: 0, alpha: 1, duration: 160, ease: 'Cubic.easeOut' });
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
    if (id === BEACON.id) {
      this.pTitle.setText(BEACON.name);
      this.pDesc.setText(BEACON.description);
      const now = buildingPower(id, lv), next = buildingPower(id, lv + 1);
      const pct = Math.floor((s.beacon.charge / BEACON.maxCharge) * 100);
      this.pStats.setText([
        `Power (Beacon Relay):  +${now}   →  +${next}`,
        `Charge:  ${pct}%   ·   Energy income ${(ECONOMY.energyPerSec(lv) * store.mods.energy).toFixed(2)}/s → ${(ECONOMY.energyPerSec(lv + 1) * store.mods.energy).toFixed(2)}/s`,
        `Building level cap:  Lv ${store.buildingLevelCap()}   ·   Anchored (can't move)`,
        info.job ? `Upgrading to Lv ${info.job.toLevel}:  ${fmtClock(info.job.total - info.job.progress)} left` : `Upgrade:  ${fmt(info.cost)} Energy + full charge  ·  ${fmtClock(info.seconds)}`,
      ].join('\n'));
      this.pMove.setVisible(false);
      this.pOpen.setVisible(false);
      this.pUpgrade.setPosition(this.panelRect.x + this.panelRect.width / 2, this.pUpgrade.y);
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
      this.pStats.setText([
        `Power contribution:  +${now}   →  +${next} at Lv ${lv + 1}`,
        extra,
        `Level cap:  Lv ${store.buildingLevelCap()}  (Beacon Lv ${s.beacon.level} + 2)`,
        info.job ? `Upgrading to Lv ${info.job.toLevel}:  ${fmtClock(info.job.total - info.job.progress)} left` : `Upgrade:  ${fmt(info.cost)} Energy  ·  takes ${fmtClock(info.seconds)}`,
      ].join('\n'));
      this.pMove.setVisible(true);
      this.pOpen.setVisible(true).setLabel({ barracks: 'Train', armory: 'Recruit', commandCenter: 'Squads', infirmary: 'Heal', archive: 'Research' }[id]);
      this.pUpgrade.setPosition(this.panelRect.x + 28 + 210, this.pUpgrade.y);
    }
    this.pLevel.setText(`Lv ${lv}`);
    const r = this.panelRect, bar = this.pBar;
    bar.clear();
    if (info.job) {
      // countdown bar in the panel; the button becomes Cancel (full refund)
      const pct = Math.min(1, info.job.progress / info.job.total), bx = r.x + 28, by = r.y + 334, bw = r.width - 56 - 236;
      bar.fillStyle(0x05070a, 1).fillRect(bx, by, bw, 16);
      bar.fillStyle(PALETTE.gold, 1).fillRect(bx, by, bw * pct, 16);
      bar.lineStyle(2, PALETTE.gold, 0.9).strokeRect(bx, by, bw, 16);
      this.pUpgrade.setLabel(`Cancel  ·  refund ${fmt(info.job.cost)}`).setStyle('danger').setEnabled(true);
      this.pReason.setText('');
    } else {
      this.pUpgrade.setLabel(`Upgrade  ·  ${fmt(info.cost)}  ·  ${fmtClock(info.seconds)}`).setStyle('gold').setEnabled(info.can);
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
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.62).setInteractive();
    const w = 600, h = 400, x = (W - w) / 2, y = (H - h) / 2 - 40;
    const g = this.add.graphics();
    panelBg(g, x, y, w, h);
    const t = text(this, x + 32, y + 32, title, 36, PALETTE.textGold, { fontStyle: 'bold' });
    const b = text(this, x + 32, y + 96, body, 24, PALETTE.text, { wordWrap: { width: w - 64 }, lineSpacing: 6 });
    c.add([dim, g, t, b]);
    const bw = (w - 64 - (buttons.length - 1) * 20) / buttons.length;
    buttons.forEach((btn, i) => {
      c.add(button(this, x + 32 + bw / 2 + i * (bw + 20), y + h - 64, bw, 74, btn.label, () => {
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
    if (this.modal) { this.modal.destroy(); this.modal = null; }
    const want = this.screen?.id ?? (this.worldMode ? 'world' : 'base');
    if (this.activeTab !== want) { this.activeTab = want; this.drawNav(); }
  }

  // Settings: audio (music / effects volume, mute), haptics, tutorial replay, version + Reset Save.
  openSettings() {
    this.openOverlay({
      title: 'Settings', h: 1060, tab: 'settings',
      build: (c, r, close) => {
        const x0 = r.x + 32, xr = r.x + r.w - 32;
        const g = this.add.graphics(); c.add(g);
        const S = () => store.state.settings;
        c.add(text(this, x0, r.y + 92, 'AUDIO', 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 }));
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
        c.add(text(this, x0, r.y + 520, 'TUTORIAL', 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 }));
        const tuS = text(this, x0, r.y + 556, '', 19, PALETTE.text); c.add(tuS);
        const rep = button(this, xr - 150, r.y + 566, 300, 64, 'Replay Tutorial', () => {
          store.replayTutorial(); close(); this.closeScreen(); this.hideWorld();
          this.toast('Tutorial restarted. Follow the gold pointer.', 2200);
        }, { style: 'gold', size: 22 }); rep.chip = 'replay-tutorial'; c.add(rep);
        // game
        c.add(text(this, x0, r.y + 650, 'GAME', 20, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 3 }));
        c.add(text(this, x0, r.y + 686, 'Broken Dawn · v0.6 (stage 6: painted base + new HUD)\nProgress saves automatically on this device. PvP: coming later.\nReset Save erases everything: base, troops, squads, leaders, gear,\nresearch and the world.', 17, PALETTE.textDim, { lineSpacing: 5 }));
        const rs = button(this, r.x + r.w / 2, r.y + 836, 300, 64, 'Reset Save', () => this.confirmReset(), { style: 'danger', size: 22 }); c.add(rs);
        this.refreshSettings = () => {
          if (!c.active) { this.refreshSettings = null; return; }
          const s = S();
          g.clear();
          for (const key of ['music', 'sfx']) {
            const b = bars[key], v = s[key];
            vals[key].setText(`${Math.round(v * 100)}%`).setColor(s.muted ? '#5d6878' : PALETTE.textCyan);
            g.fillStyle(0x05070a, 1).fillRect(b.x, b.y, b.w, 12);
            g.fillStyle(s.muted ? 0x3a414c : (key === 'music' ? PALETTE.gold : PALETTE.cyan), 1).fillRect(b.x, b.y, b.w * v, 12);
            g.lineStyle(1.5, PALETTE.metalEdge, 1).strokeRect(b.x, b.y, b.w, 12);
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
      tab: 'settings',
      buttons: [
        { label: 'Cancel', style: 'ghost' },
        { label: 'Reset', style: 'danger', onClick: () => { store.reset(); this.closeScreen(); this.toast('Save reset. Fresh start, Commander.'); } },
      ],
    });
  }

  // ---------------------------------------------------------- toast -----
  createToast() {
    this.toastBox = this.add.container(W / 2, H - NAV_H - 70).setDepth(400).setVisible(false);
    this.toastBg = this.add.graphics();
    this.toastText = text(this, 0, 0, '', 22, PALETTE.text, { align: 'center', wordWrap: { width: W - 120 } }).setOrigin(0.5);
    this.toastBox.add([this.toastBg, this.toastText]);
  }
  toast(msg, ms = 2200) {
    this.toastText.setText(msg);
    audio.play('toast', { gap: 250 });
    const w = Math.min(W - 60, this.toastText.width + 48), h = this.toastText.height + 30;
    this.toastBg.clear().fillStyle(0x0b0e13, 0.94).fillRect(-w / 2, -h / 2, w, h).lineStyle(2, PALETTE.gold, 0.8).strokeRect(-w / 2, -h / 2, w, h);
    // lift above the panel if it's open
    this.toastBox.y = this.panel.visible ? this.panelRect.y - h / 2 - 12 : H - NAV_H - 70;
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
    this.beaconLv.setText(`Lv ${s.beacon.level}`);
    this.avatarLv.setText(String(s.beacon.level));
    this.chargeText.setText(pct >= 1 ? 'Fully charged' : `Charge ${Math.floor(pct * 100)}%`).setColor(pct >= 1 ? PALETTE.textGold : PALETTE.textDim);
    const bar = this.chargeBar; bar.clear();
    bar.fillStyle(0x05070a, 1).fillRect(484, 56, 206, 22);
    bar.fillStyle(pct >= 1 ? PALETTE.gold : PALETTE.orange, 1).fillRect(486, 58, 202 * pct, 18);
    if (pct >= 1) bar.fillStyle(0xffffff, 0.25 + 0.25 * Math.sin(this.time.now / 200)).fillRect(486, 58, 202, 18);
    bar.lineStyle(1.5, PALETTE.metalEdge, 1).strokeRect(484, 56, 206, 22);

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
      this.coreBadge.clear();
      if (ready) {
        const bx = this.resX.cores.x + this.resX.cores.w - 8;
        this.coreBadge.fillStyle(0xff3355, 1).fillCircle(bx, 134, 9).lineStyle(2, 0xffffff, 0.9).strokeCircle(bx, 134, 9);
      }
      this.refreshSide();
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
