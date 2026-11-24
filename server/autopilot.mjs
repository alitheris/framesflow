// Automatic clip sourcing: for every beat, search YouTube, score candidates by the editing rules, download only the chosen moment and place it.
// This is the "no chat" mode. When an AI is connected over MCP it can direct the same steps with real judgement (and look at frames).
import { frameToMs } from './lib.mjs';
import { store } from './store.mjs';
import { search, info, videoId } from './youtube.mjs';
import { placeClip, addOverlay, checkSourceRules } from './timeline.mjs';
import { sortedTrack } from './project.mjs';

const BAD_TITLE = /\b(reaction|react|review|tier list|top \d+|podcast|shorts?|tutorial|how to|trailer|live stream|livestream|asmr|meme|compilation of|breaking news|news|explained|vlog|unboxing|gameplay|full movie|lyrics)\b/i;
const DIRTY_TITLE = /\b(for kids|kids|children|cartoon|animated|animation|subtitles?|captions?|karaoke|with text|infographic|slideshow|powerpoint|ppt|minecraft|roblox|fortnite)\b/i;
const NEWS_CHANNEL = /\b(news|cnn|bbc|fox|msnbc|nbc|abc news|cbs|sky news|reuters|al jazeera|ndtv|wion)\b/i;
const STOP = new Set('the a an of and to in on for with from by is are was were it its this that these those at as be or his her their our your'.split(' '));
const words = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

export function scoreCandidate(v, beat, topic, ledger) {
  let s = 0;
  const kw = new Set([...beat.keywords.flatMap(k => words(k.text)), ...words(topic || '')]);
  const tw = new Set(words(v.title + ' ' + v.channel));
  let hit = 0; kw.forEach(w => { if (tw.has(w)) hit++; });
  s += Math.min(hit, 5) * 2.2;
  if (BAD_TITLE.test(v.title)) s -= 5;
  if (DIRTY_TITLE.test(v.title)) s -= 4;
  if (NEWS_CHANNEL.test(v.channel) || /\bnews\b/i.test(v.title)) s -= 3.5;
  const d = v.durationSec ?? 0;
  if (d < 10) s -= 6; else if (d < 25) s -= 1; else if (d <= 1500) s += 1.5; else if (d > 3600) s -= 2.5;
  if (v.views) s += Math.min(2, Math.log10(v.views + 1) / 4);
  if (/footage|archive|archival|documentary|b-roll|broll|raw|historic|timelapse|drone|4k|hd/i.test(v.title)) s += 1.5;
  if (/Creative Commons/i.test(v.license || '')) s += 1;
  const used = ledger.count(v.id);
  if (used >= 3) s -= 100; else s -= used * 1.2;
  return s;
}

/** Choose a start time inside the video that is not at the intro/outro and doesn't collide with an earlier use. */
export function pickMoment(meta, durMs, takenRanges, beatIdx) {
  const total = (meta.durationSec || 0) * 1000;
  if (total < durMs + 2000) return null;
  const minStart = total > 40000 ? 6000 : 0; // skip channel intros
  const free = s => !takenRanges.some(([a, b]) => s < b && a < s + durMs) && s >= minStart && s + durMs <= total - 500;
  const tries = [];
  for (const h of meta.mostReplayed || []) tries.push(Math.round(h.startSec * 1000));
  const lo = Math.max(minStart, Math.min(total * 0.1, 20000)), hi = Math.max(lo + 1, total - durMs - Math.min(total * 0.08, 15000));
  for (let k = 0; k < 8; k++) tries.push(Math.round(lo + ((beatIdx * 0.37 + k * 0.173) % 1) * (hi - lo)));
  return tries.find(free) ?? null;
}

class Ledger {
  constructor(p) { this.uses = new Map(); this.ranges = new Map(); this.byBeat = new Map(); for (const c of p.clips) if (c.track === 'V1' && c.source?.url) this.add(videoId(c.source.url), c.source.inMs, c.source.outMs, c.beatId); }
  count(id) { return this.uses.get(id) || 0; }
  taken(id) { return this.ranges.get(id) || []; }
  add(id, a, b, beatId) { this.uses.set(id, this.count(id) + 1); this.ranges.set(id, [...this.taken(id), [a, b]]); if (beatId) this.byBeat.set(beatId, id); }
  release(id, a, b, beatId) { this.uses.set(id, Math.max(0, this.count(id) - 1)); this.ranges.set(id, this.taken(id).filter(([x, y]) => !(x === a && y === b))); if (this.byBeat.get(beatId) === id) this.byBeat.delete(beatId); }
}

export async function runAutopilot({ job, opts = {} }) {
  const { license = 'any', maxHeight = 1080, overlays = true, onlyMissing = true, concurrency = 3, limit } = opts;
  const p0 = store.project;
  if (!p0.beats.length) throw new Error('No beats yet. Import the voiceover, transcribe it and build beats first.');
  const ledger = new Ledger(p0);
  const queue = p0.beats.filter(b => !onlyMissing || !store.project.clips.some(c => c.track === 'V1' && c.beatId === b.id)).slice(0, limit || 1e9);
  const stats = { placed: 0, failed: [], total: queue.length };
  const order = p0.beats.map(b => b.id);
  let next = 0, done = 0;

  /** Find, download and place one clip for a beat; returns the chosen video id. */
  async function fillBeat(beat, exclude = new Set()) {
    const idx = order.indexOf(beat.id);
    const durMs = frameToMs(beat.endFrame - beat.startFrame);
    const pool = new Map();
    for (const q of beat.queries.slice(0, 3)) {
      const results = await search(q, { limit: 8, license: license === 'cc' ? 'cc' : 'any', minSec: 12 }).catch(() => []);
      for (const v of results) if (!pool.has(v.id)) pool.set(v.id, { v, q, s: scoreCandidate(v, beat, store.project.settings.topic, ledger) });
      if ([...pool.values()].filter(x => x.s > 0).length >= 4) break;
    }
    const ranked = [...pool.values()].filter(x => x.s > -4 && !exclude.has(x.v.id)).sort((a, b) => b.s - a.s).slice(0, 8);
    let lastErr = 'no suitable footage found';
    for (const { v, q } of ranked) {
      if (job.signal.aborted) throw new Error('Cancelled');
      const neighbours = [order[idx - 1], order[idx + 1]].map(id => ledger.byBeat.get(id));
      if (neighbours.includes(v.id) || ledger.count(v.id) >= 3) continue;
      const meta = await info(v.url).catch(() => null);
      if (!meta) continue;
      const start = pickMoment(meta, durMs, ledger.taken(v.id), idx);
      if (start == null) continue;
      if (checkSourceRules(store.project, { url: v.url, inMs: start, outMs: start + durMs, beatId: beat.id }).length) continue;
      if ([order[idx - 1], order[idx + 1]].map(id => ledger.byBeat.get(id)).includes(v.id)) continue; // a neighbour reserved it while we were looking
      ledger.add(v.id, start, start + durMs, beat.id); // reserve before the (slow) download
      try {
        await placeClip({
          beatId: beat.id, youtube: { url: v.url, startMs: start, query: q }, maxHeight, force: true,
          transition: beat.startMs < 30000 && idx % 6 === 5 ? { type: 'dissolve', dur: 4 } : undefined,
          kenburns: idx % 4 === 1 ? { from: 1, to: 1.05 } : undefined,
        }, { by: 'auto', tool: 'autopilot', silent: true });
        return v.id;
      } catch (e) { lastErr = e.message; ledger.release(v.id, start, start + durMs, beat.id); }
    }
    throw new Error(lastErr);
  }

  const tick = (beat, ok) => {
    done++;
    job.update({ progress: Math.min(0.97, done / queue.length), message: `Beat ${done}/${queue.length} — ${stats.placed} placed, ${stats.failed.length} need attention` });
    store.broadcast({ by: 'auto', tool: 'autopilot', summary: done % 5 === 0 ? `Autopilot: ${stats.placed}/${queue.length} beats filled` : undefined, silent: done % 5 !== 0 });
  };

  async function work() {
    while (next < queue.length) {
      if (job.signal.aborted) throw new Error('Cancelled');
      const beat = queue[next++];
      try {
        await fillBeat(beat);
        stats.placed++;
        if (overlays && beat.factOverlay?.needed && !store.project.clips.some(c => c.track === 'V2' && c.beatId === beat.id))
          addOverlay({ beatId: beat.id, kind: 'fact', title: beat.factOverlay.text, label: beat.factOverlay.kind === 'date' ? 'Date' : beat.factOverlay.kind === 'money' ? 'Amount' : 'Name', startMs: beat.firstWordMs, endMs: Math.min(beat.endMs, beat.firstWordMs + 3200) }, { by: 'auto', tool: 'autopilot', silent: true });
      } catch (e) {
        if (job.signal.aborted) throw e;
        stats.failed.push({ beatId: beat.id, text: beat.text.slice(0, 60), error: e.message });
      }
      tick(beat);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, work));

  // repair pass: parallel workers can pick the same video for neighbouring beats
  for (let pass = 0; pass < 2; pass++) {
    const v1 = sortedTrack(store.project, 'V1');
    const bad = v1.filter((c, i) => i > 0 && c.source?.url && v1[i - 1].source?.url && videoId(c.source.url) === videoId(v1[i - 1].source.url) && c.beatId);
    if (!bad.length) break;
    job.update({ message: `Fixing ${bad.length} back-to-back repeats` });
    for (const c of bad) {
      const beat = store.project.beats.find(b => b.id === c.beatId);
      if (!beat) continue;
      const vid = videoId(c.source.url);
      try {
        ledger.release(vid, c.source.inMs, c.source.outMs, beat.id);
        await fillBeat(beat, new Set([vid]));
      } catch { ledger.add(vid, c.source.inMs, c.source.outMs, beat.id); }
    }
  }
  return stats;
}
