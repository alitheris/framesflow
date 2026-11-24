// The tool registry. One definition feeds MCP (stdio + HTTP), the REST API used by the studio UI, and autopilot.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { APP_ROOT, FPS, HOME, msToFrame, frameToMs, capabilities, fmtTime, uid } from './lib.mjs';
import { store, assetsDir, projectDir } from './store.mjs';
import { summarize, projectFrames, voiceClip, checkClip, defaultClip, GRADES, TRANSITIONS, sortedTrack, clipEnd } from './project.mjs';
import { importFile } from './media.mjs';
import * as yt from './youtube.mjs';
import { transcribe, detectEngine } from './transcribe.mjs';
import { buildBeats, defaultChapters, extractKeywords, queriesFor } from './beats.mjs';
import { placeClip, addOverlay, patchClips, splitClip, beatOf } from './timeline.mjs';
import {
  opPlaceClip, opAddText, opPatchClips, opSplitClip, opDeleteClips, opDuplicateClips, opAddClipsRaw,
  opAddTrack, opRemoveTrack, opReorderTracks, opSetTrack, opSetMarkers, opAddMarker,
  opApplyEffect, opUpdateEffect, opRemoveEffect, opClearEffects, opSetKeyframes, opClearKeyframes,
  opAddEffectLayer, opSetEffectKeyframes, opClearEffectKeyframes, opDetachAudio,
  opSetTextStyle, opSetProjectFormat, opApplyLook, opClearTimeline, opMoveClip, opTrimClip,
  opSetMask, opAddAnimation, opSetPlan,
} from '../shared/ops.mjs';
import { TRANSITIONS as TRANSITION_DEFS, EFFECTS as EFFECT_DEFS, TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_FONTS, TEXT_KINDS, TEXT_POSITIONS, KEYFRAMABLE, FORMATS, FPS_OPTIONS, EFFECT_KEYFRAMABLE } from '../shared/model.mjs';
import { runQC } from './qc.mjs';
import { jobs } from './jobs.mjs';
import { renderProject } from './render.mjs';
import { runAutopilot, scoreCandidate, pickMoment } from './autopilot.mjs';
import { exportPackage } from './exporter.mjs';
import * as images from './images.mjs';
import { removeBackground } from './bgremove.mjs';
import os from 'node:os';
import { renderAnimation, snapshotAnimation, fillVars, lintHtml, MAX_ANIM_MS } from './htmlanim.mjs';
import { ANIMATION_TEMPLATES, templateById, templateDefaults } from './animtemplates.mjs';

export const DIRECTOR_PROMPT = fs.readFileSync(path.join(APP_ROOT, 'server', 'director.md'), 'utf8');
export const tools = [];
const def = (name, description, shape, handler, opts = {}) => tools.push({ name, description, shape, handler, ...opts });
const P = () => store.project;
const by = ctx => (ctx?.by === 'ui' ? 'ui' : 'mcp');
const cause = (ctx, tool, extra = {}) => ({ by: by(ctx), tool, ...extra });
const ms = z.number().int().min(0).describe('milliseconds');
const trackId = z.string().describe('track id, e.g. V1, V2, A1 or an added track like V3/A4');
const compactBeat = b => ({ id: b.id, startMs: b.startMs, endMs: b.endMs, durMs: b.endMs - b.startMs, text: b.text, firstWordMs: b.firstWordMs, lastWordMs: b.lastWordMs, keywords: b.keywords.map(k => `${k.text} (${k.type})`), queries: b.queries, emotion: b.emotion || undefined, visual: b.visual || undefined, factOverlay: b.factOverlay || undefined, chapter: b.chapter || undefined, covered: P().clips.some(c => c.track === 'V1' && c.beatId === b.id) });
/** Recompute beat frames from ms so beats stay exact on any project fps. */
const fixBeatFrames = p => { const fps = p.settings?.fps || 30; for (const b of p.beats) { b.startFrame = msToFrame(b.startMs, fps); b.endFrame = msToFrame(b.endMs, fps); } };

/** Wait up to softMs for a job promise; otherwise hand back the job so the AI can poll get_job (avoids client timeouts). */
async function soft(handle, promise, softMs = 55000) {
  const pr = promise.then(r => { handle.done(r); return r; }, e => { handle.fail(e); throw e; });
  pr.catch(() => {});
  const winner = await Promise.race([pr.then(r => ({ r })), new Promise(res => setTimeout(() => res(null), softMs))]);
  if (winner) return winner.r;
  return { running: true, jobId: handle.job.id, hint: 'Still working. Call get_job with this jobId to follow progress.' };
}

// ------------------------------------------------------------------ status & project
def('get_status', 'Check the studio: ffmpeg, yt-dlp and Whisper availability, studio URL and the open project. Call this first.', {}, async () => {
  const { ffmpeg: ff, ytdlp: yd, whisper: w } = await capabilities();
  return { ffmpeg: ff, ytdlp: yd, whisper: w.ok ? { ok: true } : { ok: false, install: 'pip install openai-whisper' }, studioUrl: `http://127.0.0.1:${process.env.PORT || 4317}`, project: summarize(P(), { clips: false }), workspace: HOME };
});

def('get_editor_rules', 'Return the full faceless-YouTube editing ruleset (roles, footage rules, pacing, hook, transitions, audio, QC, deliverables). Read once at the start of a production.', {}, async () => ({ rules: DIRECTOR_PROMPT }));

def('get_project', 'Full timeline state: settings, tracks, assets and every clip with frame/ms positions and YouTube sources.', { clips: z.boolean().default(true), limit: z.number().int().default(400) }, async a => summarize(P(), { clips: a.clips, limit: a.limit }));

def('list_projects', 'List saved projects.', {}, async () => ({ projects: store.list(), open: P().id }));
def('create_project', 'Create a new empty project and open it in the studio.', { name: z.string().min(1).max(120), niche: z.string().optional(), topic: z.string().optional() }, async (a, ctx) => {
  store.create(a.name);
  store.mutate(cause(ctx, 'create_project', { summary: `New project “${a.name}”` }), p => { if (a.niche) p.settings.niche = a.niche; if (a.topic) p.settings.topic = a.topic; }, { history: false });
  return summarize(P(), { clips: false });
});
def('open_project', 'Open a saved project by id.', { id: z.string() }, async a => { store.open(a.id); return summarize(P(), { clips: false }); });

def('update_project', 'Change project name, script, niche/topic (used to refine YouTube queries), colour grade preset, accent colour or music level.', {
  name: z.string().optional(), script: z.string().optional(), niche: z.string().optional(), topic: z.string().optional(),
  grade: z.enum(Object.keys(GRADES)).optional(), accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), musicDb: z.number().min(-50).max(-10).optional(), loudness: z.number().min(-24).max(-8).optional(),
}, async (a, ctx) => {
  store.mutate(cause(ctx, 'update_project', { summary: 'Updated project settings' }), p => {
    if (a.name) p.name = a.name; if (a.script != null) p.script = a.script;
    for (const k of ['niche', 'topic', 'grade', 'accent', 'musicDb', 'loudness']) if (a[k] != null) p.settings[k] = a[k];
  });
  return summarize(P(), { clips: false });
});
def('set_script', 'Store the full script text. It is the source of truth for spelling, names, dates and numbers while the audio controls timing.', { script: z.string().min(1), title: z.string().optional(), niche: z.string().optional(), topic: z.string().optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'set_script', { summary: `Script set (${a.script.split(/\s+/).length} words)` }), p => { p.script = a.script; if (a.title) p.name = a.title; if (a.niche) p.settings.niche = a.niche; if (a.topic) p.settings.topic = a.topic; });
  return { words: a.script.split(/\s+/).length };
});
def('set_metadata', 'Save the five title ideas and five thumbnail texts (included in the QC report).', { titleIdeas: z.array(z.string()).max(10).optional(), thumbnailIdeas: z.array(z.string()).max(10).optional(), notes: z.string().optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'set_metadata', { summary: 'Saved title/thumbnail ideas' }), p => { Object.assign(p.meta, Object.fromEntries(Object.entries(a).filter(([, v]) => v != null))); });
  return { ok: true };
});
def('undo', 'Undo the last edit.', {}, async () => ({ undone: store.undo() }));
def('redo', 'Redo.', {}, async () => ({ redone: store.redo() }));

// ------------------------------------------------------------------ media
def('list_assets', 'List library assets (video, audio, images) with ids you can place.', {}, async () => ({ assets: Object.values(P().assets).map(a => ({ id: a.id, kind: a.kind, name: a.name, durationMs: a.duration, size: `${a.width}x${a.height}`, source: a.source?.url })) }));
def('delete_assets', 'Remove assets from the library (their files too). unused:true removes everything not placed on the timeline.', { ids: z.array(z.string()).optional(), unused: z.boolean().default(false) }, async (a, ctx) => {
  const p = P();
  const used = new Set(p.clips.map(c => c.assetId));
  const ids = a.unused ? Object.keys(p.assets).filter(id => !used.has(id)) : (a.ids || []).filter(id => !used.has(id));
  const files = ids.flatMap(id => { const x = p.assets[id]; return x ? [x.file, x.thumbs?.file, x.peaks?.file].filter(Boolean) : []; });
  store.mutate(cause(ctx, 'delete_assets', { summary: `Removed ${ids.length} unused asset(s)` }), d => { for (const id of ids) delete d.assets[id]; });
  for (const f of files) fs.rmSync(path.join(assetsDir(p.id), f), { force: true });
  return { removed: ids.length, kept: (a.ids || []).length - ids.length };
}, { ui: true });
def('import_media', 'Copy a local file (video, audio or image) into the project library. Optionally place it on the timeline.', {
  path: z.string().describe('absolute path on this computer'), name: z.string().optional(), track: trackId.optional(), startMs: ms.optional(), durMs: ms.optional(),
  audio: z.boolean().optional().describe('For videos that have sound: true = play the video’s own audio on the timeline, false = import it silent. ASK THE USER which one they want. The sound can still be separated later with detach_audio.'),
}, async (a, ctx) => {
  const asset = await importFile(path.resolve(a.path), { name: a.name, cause: cause(ctx, 'import_media'), useAudio: a.audio });
  let clip = null;
  if (a.track) clip = await placeClip({ assetId: asset.id, track: a.track, startMs: a.startMs ?? 0, durMs: a.durMs, allowLong: true, replace: false }, cause(ctx, 'import_media'));
  return { asset: { id: asset.id, kind: asset.kind, name: asset.name, durationMs: asset.duration, hasAudio: !!asset.hasAudio, audioOn: !!asset.useAudio }, clipId: clip?.id };
});
export function setAsVoiceover(asset, ctx = { by: 'ui' }) {
  if (asset.kind !== 'audio' && !asset.hasAudio) throw new Error('That file has no audio.');
  const clip = defaultClip(P(), { track: 'A1', type: 'audio', assetId: asset.id, start: 0, dur: msToFrame(asset.duration), in: 0, label: 'Voiceover' });
  store.mutate(cause(ctx, 'import_voiceover', { summary: `Voiceover on A1 (${fmtTime(asset.duration)})`, clipIds: [clip.id] }), p => { p.clips = p.clips.filter(c => c.track !== 'A1'); p.clips.push(checkClip(p, clip)); p.transcript = null; p.beats = []; p.chapters = []; });
  return { assetId: asset.id, durationMs: asset.duration };
}
def('import_voiceover', 'Import the voiceover audio, put it on A1 at 0:00 (replacing any previous voiceover). Next: transcribe_voiceover.', { path: z.string() }, async (a, ctx) => {
  const asset = await importFile(path.resolve(a.path), { name: 'Voiceover', cause: cause(ctx, 'import_voiceover') });
  return setAsVoiceover(asset, ctx);
});
def('use_asset_as_voiceover', 'Use an asset already in the library as the voiceover (A1).', { assetId: z.string() }, async (a, ctx) => {
  const asset = P().assets[a.assetId]; if (!asset) throw new Error('Unknown asset');
  return setAsVoiceover(asset, ctx);
}, { ui: true });

// ------------------------------------------------------------------ transcript & beats
def('transcribe_voiceover', 'Word-level timestamps for the voiceover (Whisper if installed, script-aligned otherwise), then locks the timeline length to the voice end and builds visual beats. Long audio may return a jobId: poll get_job.', {
  language: z.string().optional().describe('e.g. en'), model: z.string().optional().describe('Whisper model: tiny, base, small, medium, large'), engine: z.enum(['auto', 'estimate']).default('auto'), topic: z.string().optional(),
}, async (a, ctx) => {
  const v = voiceClip(P());
  if (!v) throw new Error('Import a voiceover first (import_voiceover).');
  const file = path.join(assetsDir(P().id), P().assets[v.assetId].file);
  const handle = jobs.create('transcribe', 'Transcribing voiceover', { projectId: P().id });
  const run = (async () => {
    const t = await transcribe(file, { script: P().script, language: a.language, model: a.model, engine: a.engine, onLine: l => handle.update({}, l) });
    const beats = (() => { const p = P(); return buildBeats(t, { topic: a.topic || p.settings.topic || p.settings.niche }); })();
    store.mutate(cause(ctx, 'transcribe_voiceover', { summary: `Transcript locked: ${t.words.length} words, ${t.sentences.length} sentences, ${beats.length} beats (${t.engine})` }), p => {
      p.transcript = t; p.beats = beats; p.chapters = defaultChapters(beats, t.voiceEndMs, p.script);
      const voice = voiceClip(p); if (voice) voice.dur = Math.max(1, msToFrame(t.voiceEndMs, p.settings?.fps || 30) - voice.start);
      fixBeatFrames(p);
    });
    return { engine: t.engine, words: t.words.length, sentences: t.sentences.length, beats: beats.length, voiceEndMs: t.voiceEndMs, voiceEnd: fmtTime(t.voiceEndMs), notes: t.notes };
  })();
  return soft(handle, run, 50000);
});

def('set_transcript', 'Provide your own word timings (e.g. from an external Whisper run). Words: [{w, s, e}] in ms. Rebuilds sentences and beats.', {
  words: z.array(z.object({ w: z.string(), s: z.number(), e: z.number() })).min(1), voiceEndMs: ms.optional(), topic: z.string().optional(),
}, async (a, ctx) => {
  const { buildSentences } = await import('./transcribe.mjs');
  const words = a.words.map(x => ({ w: x.w, s: Math.round(x.s), e: Math.round(x.e) }));
  const t = { engine: 'external', words, sentences: buildSentences(words), voiceEndMs: a.voiceEndMs ?? words[words.length - 1].e, notes: [], createdAt: Date.now() };
  const beats = buildBeats(t, { topic: a.topic || P().settings.topic });
  store.mutate(cause(ctx, 'set_transcript', { summary: `Transcript set: ${words.length} words, ${beats.length} beats` }), p => { p.transcript = t; p.beats = beats; p.chapters = defaultChapters(beats, t.voiceEndMs, p.script); });
  return { words: words.length, beats: beats.length, voiceEndMs: t.voiceEndMs };
});

def('get_transcript', 'Sentences with ms timings (set words:true for every word).', { words: z.boolean().default(false), from: z.number().int().default(0), limit: z.number().int().default(200) }, async a => {
  const t = P().transcript; if (!t) throw new Error('No transcript yet.');
  return { engine: t.engine, voiceEndMs: t.voiceEndMs, notes: t.notes, sentences: t.sentences.slice(a.from, a.from + a.limit).map(s => ({ id: s.id, startMs: s.s, endMs: s.e, text: s.text })), ...(a.words ? { words: t.words.slice(0, 5000) } : {}) };
});

def('build_beats', 'Re-segment the transcript into visual beats (≤5 s each, paced for retention). Resets beat notes; existing clips keep their beatId only if ids still exist.', { topic: z.string().optional() }, async (a, ctx) => {
  const t = P().transcript; if (!t) throw new Error('Transcribe first.');
  const beats = buildBeats(t, { topic: a.topic || P().settings.topic });
  store.mutate(cause(ctx, 'build_beats', { summary: `Built ${beats.length} visual beats` }), p => { p.beats = beats; p.chapters = defaultChapters(beats, t.voiceEndMs, p.script); fixBeatFrames(p); });
  return { beats: beats.length, avgSec: +(beats.reduce((s, b) => s + (b.endMs - b.startMs), 0) / beats.length / 1000).toFixed(2) };
});

def('get_beats', 'The sentence visual map: every beat with exact ms window, spoken text, keywords, suggested YouTube queries, notes and whether it has a clip.', { from: z.number().int().default(0), limit: z.number().int().default(60), onlyUncovered: z.boolean().default(false) }, async a => {
  let list = P().beats.map(compactBeat); if (a.onlyUncovered) list = list.filter(b => !b.covered);
  return { total: P().beats.length, uncovered: P().beats.filter(b => !compactBeat(b).covered).length, beats: list.slice(a.from, a.from + a.limit) };
});

def('update_beat', 'Save your director notes on a beat: meaning/visual idea, emotion, better search queries, keywords, whether it needs a fact overlay — or just edit its text.', {
  id: z.string(), text: z.string().optional(), visual: z.string().optional(), emotion: z.string().optional(), queries: z.array(z.string()).optional(), keywords: z.array(z.string()).optional(),
  factOverlay: z.object({ needed: z.boolean(), text: z.string().optional(), kind: z.string().optional() }).optional(), chapter: z.string().optional(),
}, async (a, ctx) => {
  store.mutate(cause(ctx, 'update_beat', { summary: `Updated beat ${a.id}`, silent: true }), p => {
    const b = p.beats.find(x => x.id === a.id); if (!b) throw new Error('Unknown beat');
    if (a.text != null) b.text = String(a.text).slice(0, 500);
    for (const k of ['visual', 'emotion', 'queries', 'factOverlay', 'chapter']) if (a[k] !== undefined) b[k] = a[k];
    if (a.keywords) b.keywords = a.keywords.map(text => ({ text, type: 'topic' }));
  }, { history: false });
  return { ok: true };
});
def('delete_beat', 'Delete a beat (and its note). Clips placed on it are kept.', { id: z.string() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'delete_beat', { summary: `Deleted beat ${a.id}` }), p => {
    if (!p.beats.some(x => x.id === a.id)) throw new Error('Unknown beat');
    p.beats = p.beats.filter(x => x.id !== a.id);
  });
  return { beats: P().beats.length };
});
def('add_beat', 'Add one beat manually: {startMs, endMs, text}.', { startMs: ms, endMs: ms, text: z.string().min(1).max(500) }, async (a, ctx) => {
  if (a.endMs <= a.startMs) throw new Error('endMs must be after startMs');
  const fps = P().settings?.fps || 30;
  const r = store.mutate(cause(ctx, 'add_beat', { summary: 'Beat added' }), p => {
    const b = {
      id: 'b' + (p.beats.length + 1 + Math.floor(Math.random() * 900)), sentenceId: 'manual', text: a.text,
      firstWordMs: a.startMs, lastWordMs: a.endMs, startMs: a.startMs, endMs: a.endMs,
      startFrame: msToFrame(a.startMs, fps), endFrame: msToFrame(a.endMs, fps),
      keywords: [], queries: [], emotion: '', visual: '', factOverlay: null, chapter: null,
    };
    p.beats.push(b);
    return b.id;
  });
  return { id: r };
});

def('set_beats', 'Replace the beat list wholesale (advanced): [{startMs,endMs,text,keywords?,queries?}]. Boundaries must tile 0..voiceEnd with no gaps.', {
  beats: z.array(z.object({ startMs: ms, endMs: ms, text: z.string(), keywords: z.array(z.string()).optional(), queries: z.array(z.string()).optional(), visual: z.string().optional() })).min(1),
}, async (a, ctx) => {
  const t = P().transcript;
  const beats = a.beats.map((b, i) => ({ id: 'b' + (i + 1), sentenceId: t?.sentences.find(s => b.startMs >= s.s - 50 && b.startMs <= s.e + 50)?.id || 's1', text: b.text, firstWordMs: b.startMs, lastWordMs: b.endMs, startMs: b.startMs, endMs: b.endMs, startFrame: msToFrame(b.startMs), endFrame: msToFrame(b.endMs), keywords: (b.keywords || []).map(x => ({ text: x, type: 'topic' })).concat(b.keywords ? [] : extractKeywords(b.text)), queries: b.queries || queriesFor(extractKeywords(b.text), b.text, P().settings.topic), visual: b.visual || '', emotion: '', factOverlay: null, chapter: null }));
  store.mutate(cause(ctx, 'set_beats', { summary: `Set ${beats.length} beats` }), p => { p.beats = beats; fixBeatFrames(p); });
  return { beats: beats.length };
});
def('set_chapters', 'Set chapters: [{title,startMs}] (Hook, Setup, Rising Action, Climax, Payoff, CTA).', { chapters: z.array(z.object({ title: z.string(), startMs: ms })).min(1) }, async (a, ctx) => {
  store.mutate(cause(ctx, 'set_chapters', { summary: `${a.chapters.length} chapters set` }), p => {
    const end = p.transcript?.voiceEndMs || frameToMs(projectFrames(p));
    p.chapters = a.chapters.sort((x, y) => x.startMs - y.startMs).map((c, i, arr) => ({ id: 'ch' + (i + 1), title: c.title, startMs: c.startMs, endMs: arr[i + 1]?.startMs ?? end }));
  });
  return { chapters: P().chapters };
});

// ------------------------------------------------------------------ youtube
const FACELESS_BAD = /vlog|interview|podcast|reaction|face ?cam|face reveal|q&a|webinar|stage|talk show/i;
const MOVIE_GOOD = /movie|film|scene|clip|cinematic|trailer|4k|hd| fight| chase/i;
def('search_youtube', 'Search YouTube. license:"cc" restricts to Creative Commons uploads. style:"faceless" filters out vlogs/interviews/reactions (adds "no talking"), style:"movie" narrows to movie/film scenes. Returns id, url, title, channel, duration, views.', {
  query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8), license: z.enum(['any', 'cc']).default('any'), minSec: z.number().optional(), maxSec: z.number().optional(),
  style: z.enum(['any', 'faceless', 'movie']).default('any'),
}, async a => {
  const q = a.style === 'movie' ? `${a.query} movie scene` : a.style === 'faceless' ? `${a.query} no talking` : a.query;
  let r = await yt.search(q, { limit: a.limit + 6, license: a.license, minSec: a.minSec, maxSec: a.maxSec });
  if (a.style === 'faceless') r = r.filter(v => !FACELESS_BAD.test(v.title));
  if (a.style === 'movie') { const f = r.filter(v => MOVIE_GOOD.test(v.title)); if (f.length >= 2) r = f; }
  return { query: a.query, style: a.style, results: r.slice(0, a.limit).map(({ thumbnail, ...v }) => v) };
});
def('youtube_info', 'Full details for a video: license, chapters, "most replayed" peaks (great in-points), max quality, description.', { url: z.string() }, async a => yt.info(a.url));
def('inspect_youtube', 'LOOK at a stretch of a YouTube video: returns a contact-sheet image (frames left-to-right, top-to-bottom) so you can judge relevance, cleanliness (watermarks, logos, burned-in text) and the exact moment. Keep ranges short (≤20 s) for precision, or scan up to 15 min with 12–24 frames to find the right area.', {
  url: z.string(), startMs: ms.default(0), endMs: ms.optional(), frames: z.number().int().min(2).max(24).default(6), cols: z.number().int().min(1).max(6).default(3),
}, async a => {
  const r = await yt.inspect(a.url, a);
  return { video: r.meta, layout: `${r.cols} columns, row by row`, frameTimesMs: r.frameTimesMs, _images: [{ mimeType: 'image/jpeg', data: r.jpeg.toString('base64') }] };
});
def('find_clips_for_beat', 'Server-side candidate search for a beat: runs its queries, ranks results by the editing rules and proposes an in-point. You still decide — inspect_youtube the best ones.', {
  beatId: z.string(), extraQuery: z.string().optional(), license: z.enum(['any', 'cc']).default('any'), limit: z.number().int().default(5),
}, async a => {
  const p = P(), beat = beatOf(p, a.beatId); if (!beat) throw new Error('Unknown beat');
  const ledger = { count: id => p.clips.filter(c => c.track === 'V1' && c.source?.url && yt.videoId(c.source.url) === id).length };
  const qs = [a.extraQuery, ...beat.queries].filter(Boolean).slice(0, 3);
  const seen = new Map();
  for (const q of qs) for (const v of await yt.search(q, { limit: 8, license: a.license, minSec: 12 })) if (!seen.has(v.id)) seen.set(v.id, { ...v, q, score: scoreCandidate(v, beat, p.settings.topic, ledger) });
  const ranked = [...seen.values()].sort((x, y) => y.score - x.score).slice(0, a.limit);
  const durMs = frameToMs(beat.endFrame - beat.startFrame);
  const out = [];
  for (const v of ranked) {
    const meta = await yt.info(v.url).catch(() => null);
    const taken = p.clips.filter(c => c.source?.url && yt.videoId(c.source.url) === v.id).map(c => [c.source.inMs, c.source.outMs]);
    out.push({ url: v.url, title: v.title, channel: v.channel, durationSec: v.durationSec, views: v.views, score: +v.score.toFixed(1), query: v.q, license: meta?.license, usedAlready: taken.length, suggestedStartMs: meta ? pickMoment(meta, durMs, taken, p.beats.indexOf(beat)) : null, mostReplayed: meta?.mostReplayed?.slice(0, 3) });
  }
  return { beat: { id: beat.id, text: beat.text, durMs }, candidates: out };
});
def('download_youtube', 'Download a section of a YouTube video into the library (only that part is fetched, 1 s padding each side). Optionally place it.', {
  url: z.string(), startMs: ms.default(0), endMs: ms.optional(), maxHeight: z.number().int().default(1080), padMs: ms.default(1000), place: z.object({ beatId: z.string().optional(), startMs: ms.optional(), track: z.string().optional() }).optional(),
  withAudio: z.boolean().describe('REQUIRED. true = also download the video’s audio and play it on the timeline; false = picture only. ASK THE USER before calling — never assume.'),
}, async (a, ctx) => {
  const meta = await yt.info(a.url);
  const end = a.endMs ?? Math.min(a.startMs + 5000, Math.round((meta.durationSec || 9999) * 1000));
  if (a.place) return placeClip({ ...a.place, youtube: { url: a.url, startMs: a.startMs, endMs: end }, withAudio: a.withAudio, maxHeight: a.maxHeight, durMs: a.place.beatId ? undefined : end - a.startMs }, cause(ctx, 'download_youtube')).then(c => ({ clipId: c.id, assetId: c.assetId }));
  const dl = await yt.downloadSection(a.url, { startMs: a.startMs, endMs: end, maxHeight: a.maxHeight, padMs: a.padMs, audio: a.withAudio });
  const asset = await importFile(dl.file, { name: `${meta.title}`.slice(0, 60), cause: cause(ctx, 'download_youtube'), source: { type: 'youtube', url: a.url, id: meta.id, title: meta.title, channel: meta.channel, license: meta.license, rangeStartMs: dl.rangeStartMs, rangeEndMs: dl.rangeEndMs }, useAudio: a.withAudio });
  return { assetId: asset.id, hasAudio: !!asset.hasAudio, durationMs: asset.duration, coversSourceMs: [dl.rangeStartMs, dl.rangeEndMs], license: meta.license };
});

// ------------------------------------------------------------------ the skill (knowledge for the AI)
const SKILL_DIR = path.join(APP_ROOT, 'skills', 'framesflow');
function skillFiles() {
  const out = {};
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.md$/.test(f.name)) out[path.relative(SKILL_DIR, p).split(path.sep).join('/')] = p; } };
  if (fs.existsSync(SKILL_DIR)) walk(SKILL_DIR);
  return out;
}
def('get_framesflow_skill', 'READ FIRST. The Framesflow skill: how to operate this studio, and how every kind of video is made (faceless YouTube documentaries / cash-cow channels, explainers, listicles, shorts, promos, tutorials, music videos…), with sourcing/rights guidance and exact tool recipes. Call with no arguments for SKILL.md plus the list of reference files, then call again with file:"references/cash-cow-documentaries.md" (or any listed file).', {
  file: z.string().optional().describe('a path from the list, e.g. references/video-types.md'),
}, async a => {
  const files = skillFiles();
  const names = Object.keys(files);
  if (!names.length) throw new Error('The skill files are missing from this installation.');
  const name = a.file || 'SKILL.md';
  if (!files[name]) throw new Error(`Unknown file ${name}. Available: ${names.join(', ')}`);
  return { file: name, available: names, content: fs.readFileSync(files[name], 'utf8') };
});

// ------------------------------------------------------------------ web images + cut-outs
def('search_images', 'Search the web for openly licensed images (Openverse: Wikimedia Commons, Flickr, NASA, museums…). Defaults to licences that allow commercial use. Each result has url, thumbnail, size, creator and licence. Then call import_image with the url you want. Tip: for a cut-out subject use pngOnly:true and/or search "<thing> isolated"; any image can be cut out with remove_background.', {
  query: z.string().min(1), limit: z.number().int().min(1).max(30).default(8), page: z.number().int().min(1).default(1),
  orientation: z.enum(['wide', 'tall', 'square']).optional(), pngOnly: z.boolean().default(false),
  source: z.string().optional().describe('restrict to one collection, e.g. wikimedia, flickr, nasa, smithsonian'),
  licenseType: z.enum(['commercial', 'all']).default('commercial').describe('commercial = only licences that allow monetised use'),
}, async a => images.searchImages(a.query, a));
def('import_image', 'Download an image from a public https URL (e.g. from search_images) into the library, logging its licence/credit. removeBackground:true also cuts the subject out into a transparent PNG (the cut-out becomes the asset to use). Optionally place it on the timeline; transparent cut-outs default to contain-fit so the whole subject shows, and can then be animated with set_keyframes (scale, x, y, rotation, opacity) on an overlay track like V2.', {
  url: z.string().url(), name: z.string().max(80).optional(), removeBackground: z.boolean().default(false),
  credit: z.object({ title: z.string().optional(), creator: z.string().optional(), license: z.string().optional(), licenseUrl: z.string().optional(), landingUrl: z.string().optional(), attribution: z.string().optional() }).optional().describe('pass the fields from search_images so credits are logged'),
  place: z.object({ track: trackId.default('V2'), startMs: ms, durMs: ms.optional() }).optional(),
}, async (a, ctx) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-img-'));
  try {
    const dl = await images.downloadImage(a.url, dir);
    let asset = await importFile(dl.file, { name: a.name || a.credit?.title?.slice(0, 60), cause: cause(ctx, 'import_image'), source: { type: 'web-image', url: a.url, ...(a.credit || {}) } });
    let cut = null;
    if (a.removeBackground) cut = await cutOut(asset.id, ctx);
    const use = cut || asset;
    let clip = null;
    if (a.place) clip = await placeClip({ assetId: use.id, track: a.place.track, startMs: a.place.startMs, durMs: a.place.durMs ?? 3000, allowLong: true, replace: false }, cause(ctx, 'import_image'));
    return { assetId: use.id, originalAssetId: cut ? asset.id : undefined, transparent: !!cut, width: use.width, height: use.height, clipId: clip?.id };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/** Cut the subject out of an image asset → new transparent PNG asset. */
async function cutOut(assetId, ctx, name) {
  const p = P();
  const src = p.assets[assetId];
  if (!src) throw new Error('Unknown asset ' + assetId);
  if (src.kind !== 'image') throw new Error('Background removal works on images.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cut-'));
  try {
    const out = path.join(dir, 'cutout.png');
    await removeBackground(path.join(assetsDir(p.id), src.file), out);
    const asset = await importFile(out, { name: name || `${src.name.replace(/\.[^.]+$/, '')} (cutout)`, cause: cause(ctx, 'remove_background'), source: src.source || null });
    store.mutate({ by: 'system', silent: true }, d => { d.assets[asset.id].transparent = true; d.assets[asset.id].cutoutOf = src.id; }, { history: false });
    return store.project.assets[asset.id];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
def('remove_background', 'Cut the subject out of an image in the library and save it as a new transparent PNG asset (runs locally with an open-licence AI model; the first run downloads ~45 MB, then ~25 s per image on CPU). Use the returned assetId on an overlay track (V2) for animated cut-outs. replaceClips:true swaps every clip that uses the original image for the cut-out.', {
  assetId: z.string(), name: z.string().max(80).optional(), replaceClips: z.boolean().default(false), wait: z.boolean().default(true),
}, async (a, ctx) => {
  const handle = jobs.create('cutout', 'Removing background', { projectId: P().id });
  const run = cutOut(a.assetId, ctx, a.name).then(asset => {
    if (a.replaceClips) store.mutate(cause(ctx, 'remove_background', { summary: 'Swapped clips to cut-out' }), d => { for (const c of d.clips) if (c.assetId === a.assetId) { c.assetId = asset.id; c.fit = 'contain'; } });
    return { assetId: asset.id, width: asset.width, height: asset.height, transparent: true };
  });
  if (a.wait) return soft(handle, run, 55000);
  run.then(r => handle.done(r), e => handle.fail(e)).catch(() => {});
  return { jobId: handle.job.id, hint: 'Cutting out in the background — poll get_job.' };
});

// ------------------------------------------------------------------ HTML animations (HyperFrames-style)
const ANIM_GUIDE = fs.readFileSync(path.join(APP_ROOT, 'server', 'animation-guide.md'), 'utf8');
/** Resolve template+vars or raw html into the final document. */
function buildAnim(a, asset) {
  const base = asset?.animation || {};
  const templateId = a.template ?? (a.html ? null : base.template);
  const t = templateId ? templateById(templateId) : null;
  if (templateId && !t) throw new Error(`Unknown template ${templateId}. See list_animation_templates.`);
  if (!t && !(a.html || base.html)) throw new Error('Give html or a template.');
  const vars = { ...(t ? templateDefaults(t) : {}), ...(a.template || !a.html ? base.vars || {} : {}), ...(a.vars || {}) };
  const html = t ? fillVars(t.html, vars) : (a.html ?? base.html);
  return { html, template: t?.id || null, vars: t ? vars : undefined };
}
const assetPathOf = id => { const p = P(); const x = p.assets[id]; return x?.file ? path.join(assetsDir(p.id), x.file) : null; };
const animShape = {
  template: z.string().optional().describe('template id from list_animation_templates'), vars: z.record(z.string()).optional().describe('template variables, e.g. {title:"Hello", accent:"#ff0"}'),
  html: z.string().max(200000).optional().describe('your own HTML (see animation_guide). Ignored when template is set'),
  durationMs: z.number().int().min(300).max(MAX_ANIM_MS).default(3000),
};
def('animation_guide', 'READ THIS before writing HTML animations: the contract (deterministic, seekable, transparent), what is allowed, how to reference library images with asset://<id>, how to build full animated scenes, and a worked example. HyperFrames-style: your HTML is seeked frame by frame and rendered to a transparent video clip.', {}, async () => ({ guide: ANIM_GUIDE, canvas: { width: P().settings.width, height: P().settings.height, fps: P().settings.fps } }));
def('list_animation_templates', 'Ready-made animated scenes you can drop in with create_animation {template, vars}: title card, lower third, big counting number, animated bar chart. Each lists its variables.', {}, async () => ({ templates: ANIMATION_TEMPLATES.map(({ id, label, description, vars }) => ({ id, label, description, vars })) }));
def('snapshot_animation', 'LOOK at an animation before rendering it: returns a contact sheet of frames (default at 0%, 33%, 66%, 97% of the clip) over a grey background so you can check layout, overflow, timing and style. Cheap and fast; use it to iterate on your HTML, then call create_animation.', {
  ...animShape, atMs: z.array(z.number().int().min(0)).max(8).optional().describe('exact times to capture'),
}, async a => {
  const p = P();
  const { html } = buildAnim(a);
  const r = await snapshotAnimation({ html, width: p.settings.width, height: p.settings.height, durationMs: a.durationMs, times: a.atMs, assetFile: assetPathOf });
  return { frameTimesMs: r.times, layout: '2 columns, row by row', warnings: lintHtml(html), pageErrors: r.pageErrors, _images: [{ mimeType: 'image/jpeg', data: r.jpeg.toString('base64') }] };
});
def('create_animation', 'Make an animation clip from HTML/CSS/JS (or a template) — like HyperFrames: the page is seeked frame by frame in a headless browser and rendered to a TRANSPARENT video the size of the project, imported to the library and (with place) put on the timeline as a normal clip you can move, trim, fade, scale and keyframe. Use it for titles, lower thirds, counters, charts, icons, callouts, animated cut-outs (asset://<id>) and full animated scenes. Read animation_guide first; check with snapshot_animation. Needs Edge or Chrome installed. Runs as a job (poll get_job if it returns running).', {
  ...animShape, name: z.string().max(80).optional(), fps: z.number().int().min(10).max(60).optional(),
  place: z.object({ track: trackId.default('V2'), startMs: ms.default(0) }).optional().describe('put it on the timeline; omit to only add it to the library'),
}, async (a, ctx) => {
  const p = P();
  const built = buildAnim(a);
  const warnings = lintHtml(built.html);
  const fps = a.fps ?? p.settings.fps;
  const handle = jobs.create('animation', `Animation: ${a.name || built.template || 'custom'}`, { projectId: p.id });
  const run = (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-anim-'));
    try {
      const out = path.join(dir, 'anim.webm');
      const r = await renderAnimation({ html: built.html, width: p.settings.width, height: p.settings.height, fps, durationMs: a.durationMs, outFile: out, assetFile: assetPathOf, signal: handle.signal, onProgress: f => handle.update({ progress: f, message: `Rendering frames ${Math.round(f * 100)}%` }) });
      const asset = await importFile(out, { name: a.name || built.template || 'Animation', cause: cause(ctx, 'create_animation'), source: { type: 'animation', template: built.template }, noCrop: true });
      store.mutate({ by: 'system', silent: true }, d => { Object.assign(d.assets[asset.id], { alpha: true, animation: { template: built.template, vars: built.vars, html: built.html, durationMs: a.durationMs, fps, width: p.settings.width, height: p.settings.height } }); }, { history: false });
      let clip = null;
      if (a.place) clip = await placeClip({ assetId: asset.id, track: a.place.track, startMs: a.place.startMs, durMs: Math.min(r.durationMs, asset.duration), allowLong: true, replace: false, force: true }, cause(ctx, 'create_animation'));
      return { assetId: asset.id, clipId: clip?.id, durationMs: r.durationMs, frames: r.frames, warnings, pageErrors: r.pageErrors };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  })();
  return soft(handle, run, 55000);
});
def('update_animation', 'Re-render an existing animation asset with new variables, new html and/or a new duration. Every clip using the old asset is switched to the new render (positions, effects and keyframes are kept).', {
  assetId: z.string(), template: z.string().optional(), vars: z.record(z.string()).optional(), html: z.string().max(200000).optional(),
  durationMs: z.number().int().min(300).max(MAX_ANIM_MS).optional(),
}, async (a, ctx) => {
  const p = P();
  const old = p.assets[a.assetId];
  if (!old?.animation) throw new Error('That asset is not an HTML animation.');
  const built = buildAnim(a, old);
  const durationMs = a.durationMs ?? old.animation.durationMs;
  const warnings = lintHtml(built.html);
  const handle = jobs.create('animation', `Re-render: ${old.name}`, { projectId: p.id });
  const run = (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-anim-'));
    try {
      const out = path.join(dir, 'anim.webm');
      const r = await renderAnimation({ html: built.html, width: p.settings.width, height: p.settings.height, fps: old.animation.fps || p.settings.fps, durationMs, outFile: out, assetFile: assetPathOf, signal: handle.signal, onProgress: f => handle.update({ progress: f, message: `Rendering frames ${Math.round(f * 100)}%` }) });
      const asset = await importFile(out, { name: old.name, cause: cause(ctx, 'update_animation'), source: old.source, noCrop: true });
      let swapped = 0;
      store.mutate(cause(ctx, 'update_animation', { summary: `Updated animation “${old.name}”` }), d => {
        Object.assign(d.assets[asset.id], { alpha: true, animation: { ...old.animation, template: built.template, vars: built.vars, html: built.html, durationMs } });
        for (const c of d.clips) if (c.assetId === old.id) { c.assetId = asset.id; swapped++; }
      });
      return { assetId: asset.id, replacedAssetId: old.id, clipsUpdated: swapped, durationMs: r.durationMs, warnings, pageErrors: r.pageErrors };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  })();
  return soft(handle, run, 55000);
});

// ------------------------------------------------------------------ timeline editing
const kenburnsShape = z.union([z.boolean(), z.object({ from: z.number().min(1).max(2).default(1), to: z.number().min(1).max(2).default(1.06), panX0: z.number().min(-1).max(1).optional(), panX1: z.number().min(-1).max(1).optional(), panY0: z.number().min(-1).max(1).optional(), panY1: z.number().min(-1).max(1).optional() })]);
const transitionShape = z.object({ type: z.enum(TRANSITIONS), dur: z.number().int().min(2).max(120).optional().describe('frames (4–12 typical; up to 120 for long dissolves)') });
def('place_clip', 'Put a clip on the timeline. For YouTube footage pass youtube:{url,startMs} — only that moment is downloaded. With beatId the clip lands on the beat’s exact frame window (replacing the beat’s previous clip). Enforces: ≤5 s on V1, no source reuse, max 3 per video, never back-to-back from one video.', {
  beatId: z.string().optional(), track: trackId.default('V1'),
  assetId: z.string().optional(), youtube: z.object({ url: z.string(), startMs: ms.describe('exact in-point in the source video'), endMs: ms.optional(), query: z.string().optional() }).optional(),
  startMs: ms.optional(), durMs: ms.optional(), inMs: ms.optional().describe('offset into an existing asset'), speed: z.number().min(0.25).max(4).optional(),
  transition: transitionShape.optional(), kenburns: kenburnsShape.optional(), grade: z.union([z.string(), z.record(z.number())]).optional(), scale: z.number().optional(), volume: z.number().optional(),
  label: z.string().optional(), withAudio: z.boolean().optional().describe('For YouTube footage: also download + play its audio (ASK THE USER; default is picture only). For library video: overrides the asset’s audio setting.'), maxHeight: z.number().int().default(1080), force: z.boolean().default(false), allowLong: z.boolean().default(false), replace: z.boolean().optional().describe('false keeps existing clips (default true when beatId is used)'),
}, async (a, ctx) => { const c = await placeClip(a, cause(ctx, 'place_clip')); return { clipId: c.id, startMs: frameToMs(c.start), endMs: frameToMs(c.start + c.dur), source: c.source?.url, title: c.source?.title, license: c.source?.license }; });

def('add_overlay', 'Add a graphic on V2, timed to spoken words: fact card (name/date/place/number), chapter card, lower third, big stat, quote or title. Dark translucent rounded box, white text, one accent colour. Never use for subtitles.', {
  kind: z.enum(['fact', 'chapter', 'lower', 'stat', 'quote', 'title']).default('fact'), title: z.string().min(1).max(120), body: z.string().max(240).optional(), label: z.string().max(30).optional(),
  beatId: z.string().optional(), startMs: ms.optional(), endMs: ms.optional(), position: z.enum(['bl', 'bc', 'br', 'tl', 'tc', 'tr', 'center']).optional(), accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}, async (a, ctx) => { const c = addOverlay(a, cause(ctx, 'add_overlay')); return { clipId: c.id, startMs: frameToMs(c.start), endMs: frameToMs(c.start + c.dur) }; });

def('add_audio', 'Place music (A2) or sound effects (A3) from the library. Music is auto-ducked under the voice and faded out at the voice end; gainDb defaults to the project music level (−30 dB).', {
  assetId: z.string().optional(), path: z.string().optional(), track: z.enum(['A2', 'A3']).default('A2'), startMs: ms.default(0), durMs: ms.optional(), gainDb: z.number().min(-60).max(6).optional(), fadeInMs: ms.optional(), fadeOutMs: ms.optional(), inMs: ms.optional(),
}, async (a, ctx) => {
  let assetId = a.assetId;
  if (!assetId && a.path) assetId = (await importFile(path.resolve(a.path), { cause: cause(ctx, 'add_audio') })).id;
  if (!assetId) throw new Error('Give assetId or path.');
  const total = projectFrames(P());
  const asset = P().assets[assetId];
  const dur = a.durMs != null ? msToFrame(a.durMs) : a.track === 'A2' && total ? total - msToFrame(a.startMs) : msToFrame(asset.duration);
  const c = await placeClip({ assetId, track: a.track, startMs: a.startMs, durFrames: Math.max(1, dur), inMs: a.inMs ?? 0, gainDb: a.gainDb, replace: false, allowLong: true, label: asset.name }, cause(ctx, 'add_audio'));
  if (a.fadeInMs || a.fadeOutMs || a.track === 'A2') patchClips([{ id: c.id, patch: { fadeIn: msToFrame(a.fadeInMs ?? 800), fadeOut: msToFrame(a.fadeOutMs ?? 0) } }], { by: by(ctx), tool: 'add_audio', silent: true });
  return { clipId: c.id };
});

def('edit_clip', 'Patch one or more clips. Fields: start/dur (frames), in (source ms), speed, volume, gainDb, fadeIn/fadeOut (frames), scale, x, y (percent), opacity, kenburns, grade (preset name or {brightness,contrast,saturation,teal,vignette,sharpen,denoise}), transition {type,dur}, label, track, text{...}.', {
  patches: z.array(z.object({ id: z.string(), patch: z.record(z.any()) })).min(1),
}, async (a, ctx) => ({ edited: patchClips(a.patches, cause(ctx, 'edit_clip', { summary: `Edited ${a.patches.length} clip(s)` })) }), { ui: true });

def('move_clip', 'Move a clip to a new start time (ms) and optionally another track.', { id: z.string(), startMs: ms, track: z.string().optional() }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'move_clip', { summary: 'Moved clip' }), d => opMoveClip(d, a.id, a));
  return { moved: r.result };
});
def('trim_clip', 'Trim a clip: change duration (ms) and/or source in-point (ms).', { id: z.string(), durMs: ms.optional(), inMs: ms.optional(), startMs: ms.optional() }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'trim_clip', { summary: 'Trimmed clip' }), d => opTrimClip(d, a.id, a));
  return { trimmed: r.result };
});
def('split_clip', 'Split a clip at a timeline time (ms). Keyframes are split across the cut.', { id: z.string(), atMs: ms }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'split_clip', { summary: 'Split clip' }), d => opSplitClip(d, a.id, msToFrame(a.atMs, P().settings?.fps || 30)));
  return { ids: r.result };
}, { ui: true });
def('delete_clips', 'Remove clips by id. ripple:true closes the gap on that track.', { ids: z.array(z.string()).min(1), ripple: z.boolean().default(false) }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'delete_clips', { summary: `Deleted ${a.ids.length} clip(s)` }), d => opDeleteClips(d, a.ids, { ripple: a.ripple }));
  return { deleted: r.result.removed };
}, { ui: true });
def('duplicate_clips', 'Duplicate clips right after themselves (or at offsetMs).', { ids: z.array(z.string()), offsetMs: ms.optional() }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'duplicate_clips', { summary: 'Duplicated clips' }), d => opDuplicateClips(d, a.ids, a.offsetMs));
  return { ids: r.result.ids };
}, { ui: true });
def('add_clips_raw', 'Insert clips exactly as given (used by the studio for paste/drop). Prefer place_clip.', { clips: z.array(z.record(z.any())) }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'add_clips_raw', { summary: `Added ${a.clips.length} clip(s)` }), d => opAddClipsRaw(d, a.clips));
  return { ids: r.result.ids };
}, { ui: true });
def('add_track', 'Add an extra video (new top layer) or audio track.', { kind: z.enum(['video', 'audio']), name: z.string().optional() }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'add_track', { summary: `Added ${a.kind} track` }), d => opAddTrack(d, a));
  return { track: r.result, tracks: P().tracks.map(t => t.id) };
}, { ui: true });
def('remove_track', 'Remove a track and every clip on it.', { id: z.string() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'remove_track', { summary: `Removed track ${a.id}` }), d => opRemoveTrack(d, a.id));
  return { tracks: P().tracks.map(t => t.id) };
}, { ui: true });
def('reorder_tracks', 'Reorder tracks (top of the list = topmost video layer).', { order: z.array(z.string()).min(1) }, async (a, ctx) => {
  store.mutate(cause(ctx, 'reorder_tracks', { summary: 'Reordered tracks' }), d => opReorderTracks(d, a.order));
  return { tracks: P().tracks.map(t => t.id) };
}, { ui: true });
def('set_track', 'Mute/lock/solo or rename a track.', { id: z.string(), muted: z.boolean().optional(), locked: z.boolean().optional(), solo: z.boolean().optional(), name: z.string().optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'set_track', { summary: `Track ${a.id} updated`, silent: true }), d => opSetTrack(d, a.id, a));
  return { ok: true };
}, { ui: true });
def('apply_look', 'Apply a colour/transition style to the whole video in one go: grade preset (project-wide), and optionally a transition for every cut or Ken Burns on stills.', {
  grade: z.enum(Object.keys(GRADES)).optional(), transition: transitionShape.optional(), onlyEvery: z.number().int().min(1).optional().describe('apply transition to every Nth clip'),
}, async (a, ctx) => {
  store.mutate(cause(ctx, 'apply_look', { summary: 'Applied look' }), d => {
    if (a.grade) d.settings.grade = a.grade;
    if (a.transition) opApplyLook(d, { transition: a.transition.type, everyNth: a.onlyEvery });
  });
  return { grade: P().settings.grade };
});
def('clear_timeline', 'Remove every clip from the given tracks (default: V1 and V2). Voiceover is kept unless A1 is listed.', { tracks: z.array(z.string()).default(['V1', 'V2']) }, async (a, ctx) => {
  store.mutate(cause(ctx, 'clear_timeline', { summary: `Cleared ${a.tracks.join(', ')}` }), d => opClearTimeline(d, a.tracks));
  return { ok: true };
});

// ------------------------------------------------------------------ pro editor: catalogs, effects, keyframes, text, markers, format
def('list_transitions', 'The inbuilt transition catalog: id, label, group and default duration (frames) for each.', {}, async () => ({ transitions: TRANSITION_DEFS.map(({ id, label, group, dur }) => ({ id, label, group, defaultDur: dur })) }));
def('list_effects', 'The inbuilt per-clip effect catalog with every parameter and its range.', {}, async () => ({ effects: EFFECT_DEFS }));
def('list_text_presets', 'Text clip catalogs: in/out animations, fonts, kinds and positions.', {}, async () => ({ animIn: TEXT_ANIMS_IN, animOut: TEXT_ANIMS_OUT, fonts: TEXT_FONTS.map(f => f.id), kinds: TEXT_KINDS, positions: TEXT_POSITIONS }));
def('add_text_clip', 'Add a styled, animated text clip (title, lower third, caption…). kind picks the layout; style overrides anything: font, fontSize, weight, color, stroke, strokeWidth, shadow, bg, align, letterSpacing, animIn, animOut, animDur.', {
  kind: z.enum(TEXT_KINDS).default('title'), title: z.string().max(200).default(''), body: z.string().max(400).optional(), label: z.string().max(60).optional(),
  track: trackId.optional(), beatId: z.string().optional(), startMs: ms.optional(), endMs: ms.optional(),
  position: z.enum(TEXT_POSITIONS).optional(), accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), style: z.record(z.any()).optional(),
  transition: transitionShape.optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'add_text_clip', { summary: `Added ${a.kind} text "${a.title}"` }), d => opAddText(d, a));
  return { clipId: r.clip.id, clip: { id: r.clip.id, startMs: frameToMs(r.clip.start), endMs: frameToMs(r.clip.start + r.clip.dur) } };
});
def('set_text_style', 'Edit an existing text clip: change words (text:{title,body,label}) and/or the full style object.', {
  clipId: z.string(), text: z.object({ title: z.string().optional(), body: z.string().optional(), label: z.string().optional() }).optional(), style: z.record(z.any()).optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_text_style', { summary: 'Edited text' }), d => opSetTextStyle(d, a));
  return { text: r.result };
});
def('apply_effect', 'Apply an effect from the catalog to a clip (e.g. blur, vignette, glow, glitchfx). Get ids from list_effects. Effects stack in order.', {
  clipId: z.string(), type: z.string(), params: z.record(z.any()).optional(), prepend: z.boolean().default(false),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'apply_effect', { summary: `Applied ${a.type}` }), d => opApplyEffect(d, a));
  return { effect: r.result, effects: P().clips.find(c => c.id === a.clipId)?.effects };
});
def('update_effect', 'Change parameters of one effect instance on a clip (get instance ids from get_project → clip.effects).', {
  clipId: z.string(), effectId: z.string(), params: z.record(z.any()),
}, async (a, ctx) => {
  store.mutate(cause(ctx, 'update_effect', { summary: 'Tuned effect', silent: true }), d => opUpdateEffect(d, a));
  return { ok: true };
});
def('remove_effect', 'Remove one effect instance from a clip.', { clipId: z.string(), effectId: z.string() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'remove_effect', { summary: 'Removed effect' }), d => opRemoveEffect(d, a));
  return { ok: true };
});
def('clear_effects', 'Remove every effect from one clip (clipId) or from all clips.', { clipId: z.string().optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'clear_effects', { summary: 'Cleared effects' }), d => opClearEffects(d, a));
  return { ok: true };
});
def('set_keyframes', 'Animate a property over time: scale, x, y, rotation, opacity or volume. Pass keys:[{frame,value,interp}] (frames relative to the clip start; interp: linear|ease|hold) or add:{frame,value} to set one key at the playhead.', {
  clipId: z.string(), property: z.enum(KEYFRAMABLE), keys: z.array(z.object({ frame: z.number().int().min(0), value: z.number(), interp: z.enum(['linear', 'ease', 'hold']).default('linear') })).optional(),
  add: z.object({ frame: z.number().int().min(0), value: z.number(), interp: z.enum(['linear', 'ease', 'hold']).optional() }).optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_keyframes', { summary: `Keyframed ${a.property}` }), d => opSetKeyframes(d, a));
  return { keys: r.result };
});
def('clear_keyframes', 'Remove keyframes from a clip (one property or all).', { clipId: z.string(), property: z.enum(KEYFRAMABLE).optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'clear_keyframes', { summary: 'Cleared keyframes' }), d => opClearKeyframes(d, a));
  return { ok: true };
});
def('detach_audio', 'Detach the sound of a video clip onto its own audio track (same timing/volume) so it can be moved, cut, faded or muted separately. The video clip becomes silent. Needs a video clip whose asset has audio.', { clipId: z.string() }, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'detach_audio', { summary: 'Detached audio' }), d => opDetachAudio(d, a));
  return { audioClipId: r.clip.id, track: r.clip.track };
});
def('set_asset_audio', 'Choose whether a library video plays its own audio when placed on the timeline (new placements use this setting). Existing clips can be changed with edit_clip {audio:true|false}.', { assetId: z.string(), useAudio: z.boolean() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'set_asset_audio', { summary: a.useAudio ? 'Audio on for asset' : 'Audio off for asset' }), d => { const x = d.assets[a.assetId]; if (!x) throw new Error('Unknown asset ' + a.assetId); if (!x.hasAudio) throw new Error('That media has no audio.'); x.useAudio = a.useAudio; });
  return { ok: true };
});
def('add_effect_layer', 'Add an EFFECT LAYER: a separate timeline layer (own track) that applies effects to everything beneath it for its duration, like an adjustment layer. Pass effects:[{type,params?,keyframes?}] (types from list_effects). Animate it afterwards with set_effect_keyframes. Returns clipId and the effect instance ids.', {
  startMs: ms.optional(), endMs: ms.optional(), durMs: ms.optional(), track: trackId.optional(), label: z.string().max(60).optional(),
  effects: z.array(z.object({ type: z.string(), params: z.record(z.any()).optional(), keyframes: z.record(z.array(z.object({ frame: z.number().int().min(0), value: z.number(), interp: z.enum(['linear', 'ease', 'hold']).optional() }))).optional() })).min(1),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'add_effect_layer', { summary: 'Added effect layer' }), d => opAddEffectLayer(d, { ...a, startMs: a.startMs ?? 0 }));
  return { clipId: r.clip.id, track: r.clip.track, effects: r.clip.effects.map(e => ({ id: e.id, type: e.type })) };
});
def('set_effect_keyframes', 'Animate ONE PARAMETER of an effect over time (works on effect layers and on effects applied to normal clips). Keyframable params per effect: ' + Object.entries(EFFECT_KEYFRAMABLE).map(([k, v]) => `${k}(${v.join(',')})`).join(' ') + '. Pass keys:[{frame,value,interp}] (frames relative to the clip start, interp linear|ease|hold) or add:{frame,value}.', {
  clipId: z.string(), effectId: z.string(), param: z.string(),
  keys: z.array(z.object({ frame: z.number().int().min(0), value: z.number(), interp: z.enum(['linear', 'ease', 'hold']).optional() })).optional(),
  add: z.object({ frame: z.number().int().min(0), value: z.number(), interp: z.enum(['linear', 'ease', 'hold']).optional() }).optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_effect_keyframes', { summary: `Keyframed effect ${a.param}` }), d => opSetEffectKeyframes(d, a));
  return { keys: r.result };
});
def('clear_effect_keyframes', 'Remove keyframes from an effect parameter (or all parameters of that effect instance).', { clipId: z.string(), effectId: z.string(), param: z.string().optional() }, async (a, ctx) => {
  store.mutate(cause(ctx, 'clear_effect_keyframes', { summary: 'Cleared effect keyframes' }), d => opClearEffectKeyframes(d, a));
  return { ok: true };
});
def('set_markers', 'Replace all timeline markers: [{frame|ms, label?, color?}].', { markers: z.array(z.object({ frame: z.number().int().min(0).optional(), ms: ms.optional(), label: z.string().optional(), color: z.string().optional() })).default([]) }, async (a, ctx) => {
  const fps = P().settings?.fps || 30;
  const r = store.mutate(cause(ctx, 'set_markers', { summary: `Set ${a.markers.length} markers` }), d => opSetMarkers(d, a.markers.map(m => ({ ...m, frame: m.frame ?? msToFrame(m.ms || 0, fps) }))));
  return { markers: r.result };
});
def('add_marker', 'Add one marker at a time position (ms or frame).', { ms: ms.optional(), frame: z.number().int().min(0).optional(), label: z.string().default(''), color: z.string().optional() }, async (a, ctx) => {
  const fps = P().settings?.fps || 30;
  const r = store.mutate(cause(ctx, 'add_marker', { summary: 'Marker added' }), d => opAddMarker(d, { frame: a.frame ?? msToFrame(a.ms || 0, fps), label: a.label, color: a.color }));
  return { marker: r.result };
});
def('set_project_format', 'Set canvas format/size (formatId from FORMATS: hd, hd720, uhd, vertical — 16:9 or 9:16 ONLY — or raw width/height), fps (24/25/30/50/60 — clips are rescaled) and voiceLock (lock the video length to the voiceover end, used by the AI pipeline).', {
  formatId: z.string().optional(), width: z.number().int().min(64).max(7680).optional(), height: z.number().int().min(64).max(4320).optional(),
  fps: z.number().int().optional(), voiceLock: z.boolean().optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_project_format', { summary: 'Project format changed' }), d => opSetProjectFormat(d, a));
  return { settings: r.result, formats: FORMATS.map(f => ({ id: f.id, label: f.label })), fpsOptions: FPS_OPTIONS };
});

// ------------------------------------------------------------------ editor plan: the AI video-maker flow
// Flow: 1) user uploads voiceover → transcribe_voiceover (word-by-word, local Whisper, no AI tokens)
//       2) AI asks the USER for the mix: % YouTube footage / % images / % animation
//       3) set_mix → AI researches footage and writes a shot list (set_plan) covering 0→voiceEnd with
//          both timestamps per row (voiceover window + source cut), following get_editor_rules
//       4) exec_plan materialises the rows on the timeline (downloads only the needed seconds,
//          blurs watermarked regions) → then the user (or the AI) polishes and renders.
def('set_mix', 'Store the user’s mix decision for this video: percentages of YouTube footage, images and animation. Must sum to 100 and no single type may be 100. Call this AFTER asking the user — never decide the mix yourself.', {
  youtube: z.number().min(0).max(100), image: z.number().min(0).max(100), animation: z.number().min(0).max(100),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_mix', { summary: `Mix set: ${a.youtube}% YouTube / ${a.image}% images / ${a.animation}% animation` }), d => opSetPlan(d, { mix: a }));
  return { mix: r.result.mix };
});
def('set_plan', 'Store (or replace) the shot list: rows covering the voiceover back-to-back with no gaps or overlaps. Each row: {startMs,endMs, type:"youtube"|"image"|"animation", line (the exact spoken words), and per type — youtube: url,inMs,outMs,title,channel,watermark?,mask?{x,y,w,h 0..1}; image: assetId; animation: kind (stat/counter/quote/list/comparison/timeline/chapter) + graphic{...}}. Rows must respect the 14 rules in get_editor_rules.', {
  rows: z.array(z.object({
    startMs: ms, endMs: ms, type: z.enum(['youtube', 'image', 'animation']),
    line: z.string().optional(), text: z.string().optional(),
    url: z.string().optional(), title: z.string().optional(), channel: z.string().optional(),
    inMs: ms.optional(), outMs: ms.optional(), query: z.string().optional(),
    watermark: z.string().optional(), mask: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
    assetId: z.string().optional(), kind: z.string().optional(), graphic: z.record(z.any()).optional(),
    transition: z.object({ type: z.string(), dur: z.number().optional() }).optional(), note: z.string().optional(),
  })).min(1), replace: z.boolean().default(true),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_plan', { summary: `Shot list set (${a.rows.length} rows)` }), d => opSetPlan(d, { rows: a.rows, clear: !a.replace ? false : undefined }));
  const plan = r.result;
  const mix = plan.mix;
  const counts = { youtube: 0, image: 0, animation: 0 };
  for (const row of plan.rows) counts[row.type]++;
  const total = plan.rows.length;
  const actual = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v / total * 100)]));
  const issues = [];
  if (mix) for (const k of ['youtube', 'image', 'animation']) if (Math.abs(actual[k] - mix[k]) > 8) issues.push(`${k}: plan is ${actual[k]}% but the user asked for ${mix[k]}%`);
  if (plan.rows.some(r => r.type === 'youtube' && !r.url)) issues.push('Some youtube rows have no URL — either research a real one or mark them query-only.');
  return { rows: plan.rows.length, actualMix: actual, issues, voiceEndMs: plan.rows.at(-1)?.endMs };
});
def('get_plan', 'The current plan: the user’s mix %, every shot-list row (voiceover window, source cut, watermark notes) and per-row coverage on the timeline.', {}, async () => {
  const p = P();
  const plan = p.plan;
  if (!plan) return { plan: null, hint: 'No plan yet. Ask the user for the mix (set_mix), research footage, then set_plan.' };
  const rows = plan.rows.map(r => ({ ...r, placed: p.clips.some(c => c.planRowId === r.id) }));
  return { mix: plan.mix, rows, voiceEndMs: p.transcript?.voiceEndMs, lastRowEndMs: plan.rows.at(-1)?.endMs };
});
def('exec_plan', 'Materialise the shot list onto the timeline. For youtube rows: downloads ONLY the needed seconds and places them exactly on the row window (blurring the watermark region when the row has one). For image rows: places the referenced asset. For animation rows: creates the animated graphic. Runs as a background job — poll get_job.', {
  from: z.number().int().default(0), limit: z.number().int().default(500), force: z.boolean().default(false),
}, async (a, ctx) => {
  const p0 = P();
  const plan = p0.plan;
  if (!plan?.rows?.length) throw new Error('No plan to execute. set_plan first.');
  if (!plan.mix) throw new Error('No mix set. Ask the user for percentages and call set_mix first (never decide it yourself).');
  const handle = jobs.create('plan', 'Building video from shot list', { projectId: p0.id });
  const run = (async () => {
    const rows = plan.rows.slice(a.from, a.from + a.limit);
    const results = [];
    let i = 0;
    for (const row of rows) {
      i++;
      if (store.project.clips.some(c => c.planRowId === row.id)) { results.push({ row: row.id, ok: true, skipped: 'already placed' }); continue; }
      handle.update({ progress: i / rows.length }, `Row ${row.id} (${row.type})`);
      try {
        let clipId = null;
        if (row.type === 'youtube') {
          if (!row.url) throw new Error('no URL (query-only row)');
          const c = await placeClip({
            track: 'V1', startMs: row.startMs, durMs: row.endMs - row.startMs, inMs: row.inMs ?? 0,
            youtube: { url: row.url, startMs: row.inMs ?? 0, endMs: row.outMs ?? (row.inMs ?? 0) + (row.endMs - row.startMs) },
            allowLong: true, force: true, replace: false, transition: row.transition, label: row.title || row.query,
          }, cause(ctx, 'exec_plan'));
          clipId = c.id;
          if (row.mask) patchClips([{ id: c.id, patch: { mask: row.mask } }], { by: 'mcp', tool: 'exec_plan', silent: true });
        } else if (row.type === 'image') {
          if (!row.assetId) throw new Error('no assetId');
          const c = await placeClip({ assetId: row.assetId, track: 'V1', startMs: row.startMs, durMs: row.endMs - row.startMs, allowLong: true, replace: false, kenburns: true }, cause(ctx, 'exec_plan'));
          clipId = c.id;
          if (row.mask) patchClips([{ id: c.id, patch: { mask: row.mask } }], { by: 'mcp', tool: 'exec_plan', silent: true });
        } else {
          const r = store.mutate(cause(ctx, 'exec_plan', { summary: `Animation row ${row.id}` }), d => opAddAnimation(d, { startMs: row.startMs, endMs: row.endMs, kind: row.kind, graphic: row.graphic }));
          clipId = r.clip.id;
        }
        store.mutate({ by: 'system', silent: true }, d => { const c = d.clips.find(x => x.id === clipId); if (c) c.planRowId = row.id; }, { history: false });
        results.push({ row: row.id, ok: true, clipId });
      } catch (e) {
        results.push({ row: row.id, ok: false, error: e.message, note: row.query ? `UNVERIFIED: search "${row.query}"` : undefined });
      }
    }
    const failed = results.filter(r => !r.ok);
    return { placed: results.length - failed.length, failed: failed.length, results };
  })();
  return soft(handle, run, 55000);
});
def('add_animation', 'Add an animated graphic (the browser-rendered equivalent of a motion-graphics clip): kind stat | counter | quote | list | comparison | timeline | chapter, plus its data. Rendered in the preview and baked into the ffmpeg render identically.', {
  kind: z.string(), graphic: z.record(z.any()).optional(), startMs: ms.optional(), endMs: ms.optional(), beatId: z.string().optional(), track: trackId.optional(), accent: z.string().optional(),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'add_animation', { summary: `Added ${a.kind} animation` }), d => opAddAnimation(d, a));
  return { clipId: r.clip.id, startMs: frameToMs(r.clip.start), endMs: frameToMs(r.clip.start + r.clip.dur) };
});
def('set_clip_mask', 'Blur out a watermark/logo/burned-text region on a clip: x,y,w,h are 0..1 fractions of the frame (e.g. bottom-right logo: x:0.8,y:0.86,w:0.18,h:0.1). clear:true removes it. The blur is live in the preview and baked into the render.', {
  clipId: z.string(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(),
  w: z.number().min(0.02).max(1).optional(), h: z.number().min(0.02).max(1).optional(), clear: z.boolean().default(false),
}, async (a, ctx) => {
  const r = store.mutate(cause(ctx, 'set_clip_mask', { summary: a.clear ? 'Mask removed' : 'Watermark masked (blur)' }), d => opSetMask(d, a));
  return { mask: r.result };
});
def('export_notes', 'Write compact editor notes (overview, one-line-per-shot table, used-clips register, watermark report, QC) to notes.md next to the project — the short version of the documentary-editor PDF, capped so it prints in about 30 pages or fewer.', {}, async () => {
  const p = P();
  const plan = p.plan;
  const tc2 = m => `${String(Math.floor(m / 60000)).padStart(2, '0')}:${(m % 60000 / 1000).toFixed(2).padStart(5, '0')}`;
  const lines = [];
  lines.push(`# Editor notes — ${p.name}`, '');
  lines.push(`- Duration: ${tc2(p.transcript?.voiceEndMs || 0)} · Words: ${p.transcript?.words.length ?? 0}`);
  lines.push(`- Mix: ${plan?.mix ? `${plan.mix.youtube}% YouTube / ${plan.mix.image}% images / ${plan.mix.animation}% animation` : 'not set'}`, '');
  if (plan?.rows?.length) {
    lines.push('## Shot list', '', '| # | Voiceover | Type | Source / graphic | Source cut |', '|---|---|---|---|---|');
    plan.rows.forEach((r, i) => {
      const src = r.type === 'youtube' ? `[${r.title || 'video'}](${r.url})` : r.type === 'image' ? (p.assets[r.assetId]?.name || r.assetId) : `${r.kind}: ${r.graphic?.title || ''}`;
      const cut = r.type === 'youtube' ? `${tc2(r.inMs || 0)} → ${tc2(r.outMs || 0)}` : '—';
      lines.push(`| ${i + 1} | ${tc2(r.startMs)} → ${tc2(r.endMs)} | ${r.type} | ${src} | ${cut} |`);
    });
    const used = new Map();
    for (const r of plan.rows.filter(x => x.type === 'youtube' && x.url)) {
      const u = used.get(r.url) || { title: r.title, ranges: [] };
      u.ranges.push(`${tc2(r.inMs || 0)} → ${tc2(r.outMs || 0)}`);
      used.set(r.url, u);
    }
    lines.push('', '## Used clips register', '');
    for (const [url, u] of used) lines.push(`- ${u.title || url} — ${u.ranges.length} clip(s): ${u.ranges.join('; ')}`);
    const wm = plan.rows.filter(r => r.watermark);
    if (wm.length) {
      lines.push('', '## Watermark report', '');
      for (const r of wm) lines.push(`- ${tc2(r.startMs)}: ${r.watermark}${r.mask ? ` → blurred region ${JSON.stringify(r.mask)}` : ' → mask missing'}`);
    }
    const lq = plan.rows.filter(r => /low.quality/i.test(r.note || ''));
    if (lq.length) { lines.push('', '## Low-quality (essential) clips', ''); for (const r of lq) lines.push(`- ${tc2(r.startMs)}: ${r.note}`); }
  } else lines.push('_No plan yet._');
  lines.push('', '## QC', '- [ ] all lines covered, no gaps/overlaps', '- [ ] no repeated source ranges, ≤3 clips per video, never consecutive', '- [ ] rows with watermarks carry a mask', '- [ ] mix matches the user decision');
  const file = path.join(projectDir(p.id), 'notes.md');
  fs.writeFileSync(file, lines.join('\n'));
  return { file, rows: plan?.rows?.length || 0 };
});

// ------------------------------------------------------------------ studio ui hooks
def('set_playhead', 'Move the studio playhead (and optionally zoom the timeline onto a clip) so the user sees what you are talking about.', { ms: ms.optional(), clipId: z.string().optional() }, async a => {
  const c = a.clipId ? P().clips.find(x => x.id === a.clipId) : null;
  const at = a.ms ?? (c ? frameToMs(c.start) : 0);
  store.playhead = at;
  store.emit('ui', { type: 'seek', ms: at, clipId: c?.id });
  return { ms: at };
}, { ui: true });

// ------------------------------------------------------------------ qc, render, export, autopilot
def('run_qc', 'Check the edit against the rules: gaps, 5 s cap, reuse, 3-per-video, adjacency, footage ratio, pacing, sync to beats, overlay timing, hook, licences. Returns errors to fix.', {}, async () => runQC(P()));

def('render_video', 'Render the final MP4 with ffmpeg (1080p30 H.264 High, AAC 48 kHz, loudness-normalised to −14 LUFS, ends exactly at the voice end). quality:"draft" is a fast 540p check. Returns a jobId; poll get_job.', {
  quality: z.enum(['final', 'draft']).default('final'), name: z.string().optional(), wait: z.boolean().default(false),
}, async (a, ctx) => {
  const p = P();
  const handle = jobs.create('render', `Render ${a.quality}`, { projectId: p.id });
  const run = renderProject(structuredClone(p), { quality: a.quality, name: a.name, signal: handle.signal, update: handle.update }).then(r => {
    store.mutate({ by: 'system', summary: `Render finished: ${r.name}`, silent: false }, d => { d.lastRender = { file: r.name, at: Date.now(), verification: r.verification }; }, { history: false });
    return { file: r.file, name: r.name, url: `/renders/${p.id}/${encodeURIComponent(r.name)}`, verification: r.verification };
  });
  if (a.wait) return soft(handle, run, 55000);
  run.then(r => handle.done(r), e => handle.fail(e)).catch(() => {});
  return { jobId: handle.job.id, hint: 'Rendering in the background — poll get_job. The studio shows progress live.' };
});
def('autopilot', 'Fully automatic mode: for every beat without a clip, search YouTube, rank candidates by the rules, download only the chosen moment and place it exactly on the beat (plus fact overlays). Runs as a job; the user watches the timeline fill in live. Review afterwards with run_qc and replace weak clips.', {
  license: z.enum(['any', 'cc']).default('any'), maxHeight: z.number().int().default(1080), overlays: z.boolean().default(true), onlyMissing: z.boolean().default(true), limit: z.number().int().optional(), concurrency: z.number().int().min(1).max(4).default(3),
}, async (a) => {
  const handle = jobs.create('autopilot', 'Autopilot sourcing', { projectId: P().id });
  runAutopilot({ job: handle, opts: a }).then(r => handle.done(r), e => handle.fail(e)).catch(() => {});
  return { jobId: handle.job.id, hint: 'Autopilot started. Poll get_job, or just watch the studio.' };
}, { ui: true });
def('get_job', 'Status/progress/result of a background job (render, autopilot, transcription).', { id: z.string() }, async a => { const j = jobs.get(a.id); if (!j) throw new Error('Unknown job'); return j; }, { ui: true });
def('list_jobs', 'Recent background jobs.', {}, async () => ({ jobs: jobs.list() }), { ui: true });
def('cancel_job', 'Cancel a running job.', { id: z.string() }, async a => ({ cancelled: jobs.cancel(a.id) }), { ui: true });
def('export_package', 'Write the deliverables next to the render: timeline_log.csv/json, transcript_timing.json (editing record, not subtitles), sources.txt (licence flags) and retention_qc_report.md.', {}, async () => exportPackage(P(), { renderInfo: P().lastRender?.verification }));
