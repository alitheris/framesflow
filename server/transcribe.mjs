// Voiceover -> word timestamps. Uses Whisper when installed, otherwise aligns the script to the audio with silence detection.
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG, WHISPER, WHISPER_MODEL, run, capabilities, tmpdir } from './lib.mjs';
import { probe } from './media.mjs';

export async function detectEngine() {
  return { whisper: (await capabilities()).whisper.ok };
}

const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const SENT_END = /[.!?…]["')\]]*$/;

/** "Mr." / "U.S." / "St." should not end a sentence. */
const ABBR = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|inc|ltd|no|u\.s|u\.k|e\.g|i\.e)\.$/i;

export function tokenizeScript(script) {
  return script.replace(/\r/g, '').split(/\s+/).filter(Boolean).map(t => ({ w: t, n: norm(t) })).filter(t => t.n || /[.!?]/.test(t.w));
}

export function buildSentences(words) {
  const sentences = [];
  let start = 0;
  words.forEach((t, i) => {
    const last = i === words.length - 1;
    if ((SENT_END.test(t.w) && !ABBR.test(t.w)) || last) {
      const slice = words.slice(start, i + 1);
      sentences.push({ id: 's' + (sentences.length + 1), text: slice.map(x => x.w).join(' '), s: slice[0].s, e: slice[slice.length - 1].e, w0: start, w1: i });
      start = i + 1;
    }
  });
  return sentences;
}

/** Trailing silence detection: the real audible end of the voiceover. */
export async function audioFacts(file) {
  const info = await probe(file);
  const r = await run(FFMPEG, ['-v', 'info', '-i', file, '-vn', '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], { timeout: 300000 });
  const silences = [];
  let cur = null;
  for (const line of r.stderr.split('\n')) {
    let m;
    if ((m = line.match(/silence_start:\s*(-?[\d.]+)/))) cur = Math.max(0, parseFloat(m[1]) * 1000);
    else if ((m = line.match(/silence_end:\s*([\d.]+)/)) && cur != null) { silences.push({ s: cur, e: parseFloat(m[1]) * 1000 }); cur = null; }
  }
  if (cur != null) silences.push({ s: cur, e: info.duration });
  const tail = silences.find(x => x.e >= info.duration - 30);
  return { durationMs: info.duration, silences, audibleEndMs: tail ? Math.round(tail.s) : info.duration };
}

/** Banded-free Needleman-Wunsch of ASR words (b) against script tokens (a). Returns map scriptIndex -> asrIndex. */
function alignSequences(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 36e6) return null;
  const W = m + 1;
  const dp = new Int16Array((n + 1) * W);
  const sim = (x, y) => (x === y ? 3 : (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x) || (Math.abs(x.length - y.length) <= 1 && x.slice(0, 3) === y.slice(0, 3)))) ? 1 : -2);
  for (let i = 1; i <= n; i++) dp[i * W] = -i;
  for (let j = 1; j <= m; j++) dp[j] = -j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    dp[i * W + j] = Math.max(dp[(i - 1) * W + j - 1] + sim(a[i - 1], b[j - 1]), dp[(i - 1) * W + j] - 1, dp[i * W + j - 1] - 1);
  }
  const map = new Map();
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const s = sim(a[i - 1], b[j - 1]);
    if (dp[i * W + j] === dp[(i - 1) * W + j - 1] + s) { if (s > 0) map.set(i - 1, j - 1); i--; j--; }
    else if (dp[i * W + j] === dp[(i - 1) * W + j] - 1) i--;
    else j--;
  }
  return map;
}

/** Give script tokens timings using ASR anchors; unmatched stretches are interpolated by character weight. */
function transferTimings(tokens, asr) {
  const map = alignSequences(tokens.map(t => t.n), asr.map(w => norm(w.w)));
  if (!map || map.size < Math.min(tokens.length, asr.length) * 0.4) return null;
  const out = tokens.map((t, i) => (map.has(i) ? { w: t.w, s: asr[map.get(i)].s, e: asr[map.get(i)].e, anchor: true } : { w: t.w, anchor: false }));
  let i = 0;
  while (i < out.length) {
    if (out[i].anchor) { i++; continue; }
    let j = i; while (j < out.length && !out[j].anchor) j++;
    const left = i > 0 ? out[i - 1].e : asr[0].s;
    const right = j < out.length ? out[j].s : asr[asr.length - 1].e;
    const weights = out.slice(i, j).map(x => Math.max(2, norm(x.w).length));
    const total = weights.reduce((x, y) => x + y, 0);
    let t = left;
    for (let k = i; k < j; k++) { const d = Math.max(0, right - left) * (weights[k - i] / total); out[k].s = Math.round(t); out[k].e = Math.round(t + d); t += d; }
    i = j;
  }
  return out.map(({ w, s, e }) => ({ w, s, e }));
}

/** No ASR available: spread script words over the voiced time, snapping sentence ends to real pauses. */
function alignByPauses(tokens, facts) {
  const D = facts.audibleEndMs;
  const silences = facts.silences.filter(x => x.e - x.s >= 180 && x.s < D);
  const voiced = [];
  let t = 0;
  for (const s of silences) { if (s.s > t) voiced.push([t, Math.min(s.s, D)]); t = Math.max(t, s.e); }
  if (t < D) voiced.push([t, D]);
  if (!voiced.length) voiced.push([0, D]);
  const V = voiced.reduce((a, [s, e]) => a + (e - s), 0);
  const toReal = v => { for (const [s, e] of voiced) { if (v <= e - s) return s + v; v -= e - s; } return voiced[voiced.length - 1][1]; };
  const weights = tokens.map(x => Math.max(2, norm(x.w).length) + (/[.!?]$/.test(x.w) ? 3 : /[,;:]$/.test(x.w) ? 1.5 : 0));
  const W = weights.reduce((a, b) => a + b, 0);
  let cum = 0;
  const words = tokens.map((tk, i) => {
    const v0 = (cum / W) * V; cum += weights[i]; const v1 = (cum / W) * V;
    return { w: tk.w, s: Math.round(toReal(v0)), e: Math.round(toReal(v1)) };
  });
  // snap sentence boundaries onto the nearest real pause, then re-spread inside each sentence
  const sents = buildSentences(words);
  const anchors = [];
  sents.forEach((s, k) => {
    if (k === sents.length - 1) return;
    const mid = (words[s.w1].e + words[s.w1 + 1].s) / 2;
    const near = silences.filter(x => Math.abs((x.s + x.e) / 2 - mid) < 900).sort((a, b) => Math.abs((a.s + a.e) / 2 - mid) - Math.abs((b.s + b.e) / 2 - mid))[0];
    anchors.push(near ? { endBefore: near.s, startAfter: near.e } : null);
  });
  sents.forEach((s, k) => {
    const lo = k === 0 ? words[0].s : anchors[k - 1]?.startAfter ?? words[s.w0].s;
    const hi = k === sents.length - 1 ? words[words.length - 1].e : anchors[k]?.endBefore ?? words[s.w1].e;
    if (hi - lo < 200) return;
    const ws = words.slice(s.w0, s.w1 + 1);
    const wt = ws.map(x => Math.max(2, norm(x.w).length) + (/[,;:]$/.test(x.w) ? 1.5 : 0));
    const tot = wt.reduce((a, b) => a + b, 0);
    let c = lo;
    ws.forEach((x, i) => { x.s = Math.round(c); c += ((hi - lo) * wt[i]) / tot; x.e = Math.round(c); });
  });
  return words;
}

async function runWhisper(file, { script, language, model, onLine }) {
  const out = tmpdir();
  const args = [file, '--model', model, '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', out, '--fp16', 'False', '--condition_on_previous_text', 'False', '--verbose', 'False'];
  if (language) args.push('--language', language);
  if (script) args.push('--initial_prompt', script.slice(0, 500).replace(/\s+/g, ' '));
  const r = await run(WHISPER, args, { timeout: 45 * 60 * 1000, onStderr: onLine, onStdout: onLine });
  const jf = fs.readdirSync(out).find(f => f.endsWith('.json'));
  if (r.code !== 0 || !jf) { fs.rmSync(out, { recursive: true, force: true }); throw new Error('Whisper failed: ' + r.stderr.trim().split('\n').slice(-3).join(' ')); }
  const j = JSON.parse(fs.readFileSync(path.join(out, jf), 'utf8'));
  fs.rmSync(out, { recursive: true, force: true });
  const words = [];
  for (const seg of j.segments) for (const w of seg.words || []) words.push({ w: w.word.trim(), s: Math.round(w.start * 1000), e: Math.round(w.end * 1000) });
  return { words, language: j.language };
}

/**
 * Returns a locked-timeline transcript: { engine, words, sentences, voiceEndMs, notes[] }.
 * engine: 'whisper+script' | 'whisper' | 'aligned-estimate'
 */
export async function transcribe(file, { script = '', language, model = WHISPER_MODEL, engine = 'auto', onLine } = {}) {
  const facts = await audioFacts(file);
  const tokens = script ? tokenizeScript(script) : [];
  const notes = [];
  let words = null, used = 'aligned-estimate';
  const eng = await detectEngine();
  if (engine !== 'estimate' && eng.whisper) {
    try {
      const asr = await runWhisper(file, { script, language, model, onLine });
      if (asr.words.length) {
        const mapped = tokens.length ? transferTimings(tokens, asr.words) : null;
        words = mapped || asr.words; used = mapped ? 'whisper+script' : 'whisper';
        if (tokens.length && !mapped) notes.push('Script and audio differ too much to align; using the spoken words as heard.');
      }
    } catch (e) { notes.push(e.message); }
  } else if (engine !== 'estimate') notes.push('Whisper not found — install it for millisecond-accurate word timing (pip install openai-whisper). Using pause-aligned estimate.');
  if (!words) {
    if (!tokens.length) throw new Error('No Whisper and no script: add a script or install Whisper to time the voiceover.');
    words = alignByPauses(tokens, facts);
    notes.push('Timings are estimated from the script and detected pauses (±150–400 ms). Use Whisper for frame-accurate sync.');
  }
  // keep everything strictly increasing and inside the audio
  let prev = 0;
  for (const w of words) { w.s = Math.max(prev, Math.min(w.s, facts.durationMs)); w.e = Math.max(w.s + 20, Math.min(w.e, facts.durationMs)); prev = w.s; }
  const lastEnd = words[words.length - 1].e;
  const voiceEndMs = Math.abs(facts.audibleEndMs - lastEnd) < 1500 ? Math.max(lastEnd, facts.audibleEndMs - 0) : Math.min(facts.durationMs, lastEnd + 250);
  const sentences = buildSentences(words);
  return { engine: used, model: used.startsWith('whisper') ? model : null, language: language || null, words, sentences, voiceEndMs: Math.round(voiceEndMs), audioDurationMs: facts.durationMs, notes, createdAt: Date.now() };
}
