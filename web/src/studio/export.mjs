// Browser export (standalone/Netlify mode): renders the timeline through the same
// canvas compositor used for preview, encodes with WebCodecs and muxes an MP4 (mp4-muxer).
// Audio is mixed offline (OfflineAudioContext) with the same gain/EQ/duck logic as preview.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawFrame } from './compositor';
import { audioClips } from '../../../shared/model.mjs';

const SUPPORTED_V = ['avc1.640028', 'avc1.4d0028', 'vp09.00.10.08'];
const SUPPORTED_A = ['mp4a.40.2', 'opus'];

async function pickCodec(list, kind = 'video', width = 1920, height = 1080, fps = 30) {
  const Enc = kind === 'video' ? window.VideoEncoder : window.AudioEncoder;
  if (!Enc) return null;
  for (const c of list) {
    const cfg = kind === 'video'
      ? { codec: c, width, height, bitrate: 8e6, framerate: fps }
      : { codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try {
      const sup = kind === 'video' ? await VideoEncoder.isConfigSupported(cfg) : await AudioEncoder.isConfigSupported(cfg);
      if (sup?.supported) return c;
    } catch { /* next */ }
  }
  return null;
}

/** Mix all audio clips offline → AudioBuffer at 48 kHz stereo. */
export async function mixAudio(project, onProgress) {
  const fps = project.settings?.fps || 30;
  const totalFrames = Math.max(1, ...project.clips.map(c => c.start + c.dur));
  const durSec = totalFrames / fps;
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new AC(2, Math.ceil(durSec * 48000), 48000);
  const master = ctx.createGain();
  master.gain.value = project.settings?.masterVolume ?? 1;
  master.connect(ctx.destination);
  const tracks = Object.fromEntries(project.tracks.map(t => [t.id, t]));
  const solo = project.tracks.filter(t => t.solo).map(t => t.id);

  const buffers = new Map();
  const load = async asset => {
    if (buffers.has(asset.id)) return buffers.get(asset.id);
    try {
      const buf = await asset.blob.arrayBuffer();
      const b = await ctx.decodeAudioData(buf);
      buffers.set(asset.id, b);
      return b;
    } catch { buffers.set(asset.id, null); return null; }
  };

  const clips = audioClips(project).filter(c => project.assets[c.assetId]?.blob);
  let done = 0;
  for (const c of clips) {
    const track = tracks[c.track];
    if (!track || track.muted || (solo.length && !solo.includes(c.track))) { done++; onProgress?.(done / clips.length); continue; }
    const srcBuf = await load(project.assets[c.assetId]);
    if (!srcBuf) { done++; continue; }
    const src = ctx.createBufferSource();
    src.buffer = srcBuf;
    src.playbackRate.value = c.speed || 1;
    const g = ctx.createGain();
    const gainDb = c.gainDb ?? (track.role === 'music' ? project.settings?.musicDb ?? -30 : track.role === 'sfx' ? -16 : 0);
    const base = Math.pow(10, gainDb / 20);
    const vol = c.volume ?? 1;
    g.gain.value = Math.min(4, vol * base);
    // fades
    const st = c.start / fps, en = (c.start + c.dur) / fps;
    const fi = (c.fadeIn || 0) / fps, fo = (c.fadeOut || 0) / fps;
    if (fi) { g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, g.gain.value), st + fi); }
    if (fo) { g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), en - fo); g.gain.exponentialRampToValueAtTime(0.0001, en); }
    // simple EQ
    const eq = c.audioFx?.eq;
    let node = g;
    if (eq) {
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250; low.gain.value = eq.low ?? 0;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.gain.value = eq.mid ?? 0;
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4800; high.gain.value = eq.high ?? 0;
      g.connect(low); low.connect(mid); mid.connect(high); node = high;
    }
    node.connect(master);
    src.start(st, (c.in || 0) / 1000, Math.min((c.dur / fps) * (c.speed || 1), srcBuf.duration));
    done++;
    onProgress?.(done / clips.length);
  }
  return ctx.startRendering();
}

/**
 * Export the project to MP4 (or WebM fallback). Returns a Blob.
 * onProgress(frac 0..1, stage).
 */
export async function exportVideo(project, { quality = 'final', onProgress, signal } = {}) {
  const fps = project.settings?.fps || 30;
  const W = project.settings?.width || 1920, H = project.settings?.height || 1080;
  const totalFrames = Math.max(1, ...project.clips.map(c => c.start + c.dur));
  const scale = quality === 'draft' ? 0.5 : 1;
  const w = Math.round(W * scale / 2) * 2, h = Math.round(H * scale / 2) * 2;

  // render at full project size, downscale into the output canvas
  const renderCv = document.createElement('canvas');
  renderCv.width = W; renderCv.height = H;
  const renderCtx = renderCv.getContext('2d', { alpha: false });
  const outCv = document.createElement('canvas');
  outCv.width = w; outCv.height = h;
  const outCtx = outCv.getContext('2d', { alpha: false });
  const scratch = [];
  const env = {
    W, H, fps,
    off: (W2, H2) => {
      let s = scratch.find(x => x.W === W2 && x.H === H2);
      if (!s) { const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2; s = { cv, ctx: cv.getContext('2d'), W: W2, H: H2 }; scratch.push(s); }
      return { cv: s.cv, ctx: s.ctx };
    },
  };
  const drawScaled = frame => {
    drawFrame(renderCtx, project, frame, sources, env);
    outCtx.drawImage(renderCv, 0, 0, w, h);
  };
  // media decoders
  const decoders = new Map();
  const loadDecoder = async (clip) => {
    const asset = project.assets[clip.assetId];
    if (!asset) return;
    const url = asset.blob ? asset.blobUrl || URL.createObjectURL(asset.blob) : '';
    if (!url) return;
    let d = decoders.get(clip.id);
    if (d) return d;
    if (clip.type === 'image') {
      const el = new Image();
      await new Promise(res => { el.onload = res; el.onerror = res; el.src = url; });
      d = { el, ok: el.naturalWidth > 0 };
    } else {
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url; el.crossOrigin = 'anonymous';
      await new Promise(res => { el.onloadeddata = res; el.onerror = res; setTimeout(res, 6000); });
      d = { el, ok: el.readyState >= 2, url };
    }
    decoders.set(clip.id, d);
    return d;
  };
  const mediaClips = project.clips.filter(c => c.type === 'video' || c.type === 'image');
  for (const c of mediaClips) await loadDecoder(c);
  const sources = new Map([...decoders.entries()].map(([k, d]) => [k, { el: d.el, ok: d.ok }]));

  const vCodec = await pickCodec(SUPPORTED_V, 'video', w, h, fps);
  const aCodec = await pickCodec(SUPPORTED_A, 'audio');
  if (!vCodec) throw new Error('This browser cannot export video (no WebCodecs H.264/VP9). Try Chrome or Edge, or run the local server render.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vCodec.startsWith('avc') ? 'avc' : 'vp9', width: w, height: h, frameRate: fps },
    audio: aCodec ? { codec: aCodec === 'opus' ? 'opus' : 'aac', sampleRate: 48000, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
  });

  // ---- audio track
  if (aCodec && audioClips(project).length) {
    onProgress?.(0, 'Mixing audio');
    const mixed = await mixAudio(project, f => onProgress?.(f * 0.05, 'Mixing audio'));
    const aEnc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: e => console.error('audio encoder', e),
    });
    aEnc.configure({ codec: aCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    // encode in 1-second chunks (f32-planar)
    const L = mixed.getChannelData(0), R = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L;
    const CH = 48000;
    for (let off = 0; off < mixed.length; off += CH) {
      const n = Math.min(CH, mixed.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const audioData = new AudioData({
        format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / 48 * 1000),
        data,
      });
      aEnc.encode(audioData);
      audioData.close();
      if (aEnc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 0));
    }
    await aEnc.flush();
    aEnc.close();
  }

  // ---- video track (frame-by-frame)
  const vEnc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { throw e; },
  });
  vEnc.configure({ codec: vCodec, width: w, height: h, bitrate: quality === 'draft' ? 3e6 : 10e6, framerate: fps });

  for (let f = 0; f < totalFrames; f++) {
    if (signal?.aborted) { vEnc.close(); throw new DOMException('Export cancelled', 'AbortError'); }
    drawScaled(f);
    const frame = new VideoFrame(outCv, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
    vEnc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
    frame.close();
    if (f % 3 === 0) {
      onProgress?.(0.05 + 0.9 * (f / totalFrames), 'Rendering frames');
      await new Promise(r => setTimeout(r, 0)); // keep the UI alive
      if (vEnc.encodeQueueSize > 30) await new Promise(r => { const i = setInterval(() => { if (vEnc.encodeQueueSize < 8) { clearInterval(i); r(); } }, 8); });
    }
  }
  onProgress?.(0.97, 'Encoding');
  await vEnc.flush();
  vEnc.close();
  muxer.finalize();
  const { buffer } = muxer.target;
  onProgress?.(1, 'Done');
  return new Blob([buffer], { type: 'video/mp4' });
}
