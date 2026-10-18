// Stage 5 audio: every sound is synthesized with WebAudio at runtime (no audio files, nothing to
// license, ~0 KB of assets). Sound effects are tiny jsfxr-style recipes; music is a small step
// sequencer with one generated track per screen (base / world / battle) that crossfades.
// Browsers only allow audio after a user gesture, so the context is created on the first tap.
import { store } from '../state/store.js';
import { AUDIO } from '../config.js';

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note -> Hz

// ------------------------------------------------------------------ music --
// Each track: bpm, a 4-bar chord loop (MIDI roots + chord tones) and which layers play.
const TRACKS = {
  base: { bpm: 72, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], pad: 0.16, bell: 0.07, arp: 0, drums: 0, bass: 0.05 },
  world: { bpm: 96, chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 48, 52]], pad: 0.09, bell: 0, arp: 0.06, drums: 0.25, bass: 0.09 },
  battle: { bpm: 128, chords: [[45, 48, 52], [45, 48, 52], [41, 45, 48], [43, 47, 50]], pad: 0.05, bell: 0, arp: 0.05, drums: 1, bass: 0.12 },
};
const BELL = [0, 3, 7, 10, 12, 15, 19]; // minor pentatonic-ish offsets

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.paused = false;
    this.track = null;            // wanted track id
    this.voices = {};             // track id -> { gain, step, next }
    this.stats = { requested: 0, played: 0, suppressed: 0, last: null, byName: {}, haptics: 0, trackChanges: 0 };
    this.lastAt = {};
    this.timer = null;
  }

  get settings() { return store.state.settings ?? { music: AUDIO.music, sfx: AUDIO.sfx, muted: false, haptics: true }; }

  // Call once at boot: arms the first-gesture unlock and pause-on-hide.
  init() {
    if (this.inited || typeof window === 'undefined') return;
    this.inited = true;
    const unlock = () => this.unlock();
    for (const e of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(e, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    store.on('settings', () => this.applySettings());
    store.on('reset', () => this.applySettings());
  }

  unlock() {
    if (this.paused) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 4;
      this.master = c.createGain(); this.music = c.createGain(); this.sfx = c.createGain();
      this.music.connect(this.master); this.sfx.connect(this.master); this.master.connect(this.comp); this.comp.connect(c.destination);
      // shared white-noise buffer (hats, hits, whooshes)
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
      this.applySettings(true);
    }
    if (this.ctx.state !== 'running') this.ctx.resume?.().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      this.startScheduler();
      if (this.track) this.startVoice(this.track);
    }
  }

  onVisibility() {
    const hidden = document.visibilityState === 'hidden';
    this.paused = hidden;
    if (!this.ctx) return;
    if (hidden) { this.ctx.suspend?.().catch(() => {}); this.stopScheduler(); }
    else if (this.unlocked) { this.ctx.resume?.().catch(() => {}); this.startScheduler(); }
  }

  applySettings(immediate = false) {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime, k = immediate ? 0.001 : 0.08;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, k);
    this.music.gain.setTargetAtTime(s.music * 0.55, t, k);
    this.sfx.gain.setTargetAtTime(s.sfx, t, k);
  }

  state() {
    return { unlocked: this.unlocked, ctx: this.ctx?.state ?? 'none', paused: this.paused, track: this.track, playing: Object.keys(this.voices), ...this.stats, muted: this.settings.muted };
  }

  // ---------------------------------------------------------------- SFX --
  play(name, opts = {}) {
    this.stats.requested++;
    this.stats.byName[name] = (this.stats.byName[name] ?? 0) + 1;
    const s = this.settings;
    if (!this.ctx || !this.unlocked || this.paused || s.muted || s.sfx <= 0 || !SFX[name]) { this.stats.suppressed++; return false; }
    const now = performance.now();
    if (now - (this.lastAt[name] ?? 0) < (opts.gap ?? 45)) return false; // de-dupe bursts
    this.lastAt[name] = now;
    try { SFX[name](this, this.ctx.currentTime + 0.005, opts); } catch { return false; }
    this.stats.played++; this.stats.last = name;
    return true;
  }

  haptic(pattern = 10) {
    if (!this.settings.haptics) return false;
    this.stats.haptics++;
    try { return navigator.vibrate?.(pattern) ?? false; } catch { return false; }
  }

  // building blocks
  tone(t, { f = 440, f2 = null, type = 'square', dur = 0.1, vol = 0.2, a = 0.004, out = this.sfx, filter = null, detune = 0 }) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const fl = c.createBiquadFilter(); fl.type = filter.type ?? 'lowpass'; fl.frequency.value = filter.f; fl.Q.value = filter.q ?? 0.7; o.connect(fl); node = fl; }
    node.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(t, { dur = 0.08, vol = 0.2, f = 3000, type = 'highpass', f2 = null, out = this.sfx }) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // -------------------------------------------------------------- music --
  setTrack(id) {
    if (id === this.track) return;
    this.track = id;
    this.stats.trackChanges++;
    if (!this.ctx || !this.unlocked) return;
    const t = this.ctx.currentTime, X = AUDIO.crossfade;
    for (const [k, v] of Object.entries(this.voices)) {
      if (k === id) continue;
      v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(0, t + X);
      v.dying = true;
      setTimeout(() => { if (this.voices[k] === v) { v.gain.disconnect(); delete this.voices[k]; } }, X * 1000 + 300);
    }
    if (id) this.startVoice(id);
  }

  startVoice(id) {
    if (!TRACKS[id] || !this.ctx) return;
    let v = this.voices[id];
    const t = this.ctx.currentTime;
    if (!v) {
      const gain = this.ctx.createGain(); gain.gain.value = 0; gain.connect(this.music);
      v = this.voices[id] = { gain, step: 0, next: t + 0.05 };
    }
    v.dying = false;
    v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(1, t + AUDIO.crossfade);
  }

  startScheduler() { if (!this.timer) this.timer = setInterval(() => this.schedule(), 60); }
  stopScheduler() { clearInterval(this.timer); this.timer = null; }

  schedule() {
    if (!this.ctx || this.paused) return;
    const ahead = this.ctx.currentTime + 0.22;
    for (const [id, v] of Object.entries(this.voices)) {
      const T = TRACKS[id], sixteenth = 60 / T.bpm / 4;
      if (v.next < this.ctx.currentTime - 1) v.next = this.ctx.currentTime + 0.02; // after a suspend
      while (v.next < ahead) { this.playStep(T, v, v.step, v.next, sixteenth); v.step = (v.step + 1) % 64; v.next += sixteenth; }
    }
  }

  playStep(T, v, step, t, s16) {
    const out = v.gain, bar = Math.floor(step / 16), pos = step % 16, chord = T.chords[bar];
    if (T.pad && pos === 0) {
      // slow detuned pad, one chord per bar
      for (const n of chord) for (const dt of [-7, 7]) this.tone(t, { f: NOTE(n), type: 'sawtooth', dur: s16 * 16 + 0.6, vol: T.pad / 3, a: s16 * 5, out, filter: { f: 900 }, detune: dt });
    }
    if (T.bass && (T.drums ? pos % 4 === 0 || pos === 10 : pos === 0 || pos === 8)) {
      this.tone(t, { f: NOTE(chord[0] - 12), type: T.drums ? 'sawtooth' : 'sine', dur: s16 * (T.drums ? 2.5 : 7), vol: T.bass, a: 0.01, out, filter: { f: T.drums ? 500 : 2000 } });
    }
    if (T.arp && pos % (T.drums > 0.5 ? 1 : 2) === 0) {
      const seq = [0, 1, 2, 1, 2, 0, 2, 1];
      const n = chord[seq[(pos / 2 + bar) % seq.length | 0]] + 12 + (pos % 8 === 6 ? 12 : 0);
      this.tone(t, { f: NOTE(n), type: 'square', dur: s16 * 0.9, vol: T.arp, out, filter: { f: 1800 + 600 * Math.sin(step / 9) } });
    }
    if (T.bell && (pos === 6 || (pos === 13 && bar % 2))) {
      const n = chord[0] + 12 + BELL[(step * 7 + bar * 3) % BELL.length];
      this.tone(t, { f: NOTE(n), type: 'sine', dur: 1.6, vol: T.bell, a: 0.01, out });
      this.tone(t, { f: NOTE(n + 12), type: 'sine', dur: 0.8, vol: T.bell / 3, a: 0.01, out });
    }
    if (T.drums) {
      const d = T.drums;
      if (pos % 4 === 0 && (d > 0.5 || pos % 8 === 0)) this.tone(t, { f: 140, f2: 42, type: 'sine', dur: 0.22, vol: 0.5 * d, a: 0.002, out });
      if (d > 0.5 && (pos === 4 || pos === 12)) this.hiss(t, { dur: 0.16, vol: 0.22 * d, f: 1400, type: 'bandpass', out });
      if (pos % 2 === 0) this.hiss(t, { dur: pos % 4 === 2 ? 0.06 : 0.03, vol: 0.07 * Math.max(0.5, d), f: 7000, out });
    }
  }
}

// ---------------------------------------------------------- SFX recipes --
// (engine, startTime, opts). Keep them short and quiet; the compressor glues the mix.
const SFX = {
  tap: (A, t) => A.tone(t, { f: 1250, f2: 820, dur: 0.045, vol: 0.09 }),
  toggle: (A, t) => { A.tone(t, { f: 700, dur: 0.04, vol: 0.08 }); A.tone(t + 0.05, { f: 1050, dur: 0.05, vol: 0.08 }); },
  error: (A, t) => A.tone(t, { f: 200, f2: 120, type: 'sawtooth', dur: 0.16, vol: 0.12, filter: { f: 1200 } }),
  open: (A, t) => A.hiss(t, { dur: 0.12, vol: 0.06, f: 600, f2: 3200, type: 'bandpass' }),
  build: (A, t) => { A.tone(t, { f: 110, f2: 60, type: 'triangle', dur: 0.18, vol: 0.3 }); A.hiss(t, { dur: 0.1, vol: 0.12, f: 2500 }); A.hiss(t + 0.12, { dur: 0.08, vol: 0.08, f: 3500 }); },
  levelup: (A, t) => [60, 64, 67, 72, 76].forEach((n, i) => A.tone(t + i * 0.07, { f: NOTE(n + 12), type: 'triangle', dur: 0.22, vol: 0.16 })),
  train: (A, t) => { A.tone(t, { f: NOTE(67), type: 'square', dur: 0.08, vol: 0.08, filter: { f: 2500 } }); A.tone(t + 0.09, { f: NOTE(74), type: 'square', dur: 0.12, vol: 0.08, filter: { f: 2500 } }); },
  research: (A, t) => { A.tone(t, { f: 500, f2: 1600, type: 'sine', dur: 0.5, vol: 0.12 }); [76, 79, 83].forEach((n, i) => A.tone(t + 0.15 + i * 0.09, { f: NOTE(n), type: 'sine', dur: 0.4, vol: 0.09 })); },
  reveal: (A, t, o) => { const k = { common: 1, rare: 2, epic: 3, legendary: 5 }[o.rarity] ?? 1; for (let i = 0; i < k; i++) A.tone(t + i * 0.06, { f: NOTE(72 + [0, 4, 7, 12, 16][i]), type: 'triangle', dur: 0.3 + i * 0.05, vol: 0.12 }); if (k >= 3) A.hiss(t, { dur: 0.5, vol: 0.06, f: 5000 }); },
  march: (A, t) => { A.tone(t, { f: 196, type: 'sawtooth', dur: 0.32, vol: 0.12, filter: { f: 900 } }); A.tone(t + 0.12, { f: 294, type: 'sawtooth', dur: 0.3, vol: 0.1, filter: { f: 1100 } }); },
  hit: (A, t) => { A.hiss(t, { dur: 0.06, vol: 0.14, f: 1800 }); A.tone(t, { f: 160, f2: 70, type: 'square', dur: 0.06, vol: 0.08, filter: { f: 900 } }); },
  crit: (A, t) => { A.hiss(t, { dur: 0.12, vol: 0.2, f: 1200 }); A.tone(t, { f: 1600, f2: 900, type: 'square', dur: 0.12, vol: 0.08, filter: { f: 4000 } }); },
  win: (A, t) => [67, 72, 76, 79].forEach((n, i) => A.tone(t + i * 0.11, { f: NOTE(n), type: 'square', dur: i === 3 ? 0.6 : 0.14, vol: 0.1, filter: { f: 3000 } })),
  lose: (A, t) => [64, 61, 57].forEach((n, i) => A.tone(t + i * 0.16, { f: NOTE(n), type: 'triangle', dur: 0.3, vol: 0.12 })),
  heal: (A, t) => A.tone(t, { f: 440, f2: 880, type: 'sine', dur: 0.35, vol: 0.1 }),
  reward: (A, t) => { A.tone(t, { f: NOTE(84), type: 'sine', dur: 0.12, vol: 0.12 }); A.tone(t + 0.08, { f: NOTE(91), type: 'sine', dur: 0.25, vol: 0.12 }); },
  toast: (A, t) => A.tone(t, { f: 900, dur: 0.035, vol: 0.04, type: 'sine' }),
};
export const SFX_NAMES = Object.keys(SFX);

export const audio = new AudioEngine();
