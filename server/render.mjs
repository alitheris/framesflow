// Timeline -> MP4. Footage is rendered to cached normalised segments, then composited with graphics and a mastered audio mix in one encode.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { FFMPEG, FFPROBE, FPS, run, frameToMs, safeName } from './lib.mjs';
import { GRADES, projectFrames, clipEnd, voiceClip, srcSpanMs } from './project.mjs';
import { TRANSITIONS as TRANSITION_DEFS, evalKeys, EFFECT_KEYFRAMABLE_RENDER_EXACT, audioClips } from '../shared/model.mjs';
import { assetsDir, cacheDir, rendersDir } from './store.mjs';
import { renderOverlay, renderTextFrames, renderGraphicFrames } from './overlay.mjs';

const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const f5 = n => Number(n).toFixed(5);

export function mergedGrade(p, c) {
  const base = GRADES[p.settings.grade] || {};
  const own = typeof c.grade === 'string' ? GRADES[c.grade] || {} : c.grade ? { ...(GRADES[c.grade.preset] || {}), ...c.grade } : {};
  return { ...base, ...own };
}

function gradeFilters(g, q) {
  const f = [];
  if (g.denoise && q.final) f.push(`hqdn3d=${(1 + 3 * g.denoise).toFixed(2)}:${(1 + 2 * g.denoise).toFixed(2)}:${(2 + 4 * g.denoise).toFixed(2)}:${(2 + 3 * g.denoise).toFixed(2)}`);
  if (g.brightness || g.contrast !== undefined || g.saturation !== undefined)
    f.push(`eq=brightness=${f5(g.brightness || 0)}:contrast=${f5(g.contrast ?? 1)}:saturation=${f5(g.saturation ?? 1)}`);
  if (g.teal) { const t = g.teal; f.push(`colorbalance=rs=${f5(-0.08 * t)}:gs=${f5(0.03 * t)}:bs=${f5(0.14 * t)}:rh=${f5(0.1 * t)}:gh=${f5(0.02 * t)}:bh=${f5(-0.08 * t)}`); }
  if (g.sharpen && q.final) f.push(`unsharp=5:5:${f5(0.9 * g.sharpen)}:5:5:0`);
  if (g.vignette) f.push(`vignette=angle=${f5(0.9 - 0.5 * g.vignette)}`);
  if (g.grain && q.final) f.push(`noise=alls=${Math.round(g.grain * 18)}:allf=t`);
  return f;
}

/** Per-clip effect stack → ffmpeg filters (mirrors the canvas compositor's effect set). */
// kc = { frames, off }: clip length in frames and the frame offset of the clip start in the stream being filtered.
function effectFilters(effects, q, kc = { frames: 1, off: 0 }) {
  const f = [];
  for (const e of effects || []) {
    const p = { ...(e.params || {}) };
    // keyframed params: frame-exact expressions where ffmpeg supports them (exposure, saturation, hue),
    // otherwise the average of the keyframes over the clip
    const exactKeys = EFFECT_KEYFRAMABLE_RENDER_EXACT[e.type] || [];
    const expr = {};
    for (const key of Object.keys(e.keyframes || {})) {
      const keys = e.keyframes[key];
      if (!keys?.length) continue;
      if (exactKeys.includes(key)) expr[key] = `'${keyExpr(keys, kc.frames, '0', kc.off)}'`;
      let sum = 0; const N = 8;
      for (let i = 0; i <= N; i++) sum += evalKeys(keys, Math.round(kc.frames * i / N));
      p[key] = sum / (N + 1);
    }
    if (e.type === 'exposure' && (expr.brightness || expr.contrast)) f.push(`eq=brightness=${expr.brightness ?? f5(p.brightness || 0)}:contrast=${expr.contrast ?? f5(p.contrast ?? 1)}:eval=frame`);
    else if (e.type === 'saturation' && expr.amount) f.push(`eq=saturation=${expr.amount}:eval=frame`);
    else if (e.type === 'hue' && expr.deg) f.push(`hue=h=${expr.deg}`);
    else if (e.type === 'blur' && p.amount > 0) f.push(`gblur=sigma=${f5(p.amount / 2)}`);
    else if (e.type === 'sharpen') f.push(`unsharp=5:5:${f5(p.amount)}:5:5:0`);
    else if (e.type === 'exposure') f.push(`eq=brightness=${f5(p.brightness || 0)}:contrast=${f5(p.contrast ?? 1)}`);
    else if (e.type === 'saturation') f.push(`eq=saturation=${f5(p.amount ?? 1)}`);
    else if (e.type === 'hue') f.push(`hue=h=${Math.round(p.deg || 0)}`);
    else if (e.type === 'sepia') f.push(`hue=s=0,colorchannelmixer=rr=1.14:rg=0.02:rb=-0.06:gr=0.1:gg=1.0:gb=-0.1:br=-0.2:bg=0.3:bb=0.9`);
    else if (e.type === 'grayscale') f.push('hue=s=0');
    else if (e.type === 'invert') f.push('negate');
    else if (e.type === 'vignette') f.push(`vignette=angle=${f5(0.9 - 0.5 * (p.amount ?? 0.5))}`);
    else if (e.type === 'grain' && q.final) f.push(`noise=alls=${Math.round((p.amount ?? 0.35) * 18)}:allf=t`);
    else if (e.type === 'pixelate') { const s = Math.max(2, Math.round(p.size || 12)); f.push(`scale=trunc(iw/${s})*2:trunc(ih/${s})*2:flags=neighbor,scale=iw:ih:flags=neighbor`); }
    else if (e.type === 'chromatic' && p.shift > 0) f.push(`chromashift=cbh=${Math.round(p.shift)}:crh=${Math.round(-p.shift)}`);
    else if (e.type === 'tint') {
      try {
        const hex = (p.color || '#ff9a5a').replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16) / 255 - 0.5, g = parseInt(hex.slice(2, 4), 16) / 255 - 0.5, b = parseInt(hex.slice(4, 6), 16) / 255 - 0.5;
        const a = p.amount ?? 0.3;
        f.push(`colorbalance=rm=${f5(r * a)}:gm=${f5(g * a)}:bm=${f5(b * a)}`);
      } catch { /* bad color */ }
    } else if (e.type === 'mirror') f.push(p.axis === 'v' ? 'vflip' : 'hflip');
    else if (e.type === 'glow' && q.final) { const g = `gl${++glowSeq}`; f.push(`split[${g}a][${g}b];[${g}a]gblur=sigma=${f5((p.radius || 24) / 4)}[${g}c];[${g}b][${g}c]blend=all_mode=screen:all_opacity=${f5(p.amount ?? 0.5)}`); }
    // denoise handled with grade; glitchfx/posterize are preview-only stylisations
  }
  return f;
}
let glowSeq = 0;

/** Build an ffmpeg arithmetic expression evaluating keyframes at frame n (relative to clip start). */
function keyExpr(keys, frames, fallback = '0', off = 0, nExpr = null) {
  if (!keys?.length) return fallback;
  const N = nExpr || (off ? `(n-${off})` : 'n');
  const k = [...keys].sort((a, b) => a.frame - b.frame);
  if (k.length === 1) return f5(k[0].value);
  // nest from the LAST segment backwards so the earliest segment is tested first
  let expr = `${f5(k[k.length - 1].value)}`;
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1];
    const f0 = Math.max(0, a.frame), f1 = Math.min(frames, b.frame);
    let inner;
    if (a.interp === 'hold') inner = f5(a.value);
    else {
      const t = `(${N}-${f0})/${Math.max(1, f1 - f0)}`;
      inner = a.interp === 'ease'
        ? `${f5(a.value)}+(${f5(b.value - a.value)})*min(1\\,max(0\\,${t}))*min(1\\,max(0\\,${t}))*(3-2*min(1\\,max(0\\,${t})))`
        : `${f5(a.value)}+(${f5(b.value - a.value)})*min(1\\,max(0\\,${t}))`;
    }
    expr = `if(lt(${N}\\,${f1})\\,${inner}\\,${expr})`;
  }
  return expr;
}

/** Build one normalised W×H branch for a segment spec; returns { inputs, chain } */
function branch(spec, q, inLabel) {
  const { W, H, fps } = q;
  const frames = spec.frames;
  const dur = frames / fps;
  const inputs = [];
  const f = [];
  if (spec.kind === 'black') {
    inputs.push('-f', 'lavfi', '-t', f5(dur + 0.2), '-i', `color=c=black:s=${W}x${H}:r=${fps}`);
  } else if (spec.kind === 'image') {
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', f5(dur + 0.2), '-i', spec.file);
  } else {
    // transparent VP9 (HTML animations): only libvpx decodes the alpha plane
    if (spec.alpha) inputs.push('-c:v', 'libvpx-vp9');
    inputs.push('-ss', f5(Math.max(0, spec.inSec)), '-t', f5(dur * spec.speed + 0.5), '-i', spec.file);
    f.push('setpts=(PTS-STARTPTS)/' + f5(spec.speed), `fps=${fps}`);
  }
  if (spec.kind !== 'black') {
    if (spec.crop) f.push(`crop=${spec.crop.w}:${spec.crop.h}:${spec.crop.x}:${spec.crop.y}`);
    if (spec.fit === 'contain') f.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
    else f.push(`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W}:${H}`);
    const kb = spec.kb, zb = Math.max(1, spec.scale || 1), punch = spec.punch;
    const needsZoom = zb !== 1 || kb || punch || spec.x || spec.y || spec.kf;
    if (needsZoom) {
      const kz = kb ? `(${f5(kb.from)}+(${f5(kb.to - kb.from)})*n/${Math.max(1, frames)})` : '1';
      const pz = punch ? `(1+${f5(punch.amt)}*max(0,1-n/${punch.frames}))` : '1';
      const kScale = spec.kf?.scale ? `max(0.05\\,(${keyExpr(spec.kf.scale, frames, '1')}))` : '1';
      const z = `${f5(zb)}*${kz}*${pz}*${kScale}`;
      const px = kb ? `(${f5(kb.panX0 || 0)}+(${f5((kb.panX1 || 0) - (kb.panX0 || 0))})*n/${Math.max(1, frames)})` : '0';
      const py = kb ? `(${f5(kb.panY0 || 0)}+(${f5((kb.panY1 || 0) - (kb.panY0 || 0))})*n/${Math.max(1, frames)})` : '0';
      const kx = spec.kf?.x ? keyExpr(spec.kf.x, frames, '0') : '0';
      const ky = spec.kf?.y ? keyExpr(spec.kf.y, frames, '0') : '0';
      f.push(`scale=w='trunc(${W}*(${z})/2)*2':h='trunc(${H}*(${z})/2)*2':eval=frame:flags=bicubic`,
        `crop=${W}:${H}:x='clip((iw-${W})/2*(1+${px})+${f5((spec.x || 0) / 100 * W)}+${kx}/100*${W},0,iw-${W})':y='clip((ih-${H})/2*(1+${py})+${f5((spec.y || 0) / 100 * H)}+${ky}/100*${H},0,ih-${H})'`);
    }
    if (spec.rotExpr) f.push(`rotate=a='${spec.rotExpr}*(PI/180)':ow=iw:oh=ih:c=black`);
    f.push(...gradeFilters(spec.grade || {}, q), ...effectFilters(spec.effects, q, { frames, off: 0 }));
    // watermark mask → delogo (blur-patch) in render coordinates
    if (spec.mask) {
      const mx = Math.max(1, Math.round(spec.mask.x * W) + 1), my = Math.max(1, Math.round(spec.mask.y * H) + 1);
      const mw = Math.min(W - mx - 1, Math.round(spec.mask.w * W) - 2), mh = Math.min(H - my - 1, Math.round(spec.mask.h * H) - 2);
      if (mw > 8 && mh > 8) f.push(`delogo=x=${mx}:y=${my}:w=${mw}:h=${mh}`);
    }
  }
  if (spec.fadeIn) f.push(`fade=t=in:st=0:d=${f5(spec.fadeIn / fps)}:color=${spec.fadeColor || 'black'}`);
  if (spec.fadeOut) f.push(`fade=t=out:st=${f5((frames - spec.fadeOut) / fps)}:d=${f5(spec.fadeOut / fps)}:color=${spec.fadeColor || 'black'}`);
  f.push('format=yuv420p', 'setsar=1', 'tpad=stop=24:stop_mode=clone');
  return { inputs, chain: f.join(','), label: inLabel };
}

function segmentArgs(spec, q, out) {
  const enc = q.final ? ['-c:v', 'libx264', '-preset', 'fast', '-crf', '15'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26'];
  const tail = ['-an', '-r', String(q.fps), '-pix_fmt', 'yuv420p', ...enc, '-g', String(q.fps), '-movflags', '+faststart', out];
  if (spec.kind === 'joint') {
    const a = branch(spec.a, q), b = branch(spec.b, q);
    const d = spec.frames / q.fps;
    const fc = `[0:v]${a.chain}[a];[1:v]${b.chain}[b];[a][b]xfade=transition=${spec.xfade || 'fade'}:duration=${f5(d)}:offset=0,trim=end_frame=${spec.frames},setpts=PTS-STARTPTS[v]`;
    return ['-y', '-v', 'error', ...a.inputs, ...b.inputs, '-filter_complex', fc, '-map', '[v]', '-frames:v', String(spec.frames), ...tail];
  }
  const b = branch(spec, q);
  return ['-y', '-v', 'error', ...b.inputs, '-vf', b.chain, '-frames:v', String(spec.frames), ...tail];
}

function defaultKb(c, frames) {
  if (c.kenburns) return { from: 1, to: 1.06, panX0: 0, panX1: 0, panY0: 0, panY1: 0, ...c.kenburns };
  if (c.type === 'image') return { from: 1, to: 1.09, panX0: -0.15, panX1: 0.15, panY0: 0, panY1: 0 };
  return null;
}

/** Turn the base video track's clips into segment specs (+ xfade joints) covering [0,total). */
function planSegments(p, q, total) {
  const fps = q.fps;
  const baseTrack = p.tracks.find(t => t.kind === 'video' && t.role === 'base')?.id || 'V1';
  const clips = p.clips.filter(c => c.track === baseTrack && (c.type === 'video' || c.type === 'image')).sort((a, b) => a.start - b.start);
  const items = [];
  let cursor = 0;
  const fileOf = c => path.join(assetsDir(p.id), p.assets[c.assetId].file);
  for (const c of clips) {
    if (c.start > cursor) items.push({ kind: 'black', frames: c.start - cursor, gap: true });
    const a = p.assets[c.assetId];
    if (!a) { items.push({ kind: 'black', frames: c.dur }); cursor = clipEnd(c); continue; }
    const kf = c.keyframes && Object.keys(c.keyframes).length
      ? Object.fromEntries(Object.entries(c.keyframes).filter(([k]) => ['scale', 'x', 'y'].includes(k))) : null;
    const rotation = (c.rotation || 0) || (c.keyframes?.rotation?.length ? true : 0);
    items.push({
      kind: c.type, clip: c, file: fileOf(c), inSec: c.in / 1000, frames: c.dur, speed: c.speed || 1, grade: mergedGrade(p, c),
      kb: defaultKb(c, c.dur), scale: c.scale, x: c.x, y: c.y, fadeIn: c.fadeIn, fadeOut: c.fadeOut, asset: a, crop: a.crop || null,
      effects: c.effects, alpha: p.assets[c.assetId]?.alpha ? true : undefined, fit: c.fit === 'contain' ? 'contain' : undefined, kf: kf && Object.keys(kf).length ? kf : null, mask: c.mask || null,
      rotExpr: c.keyframes?.rotation?.length ? keyExpr(c.keyframes.rotation, c.dur, '0') : (c.rotation ? f5(c.rotation) : null),
    });
    cursor = clipEnd(c);
  }
  if (cursor < total) items.push({ kind: 'black', frames: total - cursor, gap: true });
  // trim anything past the end
  let acc = 0;
  for (const it of items) { if (acc + it.frames > total) it.frames = Math.max(0, total - acc); acc += it.frames; }
  const live = items.filter(i => i.frames > 0);

  // transitions into clip i (relative to previous neighbour)
  for (let i = 1; i < live.length; i++) {
    const cur = live[i], prev = live[i - 1];
    const t = cur.clip?.transition;
    if (!t || t.type === 'cut' || !cur.clip) continue;
    const n = Math.max(2, Math.min(t.dur || 10, 120));
    const def = TRANSITION_DEFS.find(x => x.id === t.type);
    if (def?.xfade && t.type !== 'cut') {
      const h = Math.floor(n / 2);
      const prevHandle = prev.kind === 'video' ? (prev.asset.duration - (prev.inSec * 1000 + (prev.frames / fps) * prev.speed * 1000)) / 1000 * fps : 1e9;
      const curHandle = cur.kind === 'video' ? cur.inSec * fps : 1e9;
      if (h < 1 || prev.frames <= h + 1 || cur.frames <= h + 1 || prevHandle < h * prev.speed || curHandle < h) continue;
      cur.joint = { h, xfade: def.xfade };
      if (t.type === 'dipblack' || t.type === 'dipwhite') cur.fadeColor = null;
    } else if (t.type === 'dipblack' || t.type === 'dipwhite') {
      const h = Math.min(n, Math.floor(Math.min(prev.frames, cur.frames) / 2));
      prev.fadeOut = Math.max(prev.fadeOut || 0, h); cur.fadeIn = Math.max(cur.fadeIn || 0, h);
      const color = t.type === 'dipwhite' ? 'white' : 'black';
      prev.fadeColor = color; cur.fadeColor = color;
    } else if (t.type === 'zoomin' || t.type === 'zoomout' || t.type === 'spin') {
      cur.punch = { amt: 0.12, frames: Math.min(n, 12) };
    } else if (t.type === 'whippan') {
      cur.punch = { amt: 0.22, frames: Math.min(n, 12) };
    } else if (t.type === 'blurdissolve' || t.type === 'glitch' || t.type === 'pixelate' || t.type === 'barndoor' || t.type === 'clockwipe') {
      // native xfade exists for some of these; fall back to a dissolve joint when handles allow
      const h = Math.floor(Math.min(n, 24) / 2);
      const prevHandle = prev.kind === 'video' ? (prev.asset.duration - (prev.inSec * 1000 + (prev.frames / fps) * prev.speed * 1000)) / 1000 * fps : 1e9;
      const curHandle = cur.kind === 'video' ? cur.inSec * fps : 1e9;
      if (h >= 1 && prev.frames > h + 1 && cur.frames > h + 1 && prevHandle >= h * prev.speed && curHandle >= h) cur.joint = { h, xfade: def?.xfade || 'fade' };
      else if (t.type === 'glitch' || t.type === 'whippan') cur.punch = { amt: 0.18, frames: Math.min(n, 12) };
    }
  }
  // expand joints
  const out = [];
  for (let i = 0; i < live.length; i++) {
    const cur = live[i];
    if (cur.joint) {
      const h = cur.joint.h, prev = out[out.length - 1];
      const prevSrc = live[i - 1];
      prev.frames -= h; cur.frames -= h;
      const aSpec = { ...prevSrc, frames: 2 * h, inSec: prevSrc.inSec + ((prevSrc.frames) / fps) * prevSrc.speed, kb: null, fadeIn: 0, fadeOut: 0, punch: null, fadeColor: null };
      const bSpec = { ...cur, frames: 2 * h, inSec: cur.inSec - h / fps, kb: null, fadeIn: 0, fadeOut: 0, punch: null, joint: null, fadeColor: null };
      if (prevSrc.kind === 'black') aSpec.kind = 'black';
      const joint = { kind: 'joint', frames: 2 * h, a: aSpec, b: bSpec, clip: cur.clip, xfade: cur.joint.xfade };
      // the joint covers [cutpoint-h, cutpoint+h): outgoing loses its last h frames, incoming its first h
      cur.inSec += h / fps * cur.speed;
      out.push(joint);
      out.push(cur);
    } else out.push(cur);
  }
  return out.filter(s => s.frames > 0);
}

function segKey(spec, q) {
  const strip = s => !s ? s : { kind: s.kind, file: s.file && [s.file, fs.statSync(s.file).mtimeMs, fs.statSync(s.file).size], inSec: s.inSec, frames: s.frames, speed: s.speed, grade: s.grade, kb: s.kb, scale: s.scale, x: s.x, y: s.y, fadeIn: s.fadeIn, fadeOut: s.fadeOut, fadeColor: s.fadeColor, punch: s.punch, crop: s.crop, effects: s.effects, alpha: s.alpha, fit: s.fit, kf: s.kf, rotExpr: s.rotExpr, mask: s.mask };
  return hash({ q: [q.W, q.H, q.final, q.fps], s: spec.kind === 'joint' ? { a: strip(spec.a), b: strip(spec.b), f: spec.frames, xf: spec.xfade } : strip(spec) });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

function parseProgress(line, totalSec) {
  const m = line.match(/out_time_ms=(\d+)/);
  return m ? Math.min(1, Number(m[1]) / 1e6 / totalSec) : null;
}

async function ff(args, { signal, onProgress, totalSec } = {}) {
  const r = await run(FFMPEG, args, { signal, onStdout: s => { if (onProgress) for (const l of s.split('\n')) { const v = parseProgress(l, totalSec); if (v != null) onProgress(v); } } });
  if (signal?.aborted) throw new Error('Cancelled');
  if (r.code !== 0) throw new Error('ffmpeg failed: ' + r.stderr.trim().split('\n').slice(-6).join('\n'));
  return r;
}

// ---------------------------------------------------------------- audio
async function buildAudio(p, total, workDir, { signal, update }) {
  const fps = p.settings?.fps || 30;
  const T = total / fps;
  const aclips = audioClips(p).filter(c => c.assetId && p.assets[c.assetId] && !p.tracks.find(t => t.id === c.track)?.muted).sort((a, b) => a.start - b.start);
  const solo = p.tracks.filter(t => t.solo).map(t => t.id);
  const use = solo.length ? aclips.filter(c => solo.includes(c.track)) : aclips;
  const mix = path.join(workDir, 'mix.wav');
  if (!use.length) {
    await ff(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', f5(T), '-c:a', 'pcm_s16le', mix], { signal });
    return { file: mix, loudness: null };
  }
  const inputs = [], parts = [];
  const groups = { voice: [], music: [], sfx: [] };
  use.forEach((c, i) => {
    const a = p.assets[c.assetId];
    const role = p.tracks.find(t => t.id === c.track)?.role || (c.track === 'A1' ? 'voice' : c.track === 'A2' ? 'music' : 'sfx');
    const spanSec = srcSpanMs(c, fps) / 1000;
    if (role === 'music' && a.duration / 1000 < spanSec + c.in / 1000) inputs.push('-stream_loop', '-1');
    inputs.push('-i', path.join(assetsDir(p.id), a.file));
    const st = c.start / fps, d = c.dur / fps;
    const gain = role === 'music' ? (c.gainDb ?? p.settings.musicDb) : role === 'sfx' ? (c.gainDb ?? -16) : (c.gainDb ?? 0);
    const kfVol = c.keyframes?.volume?.length ? keyExpr(c.keyframes.volume, c.dur, '1') : null;
    const chain = [`atrim=start=${f5(c.in / 1000)}:duration=${f5(spanSec)}`, 'asetpts=PTS-STARTPTS'];
    if (c.speed && c.speed !== 1) chain.push(`atempo=${f5(Math.min(2, Math.max(0.5, c.speed)))}`);
    chain.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    if (kfVol) chain.push(`volume=volume='${kfVol}':eval=frame`);
    else chain.push(`volume=${f5(c.volume ?? 1)}`);
    chain.push(`volume=${gain}dB`);
    if (c.fadeIn) chain.push(`afade=t=in:st=0:d=${f5(c.fadeIn / fps)}`);
    if (c.fadeOut) chain.push(`afade=t=out:st=${f5(Math.max(0, d - c.fadeOut / fps))}:d=${f5(c.fadeOut / fps)}`);
    // per-clip audio FX (EQ / reverb / delay / compressor)
    const fx = c.audioFx;
    if (fx?.eq) {
      if (fx.eq.low) chain.push(`bass=g=${f5(fx.eq.low)}:f=250`);
      if (fx.eq.mid) chain.push(`equalizer=f=1200:width_type=q:w=0.8:g=${f5(fx.eq.mid)}`);
      if (fx.eq.high) chain.push(`treble=g=${f5(fx.eq.high)}:f=4800`);
    }
    if (fx?.compressor > 0) chain.push(`acompressor=threshold=${f5(0.02 + 0.13 * (1 - fx.compressor))}:ratio=3:attack=12:release=160:makeup=${f5(1 + fx.compressor)}`);
    if (fx?.delay > 0) chain.push(`aecho=0.8:0.6:${Math.round(280)}:${f5(fx.delay * 0.6)}`);
    if (fx?.reverb > 0) chain.push(`aecho=0.7:0.7:${Math.round(90)}:${f5(fx.reverb * 0.5)}:aecho=0.6:0.5:${Math.round(210)}:${f5(fx.reverb * 0.4)}`);
    chain.push(`adelay=${Math.round(st * 1000)}|${Math.round(st * 1000)}`);
    parts.push(`[${i}:a]${chain.join(',')}[ac${i}]`);
    (groups[role] || groups.sfx).push(`[ac${i}]`);
  });
  const bus = (name, list) => list.length ? (list.length === 1 ? `[${list[0].slice(1, -1)}]anull[${name}]` : `${list.join('')}amix=inputs=${list.length}:normalize=0:duration=longest[${name}]`) : null;
  const vo = bus('vo', groups.voice), mu = bus('mu', groups.music), sf = bus('sf', groups.sfx);
  if (vo) parts.push(vo); if (mu) parts.push(mu); if (sf) parts.push(sf);
  const final = [];
  if (vo) {
    parts.push(`[vo]highpass=f=70,acompressor=threshold=0.14:ratio=3:attack=12:release=160:makeup=1.6,alimiter=limit=0.62:level=disabled,asplit=2[voF][voSC]`);
    final.push('[voF]');
  }
  if (mu) {
    const fo = Math.min(4, T / 2);
    if (vo) parts.push(`[mu][voSC]sidechaincompress=threshold=0.015:ratio=7:attack=25:release=500:makeup=1[mud]`, `[mud]afade=t=out:st=${f5(Math.max(0, T - fo))}:d=${f5(fo)}[muF]`);
    else parts.push(`[mu]afade=t=out:st=${f5(Math.max(0, T - fo))}:d=${f5(fo)}[muF]`);
    final.push('[muF]');
  } else if (vo) parts[parts.length - 1] = parts[parts.length - 1].replace('asplit=2[voF][voSC]', 'anull[voF]');
  if (sf) final.push('[sf]');
  const mv = p.settings?.masterVolume != null && p.settings.masterVolume !== 1 ? `volume=${f5(p.settings.masterVolume)},` : '';
  parts.push(`${final.join('')}amix=inputs=${final.length}:normalize=0:duration=longest,atrim=0:${f5(T)},asetpts=PTS-STARTPTS,apad=whole_dur=${f5(T)},${mv}aformat=sample_fmts=fltp:channel_layouts=stereo[out]`);
  update?.({ message: 'Mixing audio' });
  await ff(['-y', '-v', 'error', ...inputs, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-t', f5(T), mix], { signal });

  // two-pass loudnorm to -14 LUFS / -1.5 dBTP
  const target = p.settings.loudness ?? -14;
  const m1 = await run(FFMPEG, ['-v', 'info', '-i', mix, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { signal });
  const js = m1.stderr.slice(m1.stderr.lastIndexOf('{'), m1.stderr.lastIndexOf('}') + 1);
  let meas = null; try { meas = JSON.parse(js); } catch { /* fall back to single pass */ }
  const mastered = path.join(workDir, 'master.wav');
  const ln = meas && Number.isFinite(parseFloat(meas.input_i)) && parseFloat(meas.input_i) > -70
    ? `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true:print_format=json`
    : `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`;
  const m2 = await run(FFMPEG, ['-y', '-v', 'info', '-i', mix, '-af', ln + ',aresample=48000', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-t', f5(T), mastered], { signal });
  let after = null; try { after = JSON.parse(m2.stderr.slice(m2.stderr.lastIndexOf('{'), m2.stderr.lastIndexOf('}') + 1)); } catch { /* ignore */ }
  return { file: mastered, loudness: after ? { integrated: parseFloat(after.output_i), truePeak: parseFloat(after.output_tp), target } : null };
}

// ---------------------------------------------------------------- main
/**
 * quality: 'final' (1080p, crf 18) | 'draft' (960×540 fast)
 * Returns { file, verification }.
 */
export async function renderProject(p, { quality = 'final', name, signal, update = () => {} } = {}) {
  const total = projectFrames(p);
  if (!total) throw new Error('Nothing to render: add a voiceover or clips first.');
  const final = quality !== 'draft';
  const fps = p.settings?.fps || 30;
  // Output size must keep the project's exact aspect ratio (16:9 or 9:16). Final = project size;
  // draft = same aspect with a 960px long side. Both dimensions are forced even for the encoder.
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const { width: pw, height: ph } = p.settings;
  let W = pw, H = ph;
  if (!final) { const k = 960 / Math.max(pw, ph); W = even(pw * k); H = even(ph * k); }
  const q = { W, H, final, fps };
  const work = path.join(cacheDir(p.id), 'render-' + Date.now());
  fs.mkdirSync(work, { recursive: true });
  const segDir = path.join(cacheDir(p.id), 'segments');
  fs.mkdirSync(segDir, { recursive: true });
  const T = total / fps;
  try {
    // 1. footage segments (cached by content hash, so re-rendering after small edits is fast)
    const segs = planSegments(p, q, total);
    update({ message: `Preparing ${segs.length} segments`, progress: 0.02 });
    let done = 0;
    const cpu = Math.max(2, Math.min(5, Math.floor(os.cpus().length / 2)));
    await pool(segs, cpu, async seg => {
      seg.out = path.join(segDir, segKey(seg, q) + '.mp4');
      if (!fs.existsSync(seg.out)) {
        const tmp = seg.out + '.part.mp4';
        await ff(segmentArgs(seg, q, tmp), { signal });
        fs.renameSync(tmp, seg.out);
      }
      done++;
      update({ progress: 0.02 + 0.6 * (done / segs.length), message: `Footage ${done}/${segs.length}` });
    });
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, segs.map(s => `file '${s.out.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));

    // 2. graphics: every non-base video track, bottom layer first (topmost painted last)
    const baseTrack = p.tracks.find(t => t.kind === 'video' && t.role === 'base')?.id || 'V1';
    const ovTracks = p.tracks.filter(t => t.kind === 'video' && t.id !== baseTrack && !t.muted).map(t => t.id);
    const overlays = p.clips.filter(c => ovTracks.includes(c.track) && (c.type === 'text' || c.type === 'graphic' || c.type === 'image' || c.type === 'video' || c.type === 'effect') && c.start < total)
      .sort((a, b) => ovTracks.indexOf(b.track) - ovTracks.indexOf(a.track) || a.start - b.start);
    const ovInputs = [], ovFilters = [];
    let last = '[base]';
    let idx = 1;
    ovFilters.push('[0:v]null[base]');
    overlays.forEach((c, k) => {
      const st = c.start / fps, d = Math.min(c.dur, total - c.start) / fps, en = st + d;
      const fade = Math.min(0.25, d / 3);
      let chain, ovx = null, ovy = null;
      if (c.type === 'effect') {
        // effect layer: filter a copy of everything composited so far, blend it back during the clip window
        const chainFx = effectFilters(c.effects, q, { frames: c.dur, off: c.start });
        if (!chainFx.length) return;
        const opKeys = c.keyframes?.opacity;
        let op = c.opacity ?? 1;
        if (opKeys?.length) { let sum = 0; for (let i = 0; i <= 8; i++) sum += evalKeys(opKeys, Math.round(c.dur * i / 8)); op = sum / 9; }
        ovFilters.push(`${last}split=2[fa${k}][fb${k}]`, `[fb${k}]${chainFx.join(',')}[fx${k}]`,
          `[fa${k}][fx${k}]blend=all_expr='A*${f5(1 - Math.max(0, Math.min(1, op)))}+B*${f5(Math.max(0, Math.min(1, op)))}':enable='between(t,${f5(st)},${f5(en)})'[v${k}]`);
        last = `[v${k}]`;
        return;
      }
      if (c.type === 'graphic') {
        // animation graphics: per-frame transparent PNG sequence via the shared scene layout
        const seq = renderGraphicFrames(c, { width: q.W, height: q.H, accent: p.settings.accent, fps, outDir: path.join(work, `gfx${k}`) });
        ovInputs.push('-framerate', String(fps), '-i', seq.pattern);
        chain = `format=rgba,setpts=PTS+${f5(st)}/TB`;
      } else if (c.type === 'text') {
        const t2 = c.text || {};
        const styled = t2.animIn && t2.animIn !== 'none' || t2.font || t2.fontSize || t2.color || t2.strokeWidth || t2.animOut !== 'none' && t2.animOut;
        if (styled) {
          // animated text: per-frame transparent PNG sequence (exact WYSIWYG with the preview)
          const framesDir = path.join(work, `txt${k}`);
          const seq = renderTextFrames(c, { width: q.W, height: q.H, accent: p.settings.accent, fps, outDir: framesDir });
          ovInputs.push('-framerate', String(fps), '-i', seq.pattern);
          chain = `format=rgba,setpts=PTS+${f5(st)}/TB`;
        } else {
          const png = path.join(work, `ov${k}.png`);
          renderOverlay(t2, { width: q.W, height: q.H, accent: p.settings.accent }, png);
          ovInputs.push('-loop', '1', '-framerate', String(fps), '-t', f5(d), '-i', png);
          chain = `format=rgba,fade=t=in:st=0:d=${f5(fade)}:alpha=1,fade=t=out:st=${f5(d - fade)}:d=${f5(fade)}:alpha=1,setpts=PTS+${f5(st)}/TB`;
        }
      } else {
        const a = p.assets[c.assetId]; if (!a) return;
        const file = path.join(assetsDir(p.id), a.file);
        if (c.type === 'image') ovInputs.push('-loop', '1', '-framerate', String(fps), '-t', f5(d), '-i', file);
        else ovInputs.push(...(a.alpha ? ['-c:v', 'libvpx-vp9'] : []), '-ss', f5(c.in / 1000), '-t', f5(d * (c.speed || 1)), '-i', file);
        // size / rotation / opacity, with keyframes (scale, rotation evaluated on the clip's own frame count n)
        const kfs = c.keyframes || {};
        const bw = Math.round(q.W / 2) * 2, bh = Math.round(q.H / 2) * 2;
        const zStatic = c.scale || 1;
        const rotKeyed = kfs.rotation?.length ? keyExpr(kfs.rotation, c.dur, '0') : (c.rotation ? f5(c.rotation) : null);
        const animated = !!(rotKeyed || kfs.scale?.length);
        // 1) fit into the frame box at scale 1 (contain keeps the whole subject; otherwise full width)
        const bx = animated ? 1 : zStatic;
        const fit1 = c.fit === 'contain'
          ? `scale=${Math.round(bw * bx / 2) * 2}:${Math.round(bh * bx / 2) * 2}:force_original_aspect_ratio=decrease`
          : `scale=${Math.round(bw * bx / 2) * 2}:-2`;
        // 2) rotate on a fixed square canvas (ffmpeg fixes the output size at init), 3) animate scale per frame
        const rot = rotKeyed ? `rotate=a='(${rotKeyed})*PI/180':c=none:ow='2*trunc(hypot(iw,ih)/2)':oh='2*trunc(hypot(iw,ih)/2)'` : null;
        const zoom = kfs.scale?.length ? `scale=w='2*trunc(iw*(${keyExpr(kfs.scale, c.dur, '1')})/2)':h='2*trunc(ih*(${keyExpr(kfs.scale, c.dur, '1')})/2)':eval=frame`
          : animated && zStatic !== 1 ? `scale=w='2*trunc(iw*${f5(zStatic)}/2)':h='2*trunc(ih*${f5(zStatic)}/2)'` : null;
        let op = c.opacity ?? 1;
        if (kfs.opacity?.length) { let sum = 0; for (let i = 0; i <= 8; i++) sum += evalKeys(kfs.opacity, Math.round(c.dur * i / 8)); op = sum / 9; }
        chain = [
          c.type === 'video' ? `setpts=(PTS-STARTPTS)/${f5(c.speed || 1)},fps=${fps}` : null,
          fit1, 'format=rgba',
          c.flipH ? 'hflip' : null, c.flipV ? 'vflip' : null,
          rot, zoom,
          `colorchannelmixer=aa=${f5(Math.max(0, Math.min(1, op)))}`,
          `fade=t=in:st=0:d=${f5(fade)}:alpha=1`, `fade=t=out:st=${f5(d - fade)}:d=${f5(fade)}:alpha=1`,
          `setpts=PTS+${f5(st)}/TB`,
        ].filter(Boolean).join(',');
        // position keyframes use the main timeline: n = (t - start) * fps
        const tN = `((t-${f5(st)})*${fps})`;
        const zT = kfs.scale?.length ? keyExpr(kfs.scale, c.dur, '1', 0, tN) : f5(c.scale || 1);
        const kx = kfs.x?.length ? keyExpr(kfs.x, c.dur, f5(c.x || 0), 0, tN) : f5(c.x || 0);
        const ky = kfs.y?.length ? keyExpr(kfs.y, c.dur, f5(c.y || 0), 0, tN) : f5(c.y || 0);
        ovx = `(W-w)/2+(${zT})*(${kx})/100*${q.W}`; ovy = `(H-h)/2+(${zT})*(${ky})/100*${q.H}`;
      }
      const slide = c.type === 'text' || c.type === 'graphic' ? '0' : `'if(lt(t-${f5(st)},0.25),(1-(t-${f5(st)})/0.25)*${Math.round(22 * q.H / 1080)},0)'`;
      const isSeq = c.type === 'text' || c.type === 'graphic';
      const ox = isSeq ? '0' : (ovx || `(W-w)/2+${f5((c.x || 0) / 100 * q.W)}`);
      const oy = isSeq ? '0' : (ovy || `(H-h)/2+${f5((c.y || 0) / 100 * q.H)}`);
      const out = `[v${k}]`;
      ovFilters.push(`[${idx}:v]${chain}[o${k}]`, `${last}[o${k}]overlay=x='${ox}':y='${oy}':enable='between(t,${f5(st)},${f5(en)})':eof_action=pass:format=auto${out}`);
      last = out; idx++;
    });
    ovFilters.push(`${last}trim=end_frame=${total},setpts=PTS-STARTPTS[vout]`);

    // 3. audio master
    update({ message: 'Mixing and mastering audio', progress: 0.64 });
    const audio = await buildAudio(p, total, work, { signal, update });

    // 4. final encode
    const outName = safeName(name || p.name) + (final ? `_${p.settings.height}p_FINAL` : '_draft') + '.mp4';
    const outFile = path.join(rendersDir(p.id), outName);
    update({ message: 'Encoding final video', progress: 0.68 });
    const enc = final
      ? ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '320k', '-ar', '48000']
      : ['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '128k', '-ar', '48000'];
    const aIdx = idx;
    if (process.env.FF_DEBUG) console.error('[render] filter_complex:', ovFilters.join(';'));
    await ff(['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-f', 'concat', '-safe', '0', '-i', list, ...ovInputs, '-i', audio.file,
      '-filter_complex', ovFilters.join(';'), '-map', '[vout]', '-map', `${aIdx}:a`, ...enc, '-frames:v', String(total), '-t', f5(T), '-movflags', '+faststart', outFile],
      { signal, totalSec: T, onProgress: v => update({ progress: 0.68 + 0.3 * v, message: `Encoding ${Math.round(v * 100)}%` }) });

    // 5. verification (technical QC)
    const pr = JSON.parse((await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', outFile])).stdout);
    const v = pr.streams.find(s => s.codec_type === 'video'), a = pr.streams.find(s => s.codec_type === 'audio');
    const verification = {
      resolution: `${v.width}x${v.height}`, fps: v.avg_frame_rate, videoCodec: `${v.codec_name} ${v.profile}`, audio: a ? `${a.codec_name} ${a.sample_rate}Hz` : 'none',
      durationSec: Number(pr.format.duration), expectedSec: +T.toFixed(3), driftMs: Math.round((Number(pr.format.duration) - T) * 1000),
      loudness: audio.loudness, sizeMB: +(Number(pr.format.size) / 1e6).toFixed(1),
    };
    return { file: outFile, name: outName, verification };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
