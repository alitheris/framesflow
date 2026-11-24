// Renders text graphics for the ffmpeg compositor: static PNGs (legacy kinds) and
// per-frame transparent PNG sequences for animated v3 text clips (shared/textfx.mjs math).
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { textState } from '../shared/textfx.mjs';
import { graphicScene } from '../shared/graphics.mjs';

/** Render one frame of a graphic clip from the shared scene (WYSIWYG with the browser compositor). */
function drawGraphicFrame(ctx, clip, frame, fps, width, height, accent) {
  const scene = graphicScene(clip, frame, fps, width, height, accent);
  for (const e of scene.els) {
    if ((e.alpha ?? 1) <= 0.01) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, e.alpha ?? 1));
    if (e.dx || e.dy) ctx.translate(e.dx || 0, e.dy || 0);
    if (e.type === 'rect') {
      ctx.fillStyle = e.color || accent;
      roundRect(ctx, e.x, e.y, e.w, e.h, e.radius || 0);
      ctx.fill();
    } else {
      ctx.font = `${e.weight || 800} ${e.size}px "${pickFamily()}", sans-serif`;
      ctx.textAlign = e.align || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = e.color || '#fff';
      if (e.maxW) { for (const l of wrap(ctx, e.text, e.maxW)) ctx.fillText(l, e.x, e.y); }
      else ctx.fillText(e.text || '', e.x, e.y);
    }
    ctx.restore();
  }
}

/** Per-frame transparent PNGs for a graphic clip (same output contract as renderTextFrames). */
export function renderGraphicFrames(clip, { width, height, accent = '#d8f36a', fps = 30, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (let f = 0; f < clip.dur; f++) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    drawGraphicFrame(ctx, clip, clip.start + f, fps, width, height, accent);
    fs.writeFileSync(path.join(outDir, `f${String(f).padStart(5, '0')}.png`), canvas.toBuffer('image/png'));
  }
  return { dir: outDir, pattern: path.join(outDir, 'f%05d.png'), count: clip.dur };
}

const PREFERRED = ['Montserrat', 'Poppins', 'Segoe UI', 'Helvetica Neue', 'Arial', 'DejaVu Sans', 'Liberation Sans'];
let family = null;
function pickFamily() {
  if (family) return family;
  const have = new Set(GlobalFonts.families.map(f => f.family));
  family = PREFERRED.find(f => have.has(f)) || 'sans-serif';
  return family;
}
export const overlayFont = () => pickFamily();

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * text: { kind: 'fact'|'chapter'|'lower'|'stat'|'quote'|'title', title, body, label, position, accent }
 * Everything is sized relative to a 1920x1080 design and scaled to the actual output size.
 */
export function renderOverlay(text, { width, height, accent = '#d8f36a' }, outFile) {
  const S = width / 1920;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  const W = 1920, H = 1080, mx = 154, my = 92; // title-safe margins
  const F = pickFamily();
  const col = text.accent || accent;
  const kind = text.kind || 'fact';
  const title = String(text.title || '').trim();
  const body = String(text.body || '').trim();
  const label = String(text.label || '').trim();
  const pos = text.position || (kind === 'chapter' || kind === 'stat' || kind === 'quote' ? 'center' : 'bl');

  const place = (w, h) => {
    const x = pos.endsWith('l') ? mx : pos.endsWith('r') ? W - mx - w : (W - w) / 2;
    const y = pos.startsWith('t') ? my : pos.startsWith('b') ? H - my - h : (H - h) / 2;
    return [x, y];
  };

  if (kind === 'chapter') {
    ctx.fillStyle = 'rgba(8,10,6,0.78)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (label) { ctx.fillStyle = col; ctx.font = `700 34px "${F}"`; ctx.fillText(label.toUpperCase().split('').join(' '), W / 2, H / 2 - 70); }
    ctx.fillStyle = '#ffffff'; ctx.font = `800 112px "${F}"`;
    const lines = wrap(ctx, title, 1500);
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 40 + i * 120));
    ctx.fillStyle = col; ctx.fillRect(W / 2 - 60, H / 2 + 60 + (lines.length - 1) * 120, 120, 6);
  } else if (kind === 'stat') {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(8,10,6,0.62)';
    const bw = 1100, bh = 440; roundRect(ctx, (W - bw) / 2, (H - bh) / 2, bw, bh, 28); ctx.fill();
    ctx.fillStyle = col; ctx.font = `800 210px "${F}"`; ctx.fillText(title, W / 2, H / 2 + 60);
    ctx.fillStyle = '#fff'; ctx.font = `600 44px "${F}"`; wrap(ctx, body, 960).forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 140 + i * 56));
  } else if (kind === 'quote') {
    ctx.fillStyle = 'rgba(8,10,6,0.7)'; const bw = 1400; ctx.font = `600 54px "${F}"`;
    const lines = wrap(ctx, '“' + title + '”', bw - 120); const bh = 120 + lines.length * 72 + (body ? 70 : 0);
    const [x, y] = place(bw, bh); roundRect(ctx, x, y, bw, bh, 26); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(x, y + 26, 8, bh - 52);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, x + 60, y + 90 + i * 72));
    if (body) { ctx.fillStyle = col; ctx.font = `700 34px "${F}"`; ctx.fillText('— ' + body, x + 60, y + bh - 44); }
  } else if (kind === 'title') {
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = `800 96px "${F}"`; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30;
    const lines = wrap(ctx, title, 1500); const [x, y] = place(1500, lines.length * 104);
    lines.forEach((l, i) => ctx.fillText(l, x, y + 84 + i * 104));
  } else {
    // 'fact' and 'lower': dark translucent rounded rectangle, white text, one accent colour
    const padX = 40, padY = 26;
    ctx.font = `800 ${kind === 'lower' ? 54 : 64}px "${F}"`;
    const tl = wrap(ctx, title, 1050);
    ctx.font = `500 34px "${F}"`;
    const bl = body ? wrap(ctx, body, 1050) : [];
    ctx.font = `700 26px "${F}"`;
    const labelH = label ? 42 : 0;
    const tSize = kind === 'lower' ? 54 : 64;
    ctx.font = `800 ${tSize}px "${F}"`;
    const tw = Math.max(...tl.map(l => ctx.measureText(l).width));
    ctx.font = `500 34px "${F}"`;
    const bw2 = bl.length ? Math.max(...bl.map(l => ctx.measureText(l).width)) : 0;
    ctx.font = `700 26px "${F}"`;
    const lw = label ? ctx.measureText(label.toUpperCase()).width + 26 : 0;
    const w = Math.ceil(Math.max(tw, bw2, lw)) + padX * 2 + 14;
    const h = padY * 2 + labelH + tl.length * (tSize + 10) + (bl.length ? bl.length * 44 + 8 : 0);
    const [x, y] = place(w, h);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(10,12,8,0.78)'; roundRect(ctx, x, y, w, h, 18); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = col; roundRect(ctx, x, y, 12, h, 6); ctx.fill();
    let cy = y + padY; ctx.textAlign = 'left';
    if (label) { ctx.font = `700 26px "${F}"`; ctx.fillStyle = col; ctx.fillText(label.toUpperCase().split('').join(' '), x + padX + 14, cy + 28); cy += labelH; }
    ctx.font = `800 ${tSize}px "${F}"`; ctx.fillStyle = '#fff';
    tl.forEach((l, i) => ctx.fillText(l, x + padX + 14, cy + tSize * 0.86 + i * (tSize + 10)));
    cy += tl.length * (tSize + 10);
    ctx.font = `500 34px "${F}"`; ctx.fillStyle = 'rgba(255,255,255,.82)';
    bl.forEach((l, i) => ctx.fillText(l, x + padX + 14, cy + 34 + i * 44));
  }
  fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
  return outFile;
}

// ---------------------------------------------------------------- animated text (v3)
// Every frame of an animated, fully-styled text clip → numbered transparent PNGs.
// Same math as the browser compositor (shared/textfx.mjs) so preview == render.
const backEase = t => { const c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export function renderTextFrames(clip, { width, height, accent = '#d8f36a', fps = 30, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const t = clip.text || {};
  const S = width / 1920;
  const col = t.accent || accent;
  const kind = t.kind || 'title';
  const F = pickFamily();
  const title = String(t.title || '');
  const body = String(t.body || '').trim();
  const label = String(t.label || '').trim();
  const pos = t.position || (['chapter', 'stat', 'quote'].includes(kind) ? 'center' : kind === 'caption' || kind === 'subtitle' ? 'bc' : 'bl');
  const fsz = (t.fontSize || 96) * S;
  const alignX = t.align || 'center';

  for (let f = 0; f < clip.dur; f++) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const st = textState(clip, f, fps);
    const file = path.join(outDir, `f${String(f).padStart(5, '0')}.png`);
    if (st.alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, st.alpha));
      if (st.blur) { try { ctx.filter = `blur(${st.blur}px)`; } catch { /* older napi-rs */ } }
      if (kind === 'chapter') { ctx.fillStyle = 'rgba(8,10,6,0.6)'; ctx.fillRect(0, 0, width, height); }

      const font = `${t.weight || 800} ${fsz}px "${t.font || F}", "${F}", sans-serif`;
      const wrap2 = (c2, text2, mw) => { c2.font = font; return wrap(c2, text2, mw); };

      const putWord = (w, x, y, o = {}) => {
        ctx.save();
        ctx.globalAlpha *= o.alpha ?? 1;
        if (o.blur) { try { ctx.filter = `blur(${o.blur}px)`; } catch { /* */ } }
        ctx.font = font;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${(t.letterSpacing || 0) * S}px`;
        ctx.translate(x + (o.dx || 0), y + (o.dy || 0));
        if (o.rot) ctx.rotate((o.rot * Math.PI) / 180);
        if (o.scale != null && o.scale !== 1) ctx.scale(o.scale, o.scale);
        if ((t.strokeWidth || 0) > 0) { ctx.lineWidth = t.strokeWidth * S * 2; ctx.strokeStyle = t.stroke || '#000'; ctx.strokeText(w, 0, 0); }
        if (o.neon) { ctx.shadowColor = col; ctx.shadowBlur = fsz * 0.55; }
        else if (t.shadow) { ctx.shadowColor = `rgba(0,0,0,${t.shadow})`; ctx.shadowBlur = fsz * 0.18; ctx.shadowOffsetY = fsz * 0.05; }
        ctx.fillStyle = o.color || t.color || '#ffffff';
        ctx.fillText(w, 0, 0);
        ctx.restore();
      };

      ctx.textBaseline = 'middle';
      const maxW = (t.maxWidth || 0.8) * width;
      const boxKinds = ['fact', 'lower', 'quote', 'caption', 'subtitle'];
      if (boxKinds.includes(kind)) {
        ctx.save();
        ctx.translate(st.dx * 3 * S, st.dy * 3 * S);
        ctx.font = font;
        const lines = wrap2(ctx, title, maxW);
        const bodyLines = body ? wrap2(ctx, body, maxW) : [];
        const lh = fsz * (t.lineHeight || 1.15);
        const textW = Math.max(...lines.map(l => ctx.measureText(l).width), ...bodyLines.map(l => ctx.measureText(l).width), 1);
        const boxW = Math.min(maxW, textW + fsz * 0.9 + (kind === 'fact' || kind === 'lower' ? fsz * 0.35 : 0));
        const boxH = (lines.length + bodyLines.length) * lh + fsz * 0.7;
        const bx = pos.endsWith('l') ? width * 0.08 : pos.endsWith('r') ? width * 0.92 - boxW : (width - boxW) / 2;
        const by = pos.startsWith('t') ? height * 0.085 : pos === 'center' ? (height - boxH) / 2 : height - height * 0.085 - boxH;
        if (st.maskY != null) { ctx.beginPath(); ctx.rect(bx, by, boxW, boxH * st.maskY); ctx.clip(); }
        ctx.fillStyle = 'rgba(10,12,8,0.78)';
        roundRect(ctx, bx, by, boxW, boxH, fsz * 0.18); ctx.fill();
        ctx.fillStyle = col;
        if (kind === 'fact' || kind === 'lower') ctx.fillRect(bx, by, fsz * 0.14, boxH);
        let ty = by + fsz * 0.55;
        if (label) {
          ctx.font = `700 ${fsz * 0.34}px "${t.font || F}"`; ctx.fillStyle = col; ctx.textAlign = 'left';
          ctx.fillText(label.toUpperCase(), bx + fsz * 0.5 + (kind === 'fact' || kind === 'lower' ? fsz * 0.3 : 0), ty, boxW);
          ty += fsz * 0.5;
        }
        const tx = bx + fsz * 0.5 + (kind === 'fact' || kind === 'lower' ? fsz * 0.3 : 0);
        ctx.textAlign = 'left';
        if (st.typewriter != null && t.animIn === 'typewriter') {
          const chars = Math.ceil(title.length * st.typewriter);
          putWord(title.slice(0, chars), tx, ty + lh / 2);
        } else {
          for (const l of lines) { putWord(l, tx, ty + lh / 2); ty += lh; }
        }
        if (body) {
          ctx.font = `500 ${fsz * 0.52}px "${t.font || F}"`;
          for (const l of bodyLines) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(l, tx, ty + fsz * 0.3); ty += fsz * 0.6; }
        }
        ctx.restore();
      } else {
        // big centered text kinds: title / chapter / stat
        ctx.save();
        const cx = pos === 'center' || pos.includes('c') ? width / 2 : pos.endsWith('l') ? width * 0.08 : width * 0.92;
        const cy = pos.startsWith('t') ? height * 0.15 : pos === 'center' ? height / 2 : height * 0.85;
        ctx.translate(cx + st.dx * 3 * S, cy + st.dy * 3 * S);
        if (st.rot) ctx.rotate((st.rot * Math.PI) / 180);
        if (st.sx !== 1 || st.sy !== 1) ctx.scale(st.sx, st.sy);
        if (st.maskY != null) { ctx.beginPath(); ctx.rect(-width, -fsz, width * 2, fsz * 2 * st.maskY); ctx.clip(); }
        ctx.textAlign = alignX === 'left' ? 'left' : alignX === 'right' ? 'right' : 'center';
        ctx.font = font;

        if (kind === 'stat') {
          ctx.font = `800 ${fsz * 2.2}px "${t.font || F}"`;
          ctx.fillStyle = col;
          if (t.shadow) { ctx.shadowColor = `rgba(0,0,0,${t.shadow})`; ctx.shadowBlur = fsz * 0.3; }
          ctx.fillText(title, 0, -fsz * 0.5);
          ctx.font = `600 ${fsz * 0.62}px "${t.font || F}"`; ctx.fillStyle = '#fff';
          wrap2(ctx, body, maxW).slice(0, 1).forEach(l => ctx.fillText(l, 0, fsz * 0.7));
        } else if (st.perWord && t.animIn && ['wordpop', 'splitslide', 'wave', 'shake', 'jitter', 'karaoke'].includes(t.animIn)) {
          const words = title.split(/\s+/).filter(Boolean);
          const totalW = words.reduce((s, w) => s + ctx.measureText(w + ' ').width, 0);
          let wx = alignX === 'center' ? -totalW / 2 : alignX === 'right' ? -totalW : 0;
          for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const ww = ctx.measureText(w + ' ').width;
            const prog = Math.max(0, Math.min(1, (f / Math.max(2, t.animDur || 18)) * (words.length + 2) - i));
            const o = { dx: 0, dy: 0, scale: 1, alpha: Math.min(1, prog * 2.5), color: t.color || '#ffffff', blur: st.blur };
            if (t.animIn === 'wordpop') o.scale = 0.3 + 0.7 * backEase(prog);
            else if (t.animIn === 'splitslide') o.dx = (1 - Math.min(1, f / Math.max(2, t.animDur || 18))) * 60 * (i % 2 ? 1 : -1) * 2;
            else if (t.animIn === 'wave') o.dy = Math.sin(f * 0.15 + i * 0.9) * fsz * 0.12;
            else if (t.animIn === 'shake' || t.animIn === 'jitter') { o.dx = (Math.random() - 0.5) * fsz * 0.08; o.dy = (Math.random() - 0.5) * fsz * 0.06; }
            else if (t.animIn === 'karaoke') { o.color = i / words.length <= f / Math.max(1, clip.dur) ? col : (t.color || '#ffffff'); o.alpha = 1; }
            putWord(w, wx + ww / 2, 0, o);
            wx += ww;
          }
        } else if (st.typewriter != null && t.animIn === 'typewriter') {
          const chars = Math.ceil(title.length * st.typewriter);
          const shown = title.slice(0, chars);
          putWord(shown, 0, 0);
          if (Math.floor(f / 8) % 2 === 0) {
            ctx.save(); ctx.font = font; const wdt = ctx.measureText(shown).width;
            ctx.fillStyle = col; ctx.fillRect(alignX === 'center' ? wdt / 2 + fsz * 0.05 : wdt + fsz * 0.05, -fsz * 0.45, fsz * 0.08, fsz * 0.9); ctx.restore();
          }
        } else if (st.glitch && t.animIn === 'glitchtext') {
          if (Math.random() > 0.4) putWord(title, 0, 0, { color: '#ff00ff', dx: (Math.random() - 0.5) * 12, alpha: 0.6 });
          if (Math.random() > 0.4) putWord(title, 0, 0, { color: '#00ffff', dx: (Math.random() - 0.5) * 12, alpha: 0.6 });
          putWord(title, (Math.random() - 0.5) * 8, 0);
        } else {
          const lines = wrap2(ctx, title, maxW);
          const lh = fsz * (t.lineHeight || 1.15);
          let ly = -((lines.length - 1) * lh) / 2;
          for (const l of lines) { putWord(l, 0, ly); ly += lh; }
        }
        ctx.restore();
      }
      ctx.restore();
    }
    fs.writeFileSync(file, canvas.toBuffer('image/png'));
  }
  return { dir: outDir, pattern: path.join(outDir, 'f%05d.png'), count: clip.dur };
}
