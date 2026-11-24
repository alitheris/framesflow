// Deliverables: timeline log, transcript/timing record, sources list, QC + retention report.
import fs from 'node:fs';
import path from 'node:path';
import { FPS, frameToMs, msToFrame, safeName, fmtTime } from './lib.mjs';
import { rendersDir } from './store.mjs';
import { sortedTrack, projectFrames, clipEnd } from './project.mjs';
import { runQC } from './qc.mjs';
import { videoId } from './youtube.mjs';
import { creditLine } from '../shared/brand.mjs';

const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function timelineRows(p) {
  const rows = [];
  for (const c of p.clips.filter(c => c.track === 'V1' || c.track === 'V2').sort((a, b) => a.start - b.start)) {
    const b = p.beats.find(x => x.id === c.beatId);
    rows.push({
      clip_id: c.id, track: c.track, final_start_ms: frameToMs(c.start), final_end_ms: frameToMs(c.start + c.dur), final_start_frame: c.start, final_end_frame: c.start + c.dur,
      duration_ms: frameToMs(c.dur), sentence_id: b?.sentenceId || '', phrase_or_words_matched: b?.text || '', first_word_start_ms: b?.firstWordMs ?? '', last_word_end_ms: b?.lastWordMs ?? '',
      visual_keywords: b ? b.keywords.map(k => k.text).join('; ') : '', YouTube_search_query: c.source?.query || '', source_video_title: c.source?.title || '', source_channel: c.source?.channel || '',
      source_url: c.source?.url || '', source_in_ms: c.source?.inMs ?? '', source_out_ms: c.source?.outMs ?? '', type: c.type === 'text' ? `overlay:${c.text?.kind}` : c.source?.url ? 'youtube-footage' : c.type,
      transition_used: c.transition?.type || 'cut', sync_error_ms: b && c.track === 'V1' ? Math.round(Math.abs(frameToMs(c.start) - b.startMs)) : '',
    });
  }
  return rows;
}

export function sourcesText(p) {
  const by = new Map();
  for (const c of sortedTrack(p, 'V1')) {
    if (!c.source?.url) continue;
    const id = videoId(c.source.url);
    if (!by.has(id)) by.set(id, { ...c.source, uses: [] });
    by.get(id).uses.push({ q: c.source.query, src: [c.source.inMs, c.source.outMs], final: [frameToMs(c.start), frameToMs(c.start + c.dur)] });
  }
  const lines = [`SOURCES — ${p.name}`, `Generated ${new Date().toISOString()}`, ''];
  const flagged = [];
  for (const [id, s] of by) {
    const confirmed = /creative commons|public domain/i.test(s.license || '');
    if (!confirmed) flagged.push(s);
    lines.push(`${s.title}`, `  Channel: ${s.channel}`, `  URL: ${s.url}`, `  License: ${s.license || 'unknown'}${confirmed ? '' : '  ⚠ NOT CONFIRMED'}`);
    for (const u of s.uses) lines.push(`  Used: source ${fmtTime(u.src[0])}–${fmtTime(u.src[1])}  →  final ${fmtTime(u.final[0])}–${fmtTime(u.final[1])}${u.q ? `   (query: ${u.q})` : ''}`);
    lines.push('');
  }
  // web images (Openverse): credit every image that is actually on the timeline, original source for cut-outs
  const imgs = new Map();
  for (const c of p.clips) {
    let a = p.assets[c.assetId];
    if (a?.cutoutOf && p.assets[a.cutoutOf]) a = { ...p.assets[a.cutoutOf], name: a.name };
    if (a?.source?.type !== 'web-image') continue;
    if (!imgs.has(a.source.url)) imgs.set(a.source.url, { ...a.source, at: [] });
    imgs.get(a.source.url).at.push(fmtTime(frameToMs(c.start)));
  }
  if (imgs.size) {
    lines.push('IMAGES', '');
    for (const s of imgs.values()) lines.push(`${s.title || 'Image'}`, `  Creator: ${s.creator || 'unknown'}`, `  License: ${s.license || 'unknown'}${s.licenseUrl ? ` (${s.licenseUrl})` : ''}`, `  Page: ${s.landingUrl || s.url}`, ...(s.attribution ? [`  Credit line: ${s.attribution}`] : []), `  Used at: ${s.at.join(', ')}`, '');
    lines.push(`${imgs.size} images. Many licences (e.g. CC BY) require you to credit the creator in the video description.`, '');
  }
  lines.push(creditLine(), '');
  lines.push(`${by.size} source videos. ${flagged.length} have no confirmed reuse license — review before publishing (editing, cropping or grading does not by itself make footage fair use).`);
  return lines.join('\n');
}

export function reportMarkdown(p, render) {
  const qc = runQC(p);
  const chapters = p.chapters.map(c => `- ${fmtTime(c.startMs)} — ${c.title}`).join('\n') || '- (none set)';
  const flagged = new Set(p.clips.filter(c => c.source?.url && !/creative commons|public domain/i.test(c.source.license || '')).map(c => videoId(c.source.url))).size;
  return `# Retention & QC report — ${p.name}

**Duration:** ${fmtTime(frameToMs(projectFrames(p)))} · **Voice end:** ${p.transcript ? p.transcript.voiceEndMs + ' ms' : 'n/a'} · **Timing engine:** ${p.transcript?.engine || 'n/a'}

## Chapters
${chapters}

## Numbers
- Visual segments: ${qc.stats.visualSegments} (average ${qc.stats.avgSegmentSec}s, longest ${qc.stats.maxSegmentSec}s)
- YouTube motion footage: ${qc.stats.youtubeFootagePct}% · stills: ${qc.stats.stillImages} · overlays: ${qc.stats.overlays}
- Unique source videos: ${qc.stats.uniqueSourceVideos}
- Beats covered: ${qc.stats.beatsCovered}/${qc.stats.beats} · max sync error: ${qc.stats.maxSyncErrorFrames} frame(s)
${render ? `\n## Technical verification\n- ${render.resolution}, ${render.fps} fps, ${render.videoCodec}, ${render.audio}\n- Duration ${render.durationSec.toFixed(3)}s vs expected ${render.expectedSec}s (drift ${render.driftMs} ms)\n- Loudness: ${render.loudness ? `${render.loudness.integrated} LUFS, true peak ${render.loudness.truePeak} dBTP` : 'n/a'}\n` : ''}
## Rule check
${qc.pass ? '✅ No blocking errors.' : `❌ ${qc.errors} error(s).`} ${qc.warnings} warning(s).
${qc.issues.map(i => `- [${i.severity}] ${i.rule}: ${i.message}`).join('\n') || '- nothing to report'}

## Confirmations
- No subtitles or captions were added (the transcript file is an editing record only).
- Only YouTube footage and editor-created graphics were used; no stock-site assets.
- ${flagged} source video(s) lack a confirmed reuse license — see sources.txt.

## Title ideas
${(p.meta.titleIdeas || []).map((t, i) => `${i + 1}. ${t}`).join('\n') || '_not provided yet — set with set_metadata_'}

## Thumbnail text
${(p.meta.thumbnailIdeas || []).map((t, i) => `${i + 1}. ${t}`).join('\n') || '_not provided yet — set with set_metadata_'}
`;
}

export function exportPackage(p, { renderInfo } = {}) {
  const dir = path.join(rendersDir(p.id), safeName(p.name) + '_package');
  fs.mkdirSync(dir, { recursive: true });
  const rows = timelineRows(p);
  const cols = Object.keys(rows[0] || { clip_id: '' });
  fs.writeFileSync(path.join(dir, 'timeline_log.csv'), [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n'));
  fs.writeFileSync(path.join(dir, 'timeline_log.json'), JSON.stringify(rows, null, 2));
  if (p.transcript) {
    fs.writeFileSync(path.join(dir, 'transcript_timing.json'), JSON.stringify({
      note: 'Editing record only — not a subtitle file.', engine: p.transcript.engine, voiceEndMs: p.transcript.voiceEndMs, fps: FPS,
      words: p.transcript.words.map(w => ({ word: w.w, start_ms: w.s, end_ms: w.e, start_frame: msToFrame(w.s), end_frame: msToFrame(w.e) })),
      sentences: p.transcript.sentences, beats: p.beats.map(b => ({ id: b.id, sentenceId: b.sentenceId, text: b.text, first_word_start_ms: b.firstWordMs, last_word_end_ms: b.lastWordMs, visual_start_ms: b.startMs, visual_end_ms: b.endMs, start_frame: b.startFrame, end_frame: b.endFrame })),
    }, null, 2));
  }
  fs.writeFileSync(path.join(dir, 'sources.txt'), sourcesText(p));
  fs.writeFileSync(path.join(dir, 'retention_qc_report.md'), reportMarkdown(p, renderInfo));
  return { dir, files: fs.readdirSync(dir) };
}
