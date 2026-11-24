// Web image search (Openverse: openly licensed images, no API key) + a hardened image downloader.
// Openverse aggregates Wikimedia Commons, Flickr, NASA, Smithsonian, museums and more, and tells us
// the licence + creator of every result so credits can be logged with the asset.
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { uid } from './lib.mjs';

const UA = 'FramesflowStudio/1.0 (image search)';
const MAX_BYTES = 25 * 1024 * 1024;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/bmp': '.bmp' };

const normalize = r => ({
  id: r.id, title: r.title || '(untitled)', url: r.url, thumbnail: r.thumbnail, width: r.width || null, height: r.height || null,
  creator: r.creator || null, source: r.source || r.provider || null, landingUrl: r.foreign_landing_url || null,
  license: `${String(r.license || '').toUpperCase()}${r.license_version ? ' ' + r.license_version : ''}`.trim(),
  licenseUrl: r.license_url || null, attribution: r.attribution || null, filetype: r.filetype || null,
});

/**
 * Search openly licensed images.
 * licenseType: 'commercial' (default; safe for monetised videos) | 'all' | 'modification' | 'commercial,modification'.
 * orientation: wide | tall | square. pngOnly favours cut-out style graphics (a PNG is not always transparent).
 */
export async function searchImages(query, { limit = 8, source, orientation, pngOnly = false, licenseType = 'commercial', page = 1 } = {}) {
  if (!String(query || '').trim()) throw new Error('query is required');
  const q = new URLSearchParams({ q: query, page_size: String(Math.min(30, Math.max(1, limit))), page: String(page), mature: 'false' });
  if (licenseType && licenseType !== 'all') q.set('license_type', licenseType);
  if (source) q.set('source', source);
  if (orientation) q.set('aspect_ratio', orientation);
  if (pngOnly) q.set('extension', 'png');
  const res = await fetch(`https://api.openverse.org/v1/images/?${q}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Image search failed (HTTP ${res.status}). Try again in a moment.`);
  const j = await res.json();
  return { total: j.result_count ?? null, results: (j.results || []).map(normalize) };
}

// ---------------------------------------------------------------- safe download
const isPrivateIp = ip => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivateIp(v.slice(7));
};

async function assertPublic(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('Not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('Only https:// image URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('That address is not a public website');
  return u;
}

/** Download an image URL into dir; follows ≤4 redirects, re-checking every hop. Returns { file, mime, bytes }. */
export async function downloadImage(urlStr, dir) {
  let url = urlStr;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublic(url);
    const res = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'image/*' }, signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).href; continue; }
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!EXT[mime]) throw new Error(`Not a supported image (${mime || 'unknown type'}). JPEG, PNG, WebP, GIF, AVIF and BMP work.`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('Image is larger than 25 MB');
    const chunks = []; let bytes = 0;
    for await (const c of res.body) { bytes += c.length; if (bytes > MAX_BYTES) throw new Error('Image is larger than 25 MB'); chunks.push(c); }
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `img_${uid()}${EXT[mime]}`);
    fs.writeFileSync(file, Buffer.concat(chunks));
    return { file, mime, bytes };
  }
  throw new Error('Too many redirects');
}
