// WebAudio preview engine: per-clip gain (volume × fades × volume keyframes), 3-band EQ,
// reverb / compressor / delay, per-track gain, master meter. All real-time, all WYSIWYG
// with the ffmpeg mix (same parameters are baked into the render filter graph).
import { propAt, audioClips } from '../../../shared/model.mjs';

let ctxA = null;
const nodes = new Map();      // clipId → { el, src, gain, low, mid, high, comp, convolver?, wet?, delay? }
let trackGains = new Map();   // trackId → GainNode
let master = null, analyser = null, masterData = null;
let currentProject = null;

export function ensureCtx() {
  if (!ctxA) {
    ctxA = new (window.AudioContext || window.webkitAudioContext)();
    master = ctxA.createGain();
    analyser = ctxA.createAnalyser();
    analyser.fftSize = 256;
    masterData = new Uint8Array(analyser.frequencyBinCount);
    master.connect(analyser);
    analyser.connect(ctxA.destination);
  }
  if (ctxA.state === 'suspended') ctxA.resume().catch(() => {});
  return ctxA;
}

export const level = () => {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(masterData);
  let peak = 0;
  for (let i = 0; i < masterData.length; i++) peak = Math.max(peak, Math.abs(masterData[i] - 128) / 128);
  return peak;
};
export const trackLevel = () => 0; // per-track meters via analyse split (kept simple: master meter for now)

function makeImpulse(ctx, seconds = 1.8, decay = 3) {
  const rate = ctx.sampleRate, len = Math.round(rate * seconds);
  const imp = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = imp.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return imp;
}

function buildChain(c) {
  const ctx = ensureCtx();
  const src = ctx.createMediaElementSource(c.el);
  const gain = ctx.createGain();
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4800;
  const comp = ctx.createDynamicsCompressor();
  const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx);
  const wet = ctx.createGain(); wet.gain.value = 0;
  const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
  const delayWet = ctx.createGain(); delayWet.gain.value = 0;
  src.connect(low); low.connect(mid); mid.connect(high);
  high.connect(gain);
  high.connect(comp); comp.connect(gain); // compressor path (amount 0 = bypassed via threshold)
  high.connect(conv); conv.connect(wet); wet.connect(gain);
  high.connect(delay); delay.connect(delayWet); delayWet.connect(gain);
  return { src, gain, low, mid, high, comp, wet, delayWet };
}

export function syncAudio(project, frame, playing, force) {
  currentProject = project;
  if (!project) return;
  const fps = project.settings?.fps || 30;
  const tracks = Object.fromEntries(project.tracks.map(t => [t.id, t]));
  const solo = project.tracks.filter(t => t.solo).map(t => t.id);
  ensureCtx();
  const ids = new Set(project.clips.map(c => c.id));

  // drop stale nodes
  for (const [id, n] of nodes) if (!ids.has(id)) { try { n.src.disconnect(); n.gain.disconnect(); } catch { /* */ } n.el.pause(); nodes.delete(id); }

  // master volume (mixer)
  master.gain.value = project.settings?.masterVolume ?? 1;

  for (const c of audioClips(project)) {
    const track = tracks[c.track];
    const asset = project.assets[c.assetId];
    if (!asset || !asset.blobUrl && !asset.file) continue;
    let n = nodes.get(c.id);
    if (!n) {
      const el = new Audio();
      el.preload = 'auto';
      el.src = asset.blob ? asset.blobUrl || URL.createObjectURL(asset.blob) : (project.id && asset.file ? `/media/${project.id}/${asset.file}` : '');
      n = { el, ...buildChain({ el }) };
      nodes.set(c.id, n);
    }
    // rebuild chain lazily on first user gesture (autoplay policy)
    const active = frame >= c.start && frame < c.start + c.dur;
    const audible = track && !track.muted && (!solo.length || solo.includes(c.track));
    // clip gain: volume (keyframable) × fades × gainDb
    const vol = propAt(c, 'volume', frame, fps) ?? c.volume ?? 1;
    const fadeIn = c.fadeIn ? Math.min(1, (frame - c.start) / c.fadeIn) : 1;
    const fadeOut = c.fadeOut ? Math.min(1, (c.start + c.dur - frame) / c.fadeOut) : 1;
    const gainDb = c.gainDb ?? (track?.role === 'music' ? project.settings?.musicDb ?? -30 : track?.role === 'sfx' ? -16 : 0);
    const g = Math.max(0, Math.min(4, vol * Math.pow(10, gainDb / 20) * Math.min(fadeIn, fadeOut))) * (audible ? 1 : 0) * (track?.gainDb != null ? Math.pow(10, track.gainDb / 20) : 1);
    n.gain.gain.setTargetAtTime(g, ctxA.currentTime, 0.03);

    // EQ + FX params
    const fx = c.audioFx || {};
    n.low.gain.value = fx.eq?.low ?? 0;
    n.mid.gain.value = fx.eq?.mid ?? 0;
    n.high.gain.value = fx.eq?.high ?? 0;
    n.wet.gain.value = (fx.reverb ?? 0) * 0.8;
    n.delayWet.gain.value = (fx.delay ?? 0) * 0.6;
    n.comp.threshold.value = (fx.compressor ?? 0) > 0 ? -18 + (1 - (fx.compressor ?? 0)) * 18 : 0;

    if (active && playing && audible) {
      const want = (c.in + ((frame - c.start) * 1000 / fps) * (c.speed || 1)) / 1000;
      if (n.el.paused || force || Math.abs(n.el.currentTime - want) > 0.25) { try { n.el.currentTime = want; } catch { /* metadata pending */ } }
      n.el.playbackRate = Math.min(4, Math.max(0.25, c.speed || 1));
      if (n.el.paused) n.el.play().catch(() => {});
    } else if (!n.el.paused) n.el.pause();
  }
}

export function stopAll() { for (const n of nodes.values()) if (!n.el.paused) n.el.pause(); }
export function disposeAudio() {
  for (const [id, n] of nodes) { try { n.src.disconnect(); } catch { /* */ } n.el.pause(); }
  nodes.clear();
}
