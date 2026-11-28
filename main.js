// Broken Dawn creature motion mockup scene (390x844 portrait, rendered at 2x).
const W = 390, H = 844, Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');

class Mock extends Phaser.Scene {
  constructor() { super('mock'); }
  preload() {
    for (const k of ['body', 'femur', 'mandL']) this.load.image(`v2-${k}`, `art/v2/${k}.webp`);
    for (const k of ['head', 'tibia', 'antA', 'antB']) this.load.image(`v2-${k}`, `art/v3/${k}.webp`);
    for (const k of ['ground', 'lair-burrow', 'crystal-1', 'crystal-3', 'ruin-1', 'fissure-1', 'glow-teal']) this.load.image(k, `art/${k}.webp`);
  }
  makeTextures() {
    // mandible: curved hook, gold to dark-red tip (right side; left is flipped)
    const m = this.textures.createCanvas('mand', 24, 40), c = m.getContext();
    const gr = c.createLinearGradient(0, 40, 0, 0); gr.addColorStop(0, '#6b5330'); gr.addColorStop(0.5, '#d8b878'); gr.addColorStop(1, '#5a1c1c');
    c.fillStyle = gr; c.strokeStyle = '#2a1a0c'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(8, 40); c.bezierCurveTo(4, 26, 6, 10, 2, 2); c.bezierCurveTo(12, 6, 20, 18, 18, 40); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,240,200,0.5)'; c.beginPath(); c.moveTo(10, 36); c.bezierCurveTo(8, 26, 8, 14, 5, 6); c.lineTo(7, 7); c.bezierCurveTo(11, 16, 12, 26, 13, 36); c.fill();
    m.refresh();
    // soft dust puff
    const d = this.textures.createCanvas('puff', 32, 32), dc = d.getContext();
    const rg = dc.createRadialGradient(16, 16, 0, 16, 16, 16); rg.addColorStop(0, 'rgba(200,170,120,1)'); rg.addColorStop(1, 'rgba(200,170,120,0)');
    dc.fillStyle = rg; dc.fillRect(0, 0, 32, 32); d.refresh();
    // impact flash
    const fl = this.textures.createCanvas('flash', 64, 64), fc = fl.getContext();
    const fg = fc.createRadialGradient(32, 32, 0, 32, 32, 32);
    fg.addColorStop(0, 'rgba(255,248,220,1)'); fg.addColorStop(0.35, 'rgba(255,210,80,0.85)'); fg.addColorStop(1, 'rgba(255,180,40,0)');
    fc.fillStyle = fg; fc.fillRect(0, 0, 64, 64); fl.refresh();
    // vignette
    const v = this.textures.createCanvas('vig', W, H), vc = v.getContext();
    const vg = vc.createRadialGradient(W / 2, H * 0.52, H * 0.22, W / 2, H * 0.52, H * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    vc.fillStyle = vg; vc.fillRect(0, 0, W, H); v.refresh();
  }
  create() {
    this.makeTextures();
    const cam = this.cameras.main; cam.setZoom(2); cam.centerOn(W / 2, H / 2); cam.setBackgroundColor('#15110c');
    this.add.tileSprite(W / 2, H / 2, W * 2, H * 2, 'ground').setTileScale(0.5).setScale(0.5).setTint(0xd8c8b0);
    // decor in the game's painted style; the burrow lair sits mid-map and the Scuttlers roam around it
    this.lair = { x: 192, y: 404, r: 66, rMin: 104, rMax: 210 };
    this.add.image(84, 196, 'fissure-1').setScale(0.4).setAlpha(0.6).setAngle(-12);
    this.add.image(300, 772, 'fissure-1').setScale(0.38).setAlpha(0.5).setAngle(18);
    this.add.image(this.lair.x, this.lair.y, 'lair-burrow').setScale(0.6).setDepth(200);
    this.add.image(352, 470, 'crystal-1').setScale(0.3).setDepth(470 + 1000);
    this.add.image(40, 640, 'crystal-3').setScale(0.28).setDepth(640 + 1000);
    this.add.image(350, 128, 'ruin-1').setScale(0.34).setDepth(128 + 1000).setAlpha(0.95);
    this.add.image(W / 2, H / 2, 'vig').setDepth(9000);
    // header + caption
    const hdr = this.add.graphics().setDepth(9500); hdr.fillStyle(0x07090d, 0.78).fillRect(0, 0, W, 54); hdr.lineStyle(1, 0xc9a45a, 0.5).lineBetween(0, 54, W, 54);
    this.add.text(W / 2, 18, 'BROKEN DAWN', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f3d27a', letterSpacing: 3 }).setOrigin(0.5).setDepth(9501);
    this.add.text(W / 2, 38, 'Creature motion mockup · not in the game yet', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#9ff3e6' }).setOrigin(0.5).setDepth(9501);
    const ft = this.add.graphics().setDepth(9500); ft.fillStyle(0x07090d, 0.72).fillRect(0, H - 62, W, 62);
    this.cap = this.add.text(CAPTURE ? W / 2 : 160, H - 31, '', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#f4efe4', align: 'center', wordWrap: { width: CAPTURE ? 300 : 270 } }).setOrigin(0.5).setDepth(9501);
    // slow-mo toggle
    this.ts = 1;
    const btn = this.add.text(W - 12, H - 31, 'Slow-mo', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#f3d27a', backgroundColor: '#1a2a2e', padding: { x: 7, y: 5 } }).setOrigin(1, 0.5).setDepth(9502).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => { this.ts = this.ts === 1 ? 0.35 : 1; btn.setText(this.ts === 1 ? 'Slow-mo' : 'Normal'); });
    if (CAPTURE) btn.setVisible(false);

    // sentinels target (squad marker) at the edge of the lair's territory
    this.sent = this.makeSentinels(306, 662);
    const self = this, R = (x, y) => ({ type: 'goto', x, y });
    const attack = [
      { ...R(256, 570), near: true, onStart: () => this.say('A Sentinel squad strays too close…') },
      { type: 'face', target: this.sent, onStart: () => this.say('Turns in place: feet re-plant as it rotates') },
      { type: 'lunge', target: this.sent, onStart: () => this.say('Attack: crouch, front legs rise, lunge, mandibles snap'), onHit: () => self.hitSentinels() },
      { type: 'idle', dur: 1.0, onStart: () => this.say('Roaming: each Scuttler picks spots around its burrow, pauses, and eyes its neighbours') },
    ];
    this.creatures = [];
    // A: big one; roams, then breaks off to hit the Sentinels (repeats every few stops)
    this.A = new Creature(this, { x: 96, y: 560, heading: -0.5, k: 1.15, speed: 60, seed: 11, name: 'Husk Scuttler', level: 3,
      script: [{ ...R(170, 548), onStart: () => this.say('Roaming: each Scuttler picks spots around its burrow, pauses, and eyes its neighbours') }, { type: 'idle', dur: 1.5 }, ...attack],
      attackSeq: attack, attackEvery: 7 });
    this.B = new Creature(this, { x: 300, y: 300, heading: 2.4, k: 1.0, speed: 54, seed: 5, name: 'Husk Scuttler', level: 2,
      script: [R(118, 268), { type: 'idle', dur: 0.8 }] });
    this.C = new Creature(this, { x: 330, y: 470, heading: -1.9, k: 0.9, speed: 50, seed: 23, tint: 0xe6d6bf, name: 'Husk Scuttler', level: 1,
      script: [R(338, 318), { type: 'idle', dur: 1.2 }, { type: 'face', target: null, max: 1.2 }, R(300, 190)] });
    this.C.script[2].target = this.A; this.B.script.push({ type: 'face', target: this.A, max: 1.4 });
    this.creatures.push(this.A, this.B, this.C);
    this.puffs = [];
    window.__scene = this; if (CAPTURE) { this.game.loop.sleep(); window.__ready = true; }
  }
  sNear(p, x, y) { let best = 0, bd = 1e9; for (let i = 0; i < p.pts.length; i++) { const d = Math.hypot(p.pts[i][0] - x, p.pts[i][1] - y); if (d < bd) { bd = d; best = p.acc[i]; } } return best; }
  say(t) { this.cap.setText(t); }
  makeSentinels(x, y) {
    const g = this.add.graphics().setDepth(y + 1000 - 70);
    const glow = this.add.image(x, y, 'glow-teal').setScale(0.55).setAlpha(0.55).setDepth(y + 1000 - 71);
    const draw = (flash) => {
      g.clear();
      g.fillStyle(0x000000, 0.35).fillEllipse(x + 4, y + 6, 46, 26);
      g.fillStyle(flash ? 0xffffff : 0x0f2a30, 1).fillPoints([{ x, y: y - 20 }, { x: x + 22, y }, { x, y: y + 20 }, { x: x - 22, y }], true);
      g.lineStyle(2, flash ? 0xffffff : 0x46d6c8, 1).strokePoints([{ x, y: y - 20 }, { x: x + 22, y }, { x, y: y + 20 }, { x: x - 22, y }], true);
      g.lineStyle(1.2, 0xc9a45a, 0.9).strokePoints([{ x, y: y - 14 }, { x: x + 15, y }, { x, y: y + 14 }, { x: x - 15, y }], true);
      // shield emblem
      g.fillStyle(0xf3d27a, 1).fillPoints([{ x: x - 6, y: y - 7 }, { x: x + 6, y: y - 7 }, { x: x + 6, y: y + 1 }, { x, y: y + 8 }, { x: x - 6, y: y + 1 }], true);
      g.fillStyle(0x1a2a2e, 1).fillRect(x - 1, y - 5, 2, 10);
    };
    draw(false);
    const hpBg = this.add.graphics().setDepth(y + 1000 - 69);
    const s = { x, y, g, draw, hp: 1, hpBg, glow };
    this.drawHp(s);
    const lbl = this.add.text(x, y + 34, 'Sentinels', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#9ff3e6' }).setOrigin(0.5).setShadow(0, 1, '#000', 4, false, true).setDepth(5000);
    return s;
  }
  drawHp(s) { s.hpBg.clear(); s.hpBg.fillStyle(0x000000, 0.7).fillRect(s.x - 18, s.y - 32, 36, 5); s.hpBg.fillStyle(0x46d6c8, 1).fillRect(s.x - 17, s.y - 31, 34 * s.hp, 3); }
  hitSentinels() {
    const s = this.sent; s.draw(true); this.time.delayedCall(70, () => s.draw(false));
    s.hp = Math.max(0.15, s.hp - 0.22); this.drawHp(s);
    this.cameras.main.shake(200, 0.0075);
    const flash = this.add.image(s.x, s.y, 'flash').setScale(0.4).setAlpha(1).setDepth(s.y + 9400).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 280, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    for (let i = 0; i < 16; i++) this.dust(s.x - 18 + Math.random() * 36, s.y - 4 + Math.random() * 18, 0.4, 1.3 + Math.random() * 0.9, true);
    const t = this.add.text(s.x + 4, s.y - 30, '-126', { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#ffb347', stroke: '#2a1a0c', strokeThickness: 3 }).setOrigin(0.5).setDepth(9400);
    this.tweens.add({ targets: t, y: s.y - 62, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
    this.tweens.add({ targets: s.glow, scale: 0.75, alpha: 0.9, duration: 90, yoyo: true });
  }
  dust(x, y, a, sz, burst) {
    const p = this.add.image(x, y, 'puff').setAlpha(a).setScale(0.25 * sz).setDepth(y + 999);
    this.tweens.add({ targets: p, scale: (burst ? 0.9 : 0.6) * sz, alpha: 0, x: x + (Math.random() - 0.3) * (burst ? 28 : 5), y: y - (burst ? 10 : 2), duration: burst ? 800 : 500, ease: 'Quad.easeOut', onComplete: () => p.destroy() });
  }
  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05) * this.ts;
    for (const c of this.creatures) c.update(dt);
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL, parent: 'game', width: W * 2, height: H * 2, backgroundColor: '#0b0d10',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, roundPixels: false }, scene: Mock,
});
if (CAPTURE) {
  let tt = 0;
  window.__frame = (n = 1, fps = 30) => { for (let i = 0; i < n; i++) { tt += 1000 / fps; game.step(tt, 1000 / fps); } };
}
