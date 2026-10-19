// HUD layout (game units, 720 wide). The top HUD and bottom nav grow by the device safe-area insets
// (notch / home indicator) so their content never sits under them. Read once at load; a rotation
// reloads the page anyway (see main.js).
import { GAME_WIDTH, GAME_HEIGHT } from '../config.js';

function readInsets() {
  const o = typeof window !== 'undefined' ? window.__BD_TEST?.safe : null; // CSS px override for tests
  let top = 0, bottom = 0;
  if (o) { top = o.top || 0; bottom = o.bottom || 0; }
  else if (typeof document !== 'undefined' && document.body) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(d);
    const cs = getComputedStyle(d);
    top = parseFloat(cs.paddingTop) || 0; bottom = parseFloat(cs.paddingBottom) || 0;
    d.remove();
  }
  if (!top && !bottom) return { top: 0, bottom: 0 };
  // Scale.FIT: CSS px per game unit, and the letterbox band (if any) already clears part of the inset
  const iw = window.innerWidth, ih = window.innerHeight;
  const s = Math.min(iw / GAME_WIDTH, ih / GAME_HEIGHT);
  const band = Math.max(0, (ih - GAME_HEIGHT * s) / 2);
  return { top: Math.round(Math.max(0, top - band) / s), bottom: Math.round(Math.max(0, bottom - band) / s) };
}

export const SAFE = readInsets();
export const HUD_CONTENT_H = 176;          // portrait row + resource capsules
export const TOP_H = SAFE.top + HUD_CONTENT_H;
export const NAV_BODY = 132;               // sculpted bar (labels + icons), above the home-indicator inset
export const NAV_H = NAV_BODY + SAFE.bottom;
export const HERO_R = 64;                  // World emblem button radius
export const HERO_RISE = 34;               // how far the emblem rises above the bar
