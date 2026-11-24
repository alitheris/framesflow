// Render regression tests (need ffmpeg + ffprobe on PATH; skipped otherwise).
// They render tiny real projects and check the output file itself: exact aspect ratios, animated effect layers, video audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const have = bin => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
const ok = have('ffmpeg') && have('ffprobe');
const t = ok ? test : test.skip;
if (!ok) console.log('(ffmpeg/ffprobe not found, skipping render tests)');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-render-test-'));
process.env.FRAMESFLOW_HOME = home;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const model = await import('../shared/model.mjs');
const ops = await import('../shared/ops.mjs');
const { assetsDir, cacheDir, rendersDir } = await import('../server/store.mjs');
const { renderProject } = await import('../server/render.mjs');

function makeProject(name, w, h, { audio = false } = {}) {
  const p = model.newProject(name);
  p.settings.width = w; p.settings.height = h;
  for (const d of [assetsDir(p.id), cacheDir(p.id), rendersDir(p.id)]) fs.mkdirSync(d, { recursive: true });
  const file = path.join(assetsDir(p.id), 'v.mp4');
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2'];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:a', 'aac');
  spawnSync('ffmpeg', [...args, '-pix_fmt', 'yuv420p', file]);
  p.assets.a1 = { id: 'a1', kind: 'video', name: 'clip', file: 'v.mp4', duration: 2000, width: 640, height: 360, hasAudio: audio, useAudio: false };
  return p;
}
const dims = f => { const o = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().split(','); return o.map(Number); };
const meanVolume = f => Number((spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/mean_volume: (-?[\d.]+|-inf)/) || [])[1]);

for (const [label, w, h] of [['16:9', 1920, 1080], ['9:16', 1080, 1920]]) {
  t(`${label}: final and draft renders have exactly the right pixel size`, async () => {
    const p = makeProject('size-' + w, w, h);
    ops.opPlaceClip(p, { assetId: 'a1', track: 'V1', startFrame: 0, durFrames: 30, allowLong: true });
    const fin = await renderProject(p, { quality: 'final', name: 'f' });
    assert.deepEqual(dims(fin.file), [w, h]);
    const dr = await renderProject(p, { quality: 'draft', name: 'd' });
    const [dw, dh] = dims(dr.file);
    assert.equal(Math.max(dw, dh), 960, 'draft long side is 960');
    assert.ok(Math.abs(dw / dh - w / h) < 0.01, 'draft keeps the project aspect ratio');
    assert.equal(dw % 2 + dh % 2, 0, 'dimensions are even');
  });
}

t('an effect layer with keyframes changes the picture only inside its time window', async () => {
  const p = makeProject('fx', 640, 360);
  const base = ops.opPlaceClip(p, { assetId: 'a1', track: 'V1', startFrame: 0, durFrames: 60, allowLong: true }).clip;
  const L = ops.opAddEffectLayer(p, { startFrame: 20, durFrames: 20, effects: [{ type: 'exposure' }] });
  ops.opSetEffectKeyframes(p, { clipId: L.clip.id, effectId: L.clip.effects[0].id, param: 'brightness', keys: [{ frame: 0, value: -0.6 }, { frame: 19, value: -0.6 }] });
  const r = await renderProject(p, { quality: 'final', name: 'fx' });
  const avg = sec => Number((spawnSync('ffmpeg', ['-v', 'info', '-ss', String(sec), '-i', r.file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8' }).stdout.match(/YAVG=([\d.]+)/) || [])[1]);
  const before = avg(0.2), inside = avg(1.0 - 0.1), after = avg(1.7);
  assert.ok(base.id);
  assert.ok(inside < before - 25, `darker inside the layer window (before ${before}, inside ${inside})`);
  assert.ok(Math.abs(after - before) < 15, `back to normal after the window (before ${before}, after ${after})`);
});

t('video audio is silent by default, audible when switched on, and survives detaching', async () => {
  const p = makeProject('audio', 640, 360, { audio: true });
  const clip = ops.opPlaceClip(p, { assetId: 'a1', track: 'V1', startFrame: 0, durFrames: 60, allowLong: true }).clip;
  assert.equal(clip.audio, false);
  assert.ok(meanVolume((await renderProject(p, { quality: 'draft', name: 's' })).file) < -60, 'silent by default');
  clip.audio = true;
  assert.ok(meanVolume((await renderProject(p, { quality: 'draft', name: 'a' })).file) > -40, 'audible when on');
  const det = ops.opDetachAudio(p, { clipId: clip.id });
  assert.equal(det.clip.type, 'audio');
  assert.ok(meanVolume((await renderProject(p, { quality: 'draft', name: 'd' })).file) > -40, 'still audible from the detached track');
});
