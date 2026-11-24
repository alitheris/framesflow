import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSentences, tokenizeScript } from '../server/transcribe.mjs';
import { buildBeats, extractKeywords, defaultChapters } from '../server/beats.mjs';
import { newProject, defaultClip, checkClip, projectFrames, migrateProject, evalKeys } from '../shared/model.mjs';
import { uid } from '../shared/model.mjs';
import { opSplitClip, opSetKeyframes, opAddTrack, opApplyEffect, opPlaceClip, opDeleteClips, opAddMarker } from '../shared/ops.mjs';
import { runQC } from '../server/qc.mjs';

// a 20 s synthetic voiceover: 8 words per sentence, 0.45 s per word, 0.6 s pauses
function fakeTranscript() {
  const words = []; let t = 300;
  const text = 'The war began in 1914 near Sarajevo. Archduke Franz Ferdinand was shot by Gavrilo Princip. Europe held its breath, and then everything changed forever in weeks.';
  for (const tok of tokenizeScript(text)) { words.push({ w: tok.w, s: t, e: t + 420 }); t += 450; if (/[.!?]$/.test(tok.w)) t += 600; }
  const sentences = buildSentences(words);
  return { words, sentences, voiceEndMs: words.at(-1).e + 100 };
}

test('sentences split on terminal punctuation, not abbreviations', () => {
  const w = tokenizeScript('Dr. Smith arrived. He left.').map((t, i) => ({ w: t.w, s: i * 100, e: i * 100 + 80 }));
  assert.equal(buildSentences(w).length, 2);
});

test('beats tile the whole voiceover with no gaps and none over 5 s', () => {
  const t = fakeTranscript();
  const beats = buildBeats(t, { topic: 'World War 1' });
  assert.ok(beats.length >= 4);
  assert.equal(beats[0].startFrame, 0);
  for (let i = 1; i < beats.length; i++) assert.equal(beats[i].startFrame, beats[i - 1].endFrame, `gap before beat ${i}`);
  assert.equal(beats.at(-1).endFrame, Math.round((t.voiceEndMs * 30) / 1000));
  for (const b of beats) assert.ok(b.endFrame - b.startFrame <= 150, `${b.id} is ${(b.endFrame - b.startFrame) / 30}s`);
});

test('keywords find names, years and joined proper nouns', () => {
  const k = extractKeywords('Then the Eagle touched down in the Sea of Tranquility near Buzz Aldrin in 1969.');
  const texts = k.map(x => x.text);
  assert.ok(texts.includes('Sea of Tranquility'));
  assert.ok(texts.includes('Buzz Aldrin'));
  assert.ok(texts.includes('1969'));
});

test('chapters cover the runtime', () => {
  const t = fakeTranscript();
  const ch = defaultChapters(buildBeats(t, {}), t.voiceEndMs, '');
  assert.equal(ch[0].startMs, 0);
  assert.equal(ch.at(-1).endMs, t.voiceEndMs);
});

test('QC flags gaps, long segments, reused sources and back-to-back clips', () => {
  const p = newProject('t');
  p.assets.a1 = { id: 'a1', kind: 'audio', name: 'v', duration: 20000, file: 'v.wav' };
  p.assets.v1 = { id: 'v1', kind: 'video', name: 'c', duration: 20000, file: 'c.mp4' };
  p.transcript = { voiceEndMs: 20000, words: [], sentences: [] };
  p.clips.push(checkClip(p, defaultClip(p, { track: 'A1', type: 'audio', assetId: 'a1', start: 0, dur: 600 })));
  const mk = (start, dur, inMs, url) => checkClip(p, defaultClip(p, { track: 'V1', assetId: 'v1', start, dur, source: { url, title: 't', license: 'x', inMs, outMs: inMs + (dur / 30) * 1000 } }));
  p.clips.push(mk(0, 200, 0, 'https://www.youtube.com/watch?v=AAAAAAAAAAA')); // 6.7 s → too long
  p.clips.push(mk(200, 90, 1000, 'https://www.youtube.com/watch?v=AAAAAAAAAAA')); // same video, back to back, overlapping range
  p.clips.push(mk(400, 100, 0, 'https://www.youtube.com/watch?v=BBBBBBBBBBB')); // gap before it
  const rules = new Set(runQC(p).issues.map(i => i.rule));
  for (const r of ['max-length', 'consecutive-source', 'reuse', 'gap']) assert.ok(rules.has(r), `expected ${r}, got ${[...rules]}`);
});

test('project length: locked to voice end only when voiceLock is set', () => {
  const p = newProject('t'); p.transcript = { voiceEndMs: 3333, words: [], sentences: [] };
  p.settings.voiceLock = true;
  assert.equal(projectFrames(p), 100);
  p.settings.voiceLock = false;
  assert.equal(projectFrames(p), 0); // free length: clips define the end
  const c = checkClip(p, defaultClip(p, { start: 0, dur: 250 }));
  p.clips.push(c);
  assert.equal(projectFrames(p), 250);
});

test('v2 projects migrate to v3 (legacy transition names, default text styles)', () => {
  const old = { version: 2, id: 'p_x', name: 'old', settings: { fps: 30, width: 1920, height: 1080 }, tracks: [{ id: 'V1', kind: 'video', name: 'Footage' }], assets: {}, clips: [{ id: 'c1', track: 'V1', type: 'video', start: 0, dur: 90, transition: { type: 'dip', dur: 6 } }, { id: 'c2', track: 'V1', type: 'text', start: 90, dur: 30, text: { kind: 'fact', title: 'Hi' } }], transcript: null, beats: [], chapters: [] };
  const p = migrateProject(old);
  assert.equal(p.version, 3);
  assert.equal(p.clips[0].transition.type, 'dipblack');
  assert.ok(p.clips[1].text.animIn); // default text style applied
  assert.ok(Array.isArray(p.markers));
  assert.equal(checkClip(p, p.clips[0]).track, 'V1');
});

test('keyframes evaluate linear/ease/hold and split across cuts', () => {
  assert.equal(evalKeys([{ frame: 0, value: 0 }, { frame: 10, value: 10 }], 5), 5);
  assert.equal(evalKeys([{ frame: 0, value: 0, interp: 'hold' }, { frame: 10, value: 10 }], 5), 0);
  const e = evalKeys([{ frame: 0, value: 0, interp: 'ease' }, { frame: 10, value: 10 }], 2.5);
  assert.ok(e < 2.5, `smoothstep should ease in (got ${e} ≥ linear 2.5)`);
  assert.ok(Math.abs(evalKeys([{ frame: 0, value: 0, interp: 'ease' }, { frame: 10, value: 10 }], 5) - 5) < 1e-9);
  const p = newProject('t');
  const c = checkClip(p, defaultClip(p, { start: 0, dur: 20 }));
  p.clips.push(c);
  opSetKeyframes(p, { clipId: c.id, property: 'scale', keys: [{ frame: 0, value: 1 }, { frame: 20, value: 2 }] });
  const [l, r] = opSplitClip(p, c.id, 10).result.map(id => p.clips.find(x => x.id === id));
  assert.ok(l.keyframes.scale.length >= 1 && l.keyframes.scale.every(k => k.frame <= 10));
  assert.equal(r.keyframes.scale[0].frame, 0);
  assert.equal(r.keyframes.scale[0].value, 1.5); // evaluated at the cut point (keys 1→2 over 20 frames)
});

test('pro ops: tracks, effects, markers, delete with ripple', () => {
  const p = newProject('t');
  const t3 = opAddTrack(p, { kind: 'video', name: 'Overlay 2' }).result;
  assert.ok(t3.id.startsWith('V'));
  assert.equal(p.tracks[0].id, t3.id); // video tracks go on top
  const c = opPlaceClip(p, { assetId: undefined, type: 'text', track: t3.id, startMs: 0, durMs: 2000, text: { kind: 'title', title: 'X' } }).clip;
  assert.equal(c.type, 'text');
  const fx = opApplyEffect(p, { clipId: c.id, type: 'blur', params: { amount: 12 } }).result;
  assert.equal(fx.params.amount, 12);
  const m = opAddMarker(p, { ms: 500, label: 'hook' }).result;
  assert.equal(p.markers.length, 1);
  const a = opPlaceClip(p, { assetId: undefined, type: 'text', track: t3.id, startMs: 2000, durMs: 1000, text: { kind: 'title', title: 'Y' } }).clip;
  const b = opPlaceClip(p, { assetId: undefined, type: 'text', track: t3.id, startMs: 3000, durMs: 1000, text: { kind: 'title', title: 'Z' } }).clip;
  opDeleteClips(p, [a.id], { ripple: true });
  assert.equal(b.start, 60); // rippled into the gap (frames: 2000 ms → 60 @30fps, minus a's 30 frames... a was 1 frame after clamp removal → check below)
  assert.throws(() => opApplyEffect(p, { clipId: c.id, type: 'not-an-effect' }));
});

// ---------------------------------------------------------------- effect layers + effect keyframes
import { resolveEffects, effectParamAt } from '../shared/model.mjs';
import { opAddEffectLayer, opSetEffectKeyframes, opClearEffectKeyframes } from '../shared/ops.mjs';

test('effect layer lives on its own video track above the footage', () => {
  const p = newProject('fx');
  const r = opAddEffectLayer(p, { startFrame: 30, durFrames: 60, effects: [{ type: 'blur', params: { amount: 12 } }] });
  assert.equal(r.clip.type, 'effect');
  assert.equal(r.clip.start, 30);
  assert.equal(r.clip.effects[0].params.amount, 12);
  assert.notEqual(r.clip.track, 'V1');
  assert.equal(p.tracks[0].id, r.clip.track, 'new effect track is the topmost layer');
  assert.throws(() => opAddEffectLayer(p, { startFrame: 0, durFrames: 10, track: 'A1', effects: ['blur'] }));
});

test('effect parameters keyframe, interpolate and validate', () => {
  const p = newProject('fx');
  const { clip } = opAddEffectLayer(p, { startFrame: 0, durFrames: 100, effects: [{ type: 'blur' }, { type: 'invert' }] });
  const [blur, inv] = clip.effects;
  opSetEffectKeyframes(p, { clipId: clip.id, effectId: blur.id, param: 'amount', keys: [{ frame: 0, value: 0 }, { frame: 100, value: 40 }] });
  assert.equal(effectParamAt(blur, 'amount', 50), 20);
  assert.equal(resolveEffects(clip.effects, 25)[0].params.amount, 10);
  assert.throws(() => opSetEffectKeyframes(p, { clipId: clip.id, effectId: inv.id, param: 'amount', add: { frame: 0, value: 1 } }), /cannot be keyframed/);
  assert.throws(() => opSetEffectKeyframes(p, { clipId: clip.id, effectId: blur.id, param: 'radius', add: { frame: 0, value: 1 } }));
  opClearEffectKeyframes(p, { clipId: clip.id, effectId: blur.id, param: 'amount' });
  assert.equal(blur.keyframes, undefined);
});

test('splitting an effect layer re-bases effect keyframes on the right half', () => {
  const p = newProject('fx');
  const { clip } = opAddEffectLayer(p, { startFrame: 0, durFrames: 100, effects: [{ type: 'blur' }] });
  opSetEffectKeyframes(p, { clipId: clip.id, effectId: clip.effects[0].id, param: 'amount', keys: [{ frame: 0, value: 0 }, { frame: 100, value: 40 }] });
  const [l, rId] = opSplitClip(p, clip.id, 50).result;
  const right = p.clips.find(c => c.id === rId), left = p.clips.find(c => c.id === l);
  assert.equal(effectParamAt(right.effects[0], 'amount', 0), 20, 'right half starts where the left half ended');
  assert.equal(effectParamAt(right.effects[0], 'amount', 50), 40);
  assert.notEqual(right.effects[0].id, left.effects[0].id);
});

// ---------------------------------------------------------------- cut-outs + audio
import { audioClips } from '../shared/model.mjs';
import { opDetachAudio } from '../shared/ops.mjs';
import { sourcesText } from '../server/exporter.mjs';

test('transparent cut-outs default to contain-fit; video audio is opt-in and detachable', () => {
  const p = newProject('c');
  p.assets.cut = { id: 'cut', kind: 'image', name: 'cut', file: 'c.png', duration: 5000, transparent: true };
  p.assets.v = { id: 'v', kind: 'video', name: 'v', file: 'v.mp4', duration: 4000, hasAudio: true, useAudio: false };
  const img = opPlaceClip(p, { assetId: 'cut', track: 'V2', startFrame: 0, durFrames: 60 }).clip;
  assert.equal(img.fit, 'contain');
  const vid = opPlaceClip(p, { assetId: 'v', track: 'V1', startFrame: 0, durFrames: 60, allowLong: true }).clip;
  assert.equal(vid.audio, false);
  assert.equal(audioClips(p).length, 0, 'silent by default');
  vid.audio = true;
  assert.equal(audioClips(p).length, 1);
  const det = opDetachAudio(p, { clipId: vid.id });
  assert.equal(det.clip.type, 'audio');
  assert.equal(vid.audio, false);
  assert.equal(audioClips(p).length, 1);
  assert.equal(audioClips(p)[0].track, det.clip.track);
});

test('sources list credits web images (cut-outs credit the original)', () => {
  const p = newProject('c');
  p.assets.o = { id: 'o', kind: 'image', name: 'o', file: 'o.jpg', source: { type: 'web-image', url: 'https://x/y.jpg', title: 'Whale', creator: 'Ann', license: 'BY 2.0', licenseUrl: 'https://cc/by' } };
  p.assets.c = { id: 'c', kind: 'image', name: 'c', file: 'c.png', transparent: true, cutoutOf: 'o' };
  opPlaceClip(p, { assetId: 'c', track: 'V2', startFrame: 30, durFrames: 60 });
  const t = sourcesText(p);
  assert.match(t, /IMAGES/); assert.match(t, /Creator: Ann/); assert.match(t, /BY 2\.0/);
});

// ---------------------------------------------------------------- HTML animations
import { fillVars, wrapHtml, lintHtml } from '../server/htmlanim.mjs';
import { ANIMATION_TEMPLATES, templateDefaults } from '../server/animtemplates.mjs';

test('animation templates escape variables (HTML and script contexts)', () => {
  assert.equal(fillVars('<b>{{t}}</b>', { t: '<img src=x onerror=1>&"' }), '<b>&lt;img src=x onerror=1&gt;&amp;&quot;</b>');
  const js = fillVars('const s = {{json:t}};', { t: '</script><script>alert(1)</script>' });
  assert.ok(!js.includes('</script>'), 'a script end tag must never survive inside a JS string');
  for (const t of ANIMATION_TEMPLATES) {
    const out = fillVars(t.html, templateDefaults(t));
    assert.ok(!/\{\{/.test(out), `${t.id} has unfilled placeholders`);
  }
});

test('wrapHtml makes a fixed transparent canvas and maps asset:// to the local asset route', () => {
  const frag = wrapHtml('<img src="asset://a_123">', { width: 1080, height: 1920, durationMs: 2500 });
  assert.match(frag, /--ff-dur:2\.500s/); assert.match(frag, /width:1080px;height:1920px/); assert.match(frag, /https:\/\/ff\.local\/asset\/a_123/);
  const doc = wrapHtml('<!doctype html><html><head><title>x</title></head><body></body></html>', { width: 1920, height: 1080, durationMs: 1000 });
  assert.equal((doc.match(/id="ff-base"/g) || []).length, 1);
  assert.ok(doc.indexOf('ff-base') < doc.indexOf('<title>'));
});

test('lintHtml flags non-deterministic or networked code', () => {
  assert.equal(lintHtml('<div style="animation:a 1s both"></div>').length, 0);
  const w = lintHtml('setTimeout(()=>1,10); Math.random(); fetch("https://x"); Date.now(); a{animation: spin 1s infinite}');
  assert.ok(w.length >= 5);
});

// ---------------------------------------------------------------- skill + brand
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, creditLine } from '../shared/brand.mjs';
import { tools as allTools } from '../server/tools.mjs';

test('the skill is complete: every reference exists, is linked from SKILL.md, and tool names it mentions are real', () => {
  const dir = path.resolve('skills/framesflow');
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: framesflow\ndescription: .{80,}/);
  for (const f of ['cash-cow-documentaries', 'video-types', 'editing-craft', 'sourcing-and-rights', 'animation', 'recipes', 'brand', 'tools']) {
    assert.ok(fs.existsSync(path.join(dir, 'references', f + '.md')), `${f}.md missing`);
    assert.ok(skill.includes(`references/${f}.md`), `${f}.md is not linked from SKILL.md`);
  }
  const names = new Set(allTools.map(t => t.name));
  const mentioned = new Set();
  for (const f of ['SKILL.md', 'references/recipes.md', 'references/editing-craft.md']) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) mentioned.add(m[1]);
  const notTools = new Set(['get_framesflow_skill'].filter(x => !names.has(x)));
  const unknown = [...mentioned].filter(n => !names.has(n) && !notTools.has(n) && !/^(snake_case|start_ms|end_ms|use_audio)$/.test(n));
  // identifiers that are parameters/values rather than tools
  const params = new Set(['only_uncovered']);
  assert.deepEqual(unknown.filter(n => !params.has(n)), [], 'the skill mentions tools that do not exist');
  assert.ok(names.has('get_framesflow_skill'));
});

test('the skill never tells the AI to hide watermarks or ignore licences', () => {
  const all = fs.readdirSync('skills/framesflow/references').map(f => fs.readFileSync(path.join('skills/framesflow/references', f), 'utf8')).join('\n') + fs.readFileSync('skills/framesflow/SKILL.md', 'utf8');
  assert.ok(!/ignore (copyright|licen[cs]es?)/i.test(all));
  assert.match(all, /Never hide a creator.s watermark/i);
});

test('brand data: Alitheris family, minimum support amount and credit line', () => {
  assert.equal(BRAND.company.name, 'Alitheris');
  assert.deepEqual(BRAND.family.map(f => f.url), ['https://kukulabs.online', 'https://growwithali.com']);
  assert.equal(BRAND.support.minUsd, 5);
  assert.match(creditLine(), /Framesflow.*Alitheris.*Kuku Labs/);
});
