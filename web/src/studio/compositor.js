// FramesFlow canvas compositor — renders one project frame to a 2D canvas.
// WYSIWYG: every transition, effect, keyframe and text animation drawn here is what
// the ffmpeg render (and the WebCodecs browser export) produces.
import { propAt, transitionById, GRADES, clipEnd, resolveEffects } from '../../../shared/model.mjs';
import { textState } from '../../../shared/textfx.mjs';
import { graphicScene } from '../../../shared/graphics.mjs';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- filter strings
export function cssFilter(project, clip) {
  const base = GRADES[project.settings?.grade] || {};
  const own = typeof clip.grade === 'string' ? GRADES[clip.grade] || {} : clip.grade || {};
  const g = { ...base, ...own };
  const b = (g.brightness ?? 0) >= 0.5 ? g.brightness : 1 + (g.brightness || 0);
  const parts = [`brightness(${b})`, `contrast(${g.contrast ?? 1})`, `saturate(${g.saturation ?? 1})`];
  if (g.teal) parts.push(`hue-rotate(${(-g.teal * 8).toFixed(1)}deg)`);
  return parts.join(' ');
}

function effectFilter(effects) {
  let f = '';
  for (const e of effects || []) {
    const p = e.params || {};
    if (e.type === 'blur' && p.amount > 0) f += ` blur(${p.amount}px)`;
    else if (e.type === 'sharpen') f += ` contrast(${1 + p.amount * 0.3})`;
    else if (e.type === 'exposure') f += ` brightness(${1 + (p.brightness || 0)}) contrast(${p.contrast ?? 1})`;
    else if (e.type === 'saturation') f += ` saturate(${p.amount ?? 1})`;
    else if (e.type === 'hue') f += ` hue-rotate(${p.deg || 0}deg)`;
    else if (e.type === 'sepia') f += ` sepia(${p.amount ?? 0.6})`;
    else if (e.type === 'grayscale') f += ` grayscale(${p.amount ?? 1})`;
    else if (e.type === 'invert') f += ` invert(1)`;
  }
  return f.trim();
}

const hasEffect = (effects, type) => (effects || []).some(e => e.type === type);
const effectParam = (effects, type, key) => (effects || []).find(e => e.type === type)?.params?.[key];

// ---------------------------------------------------------------- media source lookup
// sources: Map(clipId → { el: HTMLVideoElement|HTMLImageElement, ok: bool }) managed by Preview.
function drawSource(ctx, src, W, H, asset, clip) {
  if (!src || !src.ok || !src.el) return false;
  const el = src.el;
  let sw = el.videoWidth || el.naturalWidth || asset?.width || 0, sh = el.videoHeight || el.naturalHeight || asset?.height || 0;
  if (!sw || !sh) return false;
  // baked crop (detected black bars on the server; in local mode crop is absent)
  const c = asset?.crop;
  if (c && asset?.width) { sw = c.w; sh = c.h; }
  // cover-fit
  const s = (clip?.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh)) * (asset?.zoomFix || 1);
  const dw = sw * s, dh = sh * s;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  const sx = c ? c.x : 0, sy = c ? c.y : 0;
  ctx.drawImage(el, sx, sy, sw, sh, dx, dy, dw, dh);
  return true;
}

// ---------------------------------------------------------------- transforms
export function clipTransform(clip, frame, fps) {
  let z = Math.max(0.05, propAt(clip, 'scale', frame, fps) || 1);
  const px = propAt(clip, 'x', frame, fps) || 0;
  const py = propAt(clip, 'y', frame, fps) || 0;
  const rot = propAt(clip, 'rotation', frame, fps) || 0;
  const p = Math.min(1, Math.max(0, (frame - clip.start) / Math.max(1, clip.dur)));
  const kb = clip.kenburns || (clip.type === 'image' && clip.fit !== 'contain' && !clip.keyframes?.scale ? { from: 1, to: 1.09, panX0: -0.15, panX1: 0.15 } : null);
  if (kb) { z *= (kb.from ?? 1) + ((kb.to ?? 1) - (kb.from ?? 1)) * p; }
  return { z, px, py, rot };
}

// apply a clip's transform + filter and draw its media; returns true if something was drawn
function drawClip(ctx, project, clip, frame, sources, env) {
  const { W, H, fps } = env;
  const asset = project.assets[clip.assetId];
  const src = sources.get(clip.id);
  if (clip.type === 'text') { drawTextClip(ctx, project, clip, frame, env); return true; }
  if (clip.type === 'graphic') { drawGraphicClip(ctx, project, clip, frame, env); return true; }
  if (!asset) return false;
  if (clip.type === 'image' && !src?.el) return false;
  if (clip.type === 'video' && (!src || !src.ok)) return false;

  const t = clipTransform(clip, frame, fps);
  const opacity = propAt(clip, 'opacity', frame, fps) ?? 1;
  const fadeIn = env.noFade ? 1 : clip.fadeIn ? Math.min(1, (frame - clip.start) / clip.fadeIn) : 1;
  const fadeOut = env.noFade ? 1 : clip.fadeOut ? Math.min(1, (clip.start + clip.dur - frame) / clip.fadeOut) : 1;
  const alpha = Math.max(0, Math.min(1, opacity * Math.min(fadeIn, fadeOut)));
  if (alpha <= 0) return false;

  // punch-in from zoom/whip transitions
  const tr = clip.transition;
  const localF = frame - clip.start;
  if (tr && (tr.type === 'zoomin' || tr.type === 'whippan') && localF < (tr.dur || 8)) {
    t.z *= 1 + (tr.type === 'whippan' ? 0.22 : 0.12) * (1 - localF / (tr.dur || 8));
  }

  // effect params resolved at this frame (keyframed effects animate)
  const fx = resolveEffects(clip.effects, frame - clip.start);

  // render the clip on the offscreen buffer so effects stay inside the layer
  const o = env.off(W, H);
  const octx = o.ctx;
  octx.clearRect(0, 0, W, H);
  octx.save();
  octx.filter = [effectFilter(fx), cssFilter(project, clip)].filter(Boolean).join(' ') || 'none';
  octx.translate(W / 2, H / 2);
  if (t.rot) octx.rotate((t.rot * Math.PI) / 180);
  octx.scale(t.z * (clip.flipH ? -1 : 1), t.z * (clip.flipV ? -1 : 1));
  octx.translate(-W / 2 + (t.px * W) / 100, -H / 2 + (t.py * H) / 100);
  const kb = clip.kenburns;
  if (kb) {
    const p = Math.min(1, Math.max(0, (frame - clip.start) / Math.max(1, clip.dur)));
    const panX = ((kb.panX0 ?? 0) + ((kb.panX1 ?? 0) - (kb.panX0 ?? 0)) * p);
    const panY = ((kb.panY0 ?? 0) + ((kb.panY1 ?? 0) - (kb.panY0 ?? 0)) * p);
    octx.translate(-panX * ((t.z - 1) / 2) * W * 0.5, -panY * ((t.z - 1) / 2) * H * 0.5);
  }
  drawSource(octx, src, W, H, asset, clip);
  octx.restore();

  // procedural (non-filter) effects on the layer
  drawProcedural(octx, fx, W, H, frame, fps);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(o.cv, 0, 0);
  ctx.restore();

  // watermark mask: blurred patch over a normalized region of the frame
  if (clip.mask && (clip.type === 'video' || clip.type === 'image')) {
    const m = clip.mask;
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x * W, m.y * H, m.w * W, m.h * H);
    ctx.clip();
    ctx.filter = 'blur(24px)';
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------- effect layers (adjustment layers)
// Applies the layer's effect stack to everything already drawn on ctx (= all tracks below it).
function drawEffectLayer(ctx, project, clip, frame, env) {
  const { W, H, fps } = env;
  const fx = resolveEffects(clip.effects, frame - clip.start);
  if (!fx.length) return false;
  const opacity = propAt(clip, 'opacity', frame, fps) ?? 1;
  const fadeIn = clip.fadeIn ? Math.min(1, (frame - clip.start + 1) / clip.fadeIn) : 1;
  const fadeOut = clip.fadeOut ? Math.min(1, (clip.start + clip.dur - frame) / clip.fadeOut) : 1;
  const alpha = Math.max(0, Math.min(1, opacity * Math.min(fadeIn, fadeOut)));
  if (alpha <= 0) return false;
  const filter = effectFilter(fx);
  if (filter) {
    const o = env.off(W, H);
    o.ctx.clearRect(0, 0, W, H);
    o.ctx.drawImage(ctx.canvas, 0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = filter;
    ctx.drawImage(o.cv, 0, 0, W, H);
    ctx.restore();
  }
  // procedural effects (vignette, grain, glow, tint, pixelate…) act on the composite directly
  if (alpha >= 0.5) drawProcedural(ctx, fx, W, H, frame, fps);
  return true;
}

// ---------------------------------------------------------------- animation graphics
export function drawGraphicClip(ctx, project, clip, frame, env) {
  const { W, H, fps } = env;
  const g = clip.graphic || {};
  const accent = g.accent || project.settings?.accent || '#d8f36a';
  const scene = graphicScene(clip, frame, fps, W, H, accent);
  ctx.save();
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
      ctx.font = `${e.weight || 800} ${e.size}px "${e.font || 'Montserrat'}", sans-serif`;
      ctx.textAlign = e.align || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = e.color || '#fff';
      if (e.maxW) { for (const l of wrapText(ctx, e.text, e.maxW)) ctx.fillText(l, e.x, e.y); }
      else ctx.fillText(e.text || '', e.x, e.y);
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- procedural effects
let noiseCv = null;
function noiseTile() {
  if (noiseCv) return noiseCv;
  noiseCv = document.createElement('canvas');
  noiseCv.width = noiseCv.height = 256;
  const nctx = noiseCv.getContext('2d');
  const img = nctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (Math.random() * 90 - 45); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  nctx.putImageData(img, 0, 0);
  return noiseCv;
}

function drawProcedural(ctx, effects, W, H, frame, fps) {
  if (!effects?.length) return;
  for (const e of effects) {
    const p = e.params || {};
    if (e.type === 'vignette') {
      const amt = p.amount ?? 0.5, soft = p.softness ?? 0.5;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.75 - soft * 0.45), W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${amt})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else if (e.type === 'grain') {
      const amt = p.amount ?? 0.35;
      ctx.save();
      ctx.globalAlpha = amt * 0.35;
      ctx.globalCompositeOperation = 'overlay';
      const n = noiseTile();
      const ox = (frame * 7) % 256, oy = (frame * 13) % 256;
      for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(n, x, y);
      ctx.restore();
    } else if (e.type === 'glow') {
      const amt = p.amount ?? 0.5, radius = p.radius ?? 24;
      ctx.save();
      ctx.globalAlpha = amt * 0.6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${radius / 2}px)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.restore();
    } else if (e.type === 'tint') {
      ctx.save();
      ctx.globalAlpha = p.amount ?? 0.3;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = p.color || '#ff9a5a';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else if (e.type === 'posterize') {
      posterizeCanvas(ctx, W, H, Math.round(p.levels || 5));
    } else if (e.type === 'pixelate') {
      const size = Math.max(2, p.size || 12);
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(W / size)); tmp.height = Math.max(1, Math.round(H / size));
      const tctx = tmp.getContext('2d');
      tctx.drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(tmp, 0, 0, W, H);
      ctx.restore();
    } else if (e.type === 'chromatic') {
      const sh = p.shift || 6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.33;
      ctx.filter = 'url(#none) saturate(3) hue-rotate(-40deg)';
      ctx.drawImage(ctx.canvas, -sh, 0);
      ctx.filter = 'saturate(3) hue-rotate(150deg)';
      ctx.drawImage(ctx.canvas, sh, 0);
      ctx.restore();
    } else if (e.type === 'glitchfx' && Math.sin(frame * 0.7 * (p.speed || 3)) > 0.6) {
      const inten = p.intensity ?? 0.5;
      const slices = Math.round(4 + inten * 10);
      for (let i = 0; i < slices; i++) {
        const y = Math.random() * H, h = 6 + Math.random() * 30 * inten;
        const dx = (Math.random() - 0.5) * 90 * inten;
        ctx.drawImage(ctx.canvas, 0, y, W, h, dx, y, W, h);
      }
    }
  }
}

function posterizeCanvas(ctx, W, H, levels) {
  const img = ctx.getImageData(0, 0, W, H);
  const step = 255 / (levels - 1);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / step) * step; d[i + 1] = Math.round(d[i + 1] / step) * step; d[i + 2] = Math.round(d[i + 2] / step) * step; }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- transitions
// prev: {clip, frame} rendered with noFade; cur is the incoming clip.
export function drawWithTransition(ctx, project, prev, cur, frame, sources, env) {
  const { W, H } = env;
  const tr = cur.clip.transition || { type: 'cut', dur: 0 };
  const def = transitionById(tr.type);
  const D = Math.max(1, tr.dur || def.dur || 0);
  const p = Math.max(0, Math.min(1, (frame - cur.clip.start) / D));
  const t = tr.type;
  const drawCur = (extra = {}) => {
    ctx.save();
    Object.assign(ctx, extra.globalAlpha != null ? { globalAlpha: extra.globalAlpha } : {});
    if (extra.filter) ctx.filter = extra.filter;
    if (extra.translate) ctx.translate(extra.translate[0], extra.translate[1]);
    if (extra.scale) { ctx.translate(W / 2, H / 2); ctx.scale(extra.scale, extra.scale); ctx.translate(-W / 2, -H / 2); }
    if (extra.rotate) { ctx.translate(W / 2, H / 2); ctx.rotate(extra.rotate); ctx.translate(-W / 2, -H / 2); }
    drawClip(ctx, project, cur.clip, frame, sources, env);
    ctx.restore();
  };
  const drawPrev = (extra = {}) => {
    if (!prev?.clip) return;
    ctx.save();
    if (extra.globalAlpha != null) ctx.globalAlpha = extra.globalAlpha;
    if (extra.filter) ctx.filter = extra.filter;
    if (extra.translate) ctx.translate(extra.translate[0], extra.translate[1]);
    drawClip(ctx, project, prev.clip, prev.frame, sources, { ...env, noFade: true });
    ctx.restore();
  };
  const fill = (color, a = 1) => { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.restore(); };

  switch (t) {
    case 'dissolve':
    case 'blurdissolve': {
      drawPrev({ globalAlpha: 1 - p * 0.0, filter: t === 'blurdissolve' && p < 0.5 ? `blur(${(0.5 - p) * 20}px)` : undefined });
      drawCur({ globalAlpha: p, filter: t === 'blurdissolve' && p > 0.5 ? `blur(${(p - 0.5) * 20}px)` : undefined });
      break;
    }
    case 'dipblack':
    case 'dipwhite': {
      const white = t === 'dipwhite';
      if (p < 0.5) { drawPrev(); fill(white ? '#fff' : '#000', p * 2); }
      else { fill(white ? '#fff' : '#000'); drawCur({ globalAlpha: (p - 0.5) * 2 }); }
      break;
    }
    case 'wipeleft': case 'wiperight': case 'wipeup': case 'wipedown': {
      drawPrev();
      const x = t === 'wiperight' ? 0 : t === 'wipeleft' ? W * (1 - p) : 0;
      const y = t === 'wipedown' ? 0 : t === 'wipeup' ? H * (1 - p) : 0;
      const w = (t === 'wipeleft' || t === 'wiperight') ? W * p : W;
      const h = (t === 'wipeup' || t === 'wipedown') ? H * p : H;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      drawCur();
      ctx.restore();
      break;
    }
    case 'pushleft': case 'pushright': case 'pushup': case 'pushdown': {
      const dx = (t === 'pushleft' ? -W : t === 'pushright' ? W : 0) * p;
      const dy = (t === 'pushup' ? -H : t === 'pushdown' ? H : 0) * p;
      drawPrev({ translate: [dx, dy] });
      drawCur({ translate: [dx, dy] });
      break;
    }
    case 'slideleft': case 'slideright': {
      drawPrev();
      drawCur({ translate: [(t === 'slideleft' ? -1 : 1) * W * (1 - p), 0] });
      break;
    }
    case 'zoomin': case 'zoomout': {
      const s = t === 'zoomin' ? 0.2 + 0.8 * p : 2 - p;
      drawCur({ globalAlpha: Math.min(1, p * 1.5), scale: s });
      break;
    }
    case 'spin': {
      drawCur({ globalAlpha: Math.min(1, p * 1.6), scale: Math.max(0.01, p), rotate: (1 - p) * TAU });
      break;
    }
    case 'whippan': {
      const blur = Math.sin(p * Math.PI) * 22;
      drawPrev({ filter: blur > 0.5 ? `blur(${blur}px)` : undefined, translate: [-W * p * 0.5, 0] });
      drawCur({ filter: blur > 0.5 ? `blur(${blur}px)` : undefined, translate: [W * (1 - p) * 0.5, 0] });
      break;
    }
    case 'glitch': {
      drawPrev();
      drawCur();
      if (p < 0.85) {
        const slices = 8;
        for (let i = 0; i < slices; i++) {
          const y = (i / slices) * H, h = H / slices;
          const off2 = (Math.random() - 0.5) * W * 0.4 * (1 - p);
          if (Math.random() > 0.4) { ctx.save(); ctx.globalAlpha = 0.85; ctx.drawImage(ctx.canvas, 0, y, W, h, off2, y, W, h); ctx.restore(); }
        }
      }
      break;
    }
    case 'pixelate': {
      drawPrev();
      drawCur();
      const size = Math.max(2, Math.round((1 - p) * 56));
      if (size > 3) {
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(1, Math.round(W / size)); tmp.height = Math.max(1, Math.round(H / size));
        tmp.getContext('2d').drawImage(ctx.canvas, 0, 0, tmp.width, tmp.height);
        ctx.save(); ctx.globalAlpha = 0.9; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, W, H);
        ctx.restore();
      }
      break;
    }
    case 'circleopen': case 'circleclose': {
      drawPrev();
      const R = Math.hypot(W, H) / 2;
      const r = (t === 'circleopen' ? p : 1 - p) * R * 1.25;
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(0.1, r), 0, TAU); ctx.clip();
      drawCur();
      ctx.restore();
      break;
    }
    case 'barndoor': {
      drawPrev();
      const w = W * p;
      ctx.save(); ctx.beginPath(); ctx.rect(W / 2 - w / 2, 0, w, H); ctx.clip();
      drawCur();
      ctx.restore();
      break;
    }
    case 'clockwipe': {
      drawPrev();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + TAU * p);
      ctx.closePath();
      ctx.clip();
      drawCur();
      ctx.restore();
      break;
    }
    case 'cut':
    default:
      drawCur();
  }
}

// ---------------------------------------------------------------- text rendering
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    const words = raw.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (maxWidth && ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

const MARGIN = { x: 0.08, y: 0.085 };

export function drawTextClip(ctx, project, clip, frame, { W, H, fps }) {
  const t = clip.text || {};
  const style = t; // style fields live on text object directly
  const accent = t.accent || project.settings?.accent || '#d8f36a';
  const kind = t.kind || 'title';
  const fs = (t.fontSize || 96) * (W / 1920); // scale with canvas
  const font = `${t.weight || 800} ${fs}px "${t.font || 'Montserrat'}", "Segoe UI", sans-serif`;
  const localF = frame - clip.start;
  const st = textState(clip, localF, fps);
  if (st.alpha <= 0.01) return;

  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, st.alpha));
  if (st.blur) ctx.filter = `blur(${st.blur}px)`;

  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${((t.letterSpacing || 0) + (st.letterX || 0)) * (W / 1920)}px`;
  ctx.textBaseline = 'middle';

  const position = t.position || (['chapter', 'stat', 'quote'].includes(kind) ? 'center' : kind === 'caption' || kind === 'subtitle' ? 'bc' : 'bl');
  const maxWidth = (t.maxWidth || 0.8) * W;

  // fullscreen wash for chapter
  if (kind === 'chapter') {
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,6,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const words = String(t.title || '').split(/\s+/).filter(Boolean);
  const drawWord = (w, x, y, walpha = 1, wdx = 0, wdy = 0, wscale = 1, wrot = 0, wcolor = null, wblur = 0) => {
    ctx.save();
    ctx.globalAlpha *= walpha;
    if (wblur) ctx.filter = `blur(${wblur}px)`;
    ctx.font = font;
    ctx.translate(x + wdx, y + wdy);
    if (wrot) ctx.rotate((wrot * Math.PI) / 180);
    if (wscale !== 1) ctx.scale(wscale, wscale);
    const col = wcolor || t.color || '#ffffff';
    if ((t.strokeWidth || 0) > 0) { ctx.lineWidth = t.strokeWidth * (W / 1920) * 2; ctx.strokeStyle = t.stroke || '#000'; ctx.strokeText(w, 0, 0); }
    if (st.shine > 0 && p_in_window(clip, localF, fps)) { /* shine handled by gradient fill below */ }
    ctx.fillStyle = col;
    if (st.neon) { ctx.shadowColor = accent; ctx.shadowBlur = fs * 0.6; }
    else if (t.shadow) { ctx.shadowColor = `rgba(0,0,0,${t.shadow})`; ctx.shadowBlur = fs * 0.18; ctx.shadowOffsetY = fs * 0.05; }
    ctx.fillText(w, 0, 0);
    ctx.restore();
  };
  const p_in_window = () => true;

  // layout positions
  const alignX = t.align || 'center';
  let cx = position.includes('l') ? W * MARGIN.x : position.includes('r') ? W * (1 - MARGIN.x) : W / 2;
  if (position === 'center') cx = W / 2;
  ctx.textAlign = alignX === 'left' ? 'left' : alignX === 'right' ? 'right' : 'center';
  const baseY = position.startsWith('t') ? H * MARGIN.y : position === 'center' ? H / 2 : H * (1 - MARGIN.y) - (kind === 'caption' || kind === 'subtitle' ? fs * 0.6 : 0);

  // background box (fact / lower / quote / caption)
  if (['fact', 'lower', 'quote', 'caption', 'subtitle'].includes(kind)) {
    const lines = wrapText(ctx, t.title || '', maxWidth);
    const bodyLines = t.body ? wrapText(ctx, t.body, maxWidth) : [];
    const lh = fs * (t.lineHeight || 1.15);
    const textW = Math.max(...lines.map(l => ctx.measureText(l).width), ...bodyLines.map(l => ctx.measureText(l).width), 1);
    const boxW = Math.min(maxWidth, textW + fs * 0.9 + (kind === 'fact' || kind === 'lower' ? fs * 0.35 : 0));
    const boxH = (lines.length + bodyLines.length) * lh + fs * 0.7;
    const bx = position.includes('l') ? W * MARGIN.x : position.includes('r') ? W * (1 - MARGIN.x) - boxW : (W - boxW) / 2;
    const by = position.startsWith('t') ? H * MARGIN.y : position === 'center' ? (H - boxH) / 2 : H - H * MARGIN.y - boxH;
    ctx.save();
    ctx.translate(st.dx * (W / 1920) * 3, st.dy * (W / 1920) * 3);
    ctx.fillStyle = 'rgba(10,12,8,0.78)';
    if (st.maskY != null) { ctx.beginPath(); ctx.rect(bx, by, boxW, boxH * st.maskY); ctx.clip(); }
    roundRect(ctx, bx, by, boxW, boxH, fs * 0.18);
    ctx.fill();
    ctx.fillStyle = accent;
    if (kind === 'fact' || kind === 'lower') ctx.fillRect(bx, by, fs * 0.14, boxH);
    // label
    let ty = by + fs * 0.55;
    if (t.label) {
      ctx.fillStyle = accent;
      ctx.font = `700 ${fs * 0.34}px "${t.font || 'Montserrat'}", sans-serif`;
      ctx.fillText(t.label.toUpperCase(), bx + fs * 0.5 + (kind === 'fact' || kind === 'lower' ? fs * 0.3 : 0), ty, boxW);
      ty += fs * 0.5;
    }
    ctx.font = font;
    const tx = bx + fs * 0.5 + (kind === 'fact' || kind === 'lower' ? fs * 0.3 : 0);
    for (const l of lines) { ctx.fillStyle = t.color || '#ffffff'; drawAnimText(ctx, ctx, l, tx, ty, st, fs, t, accent, W); ty += lh; }
    if (t.body) {
      ctx.font = `500 ${fs * 0.52}px "${t.font || 'Montserrat'}", sans-serif`;
      for (const l of bodyLines) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(l, tx, ty); ty += fs * 0.6; }
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  // big center text kinds: title / chapter / stat / quote
  const lh = fs * (t.lineHeight || 1.15);
  let y = baseY - ((words.length > 6 ? 2 : 1) - 1) * lh / 2;
  if (kind === 'stat' && t.body) {
    // big accent number + body
    ctx.save();
    ctx.translate(st.dx * 2, st.dy * 2);
    ctx.textAlign = 'center';
    ctx.font = `800 ${fs * 2.2}px "${t.font || 'Montserrat'}", sans-serif`;
    ctx.fillStyle = accent;
    if (t.shadow) { ctx.shadowColor = `rgba(0,0,0,${t.shadow})`; ctx.shadowBlur = fs * 0.3; }
    ctx.fillText(t.title || '', W / 2, H / 2 - fs * 0.8);
    ctx.font = `600 ${fs * 0.62}px "${t.font || 'Montserrat'}", sans-serif`;
    ctx.fillStyle = '#fff';
    for (const l of wrapText(ctx, t.body, maxWidth)) { ctx.fillText(l, W / 2, H / 2 + fs * 0.5); break; }
    ctx.restore();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(cx + st.dx * (W / 1920) * 3, baseY + st.dy * (W / 1920) * 3);
  if (st.rot) ctx.rotate((st.rot * Math.PI) / 180);
  if (st.sx !== 1 || st.sy !== 1) ctx.scale(st.sx, st.sy);
  if (st.maskY != null) { ctx.beginPath(); ctx.rect(-W, -fs, W * 2, fs * 2 * st.maskY); ctx.clip(); }

  if (st.perWord && words.length) {
    // word-staggered animations: wordpop, karaoke, wave, shake, splitslide, jitter
    const per = 1 / words.length;
    let wx = 0;
    const totalW = words.reduce((s, w) => s + ctx.measureText(w + ' ').width, 0);
    wx = alignX === 'center' ? -totalW / 2 : alignX === 'right' ? -totalW : 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const ww = ctx.measureText(w + ' ').width;
      const wp = Math.max(0, Math.min(1, (localF / Math.max(2, t.animDur || 18)) * (words.length + 2) - i));
      const stW = { ...st };
      let wdx = 0, wdy = 0, wscale = 1, wrot = 0, walpha = 1, wcolor = null, wblur = st.blur;
      if (t.animIn === 'wordpop') { const e = backEase(wp); wscale = 0.3 + 0.7 * e; walpha = Math.min(1, wp * 3); }
      else if (t.animIn === 'splitslide') { wdx = (1 - (st.perWordSlide ?? 1)) * 60 * (i % 2 ? 1 : -1) * (W / 1920) * 2; }
      else if (t.animIn === 'wave') { wdy = Math.sin(localF * 0.15 + i * 0.9) * fs * 0.12; walpha = 1; }
      else if (t.animIn === 'shake') { wdx = Math.sin(localF * 1.7 + i) * fs * 0.05; wdy = Math.cos(localF * 2.1 + i) * fs * 0.04; }
      else if (t.animIn === 'jitter') { wdx = (Math.random() - 0.5) * fs * 0.06; wdy = (Math.random() - 0.5) * fs * 0.06; }
      else if (t.animIn === 'karaoke') {
        const spoken = (localF / Math.max(1, clip.dur));
        wcolor = i / words.length <= spoken ? accent : (t.color || '#ffffff');
        walpha = 1;
      }
      if (t.animIn === 'karaoke' && i / words.length > (localF / Math.max(1, clip.dur))) walpha = 0.95;
      if (t.animIn === 'wave' || t.animIn === 'shake' || t.animIn === 'jitter' || t.animIn === 'karaoke' || t.animIn === 'splitslide') walpha = Math.min(1, Math.max(walpha, localF / Math.max(2, t.animDur || 18) * 2));
      drawWord(w, wx + ww / 2, 0, walpha, wdx, wdy, wscale, wrot, wcolor, wblur);
      wx += ww;
    }
  } else if (st.typewriter != null && st.typewriter < 1 && t.animIn === 'typewriter') {
    const chars = Math.ceil(String(t.title || '').length * st.typewriter);
    const shown = String(t.title || '').slice(0, chars);
    ctx.fillText(shown, 0, 0);
    // caret
    const wdt = ctx.measureText(shown).width;
    if (Math.floor(localF / 8) % 2 === 0) { ctx.fillStyle = accent; ctx.fillRect(wdt + fs * 0.05, -fs * 0.45, fs * 0.08, fs * 0.9); }
  } else if (st.glitch && t.animIn === 'glitchtext') {
    const drawGlitch = (color, dx) => { ctx.save(); ctx.fillStyle = color; ctx.globalAlpha *= 0.7; ctx.fillText(t.title || '', dx * (W / 1920) * 6, 0); ctx.restore(); };
    if (Math.random() > 0.4) drawGlitch('#f0f', (Math.random() - 0.5) * 2);
    if (Math.random() > 0.4) drawGlitch('#0ff', (Math.random() - 0.5) * 2);
    ctx.fillStyle = t.color || '#fff';
    ctx.fillText(t.title || '', (Math.random() - 0.5) * (W / 1920) * 4, 0);
  } else {
    // whole-block animation with wrap
    const lines = wrapText(ctx, t.title || '', maxWidth);
    let ly = -((lines.length - 1) * lh) / 2;
    ctx.textAlign = alignX === 'left' ? 'left' : alignX === 'right' ? 'right' : 'center';
    for (const l of lines) {
      drawAnimText(ctx, ctx, l, 0, ly, st, fs, t, accent, W);
      ly += lh;
    }
  }
  ctx.restore();
  ctx.restore();
}

function drawAnimText(ctx, targetCtx, line, x, y, st, fs, t, accent, W) {
  ctx.fillStyle = t.color || '#ffffff';
  if ((t.strokeWidth || 0) > 0) { ctx.lineWidth = t.strokeWidth * (W / 1920) * 2; ctx.strokeStyle = t.stroke || '#000'; ctx.strokeText(line, x, y); }
  if (st.neon) { ctx.shadowColor = accent; ctx.shadowBlur = fs * 0.55; }
  else if (t.shadow) { ctx.shadowColor = `rgba(0,0,0,${t.shadow})`; ctx.shadowBlur = fs * 0.18; ctx.shadowOffsetY = fs * 0.05; }
  ctx.fillText(line, x, y);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const backEase = t => { const c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// ---------------------------------------------------------------- frame composition
/**
 * Render one frame. sources: Map(clipId → {el, ok}).
 * off(W,H): factory returning a reusable {cv, ctx} scratch canvas (provided by the caller for reuse).
 */
export function drawFrame(ctx, project, frame, sources, env) {
  const W = project.settings?.width || 1920, H = project.settings?.height || 1080;
  const fps = project.settings?.fps || 30;
  env.W = W; env.H = H; env.fps = fps;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const videoTracks = project.tracks.filter(t => t.kind === 'video' && !t.muted);
  // bottom-first draw: iterate tracks from the end (bottom layer) to the start (top)
  for (let ti = videoTracks.length - 1; ti >= 0; ti--) {
    const track = videoTracks[ti];
    const allOnTrack = project.clips.filter(c => c.track === track.id && frame >= c.start && frame < c.start + c.dur);
    // effect layers act on everything drawn so far (the tracks below this one)
    for (const fxClip of allOnTrack.filter(c => c.type === 'effect')) drawEffectLayer(ctx, project, fxClip, frame, env);
    const clips = allOnTrack.filter(c => c.type !== 'effect');
    if (!clips.length) continue;
    // topmost = last in the list at overlapping times; draw bottom-up
    const sorted = clips.sort((a, b) => a.start - b.start || (project.clips.indexOf(a) - project.clips.indexOf(b)));
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : sorted.find(c2 => c2 !== cur && c2.start < cur.start && frame < c2.start + c2.dur + 60) || prevOnTrack(project, track.id, cur);
      const inTransition = cur.transition?.type && cur.transition.type !== 'cut' && frame - cur.start < Math.max(1, cur.transition.dur || transitionById(cur.transition.type).dur || 1);
      if (inTransition && i === 0) {
        drawWithTransition(ctx, project, prev ? { clip: prev, frame: extendedFrame(prev, frame), sources } : null, { clip: cur }, frame, sources, env);
      } else if (inTransition) {
        drawWithTransition(ctx, project, { clip: sorted[i - 1], frame: extendedFrame(sorted[i - 1], frame), sources }, { clip: cur }, frame, sources, env);
      } else {
        drawClip(ctx, project, cur, frame, sources, env);
      }
    }
  }
  // solo / opacity of track handled upstream (muted filtered); image overlays included via drawClip
}

function extendedFrame(clip, frame) {
  // outgoing clip during a transition: keep advancing its source time past its end
  return Math.min(frame, clip.start + clip.dur - 1 + Math.max(0, frame - (clip.start + clip.dur)));
}
function prevOnTrack(project, trackId, cur) {
  const list = project.clips.filter(c => c.track === trackId && c.start < cur.start).sort((a, b) => b.start - a.start);
  return list[0] || null;
}
