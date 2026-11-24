// Quality control against the cash-cow editing rules (gaps, 5 s cap, reuse, source limits, sync, footage ratio...).
import { FPS, frameToMs } from './lib.mjs';
import { projectFrames, sortedTrack, clipEnd, voiceClip } from './project.mjs';
import { videoId } from './youtube.mjs';

export function runQC(p) {
  const issues = [];
  const add = (severity, rule, message, clipIds = []) => issues.push({ severity, rule, message, clipIds });
  const total = projectFrames(p);
  const v1 = sortedTrack(p, 'V1');
  const video = v1.filter(c => c.type === 'video' || c.type === 'image');

  if (!voiceClip(p)) add('error', 'voiceover', 'No voiceover on A1. The voice defines the timeline.');
  if (!p.transcript) add('warn', 'transcript', 'Voiceover has not been transcribed/locked yet.');
  if (!v1.length) add('error', 'coverage', 'Footage track V1 is empty.');

  // coverage: no gaps, nothing past the end of the voice
  let cursor = 0;
  for (const c of v1) {
    if (c.start > cursor) add('error', 'gap', `Gap of ${((c.start - cursor) / FPS).toFixed(2)}s before “${c.label || c.id}” at ${(cursor / FPS).toFixed(2)}s.`, [c.id]);
    if (c.start < cursor) add('error', 'overlap', `Clip “${c.label || c.id}” overlaps the previous clip by ${((cursor - c.start) / FPS).toFixed(2)}s.`, [c.id]);
    cursor = Math.max(cursor, clipEnd(c));
  }
  if (v1.length && cursor < total) add('error', 'gap', `Footage ends ${((total - cursor) / FPS).toFixed(2)}s before the voiceover ends.`);
  if (cursor > total && total) add('error', 'tail', `Footage runs ${((cursor - total) / FPS).toFixed(2)}s past the voiceover end (no visual tail allowed).`);
  for (const c of p.clips) if (total && clipEnd(c) > total + 1 && c.track !== 'A1') add('error', 'tail', `“${c.label || c.id}” on ${c.track} extends past the voiceover end.`, [c.id]);

  // 5 second ceiling and pacing
  for (const c of video) if (c.dur > 5 * FPS) add('error', 'max-length', `“${c.label || c.id}” is ${(c.dur / FPS).toFixed(2)}s (limit 5.0s).`, [c.id]);
  if (video.length) {
    const avg = (a, b) => { const s = video.filter(c => c.start >= a * FPS && c.start < b * FPS); return s.length ? s.reduce((x, c) => x + c.dur, 0) / s.length / FPS : null; };
    const a30 = avg(0, 30), a120 = avg(30, 120), aRest = avg(120, 1e6);
    if (a30 != null && (a30 < 2.2 || a30 > 3.9)) add('warn', 'pacing', `First 30s average ${a30.toFixed(2)}s per visual (target 2.8–3.5s).`);
    if (a120 != null && (a120 < 2.6 || a120 > 4.2)) add('warn', 'pacing', `0:30–2:00 average ${a120.toFixed(2)}s per visual (target 3.0–3.8s).`);
    if (aRest != null && (aRest < 3.0 || aRest > 4.8)) add('warn', 'pacing', `After 2:00 average ${aRest.toFixed(2)}s per visual (target 3.4–4.3s).`);
  }

  // source rules: reuse, max 3 per video, never consecutive from one video
  const byVideo = new Map();
  let prevVid = null, prevClip = null;
  for (const c of v1) {
    const vid = c.source?.url ? videoId(c.source.url) : null;
    if (vid) {
      if (!byVideo.has(vid)) byVideo.set(vid, []);
      byVideo.get(vid).push(c);
      if (prevVid === vid) add('error', 'consecutive-source', `“${c.label || c.id}” follows another clip from the same YouTube video; put a different clip between them.`, [c.id, prevClip.id]);
    }
    prevVid = vid; prevClip = c;
  }
  for (const [vid, list] of byVideo) {
    if (list.length > 3) add('error', 'source-limit', `Video ${vid} is used ${list.length} times (max 3).`, list.map(c => c.id));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].source, b = list[j].source;
      if (a.inMs < b.outMs && b.inMs < a.outMs) add('error', 'reuse', `Two clips use overlapping moments of YouTube video ${vid} (${(a.inMs / 1000).toFixed(1)}s and ${(b.inMs / 1000).toFixed(1)}s).`, [list[i].id, list[j].id]);
    }
  }

  // footage ratio >= 85% real YouTube motion
  const totalV1 = v1.reduce((s, c) => s + c.dur, 0);
  const footage = v1.filter(c => c.type === 'video' && c.source?.url).reduce((s, c) => s + c.dur, 0);
  const ratio = totalV1 ? footage / totalV1 : 0;
  if (totalV1 && ratio < 0.85) add('warn', 'footage-ratio', `Only ${(ratio * 100).toFixed(0)}% of the runtime is YouTube motion footage (target ≥ 85%).`);
  const stills = v1.filter(c => c.type === 'image').length;
  if (stills > Math.max(3, v1.length * 0.1)) add('warn', 'slideshow', `${stills} still images on V1. Use stills only for essential evidence.`);

  // sync of clips to beats
  let syncMax = 0, synced = 0;
  for (const b of p.beats) {
    const c = v1.find(x => x.beatId === b.id);
    if (!c) { add('warn', 'beat-uncovered', `Beat ${b.id} (“${b.text.slice(0, 40)}…”) has no clip.`); continue; }
    const err = Math.abs(c.start - b.startFrame);
    syncMax = Math.max(syncMax, err); synced++;
    if (err > 1) add('error', 'sync', `Clip for beat ${b.id} starts ${(err / FPS * 1000).toFixed(0)}ms away from its first word.`, [c.id]);
  }

  // overlays must live inside their spoken range
  for (const c of p.clips.filter(x => x.type === 'text' && x.beatId)) {
    const b = p.beats.find(x => x.id === c.beatId);
    if (b && (c.start < b.startFrame - 1 || clipEnd(c) > b.endFrame + 1)) add('warn', 'overlay-timing', `Overlay “${c.text?.title || c.id}” leaves the spoken range of beat ${b.id}.`, [c.id]);
  }

  // hook
  const first = v1[0];
  if (first && first.start !== 0) add('error', 'hook', 'The first visual must start at 00:00.000.');
  const interrupts = p.clips.filter(c => c.start < 30 * FPS && c.start > 5 * FPS && (c.track === 'V2' || (c.transition && c.transition.type !== 'cut'))).length;
  if (total > 30 * FPS && interrupts < 2) add('warn', 'hook', `Only ${interrupts} pattern interrupt(s) in 0:05–0:30 (target 2–3).`);

  // licensing
  const unknown = new Set();
  for (const c of v1) if (c.source?.url && !/creative commons|public domain/i.test(c.source.license || '')) unknown.add(videoId(c.source.url));
  if (unknown.size) add('info', 'license', `${unknown.size} source video(s) have no confirmed reuse license — flagged in the sources list for your review.`);

  // audio
  for (const c of p.clips.filter(x => x.track === 'A2')) if ((c.volume ?? 1) > 0.5) add('warn', 'music-level', 'Music clip volume is high; keep music 28–32 dB under the voice.', [c.id]);

  const errors = issues.filter(i => i.severity === 'error').length;
  const warns = issues.filter(i => i.severity === 'warn').length;
  return {
    pass: errors === 0,
    errors, warnings: warns, issues,
    stats: {
      durationMs: frameToMs(total), visualSegments: video.length,
      avgSegmentSec: video.length ? +(totalV1 / video.length / FPS).toFixed(2) : 0,
      maxSegmentSec: video.length ? +(Math.max(...video.map(c => c.dur)) / FPS).toFixed(2) : 0,
      youtubeFootagePct: +(ratio * 100).toFixed(1), stillImages: stills, uniqueSourceVideos: byVideo.size,
      beats: p.beats.length, beatsCovered: synced, maxSyncErrorFrames: syncMax,
      overlays: p.clips.filter(c => c.track === 'V2').length,
    },
  };
}
