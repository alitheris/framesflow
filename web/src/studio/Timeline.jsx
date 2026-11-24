import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Magnet, Scissors, Trash2, Copy, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Link2, Volume2, VolumeX, Lock, Unlock, Headphones, Film, Music2, Layers, Plus, ChevronsLeftRight, Mic, Type, Eye, EyeOff, ArrowUpNarrowWide, Flag, Sparkles } from 'lucide-react';
import { frameMs, msFrame, tc, mediaUrl, thumbUrl, totalFrames, useApp, upload, askAudio, tool, toast } from '../api';
import * as T from './transport';

const LEFT = 168, RULER_H = 30, CH_H = 18, MARKER_H = 20, BEAT_H = 30, WORD_H = 20;
const TRACK_H = { V1: 84, V2: 50, A1: 64, A2: 50, A3: 46 };
const th = t => t.height || TRACK_H[t.id] || (t.kind === 'video' ? 64 : 50);
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_LEN = 2;
const TRANS_ICON = { dissolve: '⋈', dipblack: '◐', dipwhite: '◑', blurdissolve: '≋', zoomin: '⤢', zoomout: '⤡', spin: '⟳', whippan: '⇉', glitch: '⚡', pixelate: '▦', circleopen: '◯', circleclose: '◉', barndoor: '◫', clockwipe: '◷' };

// ---------- waveform peaks cache
const peakCache = new Map();
function usePeaks(project, asset) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!asset) return;
    const key = `${project.id}/${asset.id}`;
    if (peakCache.has(key)) return;
    if (asset.peaksData) { peakCache.set(key, asset.peaksData); force(n => n + 1); return; }
    if (!asset.file) return;
    peakCache.set(key, null);
    fetch(`/api/assets/${project.id}/${asset.id}/peaks`).then(r => r.arrayBuffer()).then(b => { peakCache.set(key, new Uint8Array(b)); force(n => n + 1); }).catch(() => peakCache.delete(key));
  }, [asset?.id, project.id]); // eslint-disable-line
  return asset ? peakCache.get(`${project.id}/${asset.id}`) : null;
}

function Wave({ peaks, clip, ppf, vis, height, color, fps }) {
  const ref = useRef();
  const x0 = Math.max(0, vis.left - clip.start * ppf - 200), x1 = Math.min(clip.dur * ppf, vis.right - clip.start * ppf + 200);
  const w = Math.max(0, Math.min(4000, Math.ceil(x1 - x0)));
  useEffect(() => {
    const cv = ref.current; if (!cv || !peaks || w <= 0) return;
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = color; const mid = height / 2;
    const msPerPx = (1000 / fps / ppf) * (clip.speed || 1);
    for (let x = 0; x < w; x++) {
      const t0 = clip.in + (x0 + x) * msPerPx, i0 = Math.floor(t0 / 20), i1 = Math.max(i0 + 1, Math.floor((t0 + msPerPx) / 20));
      let m = 0; for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const hh = Math.max(1, (m / 255) * (height - 6));
      ctx.fillRect(x, mid - hh / 2, 1, hh);
    }
  }, [peaks, w, x0, ppf, clip.in, clip.speed, height, color, fps]);
  if (w <= 0) return null;
  return <canvas ref={ref} width={w} height={height} className="wave" style={{ left: x0 }} />;
}

function Filmstrip({ project, asset, clip, ppf, vis, height, fps }) {
  if (!asset || (clip.type === 'text')) return null;
  const poster = asset.kind === 'image' || !asset.file ? thumbUrl(project, asset) : thumbUrl(project, asset);
  if (!asset.thumbs && !poster) return null;
  const tileW = Math.round(height * (160 / 90));
  const cw = clip.dur * ppf;
  const first = Math.max(0, Math.floor((vis.left - clip.start * ppf - 100) / tileW)), last = Math.min(Math.ceil(cw / tileW), Math.ceil((vis.right - clip.start * ppf + 100) / tileW));
  const n = asset.thumbs?.n || 1, tiles = [];
  for (let i = first; i < last && tiles.length < 60; i++) {
    const frac = asset.kind === 'image' || !asset.thumbs ? 0 : ((clip.in + (((i + 0.5) * tileW) / ppf / fps) * 1000 * (clip.speed || 1)) / asset.duration);
    const idx = Math.max(0, Math.min(n - 1, Math.floor(frac * n)));
    tiles.push(<i key={i} style={{ left: i * tileW, width: tileW, height, backgroundImage: `url(${poster})`, backgroundSize: asset.thumbs ? `${n * tileW}px ${height}px` : 'cover', backgroundPosition: asset.thumbs ? `${-idx * tileW}px 0` : 'center' }} />);
  }
  return <div className="strip">{tiles}</div>;
}

export default function Timeline({ project, rev, selected, setSelected, beatSel, setBeatSel, ops, flash, clipboard }) {
  const app = useApp();
  const total = totalFrames(project);
  const fps = project.settings?.fps || 30;
  const [pps, setPps] = useState(70);
  const ppf = pps / fps;
  const [snapOn, setSnapOn] = useState(true);
  const [ripple, setRipple] = useState(false);
  const [showMeta, setShowMeta] = useState(true);
  const scroller = useRef(), headRef = useRef();
  const [vis, setVis] = useState({ left: 0, right: 1400 });
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const [hold, setHold] = useState(null);
  const [guide, setGuide] = useState(null);
  const [dropTrack, setDropTrack] = useState(null);

  const trackById = useMemo(() => Object.fromEntries(project.tracks.map(t => [t.id, t])), [project.tracks]);
  const clipById = useMemo(() => new Map(project.clips.map(c => [c.id, c])), [project.clips]);
  const override = drag?.override || (hold && hold.rev === rev ? hold.map : null);
  const geom = c => { const o = override?.get(c.id); return o ? { ...c, ...o } : c; };

  // ---- layout
  const showWords = pps >= 110 && project.transcript;
  const rows = useMemo(() => {
    let y = RULER_H;
    const list = [];
    list.push({ key: 'markers', top: y, h: MARKER_H }); y += MARKER_H;
    if (showMeta) {
      list.push({ key: 'chapters', top: y, h: CH_H }); y += CH_H;
      list.push({ key: 'beats', top: y, h: BEAT_H }); y += BEAT_H;
      if (showWords) { list.push({ key: 'words', top: y, h: WORD_H }); y += WORD_H; }
    }
    for (const t of project.tracks) { list.push({ key: t.id, track: t, top: y, h: th(t) }); y += th(t); }
    return { list, height: y };
  }, [project.tracks, showWords, showMeta]);
  const contentW = Math.max((total + fps * 6) * ppf, vis.right - vis.left);

  const fit = useCallback(() => {
    const el = scroller.current; if (!el || !total) return;
    setPps(Math.max(8, Math.min(600, ((el.clientWidth - LEFT - 60) / total) * fps)));
    el.scrollLeft = 0;
  }, [total, fps]);
  const firstFit = useRef(null);
  useLayoutEffect(() => { if (firstFit.current !== project.id && total) { firstFit.current = project.id; fit(); } }, [project.id, total, fit]);

  const onScroll = useCallback(() => {
    const el = scroller.current; if (!el) return;
    setVis({ left: Math.max(0, el.scrollLeft - LEFT), right: el.scrollLeft - LEFT + el.clientWidth });
  }, []);
  useEffect(() => { onScroll(); const ro = new ResizeObserver(onScroll); ro.observe(scroller.current); return () => ro.disconnect(); }, [onScroll]);

  // ---- playhead
  const phRef = useRef(), tcRef = useRef();
  useEffect(() => {
    const paint = (f, playing) => {
      if (phRef.current) phRef.current.style.transform = `translateX(${LEFT + f * ppf}px)`;
      if (tcRef.current) tcRef.current.textContent = tc(Math.floor(f), true, fps);
      const el = scroller.current;
      if (playing && el) { const x = LEFT + f * ppf; if (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft + LEFT) el.scrollLeft = Math.max(0, x - LEFT - 120); }
    };
    paint(T.getFrame(), false);
    return T.subscribe(paint);
  }, [ppf, fps]);

  // ---- wheel: plain wheel scrolls the timeline horizontally, ctrl/cmd zooms
  useEffect(() => {
    const el = scroller.current;
    const onWheel = e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const anchorX = e.clientX - rect.left - LEFT + el.scrollLeft;
        const anchorFrame = anchorX / ppf;
        const next = Math.max(6, Math.min(800, pps * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        setPps(next);
        requestAnimationFrame(() => { el.scrollLeft = anchorFrame * (next / fps) - (e.clientX - rect.left - LEFT); });
        return;
      }
      // horizontal scroll: trackpad deltaX directly, mouse wheel deltaY
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (d) { el.scrollLeft += d; e.preventDefault(); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pps, ppf, fps]);

  // ---- pointer helpers
  const frameAt = clientX => { const r = scroller.current.getBoundingClientRect(); return Math.max(0, Math.round((clientX - r.left - LEFT + scroller.current.scrollLeft) / ppf)); };
  const rowAt = clientY => {
    const r = scroller.current.getBoundingClientRect(); const y = clientY - r.top + scroller.current.scrollTop;
    return rows.list.find(x => x.track && y >= x.top && y < x.top + x.h)?.track || null;
  };
  const scrub = e => {
    e.preventDefault();
    const move = ev => T.seek(frameAt(ev.clientX));
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // ---- snapping
  const snapPoints = useCallback(excludeIds => {
    const pts = new Set([0, total, Math.floor(T.getFrame())]);
    for (const c of project.clips) if (!excludeIds.has(c.id)) { pts.add(c.start); pts.add(c.start + c.dur); }
    for (const m of project.markers || []) pts.add(m.frame);
    for (const b of project.beats) pts.add(b.startFrame);
    if (pps >= 100 && project.transcript) for (const w of project.transcript.words) pts.add(msFrame(w.s, fps));
    return [...pts].sort((a, b) => a - b);
  }, [project.clips, project.beats, project.markers, project.transcript, total, pps, fps]);

  const snapTo = (pts, edges, d) => {
    if (!snapOn) return { d, at: null };
    const tol = 9 / ppf; let best = null;
    for (const e of edges) {
      const target = e + d;
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid] < target) lo = mid + 1; else hi = mid; }
      for (const i of [lo - 1, lo]) { if (i < 0 || i >= pts.length) continue; const dist = Math.abs(pts[i] - target); if (dist <= tol && (!best || dist < best.dist)) best = { dist, adj: pts[i] - target, at: pts[i] }; }
    }
    return best ? { d: d + best.adj, at: best.at } : { d, at: null };
  };

  // ---- drag engine (move / trim-l / trim-r / slip / slide / roll)
  const beginDrag = (e, c0, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = trackById[c0.track];
    const multi = e.shiftKey || (e.ctrlKey || e.metaKey) && mode === 'move' && !e.altKey;
    if (multi && mode === 'move') { const n = new Set(selected); n.has(c0.id) ? n.delete(c0.id) : n.add(c0.id); setSelected(n); return; }
    let ids = selected.has(c0.id) && mode === 'move' ? [...selected] : [c0.id];
    if (!selected.has(c0.id)) setSelected(new Set([c0.id]));
    if (track?.locked) return;
    if (mode !== 'move') ids = [c0.id];
    // modifier tools (single clip)
    if (mode === 'move' && e.altKey) mode = 'slip';
    if (mode === 'move' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !multi) mode = 'slide';
    const orig = new Map(ids.map(id => { const k = clipById.get(id); return [id, { start: k.start, dur: k.dur, in: k.in, track: k.track }]; }));
    const st = { mode, ids, orig, x0: e.clientX, y0: e.clientY, primary: c0.id, moved: false, pts: null, exclude: new Set(ids), override: null };
    dragRef.current = st; setDrag({ ...st });
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once: true });
  };

  const onMove = ev => {
    const st = dragRef.current; if (!st) return;
    const fps2 = fps;
    const dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
    if (!st.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!st.moved) { st.moved = true; st.pts = snapPoints(st.exclude); }
    let d = Math.round(dx / ppf);
    const map = new Map();
    const c0 = clipById.get(st.primary);

    if (st.mode === 'move' || st.mode === 'slide') {
      if (st.mode === 'move') {
        const edges = []; let minStart = Infinity;
        for (const [, o] of st.orig) { edges.push(o.start, o.start + o.dur); minStart = Math.min(minStart, o.start); }
        d = Math.max(d, -minStart);
        const s = snapTo(st.pts, edges, d); d = Math.max(s.d, -minStart); setGuide(s.at);
        let newTrack = null;
        if (st.ids.length === 1 && Math.abs(dy) > 16) { const t = rowAt(ev.clientY); const o = st.orig.get(st.ids[0]); if (t && t.id !== o.track && t.kind === trackById[o.track].kind && !t.locked) newTrack = t.id; }
        for (const [id, o] of st.orig) map.set(id, { start: o.start + d, ...(newTrack && id === st.ids[0] ? { track: newTrack } : {}) });
      } else {
        // slide: move this clip, push neighbours along so the track stays continuous
        const o = st.orig.get(st.ids[0]);
        const list = project.clips.filter(k => k.track === o.track && k.id !== st.ids[0]).sort((a, b) => a.start - b.start);
        const before = list.filter(k => k.start + k.dur <= o.start + 1);
        const after = list.filter(k => k.start >= o.start + o.dur - 1);
        const room = before.length ? o.start - (before[before.length - 1].start + before[before.length - 1].dur) : o.start;
        const roomR = after.length ? after[0].start - (o.start + o.dur) : 1e6;
        d = Math.max(-room, Math.min(roomR, d));
        map.set(st.ids[0], { start: o.start + d });
        for (const k of before) if (k.start + k.dur > o.start + d) map.set(k.id, { start: k.start + d });
        for (const k of after) if (k.start < o.start + o.dur + d) map.set(k.id, { start: k.start + d });
      }
    } else if (st.mode === 'slip') {
      // slip: keep timeline position, change the source in-point
      const o = st.orig.get(st.ids[0]), c = clipById.get(st.ids[0]), asset = project.assets[c.assetId];
      const msPerF = (1000 / fps2) * (c.speed || 1);
      let newIn = o.in + dx * (msPerF / ppf); // ms of source per screen px
      newIn = Math.max(0, asset && (c.type === 'video' || c.type === 'audio') ? Math.min(newIn, Math.max(0, asset.duration - o.dur * msPerF)) : newIn);
      map.set(st.ids[0], { in: Math.round(newIn) });
      st.slipIn = Math.round(newIn);
    } else if (st.mode === 'l') {
      const o = st.orig.get(st.ids[0]), c = clipById.get(st.ids[0]), asset = project.assets[c.assetId];
      const s = snapTo(st.pts, [o.start], d); d = s.d; setGuide(s.at);
      const msPerF = (1000 / fps2) * (c.speed || 1);
      const minD = c.type === 'video' || c.type === 'audio' ? -Math.floor(o.in / msPerF) : -o.start;
      d = Math.max(d, minD, -o.start); d = Math.min(d, o.dur - MIN_LEN);
      map.set(st.ids[0], { start: o.start + d, dur: o.dur - d, in: Math.max(0, Math.round(o.in + d * msPerF)) });
    } else if (st.mode === 'r') {
      const o = st.orig.get(st.ids[0]), c = clipById.get(st.ids[0]), asset = project.assets[c.assetId];
      const s = snapTo(st.pts, [o.start + o.dur], d); d = s.d; setGuide(s.at);
      d = Math.max(d, MIN_LEN - o.dur);
      const msPerF = (1000 / fps2) * (c.speed || 1);
      if (asset && (c.type === 'video' || c.type === 'audio') && c.track !== 'A2') { const room = Math.floor((asset.duration - o.in) / msPerF) - o.dur; d = Math.min(d, Math.max(0, room)); }
      map.set(st.ids[0], { dur: o.dur + d });
      st.rippleD = d;
    }
    st.override = map;
    setDrag({ ...st });
  };

  const onUp = async () => {
    window.removeEventListener('pointermove', onMove);
    const st = dragRef.current; dragRef.current = null; setGuide(null);
    if (!st) return;
    if (!st.moved || !st.override) { setDrag(null); return; }
    const patches = [];
    for (const [id, o] of st.override) {
      const base = st.orig.get(id), patch = {};
      for (const k of ['start', 'dur', 'in', 'track']) if (o[k] !== undefined && o[k] !== base[k]) patch[k] = o[k];
      if (Object.keys(patch).length) patches.push({ id, patch });
    }
    if (st.mode === 'r' && ripple && st.rippleD) {
      const id = st.ids[0], o = st.orig.get(id);
      for (const k of project.clips) if (k.track === o.track && k.id !== id && k.start >= o.start + o.dur - 1) patches.push({ id: k.id, patch: { start: k.start + st.rippleD } });
    }
    setHold({ rev, map: new Map([...st.override, ...patches.filter(p => !st.override.has(p.id)).map(p => [p.id, p.patch])]) });
    setDrag(null);
    if (patches.length) { try { await tool('edit_clip', { patches }); } catch { setHold(null); } }
  };
  useEffect(() => () => window.removeEventListener('pointermove', onMove), []); // eslint-disable-line

  // ---- background click
  const laneDown = e => {
    if (e.button !== 0 || e.target.closest('.clip')) return;
    if (!(e.shiftKey)) setSelected(new Set());
    setBeatSel(null);
    scrub(e);
  };

  // ---- drops (library → timeline, or OS files)
  const dropOn = async (e, track) => {
    e.preventDefault(); setDropTrack(null);
    const startMs = frameMs(frameAt(e.clientX), fps);
    const id = e.dataTransfer.getData('application/x-ff-asset');
    try {
      if (id) {
        const a = project.assets[id]; if (!a) return;
        const tr = track?.id || (a.kind === 'audio' ? 'A2' : 'V1');
        if (a.kind === 'audio' && tr[0] === 'V' || a.kind !== 'audio' && tr[0] === 'A') return toast('That media type does not fit that track.', 'error');
        const durMs = a.kind === 'image' ? 3000 : tr[0] === 'A' ? a.duration : Math.min(a.duration, 4000);
        await tool('place_clip', { assetId: id, track: tr, startMs, durMs, allowLong: true, replace: false, force: true });
      } else if (e.dataTransfer.files?.length) {
        for (const f of e.dataTransfer.files) {
          const a = await upload(f, { role: track?.id === 'A1' ? 'voice' : undefined });
          if (track?.id !== 'A1') await askAudio(a);
          if (track?.id !== 'A1') await tool('place_clip', { assetId: a.id, track: a.kind === 'audio' ? (track?.id?.[0] === 'A' ? track.id : 'A2') : track?.id?.[0] === 'V' ? track.id : 'V1', startMs, durMs: a.kind === 'image' ? 3000 : a.kind === 'audio' ? a.duration : Math.min(a.duration, 4000), allowLong: true, replace: false, force: true });
        }
      }
    } catch { /* toast already shown */ }
  };

  // ---- ruler ticks
  const step = STEPS.find(s => s * pps >= 90) || 600;
  const ticks = [];
  { const a = Math.floor(vis.left / pps / step) * step, b = (vis.right / pps) + step;
    for (let s = Math.max(0, a); s <= b; s += step) ticks.push(s); }
  const subStep = step / (step >= 5 ? 5 : step >= 1 ? 4 : 2);
  const minor = [];
  if (subStep * pps >= 10) { const a = Math.floor(vis.left / pps / subStep) * subStep, b = vis.right / pps + subStep; for (let s = Math.max(0, a); s <= b; s += subStep) minor.push(s); }

  const visWords = useMemo(() => {
    if (!showWords) return [];
    const f0 = vis.left / ppf - 20, f1 = vis.right / ppf + 20;
    return project.transcript.words.map((w, i) => ({ ...w, i, f: msFrame(w.s, fps), e: msFrame(w.e, fps) })).filter(w => w.e >= f0 && w.f <= f1);
  }, [showWords, vis, ppf, project.transcript, fps]);

  const trackIcon = t => (t.kind === 'video' ? (t.role === 'base' ? <Film size={13} /> : <Layers size={13} />) : t.role === 'voice' ? <Mic size={13} /> : t.role === 'music' ? <Music2 size={13} /> : <Headphones size={13} />);
  const set = (id, patch) => tool('set_track', { id, ...patch }, { quiet: true });
  const addTrack = kind => tool('add_track', { kind }, { quiet: true }).catch(() => {});
  const addEffectLayer = () => {
    const f = Math.round(T.getFrame());
    tool('add_effect_layer', { startMs: frameMs(f), durMs: 3000, effects: [{ type: 'blur', params: { amount: 8 } }] }, { quiet: true }).catch(() => {});
  };
  const removeTrack = id => { if (confirm(`Delete track ${id} and all its clips?`)) tool('remove_track', { id }, { quiet: true }).catch(() => {}); };

  return (
    <div className="tl">
      <div className="tl-bar">
        <div className="tl-group">
          <button className="tb" title="Undo (Ctrl+Z)" onClick={ops.undo}><Undo2 size={16} /></button>
          <button className="tb" title="Redo (Ctrl+Shift+Z)" onClick={ops.redo}><Redo2 size={16} /></button>
        </div>
        <div className="tl-group">
          <button className="tb" title="Split at playhead (S)" onClick={ops.split}><Scissors size={16} /></button>
          <button className="tb" title="Copy (Ctrl+C)" onClick={ops.copy} disabled={!selected.size}><Copy size={16} /></button>
          <button className="tb" title="Paste (Ctrl+V) — at the playhead" onClick={ops.paste} disabled={!clipboard?.length}><Plus size={16} /></button>
          <button className="tb" title="Delete (Del) — Shift+Del ripple deletes" onClick={() => ops.remove(ripple)} disabled={!selected.size}><Trash2 size={16} /></button>
        </div>
        <div className="tl-group">
          <button className="tb" title="Add marker (M)" onClick={ops.marker}><Flag size={15} /><span>Marker</span></button>
          <button className="tb" title="Add video track" onClick={() => addTrack('video')}><Film size={15} /><span>+ Video</span></button>
          <button className="tb" title="Add audio track" onClick={() => addTrack('audio')}><Music2 size={15} /><span>+ Audio</span></button>
          <button className="tb" title="Add an effect layer at the playhead — a separate layer that applies effects (with keyframes) to everything below it" onClick={addEffectLayer}><Sparkles size={15} /><span>+ Effect</span></button>
        </div>
        <div className="tl-group">
          <button className={`tb tgl ${snapOn ? 'on' : ''}`} title="Snapping (N)" onClick={() => setSnapOn(v => !v)}><Magnet size={16} /><span>Snap</span></button>
          <button className={`tb tgl ${ripple ? 'on' : ''}`} title="Ripple: trimming/deleting closes or opens the gap" onClick={() => setRipple(v => !v)}><ChevronsLeftRight size={16} /><span>Ripple</span></button>
          <button className={`tb tgl ${showMeta ? 'on' : ''}`} title="Show beats/chapters/words lanes" onClick={() => setShowMeta(v => !v)}><Eye size={15} /><span>Meta</span></button>
        </div>
        <div className="tl-time"><b ref={tcRef}>00:00:00</b><span>/ {tc(total, true, fps)}</span></div>
        <div className="tl-spacer" />
        <div className="tl-group zoom">
          <button className="tb" onClick={() => setPps(p => Math.max(6, p / 1.4))} title="Zoom out (-)"><ZoomOut size={16} /></button>
          <input type="range" min="0" max="100" value={Math.round((Math.log(pps / 6) / Math.log(800 / 6)) * 100)} onChange={e => setPps(6 * Math.pow(800 / 6, e.target.value / 100))} aria-label="Timeline zoom" />
          <button className="tb" onClick={() => setPps(p => Math.min(800, p * 1.4))} title="Zoom in (+)"><ZoomIn size={16} /></button>
          <button className="tb tgl" onClick={fit} title="Fit timeline (\)"><Maximize2 size={15} /><span>Fit</span></button>
        </div>
      </div>

      <div className="tl-scroll" ref={scroller} onScroll={onScroll}>
        <div className="tl-inner" style={{ width: LEFT + contentW, height: rows.height }}>
          {/* ruler */}
          <div className="tl-ruler" style={{ height: RULER_H }}>
            <div className="tl-corner" style={{ width: LEFT }}>TIME</div>
            <div className="tl-ruler-lane" style={{ width: contentW }} onPointerDown={scrub}>
              {minor.map(s => <i key={'m' + s} className="tk minor" style={{ left: s * pps }} />)}
              {ticks.map(s => <i key={s} className="tk" style={{ left: s * pps }}><em>{tc(Math.round(s * fps), step < 1, fps)}</em></i>)}
              {total > 0 && <i className="end-mark" style={{ left: total * ppf }} title="End of the video" />}
            </div>
          </div>

          {/* markers + meta lanes */}
          {rows.list.filter(r => !r.track).map(r => (
            <div key={r.key} className="tl-row meta" style={{ top: r.top, height: r.h }}>
              <div className="tl-head meta" style={{ width: LEFT }}>{r.key === 'markers' ? 'MARKERS' : r.key === 'chapters' ? 'CHAPTERS' : r.key === 'beats' ? `BEATS ${project.beats.length ? `· ${project.beats.filter(b => project.clips.some(c => c.track === 'V1' && c.beatId === b.id)).length}/${project.beats.length}` : ''}` : 'WORDS'}</div>
              <div className="tl-lane" style={{ width: contentW }} onPointerDown={r.key === 'markers' ? laneDown : laneDown}>
                {r.key === 'markers' && (project.markers || []).map(m => (
                  <div key={m.id} className="marker" style={{ left: m.frame * ppf, '--mc': m.color || 'var(--accent)' }} title={m.label || `Marker @ ${tc(m.frame, true, fps)}`}
                    onPointerDown={e => { e.stopPropagation(); T.seek(m.frame); }}>
                    <Flag size={10} />{m.label && pps > 40 ? <span>{m.label}</span> : null}
                  </div>
                ))}
                {r.key === 'chapters' && showMeta && project.chapters.map((c, i) => <div key={c.id} className={`chap c${i % 5}`} style={{ left: msFrame(c.startMs, fps) * ppf, width: Math.max(2, (msFrame(c.endMs, fps) - msFrame(c.startMs, fps)) * ppf - 1) }} onPointerDown={e => { e.stopPropagation(); T.seek(msFrame(c.startMs, fps)); }} title={c.title}>{c.title}</div>)}
                {r.key === 'beats' && showMeta && project.beats.map((b, i) => {
                  const covered = project.clips.some(c => c.track === 'V1' && c.beatId === b.id);
                  // prefer ms timings so beats stay aligned at any project fps
                  const bf0 = b.startMs != null ? msFrame(b.startMs, fps) : b.startFrame;
                  const bf1 = b.endMs != null ? msFrame(b.endMs, fps) : b.endFrame;
                  const w = (bf1 - bf0) * ppf;
                  return <div key={b.id} className={`beat ${covered ? 'ok' : 'todo'} ${beatSel === b.id ? 'sel' : ''}`} style={{ left: bf0 * ppf, width: Math.max(2, w - 1) }}
                    onPointerDown={e => { e.stopPropagation(); setBeatSel(b.id); setSelected(new Set()); T.seek(bf0); }} title={`${b.id} · ${b.text}`}>
                    {w > 46 && <><b>{b.id.replace('b', '')}</b>{w > 110 && <span>{b.text}</span>}</>}
                  </div>;
                })}
                {r.key === 'words' && visWords.map(w => <span key={w.i} className="word" style={{ left: w.f * ppf, width: Math.max(2, (w.e - w.f) * ppf - 1) }} onPointerDown={e => { e.stopPropagation(); T.seek(w.f); }}>{w.w}</span>)}
              </div>
            </div>
          ))}

          {/* tracks */}
          {rows.list.filter(r => r.track).map(({ track: t, top, h }) => {
            const list = project.clips.filter(c => c.track === t.id);
            return (
              <div key={t.id} className={`tl-row track ${t.kind} ${t.muted ? 'muted' : ''} ${dropTrack === t.id ? 'drop' : ''}`} style={{ top, height: h }}>
                <div className="tl-head" style={{ width: LEFT }}>
                  <span className="tid">{trackIcon(t)}<b>{t.id}</b></span>
                  <span className="tname">{t.name}</span>
                  <span className="tbtns">
                    <button title={t.muted ? 'Unmute' : 'Mute'} className={t.muted ? 'on' : ''} onClick={() => set(t.id, { muted: !t.muted })}>{t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
                    {t.kind === 'audio' && <button title="Solo" className={t.solo ? 'on' : ''} onClick={() => set(t.id, { solo: !t.solo })}><Headphones size={13} /></button>}
                    <button title={t.locked ? 'Unlock' : 'Lock'} className={t.locked ? 'on' : ''} onClick={() => set(t.id, { locked: !t.locked })}>{t.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
                    <button title="Delete track" className="danger" onClick={() => removeTrack(t.id)}><Trash2 size={12} /></button>
                  </span>
                </div>
                <div className="tl-lane" style={{ width: contentW }} onPointerDown={laneDown}
                  onDragOver={e => { e.preventDefault(); setDropTrack(t.id); }} onDragLeave={() => setDropTrack(null)} onDrop={e => dropOn(e, t)}>
                  {list.map(c0 => {
                    const c = geom(c0);
                    const left = c.start * ppf, width = Math.max(3, c.dur * ppf);
                    if (left + width < vis.left - 600 || left > vis.right + 600) return null;
                    const asset = project.assets[c.assetId];
                    const isSel = selected.has(c.id), isFlash = flash[c.id];
                    const ch = h - 8;
                    const cls = `clip ${c.type} ${t.kind === 'audio' ? 'aud' : ''} ${isSel ? 'sel' : ''} ${isFlash ? 'flash' : ''} ${drag?.ids.includes(c.id) && drag.moved ? 'dragging' : ''} ${t.locked ? 'locked' : ''}`;
                    const label = c.type === 'text' ? `${c.text.kind === 'chapter' ? '▣' : 'T'} ${c.text.title}` : (c.label || asset?.name || '');
                    const kfd = c.keyframes && Object.keys(c.keyframes).length;
                    return (
                      <div key={c.id} className={cls} style={{ left, width, top: 4, height: ch, '--c': c.color || '' }}
                        onPointerDown={e => beginDrag(e, c0, 'move')}
                        onContextMenu={e => { e.preventDefault(); ops.clipMenu?.(c0, e); }}
                        data-id={c.id}
                        title={`${label}\n${tc(c.start, true, fps)} → ${tc(c.start + c.dur, true, fps)} · ${(c.dur / fps).toFixed(2)}s${c.source?.title ? `\nYouTube: ${c.source.title} (${c.source.channel})` : ''}${c.effects?.length ? `\nFX: ${c.effects.map(e => e.type).join(', ')}` : ''}${kfd ? `\nKeyframes: ${Object.keys(c.keyframes).join(', ')}` : ''}\n\nDrag = move · Alt+drag = slip · Ctrl+drag = slide · edges = trim`}>
                        {asset && (c.type === 'video' || c.type === 'image') && <Filmstrip project={project} asset={asset} clip={c} ppf={ppf} vis={vis} height={ch} fps={fps} />}
                        {asset && c.type === 'audio' && <AudioWave project={project} asset={asset} clip={c} ppf={ppf} vis={vis} height={ch} color={t.role === 'voice' ? 'rgba(255,214,150,.9)' : 'rgba(190,225,255,.85)'} fps={fps} />}
                        <div className="clip-label">{c.source ? <Link2 size={11} /> : null}<span>{label}</span></div>
                        {c.transition?.type && c.transition.type !== 'cut' && <em className="trans" title={`${c.transition.type} in`}>{TRANS_ICON[c.transition.type] || '⤢'}</em>}
                        {kfd ? <em className="kfg" title="Keyframed">◆</em> : null}
                        {c.effects?.length ? <em className="fxg" title={c.effects.map(e => e.type).join(', ')}>fx</em> : null}
                        <u className="h l" onPointerDown={e => beginDrag(e, c0, 'l')} /><u className="h r" onPointerDown={e => beginDrag(e, c0, 'r')} />
                        {width > 70 && <small className="dur">{(c.dur / fps).toFixed(1)}s</small>}
                      </div>
                    );
                  })}
                  {!list.length && t.role === 'base' && <div className="lane-hint">Drop footage here — or let the AI place clips live</div>}
                  {!list.length && t.role === 'voice' && <div className="lane-hint">Drop your voiceover here</div>}
                </div>
              </div>
            );
          })}

          {guide != null && <div className="snap-guide" style={{ transform: `translateX(${LEFT + guide * ppf}px)` }} />}
          <div className="playhead" ref={phRef} style={{ height: rows.height }}><span /></div>
        </div>
      </div>
    </div>
  );
}

function AudioWave({ project, asset, ...rest }) { return <Wave peaks={usePeaks(project, asset)} {...rest} />; }
