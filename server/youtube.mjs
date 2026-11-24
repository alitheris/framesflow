// YouTube discovery + clip download through yt-dlp. Only the requested section is downloaded, never the whole video.
import fs from 'node:fs';
import path from 'node:path';
import { YTDLP, run } from './lib.mjs';
import { store, cacheDir } from './store.mjs';
import { contactSheet } from './media.mjs';

const COOKIES = process.env.YTDLP_COOKIES_BROWSER ? ['--cookies-from-browser', process.env.YTDLP_COOKIES_BROWSER] : [];
const BASE = ['--no-warnings', '--no-playlist', '--ignore-config', ...COOKIES];

// small semaphore so autopilot cannot open dozens of downloads at once
let active = 0; const waiters = [];
async function slot(fn, max = 3) {
  while (active >= max) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}

export function videoId(url) {
  const m = String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || String(url).match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
export const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

function ytError(r, what) {
  const line = (r.stderr.split('\n').filter(l => /ERROR/.test(l)).pop() || r.stderr.trim().split('\n').pop() || 'unknown error').replace(/^ERROR:\s*/, '');
  return new Error(`${what} failed: ${line.slice(0, 300)}`);
}

const normalize = j => ({
  id: j.id, url: watchUrl(j.id), title: j.title, channel: j.channel || j.uploader || '', durationSec: j.duration ?? null,
  views: j.view_count ?? null, uploadDate: j.upload_date || null, thumbnail: `https://i.ytimg.com/vi/${j.id}/mqdefault.jpg`,
  live: j.live_status === 'is_live',
});

/** Search YouTube. license:'cc' restricts to Creative Commons uploads (YouTube's own filter). */
export async function search(query, { limit = 8, license = 'any', minSec = 0, maxSec = 0 } = {}) {
  const fetchN = Math.min(40, Math.max(limit, minSec || maxSec ? limit * 3 : limit));
  const target = license === 'cc'
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query).replace(/%20/g, '+')}&sp=EgIwAQ%253D%253D`
    : `ytsearch${fetchN}:${query}`;
  const args = [target, '--flat-playlist', '--dump-json', '--no-warnings', '--ignore-config', ...COOKIES];
  if (license === 'cc') args.push('--playlist-end', String(fetchN));
  const r = await slot(() => run(YTDLP, args, { timeout: 60000 }), 4);
  const rows = r.stdout.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(j => j?.id && j.id.length === 11);
  if (!rows.length && r.code !== 0) throw ytError(r, 'YouTube search');
  return rows.map(normalize)
    .filter(v => !v.live && (!minSec || (v.durationSec ?? 0) >= minSec) && (!maxSec || (v.durationSec ?? 1e9) <= maxSec))
    .slice(0, limit)
    .map(v => ({ ...v, license: license === 'cc' ? 'Creative Commons (YouTube filter)' : 'unknown' }));
}

const infoCache = new Map();
/** Full metadata incl. license, chapters and "most replayed" heatmap peaks (good in-points). */
export async function info(url) {
  const id = videoId(url);
  if (!id) throw new Error('Not a YouTube video URL: ' + url);
  if (infoCache.has(id)) return infoCache.get(id);
  const r = await slot(() => run(YTDLP, [watchUrl(id), '-J', ...BASE], { timeout: 90000 }), 3);
  if (r.code !== 0) throw ytError(r, 'Fetching video info');
  const j = JSON.parse(r.stdout);
  const heat = (j.heatmap || []).filter(h => h.value != null).sort((a, b) => b.value - a.value).slice(0, 5)
    .map(h => ({ startSec: +h.start_time.toFixed(1), endSec: +h.end_time.toFixed(1), intensity: +h.value.toFixed(2) }));
  const out = {
    ...normalize(j),
    license: j.license || 'Standard YouTube License (reuse not confirmed)',
    isCreativeCommons: /creative commons/i.test(j.license || ''),
    description: (j.description || '').slice(0, 600),
    chapters: (j.chapters || []).map(c => ({ title: c.title, startSec: c.start_time, endSec: c.end_time })),
    mostReplayed: heat,
    maxHeight: Math.max(0, ...(j.formats || []).map(f => f.height || 0)),
    categories: j.categories, tags: (j.tags || []).slice(0, 12), ageLimit: j.age_limit,
  };
  infoCache.set(id, out);
  return out;
}

// audio:true → merge the best audio into the download; audio:false → video stream only (smaller, silent)
const fmtSel = (h, audio = true) => audio
  ? `bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`
  : `bv*[height<=${h}][vcodec^=avc1]/bv*[height<=${h}]/bv*`;
const hms = ms => { const s = ms / 1000, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`; };

/**
 * Download only [startMs-pad, endMs+pad] of a video into the project cache.
 * Returns { file, rangeStartMs, rangeEndMs } where the range is the real source time the file covers.
 */
export async function downloadSection(url, { startMs, endMs, maxHeight = 1080, padMs = 1000, tag = 'dl', audio = false, onLine } = {}) {
  const id = videoId(url);
  if (!id) throw new Error('Not a YouTube video URL: ' + url);
  const pid = store.project.id;
  const rangeStartMs = Math.max(0, startMs - padMs);
  const rangeEndMs = endMs + padMs;
  const base = path.join(cacheDir(pid), `${tag}_${id}_${rangeStartMs}_${rangeEndMs}_${maxHeight}${audio ? '_a' : '_v'}`);
  const hit = ['.mp4', '.mkv', '.webm'].map(e => base + e).find(f => fs.existsSync(f) && fs.statSync(f).size > 1000);
  if (hit) return { file: hit, rangeStartMs, rangeEndMs, cached: true };
  const args = [watchUrl(id), '-f', fmtSel(maxHeight, audio), '--download-sections', `*${hms(rangeStartMs)}-${hms(rangeEndMs)}`, '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4', '--concurrent-fragments', '4', '--no-mtime', '--newline', '-o', base + '.%(ext)s', ...BASE];
  const r = await slot(() => run(YTDLP, args, { timeout: 240000, onStdout: s => onLine?.(s) }), 3);
  const file = ['.mp4', '.mkv', '.webm'].map(e => base + e).find(f => fs.existsSync(f));
  if (r.code !== 0 || !file) throw ytError(r, 'Downloading clip');
  return { file, rangeStartMs, rangeEndMs, cached: false };
}

/** Whole-video download (use sparingly). */
export async function downloadWhole(url, { maxHeight = 720, maxMinutes = 30, audio = false, onLine } = {}) {
  const meta = await info(url);
  if ((meta.durationSec || 0) > maxMinutes * 60) throw new Error(`Video is ${Math.round(meta.durationSec / 60)} min. Download a section instead (start_ms/end_ms) or raise maxMinutes.`);
  return downloadSection(url, { startMs: 0, endMs: Math.round((meta.durationSec || 600) * 1000), padMs: 0, maxHeight, tag: 'full', audio, onLine });
}

/** Low-res look at a segment so a multimodal AI can judge cleanliness (logos, burned text, relevance). */
export async function inspect(url, { startMs = 0, endMs, frames = 6, cols = 3 } = {}) {
  const meta = await info(url);
  const end = Math.min(endMs ?? startMs + 20000, Math.round((meta.durationSec || 1e6) * 1000));
  if (end - startMs > 15 * 60 * 1000) throw new Error('Inspect at most 15 minutes at a time');
  const dl = await downloadSection(url, { startMs, endMs: end, maxHeight: 360, padMs: 0, tag: 'peek' });
  const jpeg = await contactSheet(dl.file, { startMs: 0, endMs: end - startMs, frames, cols, width: 420 });
  const step = (end - startMs) / frames;
  const times = Array.from({ length: frames }, (_, i) => Math.round(startMs + step * (i + 0.5)));
  return { jpeg, meta: { id: meta.id, title: meta.title, channel: meta.channel, license: meta.license }, frameTimesMs: times, cols };
}

