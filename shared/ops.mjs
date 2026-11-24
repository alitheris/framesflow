// FramesFlow shared timeline operations — pure functions over a project draft.
// The server tool registry and the browser's standalone bridge both call these,
// so every edit behaves identically over MCP and in the UI, locally or on Netlify.
import {
  uid, clamp, msToFrame, frameToMs, defaultClip, checkClip, clipEnd, projectFrames,
  sortedTrack, transitionById, effectById, defaultEffectParams, TEXT_ANIMS_IN, TEXT_ANIMS_OUT,
  FPS_OPTIONS, FORMATS, validSize, KEYFRAMABLE, defaultTextStyle, TEXT_KINDS, TRACKS, evalKeys, EFFECT_KEYFRAMABLE,
} from './model.mjs';
import { checkGraphic } from './graphics.mjs';

// ---------------------------------------------------------------- text style

const fpsOf = p => p.settings?.fps || 30;
const framesOf = (p, ms) => msToFrame(ms, fpsOf(p));
const msOf = (p, f) => frameToMs(f, fpsOf(p));

// ---------------------------------------------------------------- placement
/**
 * Place an existing asset (or a bare text clip) on the timeline.
 * `youtube` download / file import happen in the server layer before calling this.
 */
export function opPlaceClip(d, a = {}) {
  const fps = fpsOf(d);
  const track = a.track || 'V1';
  const beat = a.beatId ? d.beats.find(b => b.id === a.beatId) : null;
  if (a.beatId && !beat) throw new Error(`Unknown beat ${a.beatId}`);
  const startFrame = a.startFrame ?? (a.startMs != null ? framesOf(d, a.startMs) : beat ? beat.startFrame : null);
  if (startFrame == null) throw new Error('Give beatId, startMs or startFrame.');
  let durFrames = a.durFrames ?? (a.durMs != null ? framesOf(d, a.durMs) : beat ? beat.endFrame - beat.startFrame : null);
  const total = projectFrames(d);
  const assetId = a.assetId;
  if (!assetId && a.type !== 'text') throw new Error('Give assetId or type:"text".');
  const asset = assetId ? d.assets[assetId] : null;
  if (assetId && !asset) throw new Error(`Unknown asset ${assetId}`);
  if (durFrames == null) durFrames = asset ? (asset.kind === 'image' ? 3 * fps : framesOf(d, asset.duration - (a.inMs ?? 0))) : 3 * fps;
  const maxDur = a.allowLong ? Infinity : track === 'V1' ? 5 * fps : Infinity;
  if (durFrames > maxDur) durFrames = Math.round(maxDur);
  // only clamp to the current end when the length is locked (voice pipeline); free projects extend
  if (d.settings?.voiceLock && total && startFrame + durFrames > total + 1 && track !== 'A1' && !(a.extend)) durFrames = Math.max(1, total - startFrame);
  const type = a.type || (track.startsWith('A') || d.tracks.find(t => t.id === track)?.kind === 'audio' ? 'audio' : asset?.kind === 'image' ? 'image' : 'video');
  const clip = defaultClip(d, {
    track, type, assetId: assetId || undefined, start: startFrame, dur: durFrames, in: a.inMs ?? 0, speed: a.speed || 1,
    label: a.label || asset?.name || (a.text?.title) || type,
    beatId: a.beatId || null,
    ...(a.transition ? { transition: { type: a.transition.type, dur: a.transition.dur ?? transitionById(a.transition.type).dur } } : {}),
    ...(a.kenburns ? { kenburns: a.kenburns === true ? { from: 1, to: 1.06 } : a.kenburns } : {}),
    ...(a.grade ? { grade: a.grade } : {}),
    ...(a.volume != null ? { volume: a.volume } : {}),
    ...(type === 'video' ? { audio: !!(a.audio ?? asset?.useAudio) } : {}),
    ...(asset?.transparent ? { fit: 'contain' } : {}),
    ...(a.scale ? { scale: a.scale } : {}),
    ...(a.gainDb != null ? { gainDb: a.gainDb } : {}),
    ...(a.text ? { text: { ...defaultTextStyle(a.text.kind || 'title'), ...a.text } } : {}),
    ...(a.source ? { source: a.source } : {}),
  });
  d.clips.push(checkClip(d, clip));
  return { clip, summary: `Placed "${clip.label}" on ${track} at ${(startFrame / fps).toFixed(2)}s`, clipIds: [clip.id] };
}

/** Text/graphic overlay on an overlay track (fact/lower/stat/quote/title/chapter…). */
export function opAddText(d, a = {}) {
  const fps = fpsOf(d);
  const beat = a.beatId ? d.beats.find(b => b.id === a.beatId) : null;
  const startFrame = a.startFrame ?? (a.startMs != null ? framesOf(d, a.startMs) : beat ? beat.startFrame : null);
  if (startFrame == null) throw new Error('Give beatId or startMs.');
  let endFrame = a.endFrame ?? (a.endMs != null ? framesOf(d, a.endMs) : null);
  if (endFrame == null) endFrame = beat ? Math.min(beat.endFrame, startFrame + 4 * fps) : startFrame + 3 * fps;
  if (endFrame <= startFrame) throw new Error('endMs must be after startMs');
  const style = { ...defaultTextStyle(a.kind || 'title'), ...(a.style || {}) };
  const clip = defaultClip(d, {
    track: a.track || d.tracks.find(t => t.kind === 'video' && t.role === 'overlay')?.id || 'V2',
    type: 'text', start: startFrame, dur: endFrame - startFrame, beatId: a.beatId || null,
    label: a.title || a.kind || 'Text',
    text: {
      ...style,
      kind: TEXT_KINDS.includes(a.kind) ? a.kind : style.kind,
      title: a.title ?? '', body: a.body ?? '', label: a.label ?? '',
      position: a.position, accent: a.accent,
    },
    ...(a.transition ? { transition: { type: a.transition.type, dur: a.transition.dur ?? transitionById(a.transition.type).dur } } : {}),
  });
  d.clips.push(checkClip(d, clip));
  return { clip, summary: `Added ${clip.text.kind} text "${clip.text.title}"`, clipIds: [clip.id] };
}

// ---------------------------------------------------------------- edits
export function opPatchClips(d, patches) {
  if (!Array.isArray(patches) || !patches.length) throw new Error('patches[] required');
  for (const { id, patch } of patches) {
    const c = d.clips.find(x => x.id === id);
    if (!c) throw new Error(`Unknown clip ${id}`);
    Object.assign(c, patch);
    checkClip(d, c);
  }
  return { result: patches.length, summary: patches.length === 1 ? 'Edited clip' : `Edited ${patches.length} clips`, clipIds: patches.map(x => x.id) };
}

export function opSplitClip(d, id, atFrame) {
  const fps = fpsOf(d);
  const c = d.clips.find(x => x.id === id);
  if (!c) throw new Error(`Unknown clip ${id}`);
  const at = Math.round(atFrame ?? Math.floor(c.start + c.dur / 2));
  if (at <= c.start || at >= clipEnd(c)) throw new Error('Split point must be inside the clip');
  const left = at - c.start;
  const right = {
    ...structuredClone(c), id: uid('c_'), start: at, dur: c.dur - left,
    in: Math.round(c.in + frameToMs(left, fps) * (c.speed || 1)),
    transition: { type: 'cut', dur: 0 }, fadeIn: 0,
  };
  // split keyframes across the cut; the right side gets an evaluated key at frame 0 so motion continues
  if (c.keyframes) {
    for (const k of Object.keys(c.keyframes)) {
      const keys = c.keyframes[k] || [];
      const rightKeys = keys.filter(x => x.frame > left).map(x => ({ ...x, frame: x.frame - left }));
      const atCut = evalKeys(keys, left);
      if (rightKeys.length) {
        if (!keys.some(x => x.frame === left)) rightKeys.unshift({ frame: 0, value: atCut, interp: 'linear' });
        right.keyframes = { ...right.keyframes, [k]: rightKeys };
      }
      const leftKeys = keys.filter(x => x.frame <= left);
      if (leftKeys.length > 1) c.keyframes[k] = leftKeys;
      else if (leftKeys.length === 1 && leftKeys[0].frame === 0) c.keyframes[k] = leftKeys; // keep single start key
      else delete c.keyframes[k];
    }
    if (c.keyframes && !Object.keys(c.keyframes).length) c.keyframes = undefined;
    if (right.keyframes && !Object.keys(right.keyframes).length) right.keyframes = undefined;
  }
  // effect keyframes: same treatment (right side re-based to its own start, with an evaluated key at the cut)
  (c.effects || []).forEach((e, i) => {
    if (!e.keyframes) return;
    const re = right.effects[i];
    for (const k of Object.keys(e.keyframes)) {
      const keys = e.keyframes[k] || [];
      const atCut = evalKeys(keys, left);
      const rightKeys = keys.filter(x => x.frame > left).map(x => ({ ...x, frame: x.frame - left }));
      if (!keys.some(x => x.frame === left)) rightKeys.unshift({ frame: 0, value: atCut, interp: 'linear' });
      re.keyframes[k] = rightKeys;
      const leftKeys = keys.filter(x => x.frame <= left);
      if (leftKeys.length) e.keyframes[k] = leftKeys; else delete e.keyframes[k];
    }
    if (!Object.keys(e.keyframes).length) delete e.keyframes;
  });
  // effect instances need unique ids on the new clip
  (right.effects || []).forEach(e => { e.id = uid('e_'); });
  if (c.source) { right.source = { ...c.source, inMs: c.source.inMs + Math.round(frameToMs(left, fps) * (c.speed || 1)) }; c.source = { ...c.source, outMs: right.source.inMs }; }
  c.dur = left; c.fadeOut = 0;
  d.clips.push(right);
  return { result: [c.id, right.id], summary: 'Split clip', clipIds: [c.id, right.id] };
}

export function opDeleteClips(d, ids, { ripple = false } = {}) {
  if (!ids?.length) throw new Error('ids[] required');
  const set = new Set(ids);
  const removed = d.clips.filter(c => set.has(c.id));
  if (!removed.length) throw new Error('No matching clips');
  d.clips = d.clips.filter(c => !set.has(c.id));
  if (ripple) {
    for (const t of [...new Set(removed.map(c => c.track))]) {
      const gone = removed.filter(c => c.track === t);
      for (const g of gone) {
        for (const c of d.clips.filter(x => x.track === t && x.start >= clipEnd(g))) c.start = Math.max(0, c.start - g.dur);
      }
    }
  }
  return { result: { removed: removed.length }, summary: `Deleted ${removed.length} clip${removed.length > 1 ? 's' : ''}${ripple ? ' (ripple)' : ''}`, clipIds: removed.map(c => c.id) };
}

export function opDuplicateClips(d, ids, offset) {
  const fps = fpsOf(d);
  const made = [];
  for (const id of ids || []) {
    const c = d.clips.find(x => x.id === id);
    if (!c) throw new Error(`Unknown clip ${id}`);
    const copy = structuredClone(c);
    copy.id = uid('c_');
    copy.start = Math.max(0, offset != null ? Math.round(framesOf(d, offset)) : clipEnd(c));
    d.clips.push(copy);
    made.push(copy.id);
  }
  if (!made.length) throw new Error('ids[] required');
  return { result: { ids: made }, summary: `Duplicated ${made.length} clip${made.length > 1 ? 's' : ''}`, clipIds: made };
}

/** Insert raw clips (paste / drop from the studio). Clips are added verbatim after a check. */
export function opAddClipsRaw(d, clips) {
  if (!Array.isArray(clips)?.length) throw new Error('clips[] required');
  const ids = [];
  for (const raw of clips) {
    const c = { ...defaultClip(d), ...structuredClone(raw), id: uid('c_') };
    if (d.clips.some(x => x.id === c.id)) c.id = uid('c_');
    d.clips.push(checkClip(d, c));
    ids.push(c.id);
  }
  return { result: { ids }, summary: `Added ${ids.length} clips`, clipIds: ids };
}

export function opMoveClip(d, id, { startMs, startFrame, track }) {
  const c = d.clips.find(x => x.id === id);
  if (!c) throw new Error(`Unknown clip ${id}`);
  const patch = {};
  if (startFrame != null) patch.start = Math.round(startFrame);
  else if (startMs != null) patch.start = framesOf(d, startMs);
  if (track) patch.track = track;
  Object.assign(c, patch);
  checkClip(d, c);
  return { result: true, summary: `Moved clip to ${(c.start / fpsOf(d)).toFixed(2)}s`, clipIds: [id] };
}

export function opTrimClip(d, id, { inMs, durMs, startMs }) {
  const c = d.clips.find(x => x.id === id);
  if (!c) throw new Error(`Unknown clip ${id}`);
  if (inMs != null) c.in = Math.max(0, Math.round(inMs));
  if (durMs != null) c.dur = Math.max(1, framesOf(d, durMs));
  if (startMs != null) c.start = framesOf(d, startMs);
  checkClip(d, c);
  return { result: true, summary: 'Trimmed clip', clipIds: [id] };
}

/**
 * Detach a video clip's own audio: the video clip goes silent and an audio clip with the same
 * source range, timing, speed and volume appears on an audio track, free to move/cut/mix on its own.
 */
export function opDetachAudio(d, { clipId } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  if (c.type !== 'video') throw new Error('Only video clips have audio to detach');
  const asset = d.assets[c.assetId];
  if (!asset?.hasAudio) throw new Error('This clip has no audio track (it was imported or downloaded without audio).');
  // reuse a free sound-effects track if one has room, otherwise add a track
  const clash = t => d.clips.some(x => x.track === t.id && x.start < clipEnd(c) && clipEnd(x) > c.start);
  let track = d.tracks.find(t => t.kind === 'audio' && t.role === 'sfx' && !t.locked && !clash(t));
  if (!track) track = opAddTrack(d, { kind: 'audio', name: 'Detached audio', role: 'sfx' }).result;
  const audio = defaultClip(d, {
    track: track.id, type: 'audio', assetId: c.assetId, start: c.start, dur: c.dur, in: c.in, speed: c.speed || 1,
    volume: c.volume ?? 1, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, gainDb: 0,
    label: `${c.label || asset.name} (audio)`, ...(c.keyframes?.volume ? { keyframes: { volume: structuredClone(c.keyframes.volume) } } : {}),
  });
  c.audio = false;
  d.clips.push(checkClip(d, audio));
  return { clip: audio, summary: `Detached audio to ${track.id}`, clipIds: [c.id, audio.id] };
}

// ---------------------------------------------------------------- tracks
export function opAddTrack(d, { kind = 'video', name, role } = {}) {
  const prefix = kind === 'audio' ? 'A' : 'V';
  let i = 1, id;
  do { id = `${prefix}${++i}`; } while (d.tracks.some(t => t.id === id));
  const track = { id, kind, name: name || (kind === 'audio' ? 'Audio' : 'Video') + ' ' + i, role: role || (kind === 'audio' ? 'sfx' : 'overlay'), muted: false, locked: false, solo: false };
  if (kind === 'video') d.tracks.unshift(track); else d.tracks.push(track);
  return { result: track, summary: `Added ${kind} track ${id}`, clipIds: [] };
}

export function opRemoveTrack(d, id) {
  if (d.tracks.length <= 1) throw new Error('Cannot remove the last track');
  const t = d.tracks.find(x => x.id === id);
  if (!t) throw new Error(`Unknown track ${id}`);
  d.tracks = d.tracks.filter(x => x.id !== id);
  d.clips = d.clips.filter(c => c.track !== id);
  return { result: true, summary: `Removed track ${id} and its clips`, clipIds: [] };
}

export function opReorderTracks(d, order) {
  if (!Array.isArray(order)) throw new Error('order[] required');
  const ids = d.tracks.map(t => t.id);
  if (order.length !== ids.length || new Set(order).size !== ids.length || order.some(x => !ids.includes(x))) throw new Error('order must be a permutation of track ids');
  d.tracks = order.map(x => d.tracks.find(t => t.id === x));
  return { result: true, summary: 'Reordered tracks', clipIds: [] };
}

export function opSetTrack(d, id, patch = {}) {
  const t = d.tracks.find(x => x.id === id);
  if (!t) throw new Error(`Unknown track ${id}`);
  for (const k of ['muted', 'locked', 'solo']) if (patch[k] != null) t[k] = !!patch[k];
  if (patch.name != null) t.name = String(patch.name).slice(0, 40);
  return { result: t, summary: `Updated track ${id}`, clipIds: [] };
}

// ---------------------------------------------------------------- markers
export function opSetMarkers(d, markers) {
  if (!Array.isArray(markers)) throw new Error('markers[] required');
  d.markers = markers.map(m => ({ id: m.id || uid('m_'), frame: Math.max(0, Math.round(m.frame)), label: String(m.label || '').slice(0, 80), color: m.color || null }));
  return { result: d.markers, summary: `Set ${d.markers.length} markers`, clipIds: [] };
}

export function opAddMarker(d, { frame, ms, label = '', color } = {}) {
  const f = Math.max(0, Math.round(frame ?? framesOf(d, ms ?? 0)));
  const m = { id: uid('m_'), frame: f, label: String(label).slice(0, 80), color: color || null };
  d.markers.push(m);
  return { result: m, summary: `Marker at ${(f / fpsOf(d)).toFixed(2)}s`, clipIds: [] };
}

// ---------------------------------------------------------------- effects
export function opApplyEffect(d, { clipId, type, params, prepend } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  const eff = effectById(type);
  if (!eff) throw new Error(`Unknown effect ${type}. Available: ${'effect catalog'}`);
  c.effects = Array.isArray(c.effects) ? c.effects : [];
  const inst = { id: uid('e_'), type, params: { ...defaultEffectParams(type), ...(params || {}) } };
  if (prepend) c.effects.unshift(inst); else c.effects.push(inst);
  checkClip(d, c);
  return { result: inst, summary: `Applied ${eff.label} to clip`, clipIds: [clipId] };
}

export function opClearEffects(d, { clipId } = {}) {
  if (clipId) {
    const c = d.clips.find(x => x.id === clipId);
    if (!c) throw new Error(`Unknown clip ${clipId}`);
    c.effects = [];
    return { result: true, summary: 'Cleared effects', clipIds: [clipId] };
  }
  for (const c of d.clips) c.effects = [];
  return { result: true, summary: 'Cleared all effects', clipIds: [] };
}

export function opRemoveEffect(d, { clipId, effectId }) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  c.effects = (c.effects || []).filter(e => e.id !== effectId);
  return { result: true, summary: 'Removed effect', clipIds: [clipId] };
}

export function opUpdateEffect(d, { clipId, effectId, params }) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  const e = (c.effects || []).find(x => x.id === effectId);
  if (!e) throw new Error(`Unknown effect instance ${effectId}`);
  e.params = { ...e.params, ...(params || {}) };
  return { result: e, summary: 'Updated effect', clipIds: [clipId] };
}

// ---------------------------------------------------------------- effect layers + effect keyframes
/**
 * Effect layer (adjustment layer): a clip on its own video track that applies an effect stack to
 * everything on the tracks BELOW it, for its duration. Created on a fresh track unless `track` is given.
 */
export function opAddEffectLayer(d, a = {}) {
  const fps = fpsOf(d);
  const startFrame = a.startFrame ?? (a.startMs != null ? framesOf(d, a.startMs) : 0);
  let dur = a.durFrames ?? (a.durMs != null ? framesOf(d, a.durMs) : null);
  if (dur == null) dur = a.endMs != null ? framesOf(d, a.endMs) - startFrame : Math.max(1, Math.min(projectFrames(d) - startFrame, 3 * fps) || 3 * fps);
  if (dur < 1) throw new Error('Effect layer needs a positive duration');
  let track = a.track;
  if (!track) {
    const made = opAddTrack(d, { kind: 'video', name: 'Effects', role: 'effect' });
    track = made.result.id;
  }
  const effects = (a.effects || []).map(e => {
    const type = typeof e === 'string' ? e : e.type;
    if (!effectById(type)) throw new Error(`Unknown effect ${type}`);
    return { id: uid('e_'), type, params: { ...defaultEffectParams(type), ...(e.params || {}) }, ...(e.keyframes ? { keyframes: e.keyframes } : {}) };
  });
  const clip = defaultClip(d, { track, type: 'effect', start: Math.max(0, startFrame), dur, label: a.label || (effects[0] ? effectById(effects[0].type).label : 'Effect layer'), effects });
  d.clips.push(checkClip(d, clip));
  return { clip, summary: `Added effect layer "${clip.label}"`, clipIds: [clip.id] };
}

const INTERPS = ['linear', 'ease', 'hold'];

/** Keyframe one parameter of one effect instance. Frames are relative to the clip start. */
export function opSetEffectKeyframes(d, { clipId, effectId, param, keys, add } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  const e = (c.effects || []).find(x => x.id === effectId);
  if (!e) throw new Error(`Unknown effect instance ${effectId}`);
  const allowed = EFFECT_KEYFRAMABLE[e.type] || [];
  if (!allowed.includes(param)) throw new Error(`Effect ${e.type} parameter "${param}" cannot be keyframed (allowed: ${allowed.join(', ') || 'none'})`);
  e.keyframes = { ...(e.keyframes || {}) };
  if (add != null) {
    const frame = Math.max(0, Math.round(add.frame ?? 0));
    const list = (e.keyframes[param] || []).filter(k => k.frame !== frame);
    list.push({ frame, value: Number(add.value), interp: INTERPS.includes(add.interp) ? add.interp : 'linear' });
    e.keyframes[param] = list.sort((a, b) => a.frame - b.frame);
  } else if (Array.isArray(keys)) {
    const list = keys.map(k => ({ frame: Math.max(0, Math.round(k.frame)), value: Number(k.value), interp: INTERPS.includes(k.interp) ? k.interp : 'linear' })).sort((a, b) => a.frame - b.frame);
    if (list.length) e.keyframes[param] = list; else delete e.keyframes[param];
  } else throw new Error('Give keys[] or add:{frame,value}');
  if (!Object.keys(e.keyframes).length) delete e.keyframes;
  checkClip(d, c);
  return { result: e.keyframes?.[param] || [], summary: `Keyframed ${e.type}.${param}`, clipIds: [clipId] };
}

export function opClearEffectKeyframes(d, { clipId, effectId, param } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  const e = (c.effects || []).find(x => x.id === effectId);
  if (!e) throw new Error(`Unknown effect instance ${effectId}`);
  if (param && e.keyframes) { delete e.keyframes[param]; if (!Object.keys(e.keyframes).length) delete e.keyframes; }
  else delete e.keyframes;
  return { result: true, summary: 'Cleared effect keyframes', clipIds: [clipId] };
}

// ---------------------------------------------------------------- keyframes
export function opSetKeyframes(d, { clipId, property, keys, add } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  if (!KEYFRAMABLE.includes(property)) throw new Error(`Cannot keyframe "${property}". Keyframable: ${KEYFRAMABLE.join(', ')}`);
  c.keyframes = { ...(c.keyframes || {}) };
  if (add != null) {
    // add or update a single keyframe: { frame, value, interp }
    const frame = Math.max(0, Math.round(add.frame ?? 0));
    const list = (c.keyframes[property] || []).filter(k => k.frame !== frame);
    list.push({ frame, value: Number(add.value), interp: ['linear', 'ease', 'hold'].includes(add.interp) ? add.interp : 'linear' });
    c.keyframes[property] = list.sort((a, b) => a.frame - b.frame);
    if (!c.keyframes[property].length) delete c.keyframes[property];
  } else if (Array.isArray(keys)) {
    const list = keys.map(k => ({ frame: Math.max(0, Math.round(k.frame)), value: Number(k.value), interp: ['linear', 'ease', 'hold'].includes(k.interp) ? k.interp : 'linear' })).sort((a, b) => a.frame - b.frame);
    if (list.length) c.keyframes[property] = list; else delete c.keyframes[property];
  } else throw new Error('Give keys[] or add:{frame,value}');
  if (!Object.keys(c.keyframes).length) c.keyframes = undefined;
  checkClip(d, c);
  return { result: c.keyframes?.[property] || [], summary: `Keyframed ${property}`, clipIds: [clipId] };
}

export function opClearKeyframes(d, { clipId, property } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  if (property && c.keyframes) { delete c.keyframes[property]; if (!Object.keys(c.keyframes).length) c.keyframes = undefined; }
  else c.keyframes = undefined;
  return { result: true, summary: `Cleared keyframes${property ? ' (' + property + ')' : ''}`, clipIds: [clipId] };
}

// ---------------------------------------------------------------- watermark mask
/** Blur-patch a region of the clip (normalized 0..1) to hide watermarks/logos/burned-in text. */
export function opSetMask(d, { clipId, x, y, w, h, clear } = {}) {
  const c = d.clips.find(x2 => x2.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  if (clear) { c.mask = null; return { result: null, summary: 'Removed mask', clipIds: [clipId] }; }
  const m = { x, y, w, h, mode: 'blur' };
  c.mask = m;
  checkClip(d, c); // clamps to 0..1
  return { result: c.mask, summary: 'Mask set (blurred region)', clipIds: [clipId] };
}

// ---------------------------------------------------------------- animation graphics
export function opAddAnimation(d, a = {}) {
  const fps = fpsOf(d);
  const beat = a.beatId ? d.beats.find(b => b.id === a.beatId) : null;
  const startFrame = a.startFrame ?? (a.startMs != null ? framesOf(d, a.startMs) : beat ? beat.startFrame : null);
  if (startFrame == null) throw new Error('Give beatId or startMs.');
  let endFrame = a.endFrame ?? (a.endMs != null ? framesOf(d, a.endMs) : null);
  if (endFrame == null) endFrame = beat ? Math.min(beat.endFrame, startFrame + 4 * fps) : startFrame + 3 * fps;
  if (endFrame <= startFrame) throw new Error('endMs must be after startMs');
  const clip = defaultClip(d, {
    track: a.track || d.tracks.find(t => t.kind === 'video' && t.role === 'overlay')?.id || 'V2',
    type: 'graphic', start: startFrame, dur: endFrame - startFrame, beatId: a.beatId || null,
    label: a.graphic?.title || a.graphic?.kind || 'Graphic',
    graphic: checkGraphic({ ...(a.graphic || {}), kind: a.kind || a.graphic?.kind || 'stat' }),
  });
  d.clips.push(checkClip(d, clip));
  return { clip, summary: `Added ${clip.graphic.kind} animation "${clip.graphic.title}"`, clipIds: [clip.id] };
}

// ---------------------------------------------------------------- editor plan (AI shot list)
/** Store the user's mix decision + the AI's shot-list rows. Validated lightly; exec_plan materialises them. */
export function opSetPlan(d, { mix, rows, clear } = {}) {
  if (clear) { d.plan = null; return { result: null, summary: 'Plan cleared', clipIds: [] }; }
  if (!d.plan) d.plan = { mix: null, rows: [], createdAt: Date.now() };
  if (mix) {
    const m = { youtube: Number(mix.youtube) || 0, image: Number(mix.image) || 0, animation: Number(mix.animation) || 0 };
    const sum = m.youtube + m.image + m.animation;
    if (Math.round(sum) !== 100) throw new Error(`Mix percentages must sum to 100 (got ${sum}).`);
    for (const k of ['youtube', 'image', 'animation']) if (m[k] < 0) throw new Error('Percentages cannot be negative');
    if (Math.max(m.youtube, m.image, m.animation) >= 100) throw new Error('The video cannot be made of just one type — mix YouTube footage, images and animation.');
    d.plan.mix = m;
  }
  if (rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('rows[] required');
    let t = 0;
    d.plan.rows = rows.map((r, i) => {
      const startMs = Math.round(r.startMs ?? t);
      const endMs = Math.round(r.endMs ?? startMs + 3000);
      if (endMs <= startMs) throw new Error(`Row ${i + 1}: endMs must be after startMs`);
      t = endMs;
      return {
        id: r.id || 'r' + (i + 1),
        startMs, endMs,
        type: ['youtube', 'image', 'animation'].includes(r.type) ? r.type : 'youtube',
        line: r.line != null ? String(r.line).slice(0, 400) : undefined,
        text: r.text != null ? String(r.text).slice(0, 300) : undefined,
        // youtube rows
        url: r.url, title: r.title, channel: r.channel,
        inMs: r.inMs != null ? Math.max(0, Math.round(r.inMs)) : undefined,
        outMs: r.outMs != null ? Math.max(0, Math.round(r.outMs)) : undefined,
        watermark: r.watermark ? String(r.watermark).slice(0, 300) : undefined,
        mask: r.mask && Number.isFinite(r.mask.x) ? r.mask : undefined,
        // image rows
        assetId: r.assetId,
        // animation rows
        kind: r.kind, graphic: r.graphic,
        // any type
        query: r.query, transition: r.transition, note: r.note,
      };
    });
  }
  return { result: d.plan, summary: 'Plan updated', clipIds: [] };
}
export function opSetTextStyle(d, { clipId, text, style } = {}) {
  const c = d.clips.find(x => x.id === clipId);
  if (!c) throw new Error(`Unknown clip ${clipId}`);
  if (c.type !== 'text') throw new Error('Not a text clip');
  c.text = { ...defaultTextStyle(c.text.kind), ...c.text, ...(style || {}) };
  if (text) { if (text.title != null) c.text.title = String(text.title); if (text.body != null) c.text.body = String(text.body); if (text.label != null) c.text.label = String(text.label); }
  if (c.text.animIn && !TEXT_ANIMS_IN.includes(c.text.animIn)) throw new Error(`Unknown text animation ${c.text.animIn}`);
  if (c.text.animOut && !TEXT_ANIMS_OUT.includes(c.text.animOut)) throw new Error(`Unknown text animation ${c.text.animOut}`);
  return { result: c.text, summary: 'Updated text style', clipIds: [clipId] };
}

// ---------------------------------------------------------------- project-level
export function opSetProjectFormat(d, { formatId, width, height, fps, voiceLock } = {}) {
  if (formatId) {
    const f = FORMATS.find(x => x.id === formatId);
    if (!f) throw new Error(`Unknown format ${formatId}`);
    d.settings.width = f.w; d.settings.height = f.h;
  }
  if (width) d.settings.width = Math.round(Number(width));
  if (height) d.settings.height = Math.round(Number(height));
  if (!validSize(d.settings.width, d.settings.height)) throw new Error('Only 16:9 and 9:16 aspect ratios are supported.');
  if (fps) {
    const nf = Number(fps);
    if (!FPS_OPTIONS.includes(nf)) throw new Error(`fps must be one of ${FPS_OPTIONS.join(', ')}`);
    if (nf !== d.settings.fps) {
      const ratio = nf / (d.settings.fps || 30);
      for (const c of d.clips) { c.start = Math.round(c.start * ratio); c.dur = Math.max(1, Math.round(c.dur * ratio)); c.fadeIn = Math.round((c.fadeIn || 0) * ratio); c.fadeOut = Math.round((c.fadeOut || 0) * ratio); }
      for (const m of d.markers || []) m.frame = Math.round(m.frame * ratio);
      for (const b of d.beats || []) { b.startFrame = Math.round(b.startFrame * ratio); b.endFrame = Math.round(b.endFrame * ratio); }
      d.settings.fps = nf;
    }
  }
  if (voiceLock != null) d.settings.voiceLock = !!voiceLock;
  return { result: d.settings, summary: `Format ${d.settings.width}×${d.settings.height} @ ${d.settings.fps}fps`, clipIds: [] };
}

export function opApplyLook(d, { grade, transition, everyNth } = {}) {
  let n = 0;
  for (const c of d.clips) {
    if (c.track.startsWith('V') && c.type === 'video') {
      if (grade) c.grade = grade;
      if (transition) {
        if (!everyNth || n % everyNth === 0) c.transition = { type: transition, dur: transitionById(transition).dur };
      }
      n++;
    }
  }
  return { result: true, summary: `Applied look${grade ? ' ' + grade : ''}${transition ? ' + ' + transition : ''}`, clipIds: [] };
}

export function opClearTimeline(d, tracks) {
  const ids = tracks || ['V1', 'V2'];
  const removed = d.clips.filter(c => ids.includes(c.track));
  d.clips = d.clips.filter(c => !ids.includes(c.track));
  return { result: { removed: removed.length }, summary: `Cleared ${removed.length} clips`, clipIds: [] };
}
