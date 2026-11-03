// Stage 20: one font definition for the whole game. Source Sans 3 (labels + body) and Cinzel (titles and
// banners only), both OFL and bundled locally. Phaser rasterises text once, so the faces load before Boot starts the scenes.
import ss400 from '../assets/fonts/source-sans-3-latin-400-normal.woff2';
import ss600 from '../assets/fonts/source-sans-3-latin-600-normal.woff2';
import ss700 from '../assets/fonts/source-sans-3-latin-700-normal.woff2';
import cz700 from '../assets/fonts/cinzel-latin-700-normal.woff2';

export const FONT = '"Source Sans 3", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const TITLE_FONT = 'Cinzel, Georgia, "Times New Roman", serif';

const FACES = [['Source Sans 3', ss400, '400'], ['Source Sans 3', ss600, '600'], ['Source Sans 3', ss700, '700'], ['Cinzel', cz700, '700']];
let ready = null;
export function loadFonts(timeoutMs = 3000) {
  if (ready) return ready;
  const all = typeof FontFace === 'undefined' ? Promise.resolve() : Promise.all(FACES.map(([fam, url, weight]) =>
    new FontFace(fam, `url(${url})`, { weight, display: 'block' }).load().then((f) => document.fonts.add(f)).catch(() => null)));
  ready = Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]).then(() => { fontsLoaded.ok = [...(document.fonts ?? [])].filter((f) => f.status === 'loaded').map((f) => `${f.family}:${f.weight}`); });
  return ready;
}
export const fontsLoaded = { ok: [] };
