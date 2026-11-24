// Turns a locked transcript into visual beats (≤5 s each, paced per the cash-cow ruleset) + keyword/fact detection.
import { FPS, uid, msToFrame, frameToMs } from './lib.mjs';

const STOP = new Set(('a an the and or but if then so of to in on at by for with from into over under about as is are was were be been being it its this that these those he she they we you i his her their our your my me him them us who whom whose which what when where why how not no nor than too very can could should would will just also there here have has had do does did done said says say get got one two out up down off more most some any each other such own same only both few many much new old after before again further once during while because until against between through above below'.split(' ')));
const GENERIC = new Set('whole nothing something everything anything little great thing things people years never ever always every another around still really actually though through without within while whilst became become before after might would could should their there where which about being during since until among across behind beyond maybe prepare helped came come went going took taken began started'.split(' '));
const CONJ = new Set(['and', 'but', 'because', 'while', 'which', 'when', 'after', 'before', 'until', 'where', 'however', 'then', 'so', 'yet', 'although', 'though']);
const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

const targetLenMs = tMs => (tMs < 30000 ? 3200 : tMs < 120000 ? 3500 : 3900);
const MAX_MS = 4900;

/** Pick split indices inside words[i0..i1] so each part lands near the target pacing. */
function splitSentence(words, i0, i1, startMs) {
  const dur = words[i1].e - words[i0].s;
  const target = targetLenMs(startMs);
  const n = Math.max(1, Math.round(dur / target + 0.25));
  if (n === 1 && dur <= MAX_MS) return [[i0, i1]];
  const parts = Math.max(n, Math.ceil(dur / MAX_MS));
  const cuts = [];
  for (let k = 1; k < parts; k++) {
    const ideal = words[i0].s + (dur * k) / parts;
    let best = null;
    for (let i = i0; i < i1; i++) {
      const gap = words[i + 1].s - words[i].e;
      const t = words[i].e;
      if (cuts.length && i <= cuts[cuts.length - 1]) continue;
      if (t - words[i0].s < 1000 || words[i1].e - t < 1000) continue;
      const dist = Math.abs(t - ideal) / target;
      const score = (/[,;:—–-]$/.test(words[i].w) ? 3 : 0) + (CONJ.has(words[i + 1].w.toLowerCase().replace(/\W/g, '')) ? 1.5 : 0) + Math.min(gap / 120, 2) - dist * 4;
      if (!best || score > best.score) best = { i, score };
    }
    if (best) cuts.push(best.i);
  }
  const out = [];
  let a = i0;
  for (const c of cuts) { out.push([a, c]); a = c + 1; }
  out.push([a, i1]);
  // a part spoken for under ~1.3 s ("but", "and then…") is merged into its neighbour
  const merged = [];
  for (const part of out.filter(([x, y]) => y >= x)) {
    const spoken = words[part[1]].e - words[part[0]].s;
    if (merged.length && spoken < 1300) merged[merged.length - 1][1] = part[1]; else merged.push([...part]);
  }
  if (merged.length > 1) { const f = merged[0]; if (words[f[1]].e - words[f[0]].s < 1300) { merged[1][0] = f[0]; merged.shift(); } }
  return merged;
}

export function extractKeywords(text, topic = '') {
  const toks = text.replace(/[“”"]/g, '').split(/\s+/).filter(Boolean);
  const out = [];
  const add = (v, type) => { v = v.replace(/^[^\w$£€]+|[^\w%]+$/g, ''); if (v && !out.some(o => o.text.toLowerCase() === v.toLowerCase())) out.push({ text: v, type }); };
  // proper-noun runs (not just sentence-initial words)
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].replace(/[^\w'’.-]/g, '');
    const sentenceInitialCommon = i === 0 && !/^[A-Z][a-zA-Z'’-]+[,.]?$/.test(toks[1] || '');
    if (/^[A-Z][a-zA-Z'’-]+$/.test(t) && !STOP.has(t.toLowerCase()) && !sentenceInitialCommon) {
      let j = i + 1, run = [t];
      while (j < toks.length) {
        if (/^[A-Z][a-zA-Z'’-]+[,.]?$/.test(toks[j]) && !STOP.has(toks[j].toLowerCase())) { run.push(toks[j].replace(/[,.]$/, '')); j++; if (/[,.]$/.test(toks[j - 1])) break; }
        else if (/^(of|the|de|von|van|da|del|la|le)$/.test(toks[j]) && /^[A-Z]/.test(toks[j + 1] || '')) { run.push(toks[j]); j++; }
        else break;
      }
      add(run.join(' '), MONTHS.test(t) ? 'date' : 'name'); i = j - 1;
    }
  }
  for (const m of text.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)) add(m[1], 'date');
  for (const m of text.matchAll(/[$£€]\s?[\d,.]+\s?(?:million|billion|trillion|thousand|k|m|bn)?|\b[\d,.]+\s?(?:million|billion|trillion|percent|%)/gi)) add(m[0].trim(), 'money');
  const nouns = toks.map(t => t.toLowerCase().replace(/[^a-z-]/g, '')).filter(t => t.length > 4 && !STOP.has(t) && !GENERIC.has(t) && !/ly$/.test(t));
  const freq = {}; nouns.forEach(n => (freq[n] = (freq[n] || 0) + 1));
  Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 4).forEach(([n]) => add(n, 'topic'));
  return out.slice(0, 7);
}

/** Build the YouTube queries a human editor would try for this beat. */
export function queriesFor(keywords, text, topic) {
  const names = keywords.filter(k => k.type === 'name' || k.type === 'date').map(k => k.text);
  const topics = keywords.filter(k => k.type === 'topic' || k.type === 'money').map(k => k.text);
  const base = [...names.slice(0, 2), ...topics.slice(0, 2)].join(' ').trim() || text.split(/\s+/).slice(0, 6).join(' ');
  const t = (topic || '').trim();
  const list = [t && !base.toLowerCase().includes(t.toLowerCase()) ? `${base} ${t}` : base, `${base} footage`, `${base} documentary`];
  return [...new Set(list.map(s => s.replace(/\s+/g, ' ').trim()))].filter(Boolean);
}

export function buildBeats(transcript, { topic = '', startFromMs = 0 } = {}) {
  const w = transcript.words;
  if (!w.length) return [];
  const beats = [];
  let id = 1;
  for (const s of transcript.sentences) {
    const parts = splitSentence(w, s.w0, s.w1, s.s);
    for (const [a, b] of parts) {
      const text = w.slice(a, b + 1).map(x => x.w).join(' ');
      const keywords = extractKeywords(text, topic);
      beats.push({
        id: 'b' + id++, sentenceId: s.id, w0: a, w1: b, text,
        firstWordMs: w[a].s, lastWordMs: w[b].e, startMs: 0, endMs: 0,
        keywords, queries: queriesFor(keywords, text, topic),
        emotion: '', visual: '', factOverlay: null, chapter: null,
      });
    }
  }
  // visual boundaries: first beat from 0, each next beat starts at its first word, last ends at the voice end
  beats.forEach((b, i) => { b.startMs = i === 0 ? 0 : b.firstWordMs; });
  beats.forEach((b, i) => { b.endMs = i === beats.length - 1 ? transcript.voiceEndMs : beats[i + 1].startMs; });
  // a long pause after a sentence would push one visual past 5 s: split it into continuation beats
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i], len = b.endMs - b.startMs;
    if (len <= 4900) continue;
    const n = Math.ceil(len / 4500);
    const parts = [];
    for (let k = 0; k < n; k++) {
      const s = Math.round(b.startMs + (len * k) / n), e = Math.round(b.startMs + (len * (k + 1)) / n);
      parts.push({ ...b, id: k === 0 ? b.id : b.id + String.fromCharCode(96 + k), startMs: s, endMs: e, continuation: k > 0 });
    }
    beats.splice(i, 1, ...parts);
    i += n - 1;
  }
  beats.forEach(b => { b.startFrame = msToFrame(b.startMs); b.endFrame = msToFrame(b.endMs); });
  for (let i = 0; i < beats.length; i++) if (beats[i].endFrame <= beats[i].startFrame) beats[i].endFrame = beats[i].startFrame + 1;
  // fact overlay suggestions: first mention of a name/date/money, spaced ≥ 12 s apart
  const seen = new Set();
  let lastFact = -1e9;
  for (const b of beats) {
    const k = b.keywords.find(x => ['money', 'date', 'name'].includes(x.type) && !seen.has(x.text.toLowerCase()) && !(x.type === 'name' && !x.text.includes(' ') && x.text.length < 5));
    b.keywords.forEach(x => seen.add(x.text.toLowerCase()));
    if (k && b.startMs - lastFact > 12000 && b.startMs > 1500) { b.factOverlay = { needed: true, text: k.text, kind: k.type }; lastFact = b.startMs; }
  }
  return beats;
}

/** Hook / Setup / Rising Action / Climax / Payoff / CTA by runtime share. */
export function defaultChapters(beats, voiceEndMs, script = '') {
  if (!beats.length) return [];
  const hookEnd = Math.min(30000, voiceEndMs * 0.12);
  const names = ['Setup', 'Rising Action', 'Climax', 'Payoff'];
  const rest = voiceEndMs - hookEnd;
  const cta = /subscribe|like and|comment below|see you in the next/i.test(script.slice(-600));
  const body = cta ? rest - Math.min(15000, rest * 0.05) : rest;
  const cuts = [{ title: 'Hook', startMs: 0 }];
  const shares = [0.2, 0.35, 0.2, 0.25];
  let at = hookEnd;
  names.forEach((n, i) => { cuts.push({ title: n, startMs: Math.round(at) }); at += body * shares[i]; });
  if (cta) cuts.push({ title: 'CTA', startMs: Math.round(voiceEndMs - Math.min(15000, rest * 0.05)) });
  return cuts.map((c, i) => ({ id: 'ch' + (i + 1), title: c.title, startMs: c.startMs, endMs: i < cuts.length - 1 ? cuts[i + 1].startMs : voiceEndMs }));
}

export { uid, frameToMs };
