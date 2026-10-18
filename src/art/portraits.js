// Procedural placeholder portraits (canvas 2D, no external assets). Swap for real art later.
import { TROOP_CLASSES, LEADERS, GEAR, RARITY, RARITIES } from '../config.js';

export const PORTRAIT = { W: 200, H: 240 };
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function glow(ctx, color, blur, fn) { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; fn(); ctx.restore(); }
function metal(ctx, x0, y0, x1, y1, a = '#3b4452', b = '#161b23') {
  const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g;
}

function background(ctx, W, H, accent) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#11161e'); bg.addColorStop(1, '#07090d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W / 2, H * 0.42, 4, W / 2, H * 0.42, W * 0.7);
  r.addColorStop(0, `${accent}55`); r.addColorStop(1, `${accent}00`);
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `${accent}22`; ctx.lineWidth = 1;
  for (let y = 8; y < H; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function sentinel(ctx, W, H, A, crest) {
  const cx = W / 2;
  // short rifle (behind, right)
  ctx.fillStyle = '#1b2029'; rr(ctx, cx + 48, 150, 56, 14, 3); ctx.fill();
  ctx.fillStyle = A; ctx.fillRect(cx + 88, 154, 14, 4);
  // torso + bulky pauldrons
  ctx.fillStyle = metal(ctx, 0, 140, 0, H, '#3b4452', '#141922');
  poly(ctx, [[cx - 62, H], [cx - 56, 162], [cx - 30, 146], [cx + 30, 146], [cx + 56, 162], [cx + 62, H]]); ctx.fill();
  for (const s of [-1, 1]) {
    ctx.fillStyle = metal(ctx, cx + s * 60, 130, cx + s * 80, 190, '#56606f', '#232a35');
    rr(ctx, cx + s * 66 - 34, 132, 68, 50, 16); ctx.fill();
    ctx.strokeStyle = A; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx + s * 66 - 24, 168); ctx.lineTo(cx + s * 66 + 24, 168); ctx.stroke();
  }
  // chest plate with blue core
  ctx.fillStyle = '#2a313c'; poly(ctx, [[cx - 32, 160], [cx + 32, 160], [cx + 24, 210], [cx, 222], [cx - 24, 210]]); ctx.fill();
  glow(ctx, A, 14, () => { ctx.fillStyle = A; poly(ctx, [[cx, 176], [cx + 10, 188], [cx, 200], [cx - 10, 188]]); ctx.fill(); });
  // helmet: boxy with T-visor
  ctx.fillStyle = metal(ctx, cx - 40, 60, cx + 40, 150, '#56606f', '#1f252f');
  rr(ctx, cx - 38, 62, 76, 86, 18); ctx.fill();
  ctx.fillStyle = '#0a0d12'; rr(ctx, cx - 30, 86, 60, 46, 8); ctx.fill();
  glow(ctx, A, 18, () => { ctx.fillStyle = A; ctx.fillRect(cx - 26, 92, 52, 9); ctx.fillRect(cx - 5, 92, 10, 36); });
  ctx.fillStyle = crest ?? '#56606f'; ctx.fillRect(cx - 6, 54, 12, 14);
  // energy shield (front-left, translucent hex)
  glow(ctx, A, 16, () => {
    ctx.fillStyle = `${A}33`; ctx.strokeStyle = A; ctx.lineWidth = 3;
    poly(ctx, [[20, 168], [48, 152], [76, 168], [76, 214], [48, 232], [20, 214]]); ctx.fill(); ctx.stroke();
  });
}

function bearer(ctx, W, H, A, crest) {
  const cx = W / 2;
  // two-handed weapon across the back
  ctx.save(); ctx.translate(cx, 150); ctx.rotate(-0.62);
  ctx.fillStyle = '#1b2029'; rr(ctx, -110, -9, 220, 18, 4); ctx.fill();
  glow(ctx, '#ff7a1a', 16, () => { ctx.fillStyle = '#ff7a1a'; ctx.fillRect(30, -4, 76, 8); });
  ctx.restore();
  // long coat
  ctx.fillStyle = metal(ctx, 0, 140, 0, H, '#3a3028', '#120e0b');
  poly(ctx, [[cx - 74, H], [cx - 46, 156], [cx - 22, 146], [cx + 22, 146], [cx + 46, 156], [cx + 74, H]]); ctx.fill();
  // high collar
  ctx.fillStyle = '#2b231d';
  poly(ctx, [[cx - 40, 150], [cx - 18, 120], [cx - 6, 162]]); ctx.fill();
  poly(ctx, [[cx + 40, 150], [cx + 18, 120], [cx + 6, 162]]); ctx.fill();
  // gold trim down the front
  ctx.strokeStyle = A; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 8, 164); ctx.lineTo(cx - 22, H); ctx.moveTo(cx + 8, 164); ctx.lineTo(cx + 22, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 46, 158); ctx.lineTo(cx - 60, H); ctx.moveTo(cx + 46, 158); ctx.lineTo(cx + 60, H); ctx.stroke();
  // beacon light at the chest
  glow(ctx, '#ffd27f', 22, () => { ctx.fillStyle = '#ffd27f'; ctx.beginPath(); ctx.arc(cx, 186, 9, 0, Math.PI * 2); ctx.fill(); });
  // sleek helmet with visor slit
  ctx.fillStyle = metal(ctx, cx - 30, 64, cx + 30, 140, '#4a525f', '#1a1f27');
  ctx.beginPath(); ctx.ellipse(cx, 100, 30, 40, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a0d12'; rr(ctx, cx - 26, 92, 52, 14, 6); ctx.fill();
  glow(ctx, A, 16, () => { ctx.fillStyle = A; rr(ctx, cx - 22, 96, 44, 6, 3); ctx.fill(); });
  if (crest) { ctx.fillStyle = crest; poly(ctx, [[cx - 4, 58], [cx + 4, 58], [cx + 2, 80], [cx - 2, 80]]); ctx.fill(); }
}

function voyager(ctx, W, H, A, crest) {
  const cx = W / 2;
  // sniper rifle over the shoulder
  ctx.fillStyle = '#1b2029'; ctx.fillRect(cx + 40, 40, 8, 170);
  ctx.fillStyle = '#2a313c'; rr(ctx, cx + 34, 110, 20, 40, 4); ctx.fill();
  glow(ctx, A, 10, () => { ctx.fillStyle = A; ctx.fillRect(cx + 41, 44, 6, 10); });
  // cloak
  ctx.fillStyle = metal(ctx, 0, 130, 0, H, '#23343a', '#0b1214');
  poly(ctx, [[cx - 70, H], [cx - 44, 150], [cx, 136], [cx + 44, 150], [cx + 70, H]]); ctx.fill();
  ctx.strokeStyle = '#1fb5b0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 44, 152); ctx.lineTo(cx - 10, 230); ctx.moveTo(cx + 44, 152); ctx.lineTo(cx + 10, 230); ctx.stroke();
  // light chest rig + dual pistols at the hips
  ctx.fillStyle = '#2a313c'; rr(ctx, cx - 22, 172, 44, 30, 6); ctx.fill();
  ctx.fillStyle = '#161b23'; rr(ctx, cx - 58, 206, 22, 12, 3); ctx.fill(); rr(ctx, cx + 36, 206, 22, 12, 3); ctx.fill();
  // hood
  ctx.fillStyle = metal(ctx, cx - 40, 50, cx + 40, 150, '#2d4148', '#0e1619');
  ctx.beginPath(); ctx.moveTo(cx, 46); ctx.quadraticCurveTo(cx + 50, 70, cx + 44, 150); ctx.lineTo(cx - 44, 150); ctx.quadraticCurveTo(cx - 50, 70, cx, 46); ctx.fill();
  ctx.fillStyle = '#05080a'; ctx.beginPath(); ctx.ellipse(cx, 108, 24, 30, 0, 0, Math.PI * 2); ctx.fill();
  // glowing cyan eyes
  glow(ctx, A, 14, () => { ctx.fillStyle = A; ctx.fillRect(cx - 14, 102, 9, 4); ctx.fillRect(cx + 5, 102, 9, 4); });
  if (crest) { ctx.strokeStyle = crest; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 30, 70); ctx.quadraticCurveTo(cx, 54, cx + 30, 70); ctx.stroke(); }
  // floating Beacon shard
  glow(ctx, A, 22, () => { ctx.fillStyle = '#c8ffff'; poly(ctx, [[34, 62], [46, 84], [34, 110], [22, 84]]); ctx.fill(); });
  ctx.fillStyle = A; poly(ctx, [[34, 70], [40, 84], [34, 100], [28, 84]]); ctx.fill();
}

const DRAW = { sentinel, bearer, voyager };

function canvasTex(scene, key, w, h, fn) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  fn(tex.getContext(), w, h);
  tex.refresh();
}

function armorIcon(ctx, W, H, col) {
  ctx.fillStyle = metal(ctx, 0, 10, 0, H - 10, '#56606f', '#1a1f27');
  poly(ctx, [[W * 0.2, H * 0.18], [W * 0.38, H * 0.12], [W * 0.5, H * 0.22], [W * 0.62, H * 0.12], [W * 0.8, H * 0.18], [W * 0.84, H * 0.5], [W * 0.5, H * 0.9], [W * 0.16, H * 0.5]]); ctx.fill();
  glow(ctx, col, 14, () => { ctx.strokeStyle = col; ctx.lineWidth = 4; poly(ctx, [[W * 0.32, H * 0.32], [W * 0.68, H * 0.32], [W * 0.64, H * 0.56], [W * 0.5, H * 0.72], [W * 0.36, H * 0.56]]); ctx.stroke(); });
}
function weaponIcon(ctx, W, H, col) {
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.6);
  ctx.fillStyle = '#3b4452'; rr(ctx, -W * 0.42, -8, W * 0.84, 16, 4); ctx.fill();
  ctx.fillStyle = '#1a1f27'; rr(ctx, -W * 0.2, 6, 16, 22, 3); ctx.fill(); rr(ctx, -W * 0.42, -4, 22, 20, 3); ctx.fill();
  glow(ctx, col, 14, () => { ctx.fillStyle = col; ctx.fillRect(0, -3, W * 0.38, 6); });
  ctx.restore();
}

export function makePortraitTextures(scene) {
  const { W, H } = PORTRAIT;
  canvasTex(scene, 'glow-white', 128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
  // card back for recruitment reveals
  canvasTex(scene, 'card-back', 128, 190, (ctx, w, h) => {
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2a313c'); bg.addColorStop(1, '#10141b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.strokeStyle = '#56606f'; ctx.lineWidth = 1; ctx.strokeRect(12, 12, w - 24, h - 24);
    glow(ctx, '#ffb347', 20, () => { ctx.fillStyle = '#ffd27f'; ctx.beginPath(); ctx.arc(w / 2, h / 2 - 6, 16, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#3ff0ff'; poly(ctx, [[w / 2, h / 2 + 16], [w / 2 + 26, h / 2 + 30], [w / 2, h / 2 + 44], [w / 2 - 26, h / 2 + 30]]); ctx.fill();
  });
  for (const [id, def] of Object.entries(TROOP_CLASSES)) {
    canvasTex(scene, `portrait-${id}`, W, H, (ctx) => { background(ctx, W, H, def.colorHex); DRAW[id](ctx, W, H, def.colorHex); });
  }
  for (const [id, L] of Object.entries(LEADERS)) {
    const A = TROOP_CLASSES[L.affinity].colorHex;
    const crest = hex(RARITY[L.rarity].color);
    canvasTex(scene, `leader-${id}`, W, H, (ctx) => {
      background(ctx, W, H, crest);
      DRAW[L.affinity](ctx, W, H, A, crest);
      // emblem: leader initial on a chevron
      ctx.fillStyle = '#0b0e13cc'; poly(ctx, [[W - 54, 10], [W - 10, 10], [W - 10, 48], [W - 32, 60], [W - 54, 48]]); ctx.fill();
      ctx.strokeStyle = crest; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = crest; ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(L.name[0], W - 32, 33);
    });
  }
  for (const rar of RARITIES) {
    const col = hex(RARITY[rar].color);
    canvasTex(scene, `gear-armor-${rar}`, 120, 120, (ctx, w, h) => armorIcon(ctx, w, h, col));
    canvasTex(scene, `gear-weapon-${rar}`, 120, 120, (ctx, w, h) => weaponIcon(ctx, w, h, col));
  }
}

export const gearTexture = (gearId) => `gear-${GEAR[gearId].slot}-${GEAR[gearId].rarity}`;
