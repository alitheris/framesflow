// ffprobe / thumbnails / waveform helpers and the library import pipeline.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FFMPEG, FFPROBE, run, uid, safeName } from './lib.mjs';
import { store, assetsDir } from './store.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);

export async function probe(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60000 });
  if (r.code !== 0) throw new Error('Unreadable media file: ' + (r.stderr.trim().split('\n').pop() || 'ffprobe failed'));
  const j = JSON.parse(r.stdout);
  const v = j.streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = j.streams.find(s => s.codec_type === 'audio');
  const ext = path.extname(file).toLowerCase();
  const isImage = IMAGE_EXT.has(ext) || (v && !a && (j.format.format_name || '').match(/image|png_pipe|jpeg_pipe|webp_pipe/));
  const kind = isImage ? 'image' : v ? 'video' : a ? 'audio' : null;
  if (!kind) throw new Error('No audio or video stream found');
  const [n, d] = (v?.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    kind,
    duration: kind === 'image' ? 5000 : Math.round(Number(j.format.duration || v?.duration || a?.duration || 0) * 1000),
    width: v?.width || 0, height: v?.height || 0, fps: d ? +(n / d).toFixed(3) : 0,
    hasAudio: !!a, hasVideo: !!v, size: Number(j.format.size || 0),
    vcodec: v?.codec_name, acodec: a?.codec_name,
  };
}

async function makeThumbs(pid, asset) {
  if (asset.kind === 'audio') return null;
  const out = path.join(assetsDir(pid), asset.id + '.thumbs.jpg');
  const n = asset.kind === 'image' ? 1 : Math.max(4, Math.min(40, Math.ceil(asset.duration / 1000)));
  const w = 160, h = 90;
  const vf = asset.kind === 'image'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `fps=${n}/${Math.max(0.5, asset.duration / 1000)},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},tile=${n}x1`;
  const r = await run(FFMPEG, ['-y', '-v', 'error', '-i', path.join(assetsDir(pid), asset.file), '-vf', vf, '-frames:v', '1', '-q:v', '5', out], { timeout: 120000 });
  if (r.code !== 0 || !fs.existsSync(out)) return null;
  return { file: path.basename(out), n, w, h };
}

/** Peak envelope: one byte (0-255) per 20 ms, written next to the asset. */
async function makePeaks(pid, asset) {
  if (!asset.hasAudio) return null;
  const out = path.join(assetsDir(pid), asset.id + '.peaks');
  const peaks = [];
  await new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-i', path.join(assetsDir(pid), asset.file), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { windowsHide: true });
    let buf = Buffer.alloc(0);
    ff.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const step = 160 * 2;
      let off = 0;
      for (; off + step <= buf.length; off += step) {
        let m = 0;
        for (let i = 0; i < step; i += 2) { const v = Math.abs(buf.readInt16LE(off + i)); if (v > m) m = v; }
        peaks.push(Math.min(255, Math.round((m / 32768) * 255 * 1.6)));
      }
      buf = buf.subarray(off);
    });
    ff.on('error', reject);
    ff.on('close', resolve);
  });
  fs.writeFileSync(out, Buffer.from(peaks));
  return { file: path.basename(out), perSec: 50, count: peaks.length };
}

/** Baked-in black bars (pillarbox/letterbox) are detected so the compositor can crop to the real picture. */
export async function detectCrop(file, info) {
  if (info.kind !== 'video' || !info.width || !info.height) return null;
  const r = await run(FFMPEG, ['-v', 'info', '-ss', '0.3', '-t', '4', '-i', file, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-'], { timeout: 60000 }).catch(() => null);
  const all = r ? [...r.stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)] : [];
  if (!all.length) return null;
  const [, w, h, x, y] = all[all.length - 1].map(Number);
  const W = info.width, H = info.height;
  const symmetric = Math.abs(x - (W - w - x)) <= 6 && Math.abs(y - (H - h - y)) <= 6;
  const removed = 1 - (w * h) / (W * H);
  if (!symmetric || removed < 0.03 || w < W * 0.5 || h < H * 0.5) return null;
  return { w, h, x, y };
}

/** Copy a local file into the project library and register it. Thumbnails/waveforms fill in afterwards. */
export async function importFile(srcPath, { name, source, cause = { by: 'mcp', tool: 'import_media' }, move = false, useAudio, noCrop = false } = {}) {
  const pid = store.project.id;
  if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) throw new Error('File not found: ' + srcPath);
  const info = await probe(srcPath);
  const id = uid('a_');
  const ext = path.extname(srcPath).toLowerCase() || '.bin';
  const base = safeName(name || path.basename(srcPath, path.extname(srcPath)));
  const file = `${id}${ext}`;
  fs.mkdirSync(assetsDir(pid), { recursive: true });
  if (move) fs.renameSync(srcPath, path.join(assetsDir(pid), file)); else fs.copyFileSync(srcPath, path.join(assetsDir(pid), file));
  const crop = noCrop ? null : await detectCrop(path.join(assetsDir(pid), file), info);
  const asset = { id, name: name ? String(name).replace(/[\r\n]+/g, ' ').slice(0, 80) : base + ext, file, ...info, crop, source: source || null, thumbs: null, peaks: null, createdAt: Date.now(), ...(info.kind === 'video' && info.hasAudio ? { useAudio: !!useAudio } : {}) };
  store.mutate({ ...cause, summary: `Imported ${asset.kind} “${asset.name}”`, silent: cause.silent }, p => { p.assets[id] = asset; });
  // heavy decoration runs in the background so the tool call returns quickly
  (async () => {
    try {
      const [thumbs, peaks] = await Promise.all([makeThumbs(pid, asset).catch(() => null), makePeaks(pid, asset).catch(() => null)]);
      if (store.project?.id === pid && store.project.assets[id])
        store.mutate({ by: 'system', silent: true }, p => { p.assets[id].thumbs = thumbs; p.assets[id].peaks = peaks; }, { history: false });
    } catch { /* decoration is optional */ }
  })();
  return asset;
}

export const kindFromExt = f => {
  const e = path.extname(f).toLowerCase();
  return IMAGE_EXT.has(e) ? 'image' : AUDIO_EXT.has(e) ? 'audio' : 'video';
};

/** Extract N evenly spaced frames from a file range and tile them into one JPEG (returned as a Buffer). */
export async function contactSheet(file, { startMs = 0, endMs, frames = 6, cols = 3, width = 400 } = {}) {
  const dur = Math.max(0.2, ((endMs ?? 1e9) - startMs) / 1000);
  const rows = Math.ceil(frames / cols);
  const out = path.join(path.dirname(file), 'sheet-' + uid() + '.jpg');
  const rate = frames / dur;
  const args = ['-y', '-v', 'error', '-ss', String(startMs / 1000), '-i', file];
  if (endMs) args.push('-t', String(dur));
  args.push('-vf', `fps=${rate.toFixed(4)},scale=${width}:-2,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', out);
  const r = await run(FFMPEG, args, { timeout: 90000 });
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error('Could not extract frames: ' + r.stderr.split('\n').slice(-3).join(' '));
  const buf = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return buf;
}
