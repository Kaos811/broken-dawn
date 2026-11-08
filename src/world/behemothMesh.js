// stage 20c option A4 (angled painting, artwork/raw/behemoth-angled.jpg; motion ~1.8x A3). Was A3 (Behemoth): "bending 2D" on ONE painting: the centered, symmetrical winged Behemoth
// (cr-behemoth-w, 512px, keyed from artwork/raw/behemoth-centered.jpg), shown ~300px wide incl. wings, feet on the
// tile anchor (origin 0.5/0.97). Drawn as a Phaser Mesh grid; at rest every vertex sits exactly on the image's pixels
// (rest pose == the painting). The idle adds gentle per-vertex skinning: chest breathing, slight head turn/lift,
// weight shift with planted feet, crystal sway, wings flexing in the same mesh (roots fixed, tips move most), and an
// occasional small roar + wing stretch every 7-12 s. Weights are mirror-symmetric about the centre line.
const TAU = Math.PI * 2, GX = 24, GY = 24, TW = 512, CX = 256;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gau = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
const rot = (x, y, cx, cy, a) => { const c = Math.cos(a), s = Math.sin(a); return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; };
const KEY = 'cr-behemoth-w';
function grid(scene, x, y, depth) {
  const m = scene.add.mesh(x, y, KEY);
  Phaser.Geom.Mesh.GenerateGridVerts({ mesh: m, texture: KEY, width: TW, height: TW, widthSegments: GX, heightSegments: GY });
  m.hideCCW = false; m.ignoreDirtyCache = true; m.setDepth(depth);
  m.setOrtho(scene.scale.width, scene.scale.height);
  return m;
}
export const BH_MESH_W = 300;
export function buildBehemothMesh(scene, img, shimmer) {
  const body = grid(scene, img.x, img.y, img.depth);
  const w = body.vertices.map((v) => {
    const px = v.x + TW / 2, py = TW / 2 - v.y;
    // angled pose (3/4, facing front-left): near wing on the left, far wing on the right partly behind the body
    const legL = ss(300, 345, py), legR = ss(330, 380, py) * (1 - ss(385, 425, px));
    const wl = ss(152, 95, px) * (1 - legL), wr = ss(335, 388, px) * (1 - legR);
    const sd = wl > 0 ? -1 : 1, wing = Math.max(wl, wr);
    const reach = wl > 0 ? Math.min(1, (145 - px) / 115) : Math.max(0, Math.min(1, (px - 335) / 140));
    // head + horns move as ONE rigid piece (plateau weight) so the face never warps; falloff only in the neck
    const hd = Math.hypot((px - 200) / 100, (py - 255) / 112), head = (1 - ss(0.62, 1.0, hd)) * (1 - wing);
    return { px, py, sd, wing, reach, head, crys: ss(215, 120, py) * ss(120, 160, px) * ss(360, 320, px) * (1 - head),
      chest: Math.exp(-(((px - 235) / 95) ** 2 + ((py - 330) / 80) ** 2) / 2) * (1 - wing) * (1 - head), plant: ss(355, 440, py) };
  });
  let sh = null;
  if (shimmer) { sh = grid(scene, img.x, img.y, shimmer.depth); sh.setBlendMode(Phaser.BlendModes.ADD); sh.setTint(0x2fe0c8); sh.alpha = 0; shimmer.setVisible(false); }
  const r = { body, sh, w, all: sh ? [body, sh] : [body],
    T: { ph: Math.random() * TAU, br: 3.2 + Math.random() * 0.6, hd: 6 + Math.random() * 2, hph: Math.random() * TAU, wg: 4.2 + Math.random() * 0.8,
      shift: 0, tshift: 0, shiftAt: 2 + Math.random() * 2, bigAt: 5 + Math.random() * 4, big: 0 } };
  place(r, img.x, img.y, img.scaleX, null);
  return r;
}
function place(r, x0, y0, sc, f) {
  for (const m of r.all) m.setPosition(x0, y0);
  const vb = r.body.vertices, vs = r.sh?.vertices;
  for (let i = 0; i < vb.length; i++) {
    const q = r.w[i], d = f ? f(q) : null; const px = d ? d[0] : q.px, py = d ? d[1] : q.py;
    const vx = (px - CX) * sc, vy = -(py - TW * 0.97) * sc;
    vb[i].x = vx; vb[i].y = vy; if (vs) { vs[i].x = vx; vs[i].y = vy; }
  }
}
export function poseBehemothMesh(s, t, dt) {
  const r = s.rig, T = r.T, img = s.img;
  img.setScale(s.base).setPosition(s.x0, s.y0).setRotation(0);
  const br = Math.sin(TAU * t / T.br + T.ph);
  if (t > T.shiftAt) { T.shiftAt = t + 3 + Math.random() * 4; T.tshift = Math.random() * 2 - 1; }
  T.shift += (T.tshift - T.shift) * Math.min(1, dt * 1.2);
  if (t > T.bigAt) { T.bigAt = t + 7 + Math.random() * 5; T.big = 1; }
  T.big = Math.max(0, T.big - dt / 2.0);
  const big = Math.sin(Math.min(1, T.big) * Math.PI) ** 2;   // 0..1..0 over 2 s: small roar + wing stretch together
  const turn = Math.sin(TAU * t / T.hd + T.hph), lift = Math.sin(TAU * t / (T.hd * 0.7) + T.hph * 1.7);
  const flex = Math.sin(TAU * t / T.wg + T.ph);
  place(r, s.x0, s.y0, s.base, ({ px, py, sd, wing, reach, head, crys, chest, plant }) => {
    let x = px, y = py;
    const up = 1 - plant;
    const e = 0.05 * br * chest; x += (x - 235) * e; y += (y - 345) * e;                       // deeper breath
    y -= up * 4 * (br + 1) * (py / TW);                                                        // rise on the inhale
    if (crys > 0.01) { [x, y] = rot(x, y, 240, 215, crys * (0.035 * turn + 0.02 * flex)); y -= crys * 6 * big; } // crystal sway / bristle
    if (head > 0.01) {                                                                         // real head turn + lift (rigid head)
      [x, y] = rot(x, y, 245, 320, head * (0.07 * turn - 0.03 * lift - 0.08 * big));
      x += head * 6 * turn; y += head * (4 * lift - 9 * big);
    }
    if (wing > 0.01) {                                                                         // bold flex, full spread on the roar
      const k = wing * reach;
      [x, y] = rot(x, y, sd < 0 ? 148 : 336, sd < 0 ? 200 : 195, -sd * k * (0.1 * flex + 0.22 * big));
      x += sd * k * 16 * big;
    }
    x += up * 6 * T.shift;                                                                     // clearer weight shift, feet planted
    return [x, y];
  });
  const tint = img.tintTopLeft; if (r._t !== tint) { r._t = tint; r.body.setTint(tint); }
  if (r.sh) r.sh.alpha = 0.06 + 0.06 * Math.sin(TAU * t / 2.7 + s.idle.ph);
  return { sh: 1 - 0.04 * br, shx: 3 * T.shift };
}
