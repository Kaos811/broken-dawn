// Procedural creature + world-map art (canvas 2D, no external assets). Keys: cr-<type>, world-base, world-ground.
import { CREATURES } from '../config.js';

const SZ = 128;
function canvasTex(scene, key, w, h, fn) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  fn(tex.getContext(), w, h);
  tex.refresh();
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function glow(ctx, color, blur, fn) { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; fn(); ctx.restore(); }
function eye(ctx, x, y, r, col) { glow(ctx, col, 10, () => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill(); }
function shadow(ctx, w, h) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.86, w * 0.36, h * 0.09, 0, 0, Math.PI * 2); ctx.fill(); }

function bug(ctx, x, y, s, body, shell, eyeCol) {
  ctx.strokeStyle = '#2a2016'; ctx.lineWidth = 2.5 * s;
  for (const k of [-1, 1]) for (const j of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(x + k * 8 * s, y + j * 10 * s); ctx.lineTo(x + k * 20 * s, y + j * 14 * s + 6 * s); ctx.stroke(); }
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(x, y, 12 * s, 16 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(x, y + 3 * s, 10 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.moveTo(x, y - 8 * s); ctx.lineTo(x, y + 15 * s); ctx.stroke();
  ctx.fillStyle = '#3a2c1c'; ctx.beginPath(); ctx.ellipse(x, y - 14 * s, 7 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  eye(ctx, x - 3 * s, y - 15 * s, 1.8 * s, eyeCol); eye(ctx, x + 3 * s, y - 15 * s, 1.8 * s, eyeCol);
}

const DRAW = {
  scuttler(ctx, w, h) {
    shadow(ctx, w, h);
    bug(ctx, 40, 76, 1.0, '#8a6a40', '#c9a46a', '#ff7a1a');
    bug(ctx, 88, 78, 1.0, '#8a6a40', '#c9a46a', '#ff7a1a');
    bug(ctx, 64, 52, 1.25, '#9a7848', '#e0bb80', '#ffb347');
  },
  drone(ctx, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.9, w * 0.26, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    glow(ctx, '#9b7bff', 16, () => {
      ctx.fillStyle = '#5b48a8aa';
      poly(ctx, [[64, 54], [12, 30], [22, 62], [64, 70]]); ctx.fill();
      poly(ctx, [[64, 54], [116, 30], [106, 62], [64, 70]]); ctx.fill();
    });
    ctx.strokeStyle = '#c9b8ff'; ctx.lineWidth = 2; poly(ctx, [[64, 54], [12, 30], [22, 62], [64, 70]]); ctx.stroke(); poly(ctx, [[64, 54], [116, 30], [106, 62], [64, 70]]); ctx.stroke();
    ctx.fillStyle = '#2a2440'; poly(ctx, [[64, 30], [84, 58], [64, 96], [44, 58]]); ctx.fill();
    ctx.strokeStyle = '#9b7bff'; ctx.lineWidth = 3; ctx.stroke();
    eye(ctx, 64, 58, 7, '#d36bff');
    ctx.strokeStyle = '#9b7bff88'; ctx.lineWidth = 2; for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(64 + k * 8, 94); ctx.lineTo(64 + k * 14, 112); ctx.stroke(); }
  },
  hound(ctx, w, h) {
    shadow(ctx, w, h);
    const body = '#1d3b3a', hi = '#2f6460';
    ctx.fillStyle = body;
    poly(ctx, [[22, 80], [34, 58], [70, 52], [92, 40], [108, 44], [114, 58], [100, 64], [92, 78], [96, 104], [86, 104], [80, 84], [50, 84], [44, 106], [34, 106], [36, 84]]); ctx.fill();
    ctx.fillStyle = hi; poly(ctx, [[34, 60], [70, 54], [90, 44], [80, 62], [44, 68]]); ctx.fill();
    ctx.fillStyle = body; poly(ctx, [[92, 42], [98, 22], [104, 42]]); ctx.fill(); poly(ctx, [[100, 44], [110, 26], [112, 46]]); ctx.fill();
    glow(ctx, '#4dd6c1', 12, () => { ctx.strokeStyle = '#4dd6c1'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(30, 72); ctx.lineTo(88, 60); ctx.stroke(); });
    ctx.strokeStyle = body; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(24, 78); ctx.quadraticCurveTo(8, 70, 10, 52); ctx.stroke();
    eye(ctx, 104, 52, 3.5, '#6fffe9');
  },
  golem(ctx, w, h) {
    shadow(ctx, w, h);
    const rock = '#2b3448', face = '#3c4a66';
    ctx.fillStyle = rock; poly(ctx, [[34, 108], [40, 76], [30, 56], [44, 32], [84, 32], [98, 56], [88, 76], [94, 108], [74, 108], [70, 86], [58, 86], [54, 108]]); ctx.fill();
    ctx.fillStyle = face; poly(ctx, [[44, 34], [84, 34], [76, 60], [52, 60]]); ctx.fill();
    ctx.fillStyle = rock; poly(ctx, [[30, 56], [14, 74], [20, 96], [32, 90], [36, 72]]); ctx.fill(); poly(ctx, [[98, 56], [114, 74], [108, 96], [96, 90], [92, 72]]); ctx.fill();
    glow(ctx, '#6aa2ff', 16, () => {
      ctx.fillStyle = '#8ab6ff'; poly(ctx, [[50, 34], [58, 8], [64, 34]]); ctx.fill(); poly(ctx, [[66, 34], [76, 14], [80, 34]]); ctx.fill(); poly(ctx, [[60, 64], [68, 52], [76, 64], [68, 80]]); ctx.fill();
    });
    eye(ctx, 56, 46, 3, '#bfe0ff'); eye(ctx, 72, 46, 3, '#bfe0ff');
  },
  wyrm(ctx, w, h) {
    shadow(ctx, w, h);
    glow(ctx, '#ff6f3c', 18, () => {
      ctx.strokeStyle = '#4a1d12'; ctx.lineWidth = 22; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(14, 104); ctx.bezierCurveTo(40, 120, 70, 70, 52, 58); ctx.bezierCurveTo(34, 46, 60, 18, 88, 30); ctx.stroke();
    });
    ctx.strokeStyle = '#ff6f3c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(14, 104); ctx.bezierCurveTo(40, 120, 70, 70, 52, 58); ctx.bezierCurveTo(34, 46, 60, 18, 88, 30); ctx.stroke();
    ctx.fillStyle = '#5a2216'; poly(ctx, [[80, 20], [116, 30], [110, 44], [84, 42]]); ctx.fill();
    ctx.fillStyle = '#ffb347'; poly(ctx, [[84, 22], [80, 4], [92, 20]]); ctx.fill(); poly(ctx, [[96, 24], [100, 6], [104, 26]]); ctx.fill();
    ctx.fillStyle = '#ffd27f'; poly(ctx, [[110, 44], [118, 54], [104, 46]]); ctx.fill();
    eye(ctx, 102, 32, 4, '#ffdd55');
    ctx.fillStyle = '#ff6f3c'; for (const [x, y] of [[30, 108], [52, 82], [46, 56], [64, 34]]) { poly(ctx, [[x, y - 12], [x + 6, y - 2], [x - 6, y - 2]]); ctx.fill(); }
  },
};

export function makeCreatureTextures(scene) {
  for (const id of Object.keys(CREATURES)) if (!scene.textures.exists(`cr-${id}`)) canvasTex(scene, `cr-${id}`, SZ, SZ, (ctx, w, h) => DRAW[id](ctx, w, h));
  // player's base on the world map: platform + Beacon
  canvasTex(scene, 'world-base', 200, 200, (ctx, w) => {
    const c = w / 2;
    glow(ctx, '#ffb347', 30, () => { ctx.fillStyle = '#2a313c'; poly(ctx, [[c, 40], [c + 80, 100], [c, 160], [c - 80, 100]]); ctx.fill(); });
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3; poly(ctx, [[c, 40], [c + 80, 100], [c, 160], [c - 80, 100]]); ctx.stroke();
    ctx.fillStyle = '#3b4452'; ctx.fillRect(c - 12, 62, 24, 60);
    glow(ctx, '#ffb347', 26, () => { ctx.fillStyle = '#ffd27f'; ctx.beginPath(); ctx.arc(c, 56, 14, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#56606f'; for (const [x, y] of [[c - 44, 96], [c + 30, 92], [c - 6, 128]]) ctx.fillRect(x, y, 16, 14);
  });
  // squad marker on marches
  canvasTex(scene, 'world-squad', 64, 64, (ctx, w) => {
    glow(ctx, '#3ff0ff', 14, () => { ctx.fillStyle = '#0f2a30'; poly(ctx, [[w / 2, 6], [w - 8, w / 2], [w / 2, w - 6], [8, w / 2]]); ctx.fill(); });
    ctx.strokeStyle = '#3ff0ff'; ctx.lineWidth = 3; poly(ctx, [[w / 2, 6], [w - 8, w / 2], [w / 2, w - 6], [8, w / 2]]); ctx.stroke();
  });
}
