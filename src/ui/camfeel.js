// Stage 17: camera feel shared by the Base and World maps.
//  - drag inertia: a flick keeps the map gliding and eases to a stop (stops at the map edge)
//  - smooth wheel zoom: wheel steps set a target the camera eases toward, anchored under the cursor
// Under automation (navigator.webdriver) both are off unless window.__BD_TEST.feel is set, so
// tests that pan and then tap a computed point stay deterministic. prefers-reduced-motion turns them off too.
import { REDUCED_MOTION } from '../config.js';

export const feelOn = () => !REDUCED_MOTION && (typeof navigator === 'undefined' || !navigator.webdriver || !!window.__BD_TEST?.feel);

export function installCamFeel(scene, { minZ, maxZ }) {
  let samples = [], glide = null, wz = null;
  scene.stopGlide = () => { glide = null; wz = null; };
  scene.trackPan = (p) => {
    const t = performance.now();
    samples.push({ x: p.x, y: p.y, t });
    while (samples.length > 2 && t - samples[0].t > 90) samples.shift();
  };
  scene.beginPan = () => { samples = []; glide = null; };
  scene.releasePan = () => {
    const s = samples; samples = [];
    if (!feelOn() || s.length < 2) return;
    const a = s[0], b = s[s.length - 1], dt = Math.max(16, b.t - a.t);
    if (performance.now() - b.t > 80) return; // held still before release: no flick
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt; // screen px per ms
    const sp = Math.hypot(vx, vy);
    if (sp < 0.25) return;
    const k = Math.min(1, 2.6 / sp); // cap the flick speed
    glide = { vx: vx * k, vy: vy * k };
  };
  scene.wheelZoom = (sx, sy, factor) => {
    if (!feelOn()) { scene.zoomAt(sx, sy, scene.zl * factor); return; }
    glide = null;
    const base = wz ? wz.target : scene.zl;
    wz = { target: Math.min(maxZ(), Math.max(minZ(), base * factor)), sx, sy };
  };
  scene.events.on('update', (_t, dtMs) => {
    const dt = Math.min(dtMs, 50);
    const cam = scene.cameras.main;
    if (glide) {
      const z = scene.zl, x0 = cam.scrollX, y0 = cam.scrollY;
      cam.scrollX -= glide.vx * dt / z; cam.scrollY -= glide.vy * dt / z;
      scene.clampCamera();
      if (Math.abs(cam.scrollX - x0) < 1e-3) glide.vx = 0;
      if (Math.abs(cam.scrollY - y0) < 1e-3) glide.vy = 0;
      const f = Math.exp(-dt / 190);
      glide.vx *= f; glide.vy *= f;
      if (Math.hypot(glide.vx, glide.vy) < 0.02) glide = null;
    }
    if (wz) {
      const z = scene.zl, k = 1 - Math.exp(-dt / 60);
      let nz = z + (wz.target - z) * k;
      if (Math.abs(wz.target - nz) < wz.target * 2e-3) nz = wz.target;
      scene.zoomAt(wz.sx, wz.sy, nz);
      if (nz === wz.target) wz = null;
    }
  });
}
