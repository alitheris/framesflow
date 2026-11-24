// FramesFlow shared project model v3 — pure JS, no Node/browser APIs.
// Used by BOTH the server (MCP tools, ffmpeg render) and the web app (standalone mode),
// so the AI and the UI always speak exactly the same language.
//
// Units: timeline positions are integer FRAMES at project fps; source offsets and
// transcript times are MILLISECONDS. Track array order = layer order (index 0 = topmost video).

export const uid = (p = '') => p + Math.random().toString(16).slice(2, 12);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const msToFrame = (ms, fps) => Math.round((ms * fps) / 1000);
export const frameToMs = (f, fps) => Math.round((f * 1000) / fps);

// ---------------------------------------------------------------- formats
// Only two aspect ratios are supported: 16:9 (landscape) and 9:16 (vertical).
export const FORMATS = [
  { id: 'hd', label: '16:9 · 1080p', w: 1920, h: 1080 },
  { id: 'hd720', label: '16:9 · 720p', w: 1280, h: 720 },
  { id: 'uhd', label: '16:9 · 4K', w: 3840, h: 2160 },
  { id: 'vertical', label: '9:16 · Reels/Shorts', w: 1080, h: 1920 },
];
export const FPS_OPTIONS = [24, 25, 30, 50, 60];
/** Reject any custom size that is not exactly 16:9 or 9:16. */
export function validSize(w, h) {
  const r = w / h;
  return Math.abs(r - 16 / 9) < 0.01 || Math.abs(r - 9 / 16) < 0.01;
}

// ---------------------------------------------------------------- tracks
export const TRACKS = [
  { id: 'V2', kind: 'video', name: 'Graphics', role: 'overlay' },
  { id: 'V1', kind: 'video', name: 'Footage', role: 'base' },
  { id: 'A1', kind: 'audio', name: 'Voiceover', role: 'voice' },
  { id: 'A2', kind: 'audio', name: 'Music', role: 'music' },
  { id: 'A3', kind: 'audio', name: 'SFX', role: 'sfx' },
];

// ---------------------------------------------------------------- transitions
// Each: id, label, group, dur (default frames), xfade → ffmpeg xfade transition name (null = custom render path).
export const TRANSITIONS = [
  { id: 'cut', label: 'Cut', group: 'Basic', dur: 0, xfade: null },
  { id: 'dissolve', label: 'Dissolve', group: 'Basic', dur: 12, xfade: 'fade' },
  { id: 'dipblack', label: 'Dip to Black', group: 'Basic', dur: 12, xfade: 'fadeblack' },
  { id: 'dipwhite', label: 'Dip to White', group: 'Basic', dur: 12, xfade: 'fadewhite' },
  { id: 'wipeleft', label: 'Wipe Left', group: 'Wipe', dur: 12, xfade: 'wipeleft' },
  { id: 'wiperight', label: 'Wipe Right', group: 'Wipe', dur: 12, xfade: 'wiperight' },
  { id: 'wipeup', label: 'Wipe Up', group: 'Wipe', dur: 12, xfade: 'wipeup' },
  { id: 'wipedown', label: 'Wipe Down', group: 'Wipe', dur: 12, xfade: 'wipedown' },
  { id: 'pushleft', label: 'Push Left', group: 'Push', dur: 12, xfade: 'slideleft' },
  { id: 'pushright', label: 'Push Right', group: 'Push', dur: 12, xfade: 'slideright' },
  { id: 'pushup', label: 'Push Up', group: 'Push', dur: 12, xfade: 'slideup' },
  { id: 'pushdown', label: 'Push Down', group: 'Push', dur: 12, xfade: 'slidedown' },
  { id: 'slideleft', label: 'Slide Left', group: 'Push', dur: 12, xfade: 'smoothleft' },
  { id: 'slideright', label: 'Slide Right', group: 'Push', dur: 12, xfade: 'smoothright' },
  { id: 'zoomin', label: 'Zoom In', group: 'Motion', dur: 10, xfade: 'zoomin' },
  { id: 'zoomout', label: 'Zoom Out', group: 'Motion', dur: 10, xfade: null },
  { id: 'spin', label: 'Spin', group: 'Motion', dur: 12, xfade: null },
  { id: 'whippan', label: 'Whip Pan', group: 'Motion', dur: 8, xfade: null },
  { id: 'blurdissolve', label: 'Blur Dissolve', group: 'Motion', dur: 12, xfade: null },
  { id: 'glitch', label: 'Glitch', group: 'Stylized', dur: 8, xfade: null },
  { id: 'pixelate', label: 'Pixelate', group: 'Stylized', dur: 10, xfade: 'pixelize' },
  { id: 'circleopen', label: 'Circle Open', group: 'Iris', dur: 12, xfade: 'circleopen' },
  { id: 'circleclose', label: 'Circle Close', group: 'Iris', dur: 12, xfade: 'circleclose' },
  { id: 'barndoor', label: 'Barn Door', group: 'Iris', dur: 12, xfade: 'circlecrop' },
  { id: 'clockwipe', label: 'Clock Wipe', group: 'Iris', dur: 14, xfade: 'radial' },
];
export const TRANSITION_IDS = TRANSITIONS.map(t => t.id);
export const transitionById = id => TRANSITIONS.find(t => t.id === id) || TRANSITIONS[0];
// legacy v2 names → v3
const LEGACY_TRANSITION = { dip: 'dipblack', whip: 'whippan' };

// ---------------------------------------------------------------- effects
// Each: id, label, group, params: [{key, label, min, max, step, def}], render hints.
export const EFFECTS = [
  { id: 'blur', label: 'Blur', group: 'Blur & Sharpen', params: [{ key: 'amount', label: 'Amount', min: 0, max: 60, step: 0.5, def: 8 }] },
  { id: 'sharpen', label: 'Sharpen', group: 'Blur & Sharpen', params: [{ key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.05, def: 0.8 }] },
  { id: 'exposure', label: 'Brightness / Contrast', group: 'Color', params: [
    { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, def: 0 },
    { key: 'contrast', label: 'Contrast', min: 0.2, max: 3, step: 0.01, def: 1 }] },
  { id: 'saturation', label: 'Saturation', group: 'Color', params: [{ key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.01, def: 1.2 }] },
  { id: 'hue', label: 'Hue Rotate', group: 'Color', params: [{ key: 'deg', label: 'Degrees', min: -180, max: 180, step: 1, def: 30 }] },
  { id: 'tint', label: 'Tint', group: 'Color', params: [
    { key: 'color', label: 'Color', type: 'color', def: '#ff9a5a' },
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.3 }] },
  { id: 'sepia', label: 'Sepia', group: 'Color', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.6 }] },
  { id: 'grayscale', label: 'Grayscale', group: 'Color', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 1 }] },
  { id: 'invert', label: 'Invert', group: 'Color', params: [] },
  { id: 'posterize', label: 'Posterize', group: 'Stylize', params: [{ key: 'levels', label: 'Levels', min: 2, max: 16, step: 1, def: 5 }] },
  { id: 'vignette', label: 'Vignette', group: 'Stylize', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 },
    { key: 'softness', label: 'Softness', min: 0.05, max: 1, step: 0.01, def: 0.5 }] },
  { id: 'grain', label: 'Film Grain', group: 'Stylize', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.35 }] },
  { id: 'glow', label: 'Glow / Bloom', group: 'Stylize', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 },
    { key: 'radius', label: 'Radius', min: 2, max: 80, step: 1, def: 24 }] },
  { id: 'pixelate', label: 'Pixelate', group: 'Stylize', params: [{ key: 'size', label: 'Pixel Size', min: 2, max: 80, step: 1, def: 12 }] },
  { id: 'chromatic', label: 'Chromatic Aberration', group: 'Stylize', params: [{ key: 'shift', label: 'Shift', min: 0, max: 40, step: 0.5, def: 6 }] },
  { id: 'glitchfx', label: 'Glitch', group: 'Stylize', params: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, def: 0.5 },
    { key: 'speed', label: 'Speed', min: 0.5, max: 10, step: 0.5, def: 3 }] },
  { id: 'mirror', label: 'Mirror', group: 'Distort', params: [{ key: 'axis', label: 'Axis', type: 'select', options: ['h', 'v'], def: 'h' }] },
  { id: 'denoise', label: 'Denoise (render)', group: 'Blur & Sharpen', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.4 }] },
];
export const EFFECT_IDS = EFFECTS.map(e => e.id);
export const effectById = id => EFFECTS.find(e => e.id === id);
export const defaultEffectParams = id => Object.fromEntries((effectById(id)?.params || []).map(p => [p.key, p.def]));

// Effect parameters that can be animated with keyframes (evaluated in the browser preview
// for ALL of them; the ffmpeg render is frame-exact for RENDER_EXACT, and uses the
// keyframe-average for the rest — see STUDIO-GUIDE.md "Effect keyframes").
export const EFFECT_KEYFRAMABLE = {
  blur: ['amount'], sharpen: ['amount'],
  exposure: ['brightness', 'contrast'], saturation: ['amount'], hue: ['deg'],
  tint: ['amount'], sepia: ['amount'], grayscale: ['amount'],
  vignette: ['amount', 'softness'], grain: ['amount'], glow: ['amount', 'radius'],
  pixelate: ['size'], chromatic: ['shift'], posterize: ['levels'],
};
export const EFFECT_KEYFRAMABLE_RENDER_EXACT = {
  exposure: ['brightness', 'contrast'], saturation: ['amount'], hue: ['deg'],
};

/** Effective value of an effect parameter at a clip-local frame (keyframes override params). */
export function effectParamAt(effect, key, localFrame, fallback = 0) {
  const kf = effect.keyframes?.[key];
  if (kf?.length) return evalKeys(kf, localFrame);
  return effect.params?.[key] ?? fallback;
}

/**
 * Effect stack with every keyframed parameter replaced by its value at a clip-local frame.
 * Used by the preview/browser-export compositor so effect keyframes animate in real time.
 */
export function resolveEffects(effects, localFrame) {
  if (!effects?.length) return effects || [];
  return effects.map(e => {
    if (!e.keyframes) return e;
    const params = { ...(e.params || {}) };
    for (const key of Object.keys(e.keyframes)) {
      const v = effectParamAt(e, key, localFrame, params[key]);
      if (Number.isFinite(v)) params[key] = v;
    }
    return { ...e, params };
  });
}

// ---------------------------------------------------------------- text animations
export const TEXT_ANIMS_IN = [
  'none', 'fade', 'slideup', 'slidedown', 'slideleft', 'slideright', 'typewriter', 'pop', 'bounce',
  'scalein', 'blurin', 'flipin', 'rotatein', 'elastic', 'wordpop', 'karaoke', 'wave', 'shake',
  'glitchtext', 'shine', 'tracking', 'dropin', 'swing', 'neon', 'maskreveal', 'splitslide', 'jitter', 'risefade',
];
export const TEXT_ANIMS_OUT = ['none', 'fadeout', 'slideoutup', 'slideoutdown', 'scaleout', 'blurout', 'dropout'];
export const TEXT_FONTS = [
  { id: 'Montserrat', label: 'Montserrat' },
  { id: 'Poppins', label: 'Poppins' },
  { id: 'Space Grotesk', label: 'Space Grotesk' },
  { id: 'Arial Black', label: 'Arial Black' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Courier New', label: 'Courier New' },
  { id: 'Impact', label: 'Impact' },
];
export const TEXT_KINDS = ['title', 'fact', 'lower', 'stat', 'quote', 'chapter', 'caption', 'subtitle'];
export const TEXT_POSITIONS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br', 'center'];

export function defaultTextStyle(kind = 'title') {
  return {
    kind, font: 'Montserrat', fontSize: kind === 'caption' || kind === 'subtitle' ? 54 : 96, weight: 800,
    color: '#ffffff', stroke: '#000000', strokeWidth: 0, shadow: 0.6, bg: 'none', align: 'center',
    letterSpacing: 0, lineHeight: 1.15, maxWidth: 0.8,
    animIn: kind === 'caption' ? 'wordpop' : 'fade', animOut: 'none', animDur: 18,
  };
}

// ---------------------------------------------------------------- grades (legacy presets, kept)
export const GRADES = {
  none: {},
  cinema: { brightness: 0, contrast: 1.08, saturation: 0.95, teal: 0.35, vignette: 0.25, sharpen: 0.3, denoise: 0.3 },
  documentary: { brightness: 0, contrast: 1.05, saturation: 0.9, teal: 0.2, vignette: 0.15, sharpen: 0.35, denoise: 0.4 },
  archival: { brightness: 0.02, contrast: 1.12, saturation: 0.55, teal: 0, vignette: 0.35, sharpen: 0.1, denoise: 0.6, grain: 0.3 },
  vivid: { brightness: 0, contrast: 1.08, saturation: 1.35, teal: 0.1, vignette: 0.1, sharpen: 0.3, denoise: 0.2 },
  noir: { brightness: -0.02, contrast: 1.25, saturation: 0, teal: 0, vignette: 0.4, sharpen: 0.25, denoise: 0.3 },
  warm: { brightness: 0.02, contrast: 1.05, saturation: 1.1, teal: -0.2, vignette: 0.15, sharpen: 0.25, denoise: 0.2 },
};

// ---------------------------------------------------------------- audio fx
export const AUDIO_FX = {
  eq: { low: 0, mid: 0, high: 0 },           // dB, -18..18
  reverb: 0,          // 0..1 wet
  compressor: 0,      // 0..1 amount
  delay: 0,           // 0..1 wet
};

// ---------------------------------------------------------------- keyframes
export const KEYFRAMABLE = ['scale', 'x', 'y', 'rotation', 'opacity', 'volume'];

/** Evaluate a keyframe array at a local frame (0 = clip start). */
export function evalKeys(keys, frame) {
  if (!keys || !keys.length) return null;
  const k = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= k[0].frame) return k[0].value;
  if (frame >= k[k.length - 1].frame) return k[k.length - 1].value;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      if (a.interp === 'hold') return a.value;
      let t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      if (a.interp === 'ease') t = t * t * (3 - 2 * t); // smoothstep
      return a.value + (b.value - a.value) * t;
    }
  }
  return k[k.length - 1].value;
}

// ---------------------------------------------------------------- project
export function newProject(name = 'Untitled video') {
  return {
    version: 3,
    id: uid('p_'),
    name,
    createdAt: Date.now(),
    settings: {
      fps: 30, width: 1920, height: 1080, loudness: -14, musicDb: -30, grade: 'cinema',
      accent: '#d8f36a', niche: '', topic: '', voiceLock: false,
    },
    script: '',
    meta: { titleIdeas: [], thumbnailIdeas: [], notes: '' },
    tracks: TRACKS.map(t => ({ ...t, muted: false, locked: false, solo: false, height: undefined })),
    assets: {},
    clips: [],
    markers: [],
    plan: null, // { mix:{youtube,image,animation}, rows:[{id,startMs,endMs,type,...}], createdAt }
    transcript: null,
    beats: [],
    chapters: [],
  };
}

/** Migrate any older project (v1/v2) to v3 in place — never throws. */
export function migrateProject(p) {
  if (!p || typeof p !== 'object') return newProject();
  const v3 = newProject(p.name || 'Untitled');
  const fps = p.settings?.fps || 30;
  p.version = 3;
  p.settings = { ...v3.settings, ...p.settings, fps };
  p.tracks = Array.isArray(p.tracks) && p.tracks.length ? p.tracks.map(t => ({ height: undefined, ...t })) : v3.tracks;
  p.markers = Array.isArray(p.markers) ? p.markers : [];
  p.plan = p.plan || null;
  // clips: upgrade defaults
  for (const c of p.clips || []) {
    if (c.transition?.type) {
      if (LEGACY_TRANSITION[c.transition.type]) c.transition.type = LEGACY_TRANSITION[c.transition.type];
      if (!TRANSITION_IDS.includes(c.transition.type)) c.transition = { type: 'cut', dur: 0 };
    }
    if (c.type === 'text' && c.text) c.text = { ...defaultTextStyle(c.text.kind || 'fact'), ...c.text };
    if (c.effects && !Array.isArray(c.effects)) c.effects = [];
    if (c.keyframes && typeof c.keyframes !== 'object') c.keyframes = undefined;
  }
  return p;
}

export const clipEnd = c => c.start + c.dur;

/**
 * Every clip that makes sound: real audio clips plus video clips whose own audio is switched on
 * (clip.audio === true and the asset really has an audio stream). Video-embedded audio is returned
 * as a pseudo audio clip (same id/timing/volume) so the preview mixer, browser export and ffmpeg
 * render all treat it identically.
 */
export function audioClips(p) {
  const out = [];
  for (const c of p.clips) {
    if (c.type === 'audio') out.push(c);
    else if (c.type === 'video' && c.audio === true && p.assets[c.assetId]?.hasAudio) out.push({ ...c, type: 'audio', fromVideo: true });
  }
  return out;
}
export const srcSpanMs = (c, fps) => Math.round(frameToMs(c.dur, fps) * (c.speed || 1));

export function voiceClip(p) {
  return p.clips.filter(c => (c.track === 'A1' || p.tracks.find(t => t.id === c.track)?.role === 'voice') && c.assetId).sort((a, b) => a.start - b.start)[0] || null;
}

/** Final video length in frames: locked to the voiceover end only when voiceLock is set (AI pipeline). */
export function projectFrames(p) {
  const fps = p.settings?.fps || 30;
  if (p.settings?.voiceLock && p.transcript?.voiceEndMs) return msToFrame(p.transcript.voiceEndMs, fps);
  const v = voiceClip(p);
  if (v) return Math.max(clipEnd(v), ...p.clips.map(clipEnd));
  return Math.max(0, ...p.clips.map(clipEnd));
}

export function defaultClip(p, fields) {
  return {
    id: uid('c_'), track: 'V1', type: 'video', start: 0, dur: 90, in: 0, speed: 1,
    volume: 1, fadeIn: 0, fadeOut: 0, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1,
    fit: 'cover', audio: false, grade: null, kenburns: null, transition: { type: 'cut', dur: 0 }, label: '', color: null,
    flipH: false, flipV: false, effects: [], keyframes: undefined, audioFx: undefined,
    mask: null, graphic: undefined,
    ...fields,
  };
}

const num = (v, a, b, name) => {
  if (!Number.isFinite(v) || v < a || v > b) throw new Error(`${name} must be between ${a} and ${b}`);
  return v;
};

/** Normalise + validate a clip in place. Throws on invalid input. */
export function checkClip(p, c) {
  if (!p.tracks.some(t => t.id === c.track)) throw new Error(`Unknown track ${c.track}`);
  const track = p.tracks.find(t => t.id === c.track);
  const fps = p.settings?.fps || 30;
  c.start = Math.round(num(c.start, 0, 1e7, 'start'));
  c.dur = Math.max(1, Math.round(num(c.dur, 1, 1e7, 'dur')));
  c.in = Math.max(0, Math.round(num(c.in ?? 0, 0, 1e9, 'in')));
  c.speed = num(c.speed ?? 1, 0.1, 8, 'speed');
  c.volume = num(c.volume ?? 1, 0, 4, 'volume');
  c.fadeIn = Math.round(num(c.fadeIn ?? 0, 0, 1e5, 'fadeIn'));
  c.fadeOut = Math.round(num(c.fadeOut ?? 0, 0, 1e5, 'fadeOut'));
  c.scale = num(c.scale ?? 1, 0.05, 8, 'scale');
  c.x = num(c.x ?? 0, -400, 400, 'x');
  c.y = num(c.y ?? 0, -400, 400, 'y');
  c.rotation = num(c.rotation ?? 0, -3600, 3600, 'rotation');
  c.opacity = num(c.opacity ?? 1, 0, 1, 'opacity');
  if (c.audio != null) c.audio = !!c.audio;
  if (c.effects) {
    if (!Array.isArray(c.effects)) throw new Error('effects must be an array');
    for (const e of c.effects) {
      if (!EFFECT_IDS.includes(e.type)) throw new Error(`Unknown effect ${e.type}`);
      e.params = { ...defaultEffectParams(e.type), ...(e.params || {}) };
      if (e.keyframes) {
        const allowed = EFFECT_KEYFRAMABLE[e.type] || [];
        for (const k of Object.keys(e.keyframes)) {
          if (!allowed.includes(k)) throw new Error(`Effect ${e.type} parameter "${k}" cannot be keyframed (allowed: ${allowed.join(', ') || 'none'})`);
          if (!Array.isArray(e.keyframes[k])) throw new Error(`effect keyframes.${k} must be an array`);
          for (const key of e.keyframes[k]) {
            if (!Number.isFinite(key.frame) || key.frame < 0) throw new Error(`effect keyframes.${k}: frame must be ≥ 0`);
            if (!Number.isFinite(key.value)) throw new Error(`effect keyframes.${k}: value must be a number`);
            if (key.interp && !['linear', 'ease', 'hold'].includes(key.interp)) throw new Error(`effect keyframes.${k}: interp must be linear|ease|hold`);
          }
        }
        if (!Object.keys(e.keyframes).length) delete e.keyframes;
      }
    }
  }
  if (c.keyframes) {
    for (const k of Object.keys(c.keyframes)) {
      if (!KEYFRAMABLE.includes(k)) throw new Error(`Cannot keyframe ${k}`);
      if (!Array.isArray(c.keyframes[k])) throw new Error(`keyframes.${k} must be an array`);
    }
  }
  if (c.transition && !TRANSITION_IDS.includes(c.transition.type)) throw new Error(`Unknown transition ${c.transition.type}`);
  if (c.assetId && !p.assets[c.assetId]) throw new Error(`Unknown asset ${c.assetId}`);
  if (track.kind === 'audio' && c.type !== 'audio') throw new Error('Only audio clips go on audio tracks');
  if (track.kind === 'video' && c.type === 'audio') throw new Error('Audio clips cannot go on video tracks');
  if (c.type === 'effect') {
    // effect layer (adjustment layer): no media; applies its effect stack to everything on the tracks below
    if (track.kind !== 'video') throw new Error('Effect layers go on video tracks');
    c.effects = Array.isArray(c.effects) ? c.effects : [];
    delete c.assetId;
  }
  if (c.type === 'text' && !c.text) throw new Error('Text clips need a text object');
  if (c.type === 'graphic' && !c.graphic) throw new Error('Graphic clips need a graphic object');
  // watermark mask: normalized 0..1 region, always clamped
  if (c.mask) {
    const m = c.mask;
    for (const k of ['x', 'y', 'w', 'h']) m[k] = clamp(Number(m[k]) || 0, 0, 1);
    m.w = Math.max(0.02, Math.min(1, m.w)); m.h = Math.max(0.02, Math.min(1, m.h));
    if (m.x + m.w > 1) m.x = 1 - m.w;
    if (m.y + m.h > 1) m.y = 1 - m.h;
    m.mode = 'blur';
  }
  return c;
}

export function sortedTrack(p, trackId) {
  return p.clips.filter(c => c.track === trackId).sort((a, b) => a.start - b.start);
}

/** Effective property value (base value + keyframe override) at a local frame. */
export function propAt(c, key, frame, fps) {
  const kf = c.keyframes?.[key];
  if (kf?.length) return evalKeys(kf, frame - c.start);
  if (key === 'volume') return c.volume ?? 1;
  return c[key] ?? (key === 'opacity' ? 1 : key === 'scale' ? 1 : 0);
}

/** Short, token-cheap description of the timeline for AI clients. */
export function summarize(p, { clips = true, limit = 400 } = {}) {
  const fps = p.settings?.fps || 30;
  const frames = projectFrames(p);
  const v = voiceClip(p);
  const out = {
    id: p.id, name: p.name, version: p.version, settings: p.settings,
    durationMs: frameToMs(frames, fps), frames,
    voiceover: v ? { assetId: v.assetId, name: p.assets[v.assetId]?.name } : null,
    scriptChars: p.script.length,
    transcript: p.transcript ? { engine: p.transcript.engine, words: p.transcript.words.length, sentences: p.transcript.sentences.length, voiceEndMs: p.transcript.voiceEndMs } : null,
    beats: p.beats.length,
    beatsWithoutClip: p.beats.filter(b => !p.clips.some(c => c.beatId === b.id && c.track === 'V1')).length,
    markers: p.markers.length,
    tracks: p.tracks.map(t => ({ id: t.id, name: t.name, kind: t.kind, muted: t.muted, clips: p.clips.filter(c => c.track === t.id).length })),
    assets: Object.values(p.assets).map(a => ({ id: a.id, kind: a.kind, name: a.name, durationMs: a.duration, source: a.source ? { url: a.source.url, title: a.source.title } : null })).slice(0, limit),
    catalogs: {
      transitions: TRANSITION_IDS, effects: EFFECT_IDS, textAnims: TEXT_ANIMS_IN, formats: FORMATS.map(f => f.id),
    },
  };
  if (clips) {
    out.clips = [...p.clips].sort((a, b) => a.start - b.start || a.track.localeCompare(b.track)).slice(0, limit).map(c => ({
      id: c.id, track: c.track, type: c.type, start: c.start, dur: c.dur, startMs: frameToMs(c.start, fps), endMs: frameToMs(c.start + c.dur, fps),
      label: c.label || c.text?.title || p.assets[c.assetId]?.name, assetId: c.assetId, inMs: c.in, beatId: c.beatId,
      ...(c.effects?.length ? { effects: c.effects.map(e => e.type) } : {}),
      ...(c.keyframes && Object.keys(c.keyframes).length ? { keyframed: Object.keys(c.keyframes) } : {}),
      ...(c.source ? { src: c.source.url, srcRange: [c.source.inMs, c.source.outMs] } : {}),
      ...(c.transition?.type && c.transition.type !== 'cut' ? { transition: c.transition.type } : {}),
    }));
  }
  return out;
}
