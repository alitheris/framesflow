// Shared config, process helpers and small utilities for the Framesflow server.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// installed from npm (inside node_modules / the npx cache) the app folder is read-only or temporary: keep projects in the user's home
const installedFromNpm = /[\\/]node_modules[\\/]/.test(APP_ROOT) || /[\\/]_npx[\\/]/.test(APP_ROOT);
export const HOME = path.resolve(process.env.FRAMESFLOW_HOME || (installedFromNpm ? path.join(os.homedir(), 'Framesflow') : path.join(APP_ROOT, 'workspace')));
export const PORT = Number(process.env.PORT || 4317);
export const HOST = '127.0.0.1';
export const FPS = 30;
export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
export const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
export const WHISPER = process.env.WHISPER_PATH || 'whisper';
export const WHISPER_MODEL = process.env.FRAMESFLOW_WHISPER_MODEL || 'base';
export const IS_WIN = process.platform === 'win32';

for (const d of ['projects']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

export const uid = (p = '') => p + crypto.randomBytes(5).toString('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const msToFrame = ms => Math.round((ms * FPS) / 1000);
export const frameToMs = f => Math.round((f * 1000) / FPS);
export const safeName = s => String(s || 'file').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'file';
export const fmtTime = ms => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
export const sec = ms => (ms / 1000).toFixed(3);

/** Run a binary and collect output. Rejects on spawn failure; resolves with code on exit. */
export function run(cmd, args, { timeout = 0, onStdout, onStderr, cwd, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = timeout ? setTimeout(() => { if (!done) { child.kill('SIGKILL'); } }, timeout) : null;
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', d => { const s = d.toString(); out += s; onStdout?.(s); });
    child.stderr.on('data', d => { const s = d.toString(); err += s; onStderr?.(s); });
    child.on('error', e => { done = true; clearTimeout(timer); reject(Object.assign(e, { binary: cmd })); });
    child.on('close', (code, sig) => {
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve({ code, signal: sig, stdout: out, stderr: err });
    });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

export async function which(cmd, versionArg = '-version') {
  try {
    const r = await run(cmd, [versionArg], { timeout: 15000 });
    const line = (r.stdout || r.stderr).split('\n')[0].trim();
    return r.code === 0 || line ? { ok: true, version: line.slice(0, 120) } : { ok: false };
  } catch { return { ok: false }; }
}

/** Is an executable on PATH? (no process spawn: python tools like whisper take seconds to start) */
export function onPath(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const d of dirs) for (const e of exts) { try { if (fs.statSync(path.join(d, cmd + e)).isFile()) return true; } catch { /* next */ } }
  return false;
}

let capCache = null;
/** ffmpeg / yt-dlp / whisper availability, cached for 2 minutes. */
export async function capabilities(force = false) {
  if (capCache && !force && Date.now() - capCache.at < 120000) return capCache.value;
  const [ffmpeg, ytdlp] = await Promise.all([which(FFMPEG), which(YTDLP, '--version')]);
  const whisper = { ok: onPath(WHISPER) || (path.isAbsolute(WHISPER) && fs.existsSync(WHISPER)) };
  capCache = { at: Date.now(), value: { ffmpeg, ytdlp, whisper } };
  return capCache.value;
}

/** Only accept loopback Host headers (blocks DNS-rebinding against the local API). */
export function hostAllowed(host) {
  if (!host) return false;
  const h = host.replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}
export function originAllowed(origin) {
  if (!origin) return true; // non-browser clients (MCP stdio bridge, curl)
  try {
    const host = new URL(origin).host;
    if (hostAllowed(host)) return true;
    // opt-in remote origins (e.g. your Netlify URL) so the deployed studio can talk to this local server
    const allow = (process.env.FRAMESFLOW_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    return allow.includes(origin);
  } catch { return false; }
}

export function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
export const tmpdir = () => { const d = path.join(os.tmpdir(), 'ff-' + uid()); fs.mkdirSync(d, { recursive: true }); return d; };
