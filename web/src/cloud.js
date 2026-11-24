// Cloud account layer (optional). Active only when /config.json holds a Supabase project; otherwise the app behaves exactly
// as before (no login, everything local). With it enabled:
//   - Google sign-in through Supabase
//   - the relay: a WebSocket to the hosted MCP Worker so the user's AI (Claude, etc.) can edit THIS open studio tab
//   - project JSON (never media) is synced to the user's own Supabase rows so projects follow the account
import { useSyncExternalStore } from 'react';
import { LOCAL_TOOL_NAMES, local } from './local.mjs';
import { getState, subscribeApp, relayTool } from './api';

let state = { enabled: false, ready: false, session: null, mcpUrl: '', contactEmail: '', relay: 'off', cloudProjects: [], syncing: false, error: null };
const subs = new Set();
const set = patch => { state = { ...state, ...patch }; subs.forEach(f => f()); };
export const getCloud = () => state;
export const useCloud = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state);

let sb = null;
const RETURN_KEY = 'ff-return';

export async function initCloud() {
  let cfg = {};
  try { cfg = await (await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })).json(); } catch { /* no config: cloud off */ }
  const common = { mcpUrl: String(cfg.mcpUrl || '').replace(/\/+$/, ''), contactEmail: String(cfg.contactEmail || '') };
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { set({ ...common, enabled: false, ready: true }); return; }
  const { createClient } = await import('@supabase/supabase-js');
  sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  set({ ...common, enabled: true, ready: true, session: data.session });
  // back from Google: restore the page the user was on (hash routes survive the redirect through sessionStorage)
  if (data.session) restoreReturn();
  // Supabase fires this for token refreshes, tab focus etc. too: only restart things when the signed-in user really changes,
  // and never call Supabase from inside the callback itself (that can deadlock), so defer the work.
  let activeUser = data.session?.user?.id || null;
  sb.auth.onAuthStateChange((_event, session) => {
    set({ session });
    const uid = session?.user?.id || null;
    if (uid === activeUser) return;
    activeUser = uid;
    setTimeout(() => {
      if (uid) { restoreReturn(); startRelay(); startSync(); } else { stopRelay(); stopSync(); set({ cloudProjects: [] }); }
    }, 0);
  });
  if (data.session) { startRelay(); startSync(); }
}

function restoreReturn() {
  let ret = null; try { ret = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { /* private mode */ }
  if (new URLSearchParams(location.search).has('code') || ret) {
    history.replaceState(null, '', location.pathname + (ret || location.hash || '#/studio'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export async function signInWithGoogle() {
  try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/studio'); } catch { /* ignore */ }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) set({ error: error.message });
}
export async function signOut() { stopRelay(); await sb?.auth.signOut(); }
export const accessToken = () => state.session?.access_token || null;

// ---------------------------------------------------------------- relay to the hosted MCP
let ws = null, retry = 0, pingTimer = null, stopped = true, lastHello = '';

function hello(force = false) {
  if (!ws || ws.readyState !== 1) return;
  const app = getState();
  const msg = { type: 'hello', tools: app.mode === 'server' ? '*' : LOCAL_TOOL_NAMES, project: app.project?.name || '' };
  const key = JSON.stringify(msg);
  if (!force && key === lastHello) return;
  lastHello = key; ws.send(key);
}

export function startRelay() {
  if (!state.mcpUrl || !state.session || (ws && ws.readyState <= 1)) return;
  stopped = false;
  open();
}
export function stopRelay() { stopped = true; clearInterval(pingTimer); try { ws?.close(1000); } catch { /* closed */ } ws = null; set({ relay: 'off' }); }

function open() {
  set({ relay: 'connecting' });
  const url = state.mcpUrl.replace(/^http/, 'ws') + '/ws';
  try { ws = new WebSocket(url, ['bearer.' + state.session.access_token]); } catch { set({ relay: 'off' }); return; }
  const mine = ws;
  ws.onopen = () => { retry = 0; lastHello = ''; set({ relay: 'on' }); hello(true); clearInterval(pingTimer); pingTimer = setInterval(() => mine.readyState === 1 && mine.send('ping'), 25000); };
  ws.onmessage = async ev => {
    if (ev.data === 'pong') return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type !== 'call') return;
    try { mine.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: await relayTool(m.name, m.args || {}) })); }
    catch (e) { mine.send(JSON.stringify({ type: 'result', id: m.id, ok: false, error: String(e?.message || e) })); }
  };
  ws.onclose = e => {
    clearInterval(pingTimer);
    if (mine !== ws) return;
    if (e.code === 4000) { set({ relay: 'replaced' }); return; } // a newer tab took over: do not fight it
    set({ relay: 'off' });
    if (!stopped && state.session) setTimeout(() => { if (!stopped && (!ws || ws.readyState > 1)) open(); }, Math.min(15000, 800 * ++retry));
  };
}
subscribeApp(() => hello());

// ---------------------------------------------------------------- OAuth consent (called from the /authorize page)
const apiBase = () => state.mcpUrl;
async function consentCall(path, init) {
  const r = await fetch(apiBase() + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken()}`, ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
export const requestInfo = id => fetch(`${apiBase()}/authorize/request/${encodeURIComponent(id)}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Expired'); return j; });
export const decide = (req, allow) => consentCall(allow ? '/authorize/approve' : '/authorize/deny', { method: 'POST', body: JSON.stringify({ req }) });

// ---------------------------------------------------------------- project sync (JSON only; media stays on the device)
let syncUnsub = null, syncTimer = null, lastPushed = '';

const slim = p => ({
  ...p,
  assets: Object.fromEntries(Object.entries(p.assets || {}).map(([id, a]) => {
    // eslint-disable-next-line no-unused-vars
    const { blob, blobUrl, poster, peaksData, ...rest } = a;
    return [id, { ...rest, mediaOnOtherDevice: true }];
  })),
});

async function push() {
  const p = local.project;
  if (!sb || !state.session || !p || getState().mode !== 'local') return;
  const data = slim(p), key = JSON.stringify(data);
  if (key === lastPushed || key.length > 4_000_000) return;
  set({ syncing: true });
  const { error } = await sb.from('projects').upsert({ user_id: state.session.user.id, id: p.id, name: p.name, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,id' });
  if (!error) { lastPushed = key; refreshCloudProjects(); }
  set({ syncing: false, error: error ? `Cloud save failed: ${error.message}` : null });
}

function startSync() {
  if (syncUnsub) return; // already syncing
  syncUnsub = local.subscribe(() => { clearTimeout(syncTimer); syncTimer = setTimeout(push, 4000); });
  refreshCloudProjects();
}
function stopSync() { syncUnsub?.(); syncUnsub = null; clearTimeout(syncTimer); }

export async function refreshCloudProjects() {
  if (!sb || !state.session) return;
  const { data } = await sb.from('projects').select('id,name,updated_at').order('updated_at', { ascending: false }).limit(100);
  set({ cloudProjects: data || [] });
}
export async function fetchCloudProject(id) {
  const { data, error } = await sb.from('projects').select('data').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data.data;
}
export async function deleteCloudProject(id) { await sb.from('projects').delete().eq('id', id); refreshCloudProjects(); }
