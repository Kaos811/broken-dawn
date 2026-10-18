import Phaser from 'phaser';
import { GAME_WIDTH as W, GAME_HEIGHT as H, PALETTE, BEACON, BUILDINGS, ECONOMY } from '../config.js';
import { store } from '../state/store.js';
import { buildingPower } from '../systems/power.js';
import { text, fmt, fmtDuration, panelBg, button } from '../ui/widgets.js';

const TOP_H = 150;
const NAV_H = 130;
const TABS = [
  { id: 'base', label: 'Base' },
  { id: 'troops', label: 'Troops' },
  { id: 'armory', label: 'Armory' },
  { id: 'squads', label: 'Squads' },
  { id: 'settings', label: 'Settings' },
];
const STAGE2 = {
  troops: 'Train Sentinels, Bearers and Voyagers in the Barracks.',
  armory: 'Recruit leaders, armor and weapons through Armory pulls.',
  squads: 'Form Alpha, Bravo and Charlie squads and edit formations.',
};

export default class UIScene extends Phaser.Scene {
  constructor() { super('UI'); }

  create() {
    this.panelOpenFor = null;
    this.modal = null;
    this.createTopBar();
    this.createNav();
    this.createPanel();
    this.createBanner();
    this.createToast();

    const ev = this.game.events;
    ev.on('base:select', (id) => this.openPanel(id), this);
    ev.on('base:deselect', () => this.closePanel(false), this);
    ev.on('base:moveMode', (id) => this.showBanner(id), this);
    ev.on('toast', (msg) => this.toast(msg), this);
    this.unsubs = [
      store.on('upgrade', () => { this.bump(this.powerText); this.refreshPanel(); }),
      store.on('reset', () => { this.closePanel(false); }),
    ];
    this.events.once('shutdown', () => this.unsubs.forEach((u) => u()));

    // autosave + save on hide
    this.time.addEvent({ delay: ECONOMY.autosaveMs, loop: true, callback: () => store.save() });
    const saveNow = () => store.save();
    document.addEventListener('visibilitychange', saveNow);
    window.addEventListener('pagehide', saveNow);

    const off = store.offlineReport;
    if (off && off.energy >= 1) {
      this.time.delayedCall(400, () => this.toast(`Welcome back, Commander. Away ${fmtDuration(off.seconds)}${off.capped ? ' (capped)' : ''}: +${fmt(off.energy)} Energy`, 4200));
    }
    this.panelTimer = 0;
  }

  // Lets BaseScene know a screen point belongs to the UI.
  blocksPointer(x, y) {
    if (this.modal) return true;
    if (y < TOP_H || y > H - NAV_H) return true;
    if (this.panel.visible && Phaser.Geom.Rectangle.Contains(this.panelRect, x, y)) return true;
    if (this.banner.visible && Phaser.Geom.Rectangle.Contains(this.bannerRect, x, y)) return true;
    return false;
  }

  // ------------------------------------------------------------ HUD -----
  createTopBar() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x0b0e13, 0x0b0e13, 0x0b0e13, 0x0b0e13, 0.98, 0.98, 0.85, 0.85).fillRect(0, 0, W, TOP_H);
    g.lineStyle(2, PALETTE.gold, 0.6).lineBetween(0, TOP_H, W, TOP_H);
    g.lineStyle(6, PALETTE.gold, 0.12).lineBetween(0, TOP_H, W, TOP_H);
    this.add.rectangle(W / 2, TOP_H / 2, W, TOP_H, 0, 0.001).setInteractive(); // swallow taps

    text(this, 20, 12, 'BROKEN DAWN', 18, PALETTE.textGold, { fontStyle: 'bold', letterSpacing: 4 });
    text(this, W - 20, 12, 'STAGE 1 · BASE', 16, PALETTE.textDim, { letterSpacing: 2 }).setOrigin(1, 0);

    // Energy pill
    const pill = (x, w) => { panelBg(g, x, 42, w, 96, { accent: null, cut: 12, fill: 0x141922 }); };
    pill(14, 216); pill(238, 220); pill(466, 240);
    g.fillStyle(PALETTE.cyan, 1).fillPoints([{ x: 44, y: 58 }, { x: 30, y: 92 }, { x: 42, y: 92 }, { x: 36, y: 122 }, { x: 56, y: 82 }, { x: 44, y: 82 }, { x: 52, y: 58 }], true);
    text(this, 70, 52, 'ENERGY', 15, PALETTE.textDim, { letterSpacing: 2 });
    this.energyText = text(this, 70, 70, '0', 34, PALETTE.text, { fontStyle: 'bold' });
    this.rateText = text(this, 70, 110, '+1.0/s', 17, PALETTE.textCyan);

    // Base Power pill
    g.fillStyle(PALETTE.gold, 1).fillPoints([{ x: 266, y: 60 }, { x: 290, y: 66 }, { x: 290, y: 92 }, { x: 278, y: 118 }, { x: 266, y: 92 }], true);
    g.fillStyle(PALETTE.gold, 0.6).fillPoints([{ x: 266, y: 60 }, { x: 266, y: 92 }, { x: 278, y: 118 }, { x: 254, y: 92 }, { x: 254, y: 66 }], true);
    text(this, 302, 52, 'BASE POWER', 15, PALETTE.textDim, { letterSpacing: 2 });
    this.powerText = text(this, 302, 70, '0', 34, PALETTE.textGold, { fontStyle: 'bold' });
    this.powerSub = text(this, 302, 110, 'Bldg 0 · Troops 0', 17, PALETTE.textDim);

    // Beacon pill (tappable -> beacon info)
    text(this, 484, 52, 'BEACON', 15, PALETTE.textDim, { letterSpacing: 2 });
    this.beaconLv = text(this, 690, 50, 'Lv 1', 20, PALETTE.textGold, { fontStyle: 'bold' }).setOrigin(1, 0);
    this.chargeBar = this.add.graphics();
    this.chargeText = text(this, 484, 108, 'Charge 0%', 17, PALETTE.textDim);
    const beaconHit = this.add.rectangle(466 + 120, 90, 240, 96, 0, 0.001).setInteractive({ useHandCursor: true });
    beaconHit.on('pointerup', () => this.game.events.emit('ui:focusBeacon'));
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
      if (on) { g.fillStyle(PALETTE.gold, 0.12).fillRect(t.cx - W / 10, H - NAV_H, W / 5, NAV_H); g.fillStyle(PALETTE.gold, 1).fillRect(t.cx - 40, H - NAV_H, 80, 4); }
      g.lineStyle(3, col, 1); g.fillStyle(col, 1);
      const x = t.cx;
      switch (t.id) {
        case 'base': g.strokePoints([{ x, y: y - 20 }, { x: x + 24, y: y - 6 }, { x, y: y + 8 }, { x: x - 24, y: y - 6 }], true); g.fillCircle(x, y - 22, 5); g.lineBetween(x, y - 18, x, y - 6); break;
        case 'troops': g.strokeCircle(x, y - 14, 8); g.strokePoints([{ x: x - 16, y: y + 12 }, { x: x - 12, y: y - 2 }, { x: x + 12, y: y - 2 }, { x: x + 16, y: y + 12 }], false); break;
        case 'armory': g.strokePoints([{ x, y: y - 24 }, { x: x + 12, y: y - 6 }, { x, y: y + 12 }, { x: x - 12, y: y - 6 }], true); break;
        case 'squads': for (const dx of [-14, 0, 14]) g.strokeCircle(x + dx, y - 6 + (dx ? 6 : -4), 7); break;
        case 'settings': g.strokeCircle(x, y - 6, 9); for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.lineBetween(x + Math.cos(a) * 12, y - 6 + Math.sin(a) * 12, x + Math.cos(a) * 17, y - 6 + Math.sin(a) * 17); } break;
        default:
      }
    }
  }

  onTab(id) {
    if (id === 'base') { this.closeModal(); return; }
    if (id === 'settings') { this.openSettings(); return; }
    const tab = TABS.find((t) => t.id === id);
    this.openModal({ title: tab.label, body: `Coming in stage 2\n\n${STAGE2[id] ?? ''}`, buttons: [{ label: 'OK', style: 'gold' }], tab: id });
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
    const close = button(this, x + w - 40, y + 44, 56, 56, '✕', () => this.closePanel(true), { style: 'ghost', size: 26 });
    this.pUpgrade = button(this, x + 28 + 210, y + h - 56, 420, 76, 'Upgrade', () => this.doUpgrade(), { style: 'gold', size: 28 });
    this.pMove = button(this, x + w - 28 - 105, y + h - 56, 210, 76, 'Move', () => {
      const id = this.panelOpenFor; this.closePanel(false); this.game.events.emit('ui:move', id);
    }, { style: 'cyan', size: 28 });
    c.add([g, block, this.pTitle, this.pLevel, this.pDesc, this.pStats, this.pReason, close, this.pUpgrade, this.pMove]);
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
        `Charge:  ${pct}%   ·   Energy income ${ECONOMY.energyPerSec(lv).toFixed(2)}/s → ${ECONOMY.energyPerSec(lv + 1).toFixed(2)}/s`,
        `Building level cap:  Lv ${store.buildingLevelCap()}   ·   Anchored (can't move)`,
        `Upgrade cost:  ${fmt(info.cost)} Energy + full charge`,
      ].join('\n'));
      this.pMove.setVisible(false);
      this.pUpgrade.setPosition(this.panelRect.x + this.panelRect.width / 2, this.pUpgrade.y);
    } else {
      const def = BUILDINGS[id];
      this.pTitle.setText(def.name);
      this.pDesc.setText(def.description);
      const now = buildingPower(id, lv), next = buildingPower(id, lv + 1);
      this.pStats.setText([
        `Power contribution:  +${now}   →  +${next} at Lv ${lv + 1}`,
        `Power per level:  +${def.powerPerLevel}${def.powerPerLevel === 0 ? '  (stage 2 adds Armory bonuses)' : ''}`,
        `Level cap:  Lv ${store.buildingLevelCap()}  (Beacon Lv ${s.beacon.level} + 2)`,
        `Upgrade cost:  ${fmt(info.cost)} Energy`,
      ].join('\n'));
      this.pMove.setVisible(true);
      this.pUpgrade.setPosition(this.panelRect.x + 28 + 210, this.pUpgrade.y);
    }
    this.pLevel.setText(`Lv ${lv}`);
    this.pUpgrade.setLabel(`Upgrade  ·  ${fmt(info.cost)}`).setEnabled(info.can);
    this.pReason.setText(info.reason ? `⚠ ${info.reason}` : '');
  }

  doUpgrade() {
    const id = this.panelOpenFor;
    if (!id) return;
    const r = store.upgrade(id);
    if (!r.ok) this.toast(r.reason);
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
    const sub = text(this, x + 22, y + 46, 'Drag it onto open platform tiles', 18, PALETTE.textDim);
    const done = button(this, x + w - 80, y + h / 2, 130, 58, 'Done', () => this.game.events.emit('ui:moveDone'), { style: 'cyan', size: 24 });
    c.add([g, block, this.bannerText, sub, done]);
  }
  showBanner(id) {
    if (!id) { this.banner.setVisible(false); return; }
    this.bannerText.setText(`Moving ${BUILDINGS[id].name}`);
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
    if (this.activeTab !== 'base') { this.activeTab = 'base'; this.drawNav(); }
  }

  openSettings() {
    this.openModal({
      title: 'Settings',
      body: 'Broken Dawn · v0.1 (stage 1)\nProgress saves automatically on this device.\n\nReset Save erases your base layout, building levels and Energy.',
      tab: 'settings',
      buttons: [
        { label: 'Close', style: 'ghost' },
        { label: 'Reset Save', style: 'danger', onClick: () => this.confirmReset() },
      ],
    });
  }
  confirmReset() {
    this.openModal({
      title: 'Reset all progress?',
      body: 'This permanently erases your saved base, building levels, Beacon charge and Energy. This can\'t be undone.',
      tab: 'settings',
      buttons: [
        { label: 'Cancel', style: 'ghost' },
        { label: 'Reset', style: 'danger', onClick: () => { store.reset(); this.toast('Save reset. Fresh start, Commander.'); } },
      ],
    });
  }

  // ---------------------------------------------------------- toast -----
  createToast() {
    this.toastBox = this.add.container(W / 2, H - NAV_H - 70).setDepth(200).setVisible(false);
    this.toastBg = this.add.graphics();
    this.toastText = text(this, 0, 0, '', 22, PALETTE.text, { align: 'center', wordWrap: { width: W - 120 } }).setOrigin(0.5);
    this.toastBox.add([this.toastBg, this.toastText]);
  }
  toast(msg, ms = 2200) {
    this.toastText.setText(msg);
    const w = Math.min(W - 60, this.toastText.width + 48), h = this.toastText.height + 30;
    this.toastBg.clear().fillStyle(0x0b0e13, 0.94).fillRect(-w / 2, -h / 2, w, h).lineStyle(2, PALETTE.gold, 0.8).strokeRect(-w / 2, -h / 2, w, h);
    // lift above the panel if it's open
    this.toastBox.y = this.panel.visible ? this.panelRect.y - h / 2 - 12 : H - NAV_H - 70;
    this.tweens.killTweensOf(this.toastBox);
    this.toastBox.setVisible(true).setAlpha(1);
    this.tweens.add({ targets: this.toastBox, alpha: 0, delay: ms, duration: 400, onComplete: () => this.toastBox.setVisible(false) });
  }

  bump(t) { this.tweens.add({ targets: t, scale: 1.18, duration: 120, yoyo: true }); }

  update(_t, dtMs) {
    store.tick(Math.min(dtMs, 1000) / 1000);
    const s = store.state, p = store.power;
    this.energyText.setText(fmt(s.resources.energy));
    this.rateText.setText(`+${store.energyRate.toFixed(2)}/s`);
    this.powerText.setText(fmt(p.total));
    this.powerSub.setText(`Bldg ${fmt(p.building)} · Troops ${fmt(p.troop)}`);
    const pct = s.beacon.charge / BEACON.maxCharge;
    this.beaconLv.setText(`Lv ${s.beacon.level}`);
    this.chargeText.setText(pct >= 1 ? 'Fully charged' : `Charge ${Math.floor(pct * 100)}%`).setColor(pct >= 1 ? PALETTE.textGold : PALETTE.textDim);
    const bar = this.chargeBar; bar.clear();
    bar.fillStyle(0x05070a, 1).fillRect(484, 80, 206, 20);
    bar.fillStyle(pct >= 1 ? PALETTE.gold : PALETTE.orange, 1).fillRect(486, 82, 202 * pct, 16);
    if (pct >= 1) bar.fillStyle(0xffffff, 0.25 + 0.25 * Math.sin(this.time.now / 200)).fillRect(486, 82, 202, 16);
    bar.lineStyle(1.5, PALETTE.metalEdge, 1).strokeRect(484, 80, 206, 20);

    this.panelTimer += dtMs;
    if (this.panelOpenFor && this.panelTimer > 200) { this.panelTimer = 0; this.refreshPanel(); }
  }
}
