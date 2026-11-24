// Text animation engine — pure math shared by the canvas compositor (web)
// and the server's overlay PNG renderer. A preset maps progress → drawable state.
//
// state: { alpha, dx, dy, sx, sy, rot, blur, letterX (extra tracking px), clip? , perWord? }
// progress p ∈ [0,1] over the animation window; wp(i) gives per-word progress 0..1.

const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t * t * (3 - 2 * t);
const back = t => { const c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const elastic = t => (t === 0 || t === 1) ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;

const base = () => ({ alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, blur: 0, letterX: 0, clip: null, shake: 0, wave: 0, perWord: false, typewriter: 0, karaoke: false, glitch: 0, shine: 0, neon: 0, maskY: null });

export const TEXT_FX = {
  none: { label: 'None', fn: () => base() },
  fade: { label: 'Fade In', fn: (p, wp) => { const s = base(); s.alpha = p; return s; } },
  slideup: { label: 'Slide Up', fn: p => { const s = base(); const e = easeOut(p); s.dy = (1 - e) * 80; s.alpha = Math.min(1, p * 2); return s; } },
  slidedown: { label: 'Slide Down', fn: p => { const s = base(); const e = easeOut(p); s.dy = -(1 - e) * 80; s.alpha = Math.min(1, p * 2); return s; } },
  slideleft: { label: 'Slide Left', fn: p => { const s = base(); const e = easeOut(p); s.dx = (1 - e) * 120; s.alpha = Math.min(1, p * 2); return s; } },
  slideright: { label: 'Slide Right', fn: p => { const s = base(); const e = easeOut(p); s.dx = -(1 - e) * 120; s.alpha = Math.min(1, p * 2); return s; } },
  typewriter: { label: 'Typewriter', fn: (p, wp) => { const s = base(); s.typewriter = easeInOut(p); s.alpha = 1; return s; }, perChar: true },
  pop: { label: 'Pop', fn: p => { const s = base(); const e = back(Math.min(1, p)); s.sx = s.sy = 0.3 + 0.7 * e; s.alpha = Math.min(1, p * 3); return s; } },
  bounce: { label: 'Bounce', fn: p => { const s = base(); const e = 1 - Math.abs(Math.cos(p * Math.PI * 2.5)) * (1 - p); s.dy = (1 - e) * -60; s.sx = s.sy = 0.6 + 0.4 * Math.min(1, p * 1.5); s.alpha = Math.min(1, p * 4); return s; } },
  scalein: { label: 'Scale In', fn: p => { const s = base(); const e = easeOut(p); s.sx = s.sy = 0.5 + 0.5 * e; s.alpha = p; return s; } },
  blurin: { label: 'Blur In', fn: p => { const s = base(); const e = easeOut(p); s.blur = (1 - e) * 24; s.alpha = Math.min(1, p * 1.5); s.sx = s.sy = 1 + (1 - e) * 0.15; return s; } },
  flipin: { label: 'Flip In', fn: p => { const s = base(); const e = easeOut(p); s.sy = Math.max(0.02, e); s.alpha = Math.min(1, p * 2); return s; } },
  rotatein: { label: 'Rotate In', fn: p => { const s = base(); const e = easeOut(p); s.rot = (1 - e) * -12; s.alpha = Math.min(1, p * 2); s.sx = s.sy = 0.7 + 0.3 * e; return s; } },
  elastic: { label: 'Elastic', fn: p => { const s = base(); const e = elastic(Math.min(1, p)); s.sx = s.sy = e; s.alpha = Math.min(1, p * 4); return s; } },
  wordpop: { label: 'Word Pop (staggered)', fn: () => { const s = base(); s.perWord = true; return s; }, perWord: true },
  karaoke: { label: 'Karaoke Highlight', fn: () => { const s = base(); s.karaoke = true; s.perWord = true; return s; }, perWord: true },
  wave: { label: 'Wave', fn: () => { const s = base(); s.wave = 1; s.perWord = true; return s; }, perWord: true },
  shake: { label: 'Shake', fn: () => { const s = base(); s.shake = 1; s.perWord = true; return s; }, perWord: true },
  glitchtext: { label: 'Glitch', fn: p => { const s = base(); s.glitch = p < 1 ? 1 : 0; s.alpha = Math.min(1, p * 3); return s; } },
  shine: { label: 'Shine Sweep', fn: (p, wp) => { const s = base(); s.shine = p; s.alpha = Math.min(1, p * 3); return s; } },
  tracking: { label: 'Tracking In', fn: p => { const s = base(); const e = easeOut(p); s.letterX = (1 - e) * 40; s.alpha = p; return s; } },
  dropin: { label: 'Drop In', fn: p => { const s = base(); const e = easeOut(p); s.dy = -(1 - e) * 220; s.rot = (1 - e) * 4; s.alpha = Math.min(1, p * 3); return s; } },
  swing: { label: 'Swing', fn: p => { const s = base(); s.rot = Math.sin(p * Math.PI * 3) * (1 - p) * 8; s.alpha = Math.min(1, p * 3); s.dy = -20 * (1 - easeOut(p)); return s; } },
  neon: { label: 'Neon Flicker', fn: (p, wp) => { const s = base(); s.neon = 1; s.alpha = p < 0.15 ? Math.random() : 1; return s; } },
  maskreveal: { label: 'Mask Reveal', fn: p => { const s = base(); const e = easeInOut(p); s.maskY = e; return s; } },
  splitslide: { label: 'Split Slide', fn: p => { const s = base(); s.perWord = true; s.perWordSlide = easeOut(p); s.alpha = Math.min(1, p * 2.5); return s; }, perWord: true },
  jitter: { label: 'Jitter', fn: () => { const s = base(); s.shake = 0.5; s.perWord = true; return s; }, perWord: true },
  risefade: { label: 'Rise & Fade', fn: p => { const s = base(); const e = easeOut(p); s.dy = (1 - e) * 40; s.alpha = p; s.blur = (1 - e) * 4; return s; } },
};

export const TEXT_FX_OUT = {
  none: { label: 'None', fn: () => base() },
  fadeout: { label: 'Fade Out', fn: p => { const s = base(); s.alpha = 1 - p; return s; } },
  slideoutup: { label: 'Slide Out Up', fn: p => { const s = base(); s.dy = -easeOut(p) * 80; s.alpha = 1 - p * 0.8; return s; } },
  slideoutdown: { label: 'Slide Out Down', fn: p => { const s = base(); s.dy = easeOut(p) * 80; s.alpha = 1 - p * 0.8; return s; } },
  scaleout: { label: 'Scale Out', fn: p => { const s = base(); const e = easeOut(p); s.sx = s.sy = 1 - 0.4 * e; s.alpha = 1 - p; return s; } },
  blurout: { label: 'Blur Out', fn: p => { const s = base(); s.blur = easeOut(p) * 20; s.alpha = 1 - p; return s; } },
  dropout: { label: 'Drop Out', fn: p => { const s = base(); s.dy = easeOut(p) * 200; s.alpha = 1 - p * 0.9; s.rot = easeOut(p) * 5; return s; } },
};

export const textFxIn = id => TEXT_FX[id] || TEXT_FX.none;
export const textFxOut = id => TEXT_FX_OUT[id] || TEXT_FX_OUT.none;

/** Compose in + hold + out states for a text clip at local frame f. */
export function textState(clip, f, fps) {
  const t = clip.text || {};
  const animDur = Math.max(2, t.animDur || 18);
  const dur = clip.dur;
  let p = Math.min(1, f / animDur);
  const inFx = textFxIn(t.animIn || 'fade');
  let s = inFx.fn(p, f / animDur);
  if (t.animOut && t.animOut !== 'none' && f > dur - animDur) {
    const po = (dur - f) / animDur;
    const o = textFxOut(t.animOut).fn(1 - Math.max(0, po));
    s = { ...s, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0 && v != null && !(typeof v === 'number' && Math.abs(v) < 1e-9 && ['dx', 'dy', 'blur', 'rot'].includes('')))) };
    // simple composition: multiply alpha, add offsets
    s.alpha = Math.min(s.alpha, o.alpha);
    s.dx += o.dx; s.dy += o.dy; s.blur = Math.max(s.blur, o.blur);
    s.sx *= o.sx; s.sy *= o.sy;
  }
  return s;
}
