// FramesFlow bridge: ONE api surface for both runtimes.
//  - server mode  : local Node server (same origin, or probed on 127.0.0.1:4317 from Netlify)
//  - local mode   : pure browser (Netlify) — projects in IndexedDB, shared ops in-process
import { useSyncExternalStore } from 'react';
import { projectFrames as pf } from '../../shared/model.mjs';
import * as L from './local.mjs';

let state = { mode: 'boot', connected: false, rev: 0, project: null, jobs: {}, activity: [], flash: {}, agentAt: 0, projects: [], health: null, toast: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());
const set = patch => { state = { ...state, ...patch }; emit(); };
export const getState = () => state;
export const useApp = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state);
export const uiEvents = new EventTarget();
export const subscribeApp = cb => { subs.add(cb); return () => subs.delete(cb); };

let toastTimer;
export function toast(msg, kind = 'info') {
  set({ toast: { msg, kind, id: Math.random() } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 9000 : 4500);
}

export const isServer = () => state.mode === 'server';
export const isLocal = () => state.mode === 'local';
export const BASE = () => (state.remote ? 'http://127.0.0.1:4317' : '');

// ---------------------------------------------------------------- boot / mode detection
let pollTimer = null;

async function probe(url, ms = 1800) {
  // race a hard timer against the fetch — some environments ignore AbortController while a
  // private-network preflight is pending, and boot must never hang on it
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await Promise.race([
      fetch(url, { signal: c.signal }).then(r => r.ok, () => false),
      new Promise(res => setTimeout(() => res(false), ms)),
    ]);
  } catch { return false; }
  finally { clearTimeout(t); }
}

export async function init() {
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    if (await probe('/api/ping')) return startServer('');
  }
  // deployed (or dev server without backend): look for a local studio to link with
  if (await probe('http://127.0.0.1:4317/api/ping', 1500)) return startServer('http://127.0.0.1:4317', true);
  return startLocal();
}
export const connect = init; // legacy alias used by Guide.jsx

function startServer(base, remote = false) {
  set({ mode: 'server', remote, connected: true });
  refreshHealth();
  setInterval(refreshHealth, 15000);
  if (remote) {
    pollTimer = setInterval(pollState, 900);
    pollState();
  } else {
    connectWs();
  }
  return state;
}

async function pollState() {
  try {
    const r = await fetch(`${BASE()}/api/state`);
    const j = await r.json();
    applySnapshot(j);
  } catch { set({ connected: false }); }
}

function applySnapshot(j) {
  const act = (j.activity || []).map(a => ({ ...a, at: Date.now() }));
  set({ connected: true, rev: j.rev, project: j.project, jobs: Object.fromEntries((j.jobs || []).map(x => [x.id, x])), activity: act.length ? [...state.activity, ...act].slice(-120) : state.activity, projects: j.projects });
  if (state.project) L.local.project = state.project; // keep transport in sync
}

function connectWs() {
  let ws, retry = 0;
  const flashTimers = new Map();
  const flash = ids => {
    if (!ids?.length) return;
    const f = { ...state.flash };
    for (const id of ids) { f[id] = Date.now(); clearTimeout(flashTimers.get(id)); flashTimers.set(id, setTimeout(() => { const g = { ...state.flash }; delete g[id]; set({ flash: g }); }, 2200)); }
    set({ flash: f });
  };
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; set({ connected: true }); };
    ws.onclose = () => { ws = null; set({ connected: false }); setTimeout(open, Math.min(4000, 400 * ++retry)); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') applySnapshot(m);
      else if (m.type === 'project') {
        const act = (m.activity || []).map(a => ({ ...a, at: Date.now() }));
        set({ rev: m.rev, project: m.project, activity: act.length ? [...state.activity, ...act].slice(-120) : state.activity });
        if (m.cause?.by !== 'ui') flash(m.cause?.clipIds);
        if (m.cause?.by === 'mcp' || m.cause?.by === 'auto') set({ agentAt: Date.now() });
      } else if (m.type === 'job') {
        set({ jobs: { ...state.jobs, [m.job.id]: m.job } });
        if (m.job.status === 'failed') toast(`${m.job.label} failed: ${m.job.error}`, 'error');
      } else if (m.type === 'agent') set({ agentAt: m.at });
      else if (m.type === 'seek') uiEvents.dispatchEvent(new CustomEvent('seek', { detail: m }));
    };
  };
  open();
}

async function startLocal() {
  set({ mode: 'local', connected: true });
  bindLocal(); // subscribe BEFORE init so the first emit carries the project into React
  await L.initLocal();
  set({ project: L.local.project, rev: L.local.rev });
  await refreshLocalProjects();
  return state;
}

function bindLocal() {
  L.local.subscribe(({ rev, project, cause }) => {
    set({ rev, project, projects: state.projects });
    if (cause?.by !== 'ui') set({ agentAt: Date.now() });
  });
  refreshLocalProjects();
}

export async function refreshLocalProjects() {
  try { set({ projects: await L.listProjects() }); } catch { /* idb blocked */ }
}

export async function refreshHealth() {
  try {
    const h = await (await fetch(`${BASE()}/api/health`)).json();
    set({ health: h, agentAt: Math.max(state.agentAt, h.lastAgentAt || 0) });
  } catch { /* offline */ }
}

// ---------------------------------------------------------------- tool calls
/** Run a tool on behalf of the hosted AI link (no toasts; the studio shows it as AI activity). */
export async function relayTool(name, args = {}) {
  if (state.mode === 'local') return L.localTool(name, args, { quiet: true, by: 'mcp' });
  const r = await fetch(`${BASE()}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-framesflow-client': 'mcp' }, body: JSON.stringify({ args }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.result;
}

export async function tool(name, args = {}, { quiet = false } = {}) {
  try {
    if (state.mode === 'local') return L.localTool(name, args, { quiet });
    const r = await fetch(`${BASE()}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j.result;
  } catch (e) { if (!quiet) toast(e.message, 'error'); throw e; }
}

export async function upload(file, { role } = {}) {
  if (state.mode === 'local') {
    const asset = await L.probeFile(file);
    if (asset.kind === 'audio') { const peaks = await L.computePeaks(asset); if (peaks) asset.peaksData = peaks; }
    L.local.mutate({ by: 'ui', tool: 'upload', summary: `Imported “${asset.name}”` }, d => { d.assets[asset.id] = asset; });
    if (role === 'voice') {
      L.local.mutate({ by: 'ui', tool: 'voice', summary: 'Voiceover placed on A1' }, d => {
        const fps = d.settings?.fps || 30;
        d.clips = d.clips.filter(c => c.track !== 'A1');
        d.clips.push({ id: 'c_' + Math.random().toString(16).slice(2, 12), track: 'A1', type: 'audio', assetId: asset.id, start: 0, dur: Math.round(asset.duration * fps / 1000), in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, label: 'Voiceover' });
      });
    }
    return asset;
  }
  const r = await fetch(`${BASE()}/api/upload?name=${encodeURIComponent(file.name)}${role ? `&role=${role}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
  const j = await r.json();
  if (!r.ok) { toast(`${file.name}: ${j.error}`, 'error'); throw new Error(j.error); }
  return j.asset;
}

/** After importing a video that has sound: ask whether to use its audio (can be detached later). */
export async function askAudio(asset) {
  if (!asset || asset.kind !== 'video' || !asset.hasAudio) return asset;
  const keep = window.confirm(`“${asset.name}” has audio.

OK = import WITH its audio
Cancel = import the picture only (you can still detach the audio later)`);
  try { await tool('set_asset_audio', { assetId: asset.id, useAudio: keep }, { quiet: true }); asset.useAudio = keep; } catch { /* toast already shown */ }
  return asset;
}

export const mediaUrl = (project, asset) => {
  if (!asset) return '';
  if (state.mode === 'local') return L.mediaObjectUrl(asset);
  return `${BASE()}/media/${project.id}/${asset.file}`;
};
export const thumbUrl = (project, asset) => {
  if (!asset) return '';
  if (state.mode === 'local') return asset.poster || L.mediaObjectUrl(asset);
  return asset?.thumbs ? `${BASE()}/media/${project.id}/${asset.thumbs.file}` : '';
};

// ---------------------------------------------------------------- time helpers (per-project fps)
export const curFps = () => state.project?.settings?.fps || 30;
export const FPS = 30; // legacy default
export const frameMs = (f, fps = curFps()) => Math.round((f * 1000) / fps);
export const msFrame = (ms, fps = curFps()) => Math.round((ms * fps) / 1000);
export function tc(frames, withFrames = true, fps = curFps()) {
  const s = Math.floor(frames / fps), f = frames % fps, m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${withFrames ? ':' + String(f).padStart(2, '0') : ''}`;
}
export const fmtMs = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
export const sortedV1 = p => p.clips.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
export const totalFrames = p => pf(p);
