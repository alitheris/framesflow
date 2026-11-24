// Standalone (Netlify) mode: everything lives in the browser.
// Projects persist in IndexedDB; media files stay local as Blobs; every timeline edit
// runs through the SAME shared ops the server/MCP uses.
import { newProject, migrateProject, checkClip, projectFrames, summarize, defaultClip, uid, TRANSITIONS, EFFECTS, TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_FONTS, TEXT_KINDS, TEXT_POSITIONS } from '../../shared/model.mjs';
import * as ops from '../../shared/ops.mjs';

const DB = 'framesflow', STORE = 'projects', MEDIA = 'media';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (store, mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  });
};

// ------------------------------------------------------------- media library
export async function putMedia(id, blob) { await tx(MEDIA, 'readwrite', s => s.put(blob, id)); }
export async function getMedia(id) { return tx(MEDIA, 'readonly', s => s.get(id)); }

const mediaUrls = new Map(); // assetId → object URL (per session)
export const mediaObjectUrl = asset => {
  if (!asset) return '';
  if (!mediaUrls.has(asset.id)) {
    if (asset.blobUrl) mediaUrls.set(asset.id, asset.blobUrl);
    else mediaUrls.set(asset.id, URL.createObjectURL(asset.blob));
  }
  return mediaUrls.get(asset.id);
};

/** Probe a file: kind, duration, dimensions; grab a poster frame for videos/images. */
export async function probeFile(file) {
  const kind = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(file.name) ? 'audio'
    : file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name) ? 'image' : 'video';
  const url = URL.createObjectURL(file);
  const asset = {
    id: uid('a_'), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80), kind, size: file.size, createdAt: Date.now(),
    duration: kind === 'image' ? 0 : 3000, width: 0, height: 0, hasAudio: kind === 'audio',
  };
  await new Promise(resolve => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => { asset.width = img.naturalWidth; asset.height = img.naturalHeight; asset.poster = url; asset.blob = file; resolve(); };
      img.onerror = resolve;
      img.src = url;
    } else {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        asset.duration = Math.round((el.duration || 3) * 1000);
        asset.width = el.videoWidth || 0; asset.height = el.videoHeight || 0;
        // browsers cannot cheaply tell if a video has sound; assume yes unless the engine says otherwise
        asset.hasAudio = kind === 'audio' || (kind === 'video' && el.mozHasAudio !== false && !(el.audioTracks && el.audioTracks.length === 0));
        asset.blob = file;
        if (kind === 'video') {
          el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
          el.onseeked = () => {
            try {
              const cv = document.createElement('canvas');
              cv.width = 320; cv.height = Math.max(1, Math.round(320 * (el.videoHeight / el.videoWidth || 0.5625)));
              cv.getContext('2d').drawImage(el, 0, 0, cv.width, cv.height);
              asset.poster = cv.toDataURL('image/jpeg', 0.7);
            } catch { /* cross-origin or codec */ }
            resolve();
          };
          setTimeout(resolve, 2500); // never hang on weird codecs
        } else resolve();
      };
      el.onerror = resolve;
      el.src = url;
    }
  });
  if (!asset.blob) asset.blob = file;
  return asset;
}

/** Compute waveform peaks (1 byte per 20 ms) for a local audio/video asset. */
export async function computePeaks(asset) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const buf = await asset.blob.arrayBuffer();
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const per = Math.round(audio.sampleRate * 0.02);
    const peaks = new Uint8Array(Math.ceil(ch.length / per));
    for (let i = 0; i < peaks.length; i++) {
      let m = 0;
      for (let j = i * per; j < Math.min((i + 1) * per, ch.length); j += 16) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      peaks[i] = Math.min(255, Math.round(m * 255));
    }
    ctx.close();
    return peaks;
  } catch { return null; }
}

// ------------------------------------------------------------- projects
const LS_KEY = 'framesflow.last';

export async function listProjects() {
  const all = await tx(STORE, 'readonly', s => s.getAll());
  return all.map(p => ({ id: p.id, name: p.name, clips: p.clips?.length || 0, updated: p.updatedAt || 0 })).sort((a, b) => b.updated - a.updated);
}

class LocalStore {
  constructor() {
    this.project = null;
    this.rev = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.activity = [];
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(cause = {}) {
    if (cause.summary) {
      this.activity = [...this.activity, { at: Date.now(), by: cause.by || 'ui', tool: cause.tool, summary: cause.summary, clipIds: cause.clipIds }].slice(-200);
    }
    this.rev++;
    for (const fn of this.listeners) fn({ rev: this.rev, project: this.project, cause });
    this.scheduleSave();
  }
  scheduleSave() { clearTimeout(this._t); this._t = setTimeout(() => this.saveNow(), 500); }
  async saveNow() {
    if (!this.project) return;
    this.project.updatedAt = Date.now();
    await tx(STORE, 'readwrite', s => s.put(structuredClone(this.project)));
    localStorage.setItem(LS_KEY, this.project.id);
  }
  mutate(cause, fn, { history = true } = {}) {
    const draft = structuredClone(this.project);
    const result = fn(draft);
    if (history) { this.undoStack.push(structuredClone(this.project)); if (this.undoStack.length > 50) this.undoStack.shift(); this.redoStack = []; }
    this.project = draft;
    this.emit(cause);
    return result;
  }
  undo() { const p = this.undoStack.pop(); if (!p) return false; this.redoStack.push(structuredClone(this.project)); this.project = p; this.emit({ by: 'ui', summary: 'Undo' }); return true; }
  redo() { const p = this.redoStack.pop(); if (!p) return false; this.undoStack.push(structuredClone(this.project)); this.project = p; this.emit({ by: 'ui', summary: 'Redo' }); return true; }
}

export const local = new LocalStore();

export async function initLocal() {
  const id = localStorage.getItem(LS_KEY);
  const all = await listProjects();
  let p = null;
  if (id) {
    const row = await tx(STORE, 'readonly', s => s.get(id));
    if (row) p = migrateProject(row);
  }
  if (!p) p = all.length ? migrateProject(await tx(STORE, 'readonly', s => s.get(all[0].id))) : newProject('My first video');
  local.project = p;
  local.emit({ by: 'system', summary: `Opened “${p.name}”` });
  return p;
}

export async function createLocalProject(name) {
  const p = newProject(name);
  await local.saveNow(); // save previous
  await tx(STORE, 'readwrite', s => s.put(structuredClone(p)));
  local.project = p; local.undoStack = []; local.redoStack = [];
  local.emit({ by: 'system', summary: `Created project “${name}”` });
  return p;
}

/** Add a project that came from the cloud account (same id never overwrites a project that already exists on this device). */
export async function importLocalProject(data) {
  const existing = await tx(STORE, 'readonly', s => s.get(data.id));
  await local.saveNow();
  const p = migrateProject(existing || data);
  if (!existing) await tx(STORE, 'readwrite', s => s.put(structuredClone(p)));
  local.project = p; local.undoStack = []; local.redoStack = [];
  local.emit({ by: 'system', summary: `Opened “${p.name}”` });
  return { project: p, existed: !!existing };
}

export async function openLocalProject(id) {
  await local.saveNow();
  const row = await tx(STORE, 'readonly', s => s.get(id));
  if (!row) throw new Error('Project not found');
  local.project = migrateProject(row); local.undoStack = []; local.redoStack = [];
  local.emit({ by: 'system', summary: `Opened “${row.name}”` });
  return local.project;
}

export async function deleteLocalProject(id) {
  await tx(STORE, 'readwrite', s => s.delete(id));
}

// ------------------------------------------------------------- tool dispatch (shared ops)
// Tools that work fully in the browser. Others require the local server.
const LOCAL_OPS = {
  place_clip: (d, a) => { const r = ops.opPlaceClip(d, a); return { clipId: r.clip.id }; },
  add_text_clip: (d, a) => { const r = ops.opAddText(d, a); return { clipId: r.clip.id }; },
  add_overlay: (d, a) => { const r = ops.opAddText(d, a); return { clipId: r.clip.id }; },
  edit_clip: (d, a) => ({ edited: ops.opPatchClips(d, a.patches) }),
  move_clip: (d, a) => ({ moved: ops.opMoveClip(d, a.id, a).result }),
  trim_clip: (d, a) => ({ trimmed: ops.opTrimClip(d, a.id, a).result }),
  split_clip: (d, a) => ({ ids: ops.opSplitClip(d, a.id, a.atFrame ?? a.atMs).result }),
  delete_clips: (d, a) => ({ deleted: ops.opDeleteClips(d, a.ids, { ripple: a.ripple }).result.removed }),
  duplicate_clips: (d, a) => ({ ids: ops.opDuplicateClips(d, a.ids, a.offsetMs).result.ids }),
  add_clips_raw: (d, a) => ({ ids: ops.opAddClipsRaw(d, a.clips).result.ids }),
  add_track: (d, a) => ({ track: ops.opAddTrack(d, a).result }),
  remove_track: (d, a) => { ops.opRemoveTrack(d, a.id); return { ok: true }; },
  reorder_tracks: (d, a) => { ops.opReorderTracks(d, a.order); return { ok: true }; },
  set_track: (d, a) => { ops.opSetTrack(d, a.id, a); return { ok: true }; },
  set_markers: (d, a) => ({ markers: ops.opSetMarkers(d, a.markers).result }),
  add_marker: (d, a) => ({ marker: ops.opAddMarker(d, a).result }),
  apply_effect: (d, a) => ({ effect: ops.opApplyEffect(d, a).result }),
  update_effect: (d, a) => { ops.opUpdateEffect(d, a); return { ok: true }; },
  remove_effect: (d, a) => { ops.opRemoveEffect(d, a); return { ok: true }; },
  clear_effects: (d, a) => { ops.opClearEffects(d, a); return { ok: true }; },
  set_keyframes: (d, a) => ({ keys: ops.opSetKeyframes(d, a).result }),
  clear_keyframes: (d, a) => { ops.opClearKeyframes(d, a); return { ok: true }; },
  detach_audio: (d, a) => { const r = ops.opDetachAudio(d, a); return { audioClipId: r.clip.id, track: r.clip.track }; },
  set_asset_audio: (d, a) => { const x = d.assets[a.assetId]; if (!x) throw new Error('Unknown asset'); x.useAudio = !!a.useAudio; return { ok: true }; },
  add_effect_layer: (d, a) => { const r = ops.opAddEffectLayer(d, { ...a, startMs: a.startMs ?? 0 }); return { clipId: r.clip.id, track: r.clip.track, effects: r.clip.effects.map(e => ({ id: e.id, type: e.type })) }; },
  set_effect_keyframes: (d, a) => ({ keys: ops.opSetEffectKeyframes(d, a).result }),
  clear_effect_keyframes: (d, a) => { ops.opClearEffectKeyframes(d, a); return { ok: true }; },
  set_text_style: (d, a) => ({ text: ops.opSetTextStyle(d, a).result }),
  set_clip_mask: (d, a) => ({ mask: ops.opSetMask(d, a).result }),
  add_animation: (d, a) => ({ clipId: ops.opAddAnimation(d, a).clip.id }),
  set_mix: (d, a) => ({ mix: ops.opSetPlan(d, { mix: a }).result.mix }),
  set_plan: (d, a) => ({ rows: ops.opSetPlan(d, { rows: a.rows }).result.rows.length }),
  set_project_format: (d, a) => ({ settings: ops.opSetProjectFormat(d, a).result }),
  apply_look: (d, a) => { ops.opApplyLook(d, a); if (a.grade) d.settings.grade = a.grade; return { ok: true }; },
  clear_timeline: (d, a) => ({ ok: ops.opClearTimeline(d, a.tracks).result }),
  update_project: (d, a) => { if (a.name) d.name = a.name; if (a.script != null) d.script = a.script; for (const k of ['niche', 'topic', 'grade', 'accent', 'musicDb', 'loudness']) if (a[k] != null) d.settings[k] = a[k]; return { ok: true }; },
  update_beat: (d, a) => { const b = d.beats.find(x => x.id === a.id); if (!b) throw new Error('Unknown beat'); if (a.text != null) b.text = a.text; return { ok: true }; },
  delete_beat: (d, a) => { d.beats = d.beats.filter(x => x.id !== a.id); return { beats: d.beats.length }; },
  add_beat: (d, a) => { const fps = d.settings?.fps || 30; d.beats.push({ id: 'b' + (d.beats.length + 1), sentenceId: 'manual', text: a.text, startMs: a.startMs, endMs: a.endMs, startFrame: Math.round(a.startMs * fps / 1000), endFrame: Math.round(a.endMs * fps / 1000), keywords: [], queries: [] }); return { ok: true }; },
  set_chapters: (d, a) => { const end = d.transcript?.voiceEndMs || 0; d.chapters = a.chapters.sort((x, y) => x.startMs - y.startMs).map((c, i, arr) => ({ id: 'ch' + (i + 1), title: c.title, startMs: c.startMs, endMs: arr[i + 1]?.startMs ?? end })); return { chapters: d.chapters }; },
  set_script: (d, a) => { d.script = a.script; if (a.title) d.name = a.title; return { ok: true }; },
  set_metadata: (d, a) => { d.meta = { ...d.meta, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v != null)) }; return { ok: true }; },
  delete_assets: (d, a) => {
    const used = new Set(d.clips.map(c => c.assetId));
    const ids = a.unused ? Object.keys(d.assets).filter(x => !used.has(x)) : (a.ids || []).filter(x => !used.has(x));
    for (const id of ids) { d.assets[id] && mediaUrls.delete(id); delete d.assets[id]; }
    return { removed: ids.length };
  },
};

// Read-only tools: they inspect the open project without changing it (the AI needs these first).
const LOCAL_READ = {
  get_project: a => summarize(local.project, { clips: a.clips ?? true, limit: a.limit ?? 400 }),
  get_status: () => ({ runtime: 'browser', note: 'Editing runs in the user’s browser tab. YouTube, rendering, image search and HTML animations need the local Framesflow helper.', project: { id: local.project?.id, name: local.project?.name } }),
  list_transitions: () => ({ transitions: TRANSITIONS.map(({ id, label, group, dur }) => ({ id, label, group, defaultDur: dur })) }),
  list_effects: () => ({ effects: EFFECTS }),
  list_text_presets: () => ({ animIn: TEXT_ANIMS_IN, animOut: TEXT_ANIMS_OUT, fonts: TEXT_FONTS.map(f => f.id), kinds: TEXT_KINDS, positions: TEXT_POSITIONS }),
};

/** Names of the tools that run fully in the browser (used by the cloud relay to tell the AI what is available). */
export const LOCAL_TOOL_NAMES = [...Object.keys(LOCAL_READ), ...Object.keys(LOCAL_OPS), 'get_plan', 'undo', 'redo'];

export function localTool(name, args = {}, { quiet, by = 'ui' } = {}) {
  const op = LOCAL_OPS[name];
  if (LOCAL_READ[name]) return LOCAL_READ[name](args || {});
  if (name === 'get_plan') {
    const plan = local.project?.plan;
    if (!plan) return { plan: null };
    return { mix: plan.mix, rows: plan.rows.map(r => ({ ...r, placed: local.project.clips.some(c => c.planRowId === r.id) })) };
  }
  if (!op) {
    const e = new Error(`"${name}" needs the local FramesFlow server (run npm start). In the browser you can edit, preview and export directly.`);
    throw e;
  }
  if (name === 'undo') return { undone: local.undo() };
  if (name === 'redo') return { redone: local.redo() };
  const r = local.mutate({ by, tool: name }, d => op(d, args));
  return r ?? { ok: true };
}
