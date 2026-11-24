// HTML → transparent video. The same idea as HyperFrames: a page is a pure function of time, so we seek it
// to frame i / fps, screenshot it with a transparent background, and pipe the frames into ffmpeg (VP9 + alpha).
// Runs in the user's installed Edge/Chrome through puppeteer-core (no browser download). Network is blocked.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { FFMPEG, uid } from './lib.mjs';

export const MAX_ANIM_MS = 60000;

// ---------------------------------------------------------------- browser discovery
export function findBrowser() {
  const env = process.env.FRAMESFLOW_CHROME;
  if (env && fs.existsSync(env)) return env;
  const pf = process.env['ProgramFiles'], pf86 = process.env['ProgramFiles(x86)'], local = process.env.LOCALAPPDATA;
  const list = process.platform === 'win32' ? [
    pf86 && `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, pf && `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    pf && `${pf}\\Google\\Chrome\\Application\\chrome.exe`, pf86 && `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const hit = list.filter(Boolean).find(f => fs.existsSync(f));
  if (!hit) throw new Error('HTML animations need Microsoft Edge or Google Chrome installed (or set FRAMESFLOW_CHROME to its path).');
  return hit;
}

// ---------------------------------------------------------------- html preparation
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON string literal safe inside an inline <script> ('<' escaped so a closing script tag cannot appear)
const jsonForScript = v => JSON.stringify(String(v ?? '')).split('<').join('\\u003c').split(String.fromCharCode(8232)).join('').split(String.fromCharCode(8233)).join('');

/** {{name}} → HTML-escaped value, {{json:name}} → safe JS string literal. */
export function fillVars(tpl, vars = {}) {
  return String(tpl)
    .replace(/\{\{json:(\w+)\}\}/g, (_, k) => jsonForScript(vars[k]))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => escHtml(vars[k]));
}

/** Wrap a fragment (or inject base styles into a full document) so it is a transparent, fixed-size, non-scrolling canvas. */
export function wrapHtml(html, { width, height, durationMs, snapshotBg = false }) {
  const base = `<style id="ff-base">:root{--ff-w:${width}px;--ff-h:${height}px;--ff-dur:${(durationMs / 1000).toFixed(3)}s}html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}${snapshotBg ? 'html{background:#2d2f2a}' : ''}</style>`;
  let src = String(html).replace(/asset:\/\/([\w-]+)/g, 'https://ff.local/asset/$1');
  if (/<html[\s>]/i.test(src) || /<!doctype/i.test(src)) {
    if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, m => m + base);
    return src.replace(/<html[^>]*>/i, m => m + '<head>' + base + '</head>');
  }
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${src}</body></html>`;
}

/** Things that make a page non-deterministic or unsafe; returned as warnings for the author (usually an AI). */
export function lintHtml(html) {
  const w = [];
  const rules = [
    [/Date\.now\(|new Date\(|performance\.now\(/, 'Uses the clock (Date/performance.now). Everything must be a function of the seeked time t.'],
    [/Math\.random\(/, 'Uses Math.random(). Use a seeded generator so every render is identical.'],
    [/setTimeout\(|setInterval\(/, 'Uses timers. Timers do not run per frame; drive everything from CSS animations or window.__ffSeek(t).'],
    [/requestAnimationFrame\(/, 'Uses requestAnimationFrame. Draw inside window.__ffSeek(t) instead.'],
    [/\bfetch\(|XMLHttpRequest|WebSocket|<script[^>]+src=["']https?:\/\/(?!ff\.local)/i, 'Network access is blocked. Inline everything; use asset://<assetId> for library images.'],
    [/animation(?:-iteration-count)?\s*:[^;]*infinite/i, 'Infinite CSS animations loop forever; give a finite iteration count that fits the clip length.'],
  ];
  for (const [re, msg] of rules) if (re.test(html)) w.push(msg);
  return w;
}

// ---------------------------------------------------------------- page session
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

async function openPage({ html, width, height, durationMs, assetFile, transparent = true, snapshotBg = false }) {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true, defaultViewport: null,
    args: ['--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--font-render-hinting=none', '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-extensions'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return req.continue();
      const m = u.match(/^https:\/\/ff\.local\/asset\/([\w-]+)/);
      if (m && assetFile) {
        const f = assetFile(m[1]);
        if (f && fs.existsSync(f)) return req.respond({ status: 200, contentType: MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(f) });
      }
      return req.abort();
    });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)); });
    await page.setContent(wrapHtml(html, { width, height, durationMs, snapshotBg }), { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => { try { await document.fonts?.ready; } catch { /* ignore */ } if (window.__ffReady) await window.__ffReady; });
    await page.evaluate(() => {
      window.__ffSeekAll = t => {
        const ms = t * 1000;
        for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = ms; } catch { /* finished/detached */ } }
        if (window.__timelines) for (const k of Object.keys(window.__timelines)) { const tl = window.__timelines[k]; try { tl.pause(); tl.time(t, false); } catch { /* not a timeline */ } }
        if (typeof window.__ffSeek === 'function') window.__ffSeek(t);
      };
    });
    const shot = async t => {
      await page.evaluate(tt => { window.__ffSeekAll(tt); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, t);
      return Buffer.from(await page.screenshot({ type: 'png', omitBackground: transparent && !snapshotBg, optimizeForSpeed: true }));
    };
    return { browser, shot, errors };
  } catch (e) { await browser.close().catch(() => {}); throw e; }
}

// ---------------------------------------------------------------- render
/** Render html to a VP9+alpha WebM. Returns { frames, durationMs, warnings, pageErrors }. */
export async function renderAnimation({ html, width, height, fps = 30, durationMs, outFile, assetFile, signal, onProgress }) {
  if (!(durationMs > 0) || durationMs > MAX_ANIM_MS) throw new Error(`durationMs must be between 1 and ${MAX_ANIM_MS}`);
  const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
  const { browser, shot, errors } = await openPage({ html, width, height, durationMs, assetFile });
  let ff;
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1', '-auto-alt-ref', '0', '-an', outFile], { windowsHide: true });
    let stderr = ''; ff.stderr.on('data', d => { stderr += d; });
    const closed = new Promise(res => ff.on('close', res));
    ff.stdin.on('error', () => { /* surfaced through the exit code */ });
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      const png = await shot(i / fps);
      if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      if (i % 4 === 0) onProgress?.(i / frames);
    }
    ff.stdin.end();
    const code = await closed;
    if (code !== 0 || !fs.existsSync(outFile)) throw new Error('ffmpeg could not encode the animation: ' + stderr.trim().split('\n').slice(-3).join(' '));
    return { frames, durationMs: Math.round((frames / fps) * 1000), pageErrors: [...new Set(errors)].slice(0, 5) };
  } finally {
    try { ff?.kill(); } catch { /* already gone */ }
    await browser.close().catch(() => {});
  }
}

/** A few frames of the page on a neutral grey background, tiled into one JPEG (Buffer) so an AI can look at it. */
export async function snapshotAnimation({ html, width, height, durationMs, times, assetFile }) {
  const { browser, shot, errors } = await openPage({ html, width, height, durationMs, assetFile, snapshotBg: true });
  const dir = path.join(os.tmpdir(), 'ff-snap-' + uid());
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ts = (times?.length ? times : [0, 0.33, 0.66, 0.97].map(f => f * durationMs)).map(ms => Math.min(durationMs, Math.max(0, ms)) / 1000);
    for (let i = 0; i < ts.length; i++) fs.writeFileSync(path.join(dir, `f${i}.png`), await shot(ts[i]));
    const cols = ts.length > 1 ? 2 : 1, rows = Math.ceil(ts.length / cols), out = path.join(dir, 'sheet.jpg');
    const w = Math.min(640, width);
    await new Promise((res, rej) => {
      const p = spawn(FFMPEG, ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(dir, 'f%d.png'), '-vf', `scale=${w}:-2,tile=${cols}x${rows}:padding=6:color=black`, '-frames:v', '1', '-q:v', '4', out], { windowsHide: true });
      let e = ''; p.stderr.on('data', d => { e += d; }); p.on('close', c => (c === 0 ? res() : rej(new Error('Could not tile frames: ' + e.slice(-200)))));
    });
    return { jpeg: fs.readFileSync(out), times: ts.map(t => Math.round(t * 1000)), pageErrors: [...new Set(errors)].slice(0, 5) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await browser.close().catch(() => {});
  }
}
