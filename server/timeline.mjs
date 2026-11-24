// Timeline operations: thin server wrappers around the shared pure ops (shared/ops.mjs),
// plus the IO-heavy paths (YouTube download, file import) that only exist on the server.
import { FPS, msToFrame, frameToMs } from './lib.mjs';
import { store } from './store.mjs';
import { defaultClip, checkClip, projectFrames, clipEnd } from './project.mjs';
import { opPlaceClip, opAddText, opPatchClips, opSplitClip } from '../shared/ops.mjs';
import { downloadSection, videoId, info as ytInfo } from './youtube.mjs';
import { importFile } from './media.mjs';

export const beatOf = (p, id) => p.beats.find(b => b.id === id);

/** Rule checks before a YouTube moment is placed (reuse, 3-per-video, adjacency, 5 s). */
export function checkSourceRules(p, { url, inMs, outMs, beatId, replaceClipId }) {
  const vid = videoId(url);
  const used = p.clips.filter(c => c.track === 'V1' && c.source?.url && videoId(c.source.url) === vid && c.id !== replaceClipId);
  const problems = [];
  if (used.length >= 3) problems.push(`YouTube video ${vid} already used ${used.length} times (max 3).`);
  for (const u of used) if (inMs < u.source.outMs && u.source.inMs < outMs) problems.push(`Overlaps a moment already used at ${(u.start / FPS).toFixed(1)}s.`);
  if (beatId) {
    const b = beatOf(p, beatId);
    if (b) {
      const v1 = p.clips.filter(c => c.track === 'V1' && c.id !== replaceClipId).sort((a, b2) => a.start - b2.start);
      const prev = [...v1].reverse().find(c => clipEnd(c) <= b.startFrame + 1), next = v1.find(c => c.start >= b.endFrame - 1);
      for (const nb of [prev, next]) if (nb?.source?.url && videoId(nb.source.url) === vid) problems.push('Adjacent clip comes from the same YouTube video — put a different clip between them.');
    }
  }
  return problems;
}

/**
 * Put something on the timeline. Either an existing asset, or a YouTube section that is downloaded first.
 * Timing comes from a beat (exact first-word start → next beat) unless startMs/durMs are given.
 */
export async function placeClip(a, cause = { by: 'mcp', tool: 'place_clip' }) {
  let p = store.project;
  const track = a.track || 'V1';
  const beat = a.beatId ? beatOf(p, a.beatId) : null;
  if (a.beatId && !beat) throw new Error(`Unknown beat ${a.beatId}`);
  const fps = p.settings?.fps || 30;
  const startFrame = a.startFrame ?? (a.startMs != null ? msToFrame(a.startMs, fps) : beat ? beat.startFrame : null);
  if (startFrame == null) throw new Error('Give beatId, startMs or startFrame.');
  let durFrames = a.durFrames ?? (a.durMs != null ? msToFrame(a.durMs, fps) : beat ? beat.endFrame - beat.startFrame : null);
  const total = projectFrames(p);
  let assetId = a.assetId, inMs = a.inMs ?? 0, source = null;

  if (!assetId && a.youtube) {
    const y = a.youtube;
    if (!y.url) throw new Error('youtube.url is required');
    if (y.startMs == null) throw new Error('youtube.startMs is required (the exact moment in the source video)');
    const speed = a.speed || 1;
    if (durFrames == null) durFrames = Math.min(msToFrame(y.endMs - y.startMs, fps), 5 * FPS);
    const spanMs = Math.round(frameToMs(durFrames, fps) * speed);
    const outMs = y.startMs + spanMs;
    if (track === 'V1' && !a.force) {
      const problems = checkSourceRules(p, { url: y.url, inMs: y.startMs, outMs, beatId: a.beatId, replaceClipId: a.replaceClipId });
      if (problems.length) throw new Error('Rule check failed: ' + problems.join(' ') + ' (pass force:true to override)');
    }
    const meta = await ytInfo(y.url);
    if (meta.durationSec && outMs / 1000 > meta.durationSec + 0.5) throw new Error(`Source video is only ${meta.durationSec}s long; ${(outMs / 1000).toFixed(1)}s requested.`);
    const pad = a.padMs ?? 1000;
    const wantAudio = !!(a.audio ?? a.withAudio);
    const dl = await downloadSection(y.url, { startMs: y.startMs, endMs: outMs, maxHeight: a.maxHeight || 1080, padMs: pad, audio: wantAudio });
    const asset = await importFile(dl.file, {
      name: `${meta.title}`.slice(0, 60) + ` [${(y.startMs / 1000).toFixed(1)}s]`, cause: { by: cause.by, tool: 'download', silent: true },
      source: { type: 'youtube', url: y.url, id: meta.id, title: meta.title, channel: meta.channel, license: meta.license, rangeStartMs: dl.rangeStartMs, rangeEndMs: dl.rangeEndMs, query: y.query || a.query || null },
      useAudio: wantAudio,
    });
    assetId = asset.id;
    inMs = y.startMs - dl.rangeStartMs;
    source = { type: 'youtube', url: y.url, title: meta.title, channel: meta.channel, license: meta.license, inMs: y.startMs, outMs, query: y.query || a.query || null };
    p = store.project;
  }
  if (!assetId && a.type !== 'text') throw new Error('Give assetId or youtube:{url,startMs}.');
  const asset = p.assets[assetId];
  if (assetId && !asset) throw new Error(`Unknown asset ${assetId}`);
  if (durFrames == null && asset) durFrames = msToFrame(asset.duration - inMs, fps);
  if (track === 'V1' && durFrames > 5 * FPS && !a.allowLong) throw new Error(`A visual segment may not exceed 5.0 s (got ${(durFrames / FPS).toFixed(2)} s). Split the beat or pass allowLong:true.`);
  if (p.settings?.voiceLock && total && startFrame + durFrames > total + 1 && track !== 'A1' && !a.extend) durFrames = Math.max(1, total - startFrame);
  const speed = a.speed || 1;
  if (asset && asset.kind === 'video' && inMs + frameToMs(durFrames, fps) * speed > asset.duration + 80) throw new Error(`Asset “${asset.name}” is ${(asset.duration / 1000).toFixed(1)}s; the clip needs ${((inMs + frameToMs(durFrames, fps) * speed) / 1000).toFixed(1)}s of source.`);

  if (source && asset && asset.source && asset.source.type === 'youtube' && !source.title) {
    source = { type: 'youtube', url: asset.source.url, title: asset.source.title, channel: asset.source.channel, license: asset.source.license, inMs: asset.source.rangeStartMs + inMs, outMs: asset.source.rangeStartMs + inMs + Math.round(frameToMs(durFrames, fps) * speed) };
  }
  return store.mutate(cause, d => {
    if (a.replaceClipId) d.clips = d.clips.filter(c => c.id !== a.replaceClipId);
    if (a.replace !== false && a.beatId && track === 'V1') d.clips = d.clips.filter(c => !(c.track === 'V1' && c.beatId === a.beatId));
    const r = opPlaceClip(d, { ...a, track, source: source || undefined });
    Object.assign(cause, { summary: r.summary, clipIds: r.clipIds });
    return r.clip;
  });
}

export function addOverlay(a, cause = { by: 'mcp', tool: 'add_overlay' }) {
  return store.mutate(cause, d => {
    const r = opAddText(d, { ...a, kind: a.kind || 'fact' });
    Object.assign(cause, { summary: r.summary, clipIds: r.clipIds });
    return r.clip;
  });
}

export function patchClips(patches, cause) {
  return store.mutate(cause, d => {
    const r = opPatchClips(d, patches);
    Object.assign(cause, { summary: r.summary, clipIds: r.clipIds });
    return r.result;
  });
}

export function splitClip(id, atFrame, cause) {
  return store.mutate(cause, d => {
    const r = opSplitClip(d, id, atFrame);
    Object.assign(cause, { summary: r.summary, clipIds: r.clipIds });
    return r.result;
  });
}

// keep named export used elsewhere
export { defaultClip, checkClip };
