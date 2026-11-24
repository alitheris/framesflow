// Playback clock for the studio. Lives outside React so scrubbing/playing never re-renders the whole app.
import { useSyncExternalStore } from 'react';

let project = null;
let frame = 0, playing = false, t0 = 0, f0 = 0, raf = 0, rate = 1;
const subs = new Set();
let driver = null;
export const attach = d => { driver = d; return () => { if (driver === d) driver = null; }; };
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
export const getFrame = () => frame;
export const isPlaying = () => playing;
export const fps = () => project?.settings?.fps || 30;
export const setProject = p => {
  const oldFps = project?.settings?.fps;
  project = p;
  if (oldFps && p?.settings?.fps && oldFps !== p.settings.fps) frame = Math.round(frame * p.settings.fps / oldFps);
  if (frame > total()) frame = Math.max(0, total());
  driver?.sync(frame, playing, true);
};
export const total = () => (project ? totalFramesOf(project) : 0);
const totalFramesOf = p => {
  const fps = p.settings?.fps || 30;
  if (p.settings?.voiceLock && p.transcript?.voiceEndMs) return Math.round(p.transcript.voiceEndMs * fps / 1000);
  const voice = p.clips.filter(c => c.track === 'A1' && c.assetId).sort((a, b) => a.start - b.start)[0];
  const end = Math.max(0, ...p.clips.map(c => c.start + c.dur));
  return Math.max(voice ? voice.start + voice.dur : 0, end);
};

const notify = () => subs.forEach(f => f(frame, playing));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// rAF stalls in background/occluded webviews — a watchdog keeps playback moving (at reduced
// smoothness) even when requestAnimationFrame is suspended.
let watchdog = null, lastTickAt = 0;
function startLoop() {
  pauseLoop();
  lastTickAt = performance.now();
  const step = now => { lastTickAt = now; tick(now); if (playing) raf = requestAnimationFrame(step); };
  raf = requestAnimationFrame(step);
  watchdog = setInterval(() => { if (playing && performance.now() - lastTickAt > 120) tick(performance.now()); }, 60);
}
function pauseLoop() { cancelAnimationFrame(raf); clearInterval(watchdog); watchdog = null; }

function tick(now) {
  if (!playing) return;
  frame = f0 + ((now - t0) * fps() * rate) / 1000;
  if (frame >= total()) { frame = total(); pause(); return; }
  if (frame < 0) { frame = 0; pause(); return; }
  driver?.sync(frame, true, false);
  notify();
}

export function seek(f, { keepPlaying = true } = {}) {
  frame = clamp(Math.round(f), 0, total());
  if (playing) { t0 = performance.now(); f0 = frame; if (!keepPlaying) pause(); }
  driver?.sync(frame, playing, true);
  notify();
}
export function play() {
  if (playing || !total()) return;
  if (frame >= total() - 1) frame = 0;
  playing = true; t0 = performance.now(); f0 = frame;
  startLoop();
  driver?.sync(frame, true, true); notify();
}
export function pause() { if (!playing) return; playing = false; pauseLoop(); rate = 1; driver?.sync(frame, false, true); notify(); }
export const toggle = () => (playing ? pause() : play());
export const step = d => { pause(); seek(frame + d); };
/** J/K/L shuttle: negative plays backwards via re-seeking each tick. */
export function shuttle(dir) {
  if (dir === 0) return pause();
  if (dir < 0) { // reverse playback by stepping (video elements can't play backwards)
    pause(); playing = true; t0 = performance.now(); f0 = frame; rate = -1; startLoop(); notify();
  } else { if (playing && rate >= 1) { rate = Math.min(4, rate * 2); t0 = performance.now(); f0 = frame; } else { pause(); rate = 1; play(); } }
}

export const useFrame = () => useSyncExternalStore(subscribe, () => Math.floor(frame));
export const usePlaying = () => useSyncExternalStore(subscribe, () => playing);
