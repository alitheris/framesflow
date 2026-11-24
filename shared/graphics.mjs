// Animation graphics engine — one pure layout function used by the browser compositor
// AND the server's PNG-sequence renderer, so animation clips are WYSIWYG everywhere.
// A graphic clip: { type:'graphic', graphic:{ kind, title, body, items[], left{}, right{}, accent, position } }
export const GRAPHIC_KINDS = ['stat', 'counter', 'quote', 'list', 'comparison', 'timeline', 'chapter'];

const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clamp01 = t => Math.min(1, Math.max(0, t));

function base(W, H) {
  return { W, H, els: [] };
}
const T = (o) => (o.type = 'text', o);
const R = (o) => (o.type = 'rect', o);

/** Element defaults so both renderers agree. */
export function el(o) {
  return { alpha: 1, size: 48, weight: 800, color: '#ffffff', align: 'center', font: 'Montserrat', ...o };
}

/**
 * Compute the scene for a graphic clip at absolute timeline `frame`.
 * Returns { els: [...], bg: 'rgba(...)'|null }. Coordinates are in project pixels.
 */
export function graphicScene(clip, frame, fps, W, H, accentDefault = '#d8f36a') {
  const g = clip.graphic || {};
  const kind = GRAPHIC_KINDS.includes(g.kind) ? g.kind : 'stat';
  const accent = g.accent || accentDefault;
  const S = W / 1920;
  const local = frame - clip.start;
  const dur = Math.max(1, clip.dur);
  const p = clamp01(local / Math.max(2, g.animDur || 18));      // intro progress
  const pOut = clamp01((dur - local) / Math.max(2, g.animDur || 14)); // outro progress
  const outA = Math.min(1, pOut * 2);
  const scene = base(W, H);
  const els = scene.els;

  if (kind === 'stat' || kind === 'counter') {
    // big accent number counting up + label below
    const num = parseFloat(String(g.title ?? '').replace(/[, %]/g, ''));
    const isNum = Number.isFinite(num) && kind === 'counter';
    const shown = isNum
      ? String(Math.round(num * easeOut(p))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : g.title ?? '';
    const suffix = isNum && /%$/.test(String(g.title)) ? '%' : '';
    els.push(T({ x: W / 2, y: H * 0.42, text: shown + suffix, size: 220 * S, weight: 800, color: accent, align: 'center', alpha: p * outA, dy: (1 - easeOut(p)) * 30 * S }));
    els.push(T({ x: W / 2, y: H * 0.42 + 150 * S, text: g.body || '', size: 54 * S, weight: 600, color: '#ffffff', align: 'center', alpha: clamp01(p * 1.5 - 0.3) * outA }));
    els.push(R({ x: W / 2 - 60 * S, y: H * 0.42 + 200 * S, w: 120 * S * easeOut(p), h: 6 * S, color: accent, alpha: outA, radius: 3 * S }));
  } else if (kind === 'quote') {
    const bw = 1400 * S, bh = 460 * S, x = (W - bw) / 2, y = (H - bh) / 2;
    els.push(R({ x, y, w: bw, h: bh, color: 'rgba(8,10,6,0.72)', alpha: p * outA, radius: 26 * S, dy: (1 - easeOut(p)) * 40 * S }));
    els.push(R({ x: x + 40 * S, y: y + 30 * S, w: 8 * S, h: bh - 60 * S, color: accent, alpha: outA, dy: (1 - easeOut(p)) * 40 * S }));
    els.push(T({ x: x + 90 * S, y: y + bh / 2 - 30 * S, text: `“${g.title || ''}”`, size: 60 * S, weight: 600, color: '#ffffff', align: 'left', alpha: clamp01(p * 1.6) * outA, maxW: bw - 140 * S }));
    if (g.body) els.push(T({ x: x + 90 * S, y: y + bh - 60 * S, text: `— ${g.body}`, size: 38 * S, weight: 700, color: accent, align: 'left', alpha: clamp01(p * 1.6 - 0.4) * outA }));
  } else if (kind === 'list') {
    const items = g.items || [];
    const bx = W * 0.14, by = H * 0.2, bw = W * 0.72;
    els.push(R({ x: bx - 30 * S, y: by - 40 * S, w: bw + 60 * S, h: (items.length + 1.4) * 84 * S, color: 'rgba(8,10,6,0.7)', alpha: p * outA, radius: 22 * S }));
    els.push(T({ x: bx, y: by, text: g.title || '', size: 58 * S, weight: 800, color: accent, align: 'left', alpha: clamp01(p * 2) * outA }));
    items.forEach((it, i) => {
      const ip = clamp01((p * (items.length + 1.5) - 1) - i * 0.4);
      const y = by + 110 * S + i * 84 * S;
      els.push(R({ x: bx, y: y - 14 * S, w: 14 * S, h: 14 * S, color: accent, alpha: ip * outA, radius: 7 * S, dx: -(1 - easeOut(ip)) * 30 * S }));
      els.push(T({ x: bx + 40 * S, y, text: typeof it === 'string' ? it : it.label, size: 46 * S, weight: 600, color: '#ffffff', align: 'left', alpha: ip * outA, dx: (1 - easeOut(ip)) * 40 * S, maxW: bw - 40 * S }));
    });
  } else if (kind === 'comparison') {
    const L = g.left || {}, Rg = g.right || {};
    const y = H * 0.3, colW = W * 0.34, gap = W * 0.08;
    els.push(T({ x: W / 2, y: H * 0.16, text: g.title || '', size: 64 * S, weight: 800, color: '#ffffff', align: 'center', alpha: clamp01(p * 2) * outA }));
    const dl = clamp01(p * 2.4), dr = clamp01(p * 2.4 - 0.5);
    const col = (cx, d, prog, side) => {
      const c = side === 'left' ? accent : '#ffffff';
      const dx = (side === 'left' ? -1 : 1) * (1 - easeOut(prog)) * 60 * S;
      els.push(R({ x: cx - colW / 2, y, w: colW, h: 320 * S, color: 'rgba(8,10,6,0.72)', alpha: prog * outA, radius: 22 * S, dx }));
      els.push(T({ x: cx, y: y + 60 * S, text: d.label || '', size: 42 * S, weight: 700, color: c, align: 'center', alpha: prog * outA, dx }));
      els.push(T({ x: cx, y: y + 170 * S, text: d.value || '', size: 96 * S, weight: 800, color: '#ffffff', align: 'center', alpha: prog * outA, dx }));
    };
    col(W / 2 - gap / 2 - colW / 2, { label: L.label, value: L.value }, dl, 'left');
    col(W / 2 + gap / 2 + colW / 2, { label: Rg.label, value: Rg.value }, dr, 'right');
    els.push(T({ x: W / 2, y: y + 160 * S, text: g.vs || 'VS', size: 44 * S, weight: 800, color: accent, align: 'center', alpha: clamp01(p * 3 - 1.2) * outA }));
  } else if (kind === 'timeline') {
    const items = g.items || [];
    const y = H * 0.55, x0 = W * 0.14, x1 = W * 0.86;
    els.push(T({ x: W / 2, y: H * 0.2, text: g.title || '', size: 64 * S, weight: 800, color: '#ffffff', align: 'center', alpha: clamp01(p * 2) * outA }));
    els.push(R({ x: x0, y: y - 2 * S, w: (x1 - x0) * easeOut(p), h: 4 * S, color: accent, alpha: outA, radius: 2 * S }));
    items.forEach((it, i) => {
      const ip = clamp01((p * (items.length + 1.6) - 1) - i * 0.35);
      const cx = x0 + ((x1 - x0) * (i + 0.5)) / Math.max(1, items.length);
      els.push(R({ x: cx - 11 * S, y: y - 11 * S, w: 22 * S, h: 22 * S, color: accent, alpha: ip * outA, radius: 11 * S }));
      els.push(T({ x: cx, y: y + 46 * S, text: typeof it === 'string' ? it : it.label, size: 34 * S, weight: 700, color: '#ffffff', align: 'center', alpha: ip * outA, maxW: (x1 - x0) / Math.max(1, items.length) }));
      if (typeof it === 'object' && it.when) els.push(T({ x: cx, y: y - 52 * S, text: it.when, size: 30 * S, weight: 600, color: accent, align: 'center', alpha: ip * outA }));
    });
  } else if (kind === 'chapter') {
    els.push(R({ x: 0, y: 0, w: W, h: H, color: 'rgba(8,10,6,0.66)', alpha: p * outA }));
    if (g.body) els.push(T({ x: W / 2, y: H / 2 - 110 * S, text: g.body.toUpperCase(), size: 34 * S, weight: 700, color: accent, align: 'center', alpha: clamp01(p * 2) * outA, dy: (1 - easeOut(p)) * 24 * S }));
    els.push(T({ x: W / 2, y: H / 2, text: g.title || '', size: 112 * S, weight: 800, color: '#ffffff', align: 'center', alpha: clamp01(p * 1.6) * outA, maxW: W * 0.8 }));
    els.push(R({ x: W / 2 - 60 * S, y: H / 2 + 96 * S, w: 120 * S * easeOut(p), h: 6 * S, color: accent, alpha: outA, radius: 3 * S }));
  }
  return scene;
}

/** Validate/normalize a graphic payload. Throws on unknown kinds or bad items. */
export function checkGraphic(g) {
  if (!g || typeof g !== 'object') throw new Error('graphic object required');
  if (!GRAPHIC_KINDS.includes(g.kind)) throw new Error(`Unknown graphic kind ${g.kind}. Available: ${GRAPHIC_KINDS.join(', ')}`);
  const out = { kind: g.kind, title: String(g.title ?? ''), body: g.body != null ? String(g.body) : undefined, accent: g.accent, animDur: g.animDur };
  if (['list', 'timeline'].includes(g.kind)) out.items = (g.items || []).slice(0, 8).map(it => typeof it === 'string' ? { label: it } : { label: String(it.label || ''), when: it.when != null ? String(it.when) : undefined });
  if (g.kind === 'comparison') { out.left = { label: String(g.left?.label || ''), value: String(g.left?.value || '') }; out.right = { label: String(g.right?.label || ''), value: String(g.right?.value || '') }; }
  return out;
}
