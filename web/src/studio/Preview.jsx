// Canvas preview: video/image elements are pure decoders; every frame is composed
// through the shared compositor so the preview IS the export.
import React, { useEffect, useRef } from 'react';
import { mediaUrl } from '../api';
import * as T from './transport';
import { drawFrame } from './compositor';
import { syncAudio, stopAll } from './audio';

export default function Preview({ project, selectedIds }) {
  const cvRef = useRef(), boxRef = useRef();
  const decoders = useRef(new Map()); // clipId → { el, ok, type }
  const projRef = useRef(project);
  projRef.current = project;
  const selectionRef = useRef(selectedIds);
  selectionRef.current = selectedIds;

  const w = project.settings?.width || 1920, h = project.settings?.height || 1080;

  useEffect(() => {
    const canvas = cvRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const scratch = [];
    const env = {
      // reusable offscreen layer(s); drawFrame usage is synchronous and non-reentrant per layer
      off: (W, H) => {
        let s = scratch.find(x => x.W === W && x.H === H);
        if (!s) { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; s = { cv, ctx: cv.getContext('2d'), W, H }; scratch.push(s); }
        return { cv: s.cv, ctx: s.ctx };
      },
    };

    const ids = () => new Set(projRef.current.clips.map(c => c.id));
    const prune = () => {
      const have = ids();
      for (const [cid, d] of decoders.current) {
        if (!have.has(cid)) { d.el.pause?.(); if (d.el.tagName === 'VIDEO') d.el.removeAttribute('src'); decoders.current.delete(cid); }
      }
    };

    const getDecoder = (clip, asset) => {
      let d = decoders.current.get(clip.id);
      const url = mediaUrl(projRef.current, asset);
      if (d && d.url === url) return d;
      if (d) { d.el.pause?.(); if (d.el.tagName === 'VIDEO') d.el.removeAttribute('src'); decoders.current.delete(clip.id); }
      if (clip.type === 'image') {
        const el = new Image();
        el.onload = () => { if (d) d.ok = true; requestDraw(); };
        el.src = url;
        d = { el, ok: false, type: 'image', url };
      } else {
        const el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
        el.addEventListener('loadeddata', () => { if (d) { d.ok = true; } requestDraw(); }, { once: true });
        el.src = url;
        d = { el, ok: false, type: 'video', url };
      }
      decoders.current.set(clip.id, d);
      return d;
    };

    let raf = 0, lastKey = '';
    // rAF can be fully suspended in background webviews — detect it once and fall back to setTimeout paints
    let rafDead = false;
    {
      window.__ffRafOk = false;
      requestAnimationFrame(() => { window.__ffRafOk = true; });
      setTimeout(() => { rafDead = !window.__ffRafOk; }, 350);
    }
    const requestDraw = () => {
      if (raf) return;
      raf = rafDead ? setTimeout(paint, 33) : requestAnimationFrame(paint);
    };
    const paint = () => {
      raf = 0;
      const p = projRef.current;
      if (!p) return;
      const frame = T.getFrame();
      // keep decoders in sync
      const fps = p.settings?.fps || 30;
      const active = new Set();
      for (const c of p.clips) {
        const inWindow = frame >= c.start - 90 && frame < c.start + c.dur + 60; // pre-roll for transitions
        if ((c.type === 'video' || c.type === 'image') && inWindow) {
          const asset = p.assets[c.assetId];
          if (!asset) continue;
          getDecoder(c, asset);
          active.add(c.id);
        }
      }
      for (const [cid, d] of decoders.current) {
        if (!active.has(cid)) { d.el.pause?.(); continue; }
        const c = p.clips.find(x => x.id === cid);
        if (c?.type === 'video') {
          const live = frame >= c.start && frame < c.start + c.dur;
          const want = (c.in + ((Math.min(frame, c.start + c.dur - 1) - c.start) * 1000 / fps) * (c.speed || 1)) / 1000;
          if (live && T.isPlaying()) {
            if (d.el.paused) d.el.play().catch(() => {});
            if (Math.abs(d.el.currentTime - want) > 0.35) d.el.currentTime = want;
          } else {
            if (!d.el.paused) d.el.pause();
            if (d.el.readyState >= 1 && Math.abs(d.el.currentTime - want) > 0.02) { try { d.el.currentTime = want; } catch { /* seek */ } }
          }
          d.el.playbackRate = Math.min(4, Math.max(0.25, c.speed || 1));
        }
      }
      drawFrame(ctx, p, frame, new Map([...decoders.current].map(([k, d]) => [k, { el: d.el, ok: d.ok }])), env);
      // selection outline
      const sel = selectionRef.current;
      const box = boxRef.current;
      let ol = box.querySelector('.pv-canvas-sel');
      const base = p.clips.find(c => sel?.has(c.id) && frame >= c.start && frame < c.start + c.dur && c.track[0] === 'V');
      if (base && ol) { ol.style.display = 'block'; }
      else if (ol) ol.style.display = 'none';
      syncAudio(p, frame, T.isPlaying(), false);
    };

    const detach = T.attach({ sync: (frame, playing, force) => { syncAudio(projRef.current, frame, playing, force); requestDraw(); if (force) paint(); } });
    T.subscribe(requestDraw);
    paint();
    const iv = setInterval(prune, 4000);
    return () => { detach(); clearInterval(iv); cancelAnimationFrame(raf); stopAll(); for (const d of decoders.current.values()) { d.el.pause?.(); } decoders.current.clear(); };
  }, [project?.id, w, h]); // eslint-disable-line

  // redraw when project content changes while paused
  useEffect(() => { requestAnimationFrame(() => window.dispatchEvent(new Event('ff-redraw'))); }, [project]);
  useEffect(() => {
    const f = () => cvRef.current && cvRef.current.dispatchEvent(new Event('redraw'));
    window.addEventListener('ff-redraw', f);
    return () => window.removeEventListener('ff-redraw', f);
  }, []);

  return (
    <div className="pv-stage">
      <div className={`pv-frame ${selectedIds?.size ? 'has-sel' : ''}`} ref={boxRef} style={{ aspectRatio: `${w} / ${h}`, '--parw': w / h }}>
        <canvas ref={cvRef} width={w} height={h} className="pv-canvas" />
        <div className="pv-canvas-sel" />
        {!project.clips.some(c => c.track[0] === 'V') && <div className="pv-empty"><b>Nothing on the timeline yet</b><span>Drop clips here, add a title, or ask your connected AI to start.</span></div>}
      </div>
    </div>
  );
}
