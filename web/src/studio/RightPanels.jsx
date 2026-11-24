import React, { useState } from 'react';
import { Link2, ExternalLink, Sparkles, Cog, Pencil, Radio, Trash2, Copy, Scissors, Plus, Diamond, FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { useApp, tool, tc, FPS, curFps, frameMs, msFrame, isServer, toast } from '../api';
import { Slider, Field, Select, Chip, ago } from './ui';
import * as T from './transport';
import { propAt, TRANSITIONS as TRANSITION_DEFS, EFFECTS as EFFECT_DEFS, TEXT_ANIMS_IN, TEXT_ANIMS_OUT, TEXT_FONTS, TEXT_KINDS, TEXT_POSITIONS, KEYFRAMABLE, FORMATS, FPS_OPTIONS, effectById, defaultEffectParams, EFFECT_KEYFRAMABLE, effectParamAt } from '../../../shared/model.mjs';

const GRADES = ['none', 'cinema', 'documentary', 'archival', 'vivid', 'noir', 'warm'];
const POS = TEXT_POSITIONS;
const edit = (id, patch) => tool('edit_clip', { patches: [{ id, patch }] });

// ---------------------------------------------------------------- keyframes
function KeyframeRow({ project, clip, prop, label, min, max, step, unit = '', base }) {
  const keys = clip.keyframes?.[prop] || [];
  const fps = project.settings?.fps || 30;
  const frame = Math.floor(T.getFrame());
  const local = Math.max(0, frame - clip.start);
  const eff = keys.length ? propAt(clip, prop, frame, fps) : (base ?? clip[prop] ?? 0);
  const atKey = keys.find(k => k.frame === local);
  const add = () => tool('set_keyframes', { clipId: clip.id, property: prop, add: { frame: local, value: eff, interp: 'linear' } });
  const del = () => tool('clear_keyframes', { clipId: clip.id, property: prop });
  const setVal = v => atKey
    ? tool('set_keyframes', { clipId: clip.id, property: prop, add: { frame: local, value: v, interp: atKey.interp } })
    : edit(clip.id, { [prop]: v });
  return (
    <div className="kf-row">
      <Slider label={label} value={eff} min={min} max={max} step={step} unit={unit}
        onCommit={setVal} keyframed={keys.length > 0} />
      <span className="kf-btns">
        <button className={`icon sm ${keys.length ? 'on' : ''}`} title={keys.length ? 'Keyframed — click to add key at the playhead' : 'Animate this property (adds a key at the playhead)'} onClick={add}><Diamond size={12} /></button>
        {!!keys.length && <button className="icon sm" title="Remove all keys on this property" onClick={del}><Trash2 size={11} /></button>}
      </span>
      {!!keys.length && <div className="kf-keys">{keys.map(k => (
        <button key={k.frame} className={`kf ${k.frame === local ? 'at' : ''}`} title={`${(k.frame / fps).toFixed(2)}s → ${(+k.value).toFixed(2)} (${k.interp}) — double-click to delete`}
          onClick={() => T.seek(clip.start + k.frame)}
          onDoubleClick={() => tool('set_keyframes', { clipId: clip.id, property: prop, keys: keys.filter(x => x !== k).map(x => x) })}>
          <i style={{ left: `${Math.min(100, (k.frame / Math.max(1, clip.dur)) * 100)}%` }} />
        </button>))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- effect parameter with keyframes
function EffectParamRow({ project, clip, effect, p }) {
  const fps = project.settings?.fps || 30;
  const canKey = (EFFECT_KEYFRAMABLE[effect.type] || []).includes(p.key);
  const keys = effect.keyframes?.[p.key] || [];
  const frame = Math.floor(T.getFrame());
  const local = Math.max(0, Math.min(clip.dur, frame - clip.start));
  const value = keys.length ? effectParamAt(effect, p.key, local, p.def) : (effect.params[p.key] ?? p.def);
  const atKey = keys.find(k => k.frame === local);
  const kf = payload => tool('set_effect_keyframes', { clipId: clip.id, effectId: effect.id, param: p.key, ...payload }, { quiet: true });
  const setVal = v => atKey ? kf({ add: { frame: local, value: v, interp: atKey.interp } })
    : keys.length ? kf({ add: { frame: local, value: v, interp: 'linear' } })
    : tool('update_effect', { clipId: clip.id, effectId: effect.id, params: { [p.key]: v } }, { quiet: true });
  return (
    <div className="kf-row">
      <Slider label={p.label} value={value} min={p.min} max={p.max} step={p.step} onCommit={setVal} keyframed={keys.length > 0} />
      {canKey && <span className="kf-btns">
        <button className={`icon sm ${keys.length ? 'on' : ''}`} title={keys.length ? 'Keyframed — click to add a key at the playhead' : 'Animate this parameter (adds a key at the playhead)'} onClick={() => kf({ add: { frame: local, value, interp: 'linear' } })}><Diamond size={12} /></button>
        {!!keys.length && <button className="icon sm" title="Remove all keys on this parameter" onClick={() => tool('clear_effect_keyframes', { clipId: clip.id, effectId: effect.id, param: p.key }, { quiet: true })}><Trash2 size={11} /></button>}
      </span>}
      {!!keys.length && <div className="kf-keys">{keys.map(k => (
        <button key={k.frame} className={`kf ${k.frame === local ? 'at' : ''}`} title={`${(k.frame / fps).toFixed(2)}s → ${(+k.value).toFixed(2)} (${k.interp}) — double-click to delete`}
          onClick={() => T.seek(clip.start + k.frame)}
          onDoubleClick={() => kf({ keys: keys.filter(x => x !== k) })}>
          <i style={{ left: `${Math.min(100, (k.frame / Math.max(1, clip.dur)) * 100)}%` }} />
        </button>))}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- HTML animation editor
function AnimationEditor({ asset }) {
  const a = asset.animation;
  const tpl = a.template;
  const [vars, setVars] = useState(a.vars || {});
  const [html, setHtml] = useState(a.html || '');
  const [busy, setBusy] = useState(false);
  const keys = Object.keys(a.vars || {});
  const run = async () => {
    setBusy(true);
    try { const r = await tool('update_animation', tpl ? { assetId: asset.id, vars } : { assetId: asset.id, html }); if (r?.warnings?.length) toast(r.warnings[0], 'error'); }
    catch { /* toast */ } finally { setBusy(false); }
  };
  return (
    <div className="grp"><h4>Animation</h4>
      {tpl ? keys.map(k => (
        <label key={k} className="fld"><span>{k}</span><input type={k === 'accent' ? 'color' : 'text'} value={vars[k] ?? ''} onChange={e => setVars(v => ({ ...v, [k]: e.target.value }))} /></label>
      )) : <textarea className="anim-html" spellCheck={false} value={html} onChange={e => setHtml(e.target.value)} />}
      <button className="btn" disabled={busy} onClick={run}>{busy ? 'Rendering…' : 'Re-render animation'}</button>
      <p className="note">Re-rendering swaps every clip that uses this animation. Position, effects and keyframes are kept.</p>
    </div>
  );
}

// ---------------------------------------------------------------- effects stack
function EffectsStack({ project, clip }) {
  const [pick, setPick] = useState('');
  const fx = clip.effects || [];
  return (
    <div className="grp"><h4>{clip.type === 'effect' ? 'Effects on this layer' : 'Effects stack'}</h4>
      {fx.map(e => {
        const def = effectById(e.type);
        return (
          <div key={e.id} className="fx-item">
            <header><b>{def?.label || e.type}</b><button className="icon sm" title="Remove effect" onClick={() => tool('remove_effect', { clipId: clip.id, effectId: e.id }, { quiet: true })}><Trash2 size={12} /></button></header>
            {(def?.params || []).map(p => p.type === 'color' ? (
              <label key={p.key} className="fld"><span>{p.label}</span><input type="color" value={e.params[p.key] || p.def} onChange={ev => tool('update_effect', { clipId: clip.id, effectId: e.id, params: { [p.key]: ev.target.value } }, { quiet: true })} /></label>
            ) : p.type === 'select' ? (
              <Select key={p.key} label={p.label} value={e.params[p.key] ?? p.def} onChange={v => tool('update_effect', { clipId: clip.id, effectId: e.id, params: { [p.key]: v } }, { quiet: true })} options={p.options} />
            ) : (
              <EffectParamRow key={p.key} project={project} clip={clip} effect={e} p={p} />
            ))}
          </div>
        );
      })}
      <div className="row2">
        <Select label="" value={pick} onChange={v => setPick(v)} options={[{ v: '', l: 'Add effect…' }, ...EFFECT_DEFS.map(e => ({ v: e.id, l: `${e.label} (${e.group})` }))]} />
        <button className="btn" disabled={!pick} onClick={() => { tool('apply_effect', { clipId: clip.id, type: pick }, { quiet: true }); setPick(''); }}><Plus size={14} /> Add</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- text style
function TextEditor({ project, clip }) {
  const t = clip.text;
  const set = patch => edit(clip.id, { text: { ...t, ...patch } });
  return (
    <div className="grp"><h4>Text</h4>
      <Select label="Style" value={t.kind} onChange={v => set({ kind: v })} options={TEXT_KINDS} />
      <Field label={t.kind === 'chapter' ? 'Chapter title' : 'Headline'} value={t.title} onCommit={v => edit(clip.id, { text: { ...t, title: v }, label: v })} />
      <Field label="Detail" value={t.body} multiline={2} onCommit={v => set({ body: v })} />
      <div className="row2"><Field label="Label" value={t.label} onCommit={v => set({ label: v })} />
        <Select label="Position" value={t.position || 'auto'} onChange={v => set({ position: v === 'auto' ? undefined : v })} options={[{ v: 'auto', l: 'Auto' }, ...POS]} /></div>
      <div className="row2">
        <Select label="Font" value={t.font || 'Montserrat'} onChange={v => set({ font: v })} options={TEXT_FONTS.map(f => ({ v: f.id, l: f.label }))} />
        <Select label="Weight" value={String(t.weight || 800)} onChange={v => set({ weight: +v })} options={['400', '600', '700', '800', '900']} />
      </div>
      <div className="row2">
        <label className="fld"><span>Colour</span><input type="color" value={t.color || '#ffffff'} onChange={e => set({ color: e.target.value })} /></label>
        <label className="fld"><span>Accent</span><input type="color" value={t.accent || project.settings.accent} onChange={e => set({ accent: e.target.value })} /></label>
      </div>
      <div className="row3">
        <Field label="Size (px)" type="number" value={t.fontSize || 96} onCommit={v => set({ fontSize: Math.max(12, +v) })} />
        <Field label="Stroke" type="number" value={t.strokeWidth || 0} onCommit={v => set({ strokeWidth: Math.max(0, +v) })} />
        <Slider label="Shadow" value={t.shadow ?? 0.6} min={0} max={1} step={0.05} onCommit={v => set({ shadow: v })} />
      </div>
      <div className="row2">
        <Select label="Align" value={t.align || 'center'} onChange={v => set({ align: v })} options={['left', 'center', 'right']} />
        <Slider label="Letter spacing" value={t.letterSpacing || 0} min={-10} max={40} step={1} onCommit={v => set({ letterSpacing: v })} />
      </div>
      <h4 className="sub">Animation</h4>
      <div className="row2">
        <Select label="In" value={t.animIn || 'fade'} onChange={v => set({ animIn: v })} options={TEXT_ANIMS_IN.map(a => ({ v: a, l: a === 'none' ? 'None' : a }))} />
        <Select label="Out" value={t.animOut || 'none'} onChange={v => set({ animOut: v })} options={TEXT_ANIMS_OUT.map(a => ({ v: a, l: a === 'none' ? 'None' : a }))} />
      </div>
      <Slider label="Anim length" value={t.animDur || 18} min={2} max={90} step={1} fmt={v => `${(v / (project.settings?.fps || 30)).toFixed(1)}s`} onCommit={v => set({ animDur: Math.round(v) })} />
    </div>
  );
}

// ---------------------------------------------------------------- inspector
export function Inspector({ project, selected, ops }) {
  const ids = [...selected];
  const clip = ids.length === 1 ? project.clips.find(c => c.id === ids[0]) : null;
  const fps = project.settings?.fps || 30;
  if (ids.length > 1) {
    return <div className="panel-scroll insp"><h3 className="insp-h">{ids.length} clips selected</h3>
      <div className="row2"><button className="btn" onClick={ops.duplicate}><Copy size={14} /> Duplicate</button><button className="btn danger" onClick={() => ops.remove(false)}><Trash2 size={14} /> Delete</button></div>
      <p className="note">Drag to move them together. Shift/Ctrl-click toggles selection.</p></div>;
  }
  if (!clip) return <ProjectSettings project={project} />;
  const asset = project.assets[clip.assetId];
  const g = typeof clip.grade === 'object' && clip.grade ? clip.grade : {};
  const gradeName = typeof clip.grade === 'string' ? clip.grade : g.preset || '';
  const isAudio = clip.type === 'audio', isText = clip.type === 'text', isEffect = clip.type === 'effect', isVisual = !isAudio && !isText && !isEffect;
  const kb = clip.kenburns;
  const defGain = project.tracks.find(t => t.id === clip.track)?.role === 'music' ? project.settings.musicDb : project.tracks.find(t => t.id === clip.track)?.role === 'sfx' ? -16 : 0;
  const fx = project.settings;

  return (
    <div className="panel-scroll insp">
      <h3 className="insp-h">{isEffect ? 'Effect layer' : isText ? 'Text' : isAudio ? 'Audio clip' : clip.type === 'image' ? 'Image' : 'Video clip'}<span>{clip.track}</span></h3>
      <Field label="Name" value={clip.label || asset?.name || ''} onCommit={v => edit(clip.id, { label: v })} />

      <div className="grp"><h4>Timing</h4>
        <div className="row3">
          <Field label="Start" mono value={tc(clip.start, true, fps)} onCommit={v => { const p = v.split(':').map(Number); if (p.every(Number.isFinite)) edit(clip.id, { start: p[0] * 60 * fps + (p[1] || 0) * fps + (p[2] || 0) }); }} />
          <Field label="Length (s)" type="number" value={+(clip.dur / fps).toFixed(2)} onCommit={v => edit(clip.id, { dur: Math.max(1, Math.round(v * fps)) })} />
          {!isText && !isEffect && <Field label="In (s)" type="number" value={+(clip.in / 1000).toFixed(2)} onCommit={v => edit(clip.id, { in: Math.max(0, Math.round(v * 1000)) })} />}
        </div>
        {!isText && !isEffect && <Slider label="Speed" value={clip.speed || 1} min={0.1} max={8} step={0.05} unit="×" onCommit={v => edit(clip.id, { speed: v })} />}
        <p className="note">{(clip.dur / fps).toFixed(2)}s · ends {tc(clip.start + clip.dur, true, fps)}</p>
      </div>

      {isText && <TextEditor project={project} clip={clip} />}

      {isEffect && (
        <>
          <div className="grp"><h4>Layer</h4>
            <KeyframeRow project={project} clip={clip} prop="opacity" label="Strength" min={0} max={1} step={0.01} base={clip.opacity ?? 1} />
            <p className="note">Applies to everything on the tracks below, for the length of this clip. Click the diamond next to a parameter to animate it over time.</p>
          </div>
          <EffectsStack project={project} clip={clip} />
        </>
      )}

      {(isAudio) && (
        <>
          <div className="grp"><h4>Audio</h4>
            <KeyframeRow project={project} clip={clip} prop="volume" label="Volume" min={0} max={4} step={0.05} unit="×" base={clip.volume ?? 1} />
            <Slider label="Level (dB)" value={clip.gainDb ?? defGain} min={-60} max={12} step={1} unit=" dB" onCommit={v => edit(clip.id, { gainDb: v })} />
            <Slider label="Fade in" value={clip.fadeIn} min={0} max={300} step={1} fmt={v => `${(v / fps).toFixed(1)}s`} onCommit={v => edit(clip.id, { fadeIn: Math.round(v) })} />
            <Slider label="Fade out" value={clip.fadeOut} min={0} max={300} step={1} fmt={v => `${(v / fps).toFixed(1)}s`} onCommit={v => edit(clip.id, { fadeOut: Math.round(v) })} />
          </div>
          <div className="grp"><h4>Audio effects</h4>
            <div className="row3">
              <Slider label="Low" value={clip.audioFx?.eq?.low ?? 0} min={-18} max={18} step={1} unit=" dB" onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), eq: { ...(clip.audioFx?.eq || {}), low: v } } })} />
              <Slider label="Mid" value={clip.audioFx?.eq?.mid ?? 0} min={-18} max={18} step={1} unit=" dB" onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), eq: { ...(clip.audioFx?.eq || {}), mid: v } } })} />
              <Slider label="High" value={clip.audioFx?.eq?.high ?? 0} min={-18} max={18} step={1} unit=" dB" onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), eq: { ...(clip.audioFx?.eq || {}), high: v } } })} />
            </div>
            <div className="row3">
              <Slider label="Reverb" value={clip.audioFx?.reverb ?? 0} min={0} max={1} step={0.05} onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), reverb: v } })} />
              <Slider label="Compress" value={clip.audioFx?.compressor ?? 0} min={0} max={1} step={0.05} onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), compressor: v } })} />
              <Slider label="Delay" value={clip.audioFx?.delay ?? 0} min={0} max={1} step={0.05} onCommit={v => edit(clip.id, { audioFx: { ...(clip.audioFx || {}), delay: v } })} />
            </div>
          </div>
        </>
      )}

      {isVisual && (
        <>
          <div className="grp"><h4>Frame</h4>
            <KeyframeRow project={project} clip={clip} prop="scale" label="Scale" min={0.05} max={5} step={0.01} unit="×" base={clip.scale} />
            <div className="row2">
              <KeyframeRow project={project} clip={clip} prop="x" label="X" min={-100} max={100} step={0.5} unit="%" base={clip.x} />
              <KeyframeRow project={project} clip={clip} prop="y" label="Y" min={-100} max={100} step={0.5} unit="%" base={clip.y} />
            </div>
            <div className="row2">
              <KeyframeRow project={project} clip={clip} prop="rotation" label="Rotate" min={-180} max={180} step={1} unit="°" base={clip.rotation ?? 0} />
              <KeyframeRow project={project} clip={clip} prop="opacity" label="Opacity" min={0} max={1} step={0.01} base={clip.opacity ?? 1} />
            </div>
            <div className="row2 checks">
              <label className="check"><input type="checkbox" checked={!!clip.flipH} onChange={e => edit(clip.id, { flipH: e.target.checked })} /> <FlipHorizontal2 size={12} /> Flip H</label>
              <label className="check"><input type="checkbox" checked={!!clip.flipV} onChange={e => edit(clip.id, { flipV: e.target.checked })} /> <FlipVertical2 size={12} /> Flip V</label>
            </div>
            <label className="check"><input type="checkbox" checked={!!kb} onChange={e => edit(clip.id, { kenburns: e.target.checked ? { from: 1, to: 1.06, panX0: 0, panX1: 0.2 } : null })} /> Slow push-in (Ken Burns)</label>
            {kb && <div className="row2"><Slider label="From" value={kb.from} min={1} max={1.4} step={0.01} unit="×" onCommit={v => edit(clip.id, { kenburns: { ...kb, from: v } })} /><Slider label="To" value={kb.to} min={1} max={1.4} step={0.01} unit="×" onCommit={v => edit(clip.id, { kenburns: { ...kb, to: v } })} /></div>}
          </div>

          {clip.type === 'image' && asset && isServer() && (
            <div className="grp"><h4>Cut-out</h4>
              {asset.transparent ? <p className="note">Transparent PNG. Put it on an overlay track and animate scale, position and rotation with the diamonds.</p> : (
                <button className="btn" title="Cut the subject out into a transparent PNG (runs locally, about 25 s)" onClick={async () => {
                  try { const r = await tool('remove_background', { assetId: asset.id }); if (r?.assetId) await edit(clip.id, { assetId: r.assetId, fit: 'contain' }); } catch { /* toast */ }
                }}><Sparkles size={14} /> Remove background</button>
              )}
              <label className="check"><input type="checkbox" checked={clip.fit === 'contain'} onChange={e => edit(clip.id, { fit: e.target.checked ? 'contain' : 'cover' })} /> Show the whole image (no crop)</label>
            </div>
          )}

          {clip.type === 'video' && asset?.animation && isServer() && <AnimationEditor asset={asset} />}

          {clip.type === 'video' && (
            <div className="grp"><h4>Clip audio</h4>
              {asset?.hasAudio ? (
                <>
                  <label className="check"><input type="checkbox" checked={!!clip.audio} onChange={e => edit(clip.id, { audio: e.target.checked })} /> Play this clip’s own audio</label>
                  {!!clip.audio && <KeyframeRow project={project} clip={clip} prop="volume" label="Volume" min={0} max={4} step={0.05} unit="×" base={clip.volume ?? 1} />}
                  <button className="btn" title="Move the sound onto its own audio track (the video becomes silent)" onClick={() => tool('detach_audio', { clipId: clip.id })}><Scissors size={14} /> Detach audio to its own track</button>
                </>
              ) : <p className="note">This clip has no audio (it was imported or downloaded without it).</p>}
            </div>
          )}

          <EffectsStack project={project} clip={clip} />

          <div className="grp"><h4>Look</h4>
            <Select label="Colour grade" value={gradeName} onChange={v => edit(clip.id, { grade: v || null })} options={[{ v: '', l: `Project default (${fx.grade})` }, ...GRADES]} />
            <Slider label="Contrast" value={g.contrast ?? 1} min={0.6} max={1.6} step={0.01} onCommit={v => edit(clip.id, { grade: { ...(gradeName ? { preset: gradeName } : {}), ...g, contrast: v } })} />
            <Slider label="Saturation" value={g.saturation ?? 1} min={0} max={2} step={0.01} onCommit={v => edit(clip.id, { grade: { ...(gradeName ? { preset: gradeName } : {}), ...g, saturation: v } })} />
          </div>

          <div className="grp"><h4>Transition into this clip</h4>
            <Select label="Type" value={clip.transition?.type || 'cut'} onChange={v => edit(clip.id, { transition: { type: v, dur: v === 'cut' ? 0 : TRANSITION_DEFS.find(t => t.id === v)?.dur || 10 } })}
              options={[...new Set(TRANSITION_DEFS.map(t => t.group))].map(grp => ({ group: grp, items: TRANSITION_DEFS.filter(t => t.group === grp).map(t => ({ v: t.id, l: t.label })) }))} />
            {clip.transition?.type && clip.transition.type !== 'cut' && <Slider label="Length" value={clip.transition.dur || 10} min={2} max={120} step={1} fmt={v => `${v} fr · ${(v / fps).toFixed(1)}s`} onCommit={v => edit(clip.id, { transition: { ...clip.transition, dur: Math.round(v) } })} />}
          </div>
        </>
      )}

      {clip.source && (
        <div className="grp src"><h4>Source</h4>
          <p><Link2 size={12} /> <b>{clip.source.title}</b><br />{clip.source.channel}</p>
          <p className="note">{(clip.source.inMs / 1000).toFixed(1)}s → {(clip.source.outMs / 1000).toFixed(1)}s · {clip.source.license}</p>
          <a className="link" href={`${clip.source.url}&t=${Math.floor(clip.source.inMs / 1000)}s`} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open at this moment</a>
        </div>
      )}

      <div className="row3 acts">
        <button className="btn" onClick={ops.split}><Scissors size={14} /> Split</button>
        <button className="btn" onClick={ops.duplicate}><Copy size={14} /> Duplicate</button>
        <button className="btn danger" onClick={() => ops.remove(false)}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}

function ProjectSettings({ project }) {
  const s = project.settings;
  const app = useApp();
  const fmt = FORMATS.find(f => f.w === s.width && f.h === s.height);
  return (
    <div className="panel-scroll insp">
      <h3 className="insp-h">Project settings</h3>
      <div className="grp"><h4>Format</h4>
        <Select label="Canvas" value={fmt?.id || 'custom'} onChange={v => v !== 'custom' && tool('set_project_format', { formatId: v })}
          options={[...FORMATS.map(f => ({ v: f.id, l: f.label })), ...(fmt ? [] : [{ v: 'custom', l: `${s.width}×${s.height} (custom)` }])]} />
        <div className="row2">
          <Field label="Width" type="number" value={s.width} onCommit={v => tool('set_project_format', { width: v })} />
          <Field label="Height" type="number" value={s.height} onCommit={v => tool('set_project_format', { height: v })} />
        </div>
        <Select label="Frame rate" value={String(s.fps)} onChange={v => tool('set_project_format', { fps: +v })} options={FPS_OPTIONS.map(f => ({ v: String(f), l: `${f} fps` }))} />
        <label className="check"><input type="checkbox" checked={!!s.voiceLock} onChange={e => tool('set_project_format', { voiceLock: e.target.checked })} /> Lock length to voiceover end (AI pipeline)</label>
      </div>
      <div className="grp"><h4>Colour</h4>
        <Select label="Grade for every clip" value={s.grade} onChange={v => tool('update_project', { grade: v })} options={GRADES} />
        <label className="fld"><span>Accent colour (graphics)</span><input type="color" value={s.accent} onChange={e => tool('update_project', { accent: e.target.value }, { quiet: true })} /></label>
      </div>
      <div className="grp"><h4>Audio</h4>
        <Slider label="Music under voice" value={s.musicDb} min={-45} max={-15} step={1} unit=" dB" onCommit={v => tool('update_project', { musicDb: v })} />
        <Slider label="Master volume" value={s.masterVolume ?? 1} min={0} max={2} step={0.05} unit="×" onCommit={v => tool('update_project', { masterVolume: v })} />
        <Slider label="Loudness target" value={s.loudness} min={-23} max={-9} step={1} unit=" LUFS" onCommit={v => tool('update_project', { loudness: v })} />
      </div>
      <div className="grp"><h4>Output</h4><p className="note">{s.width}×{s.height} · {s.fps} fps · H.264 High · AAC 48 kHz{app.mode === 'server' ? '' : ' · browser export (WebCodecs)'}</p></div>
      <p className="note">Select a clip on the timeline to edit timing, effects, keyframes, look and transitions.</p>
    </div>
  );
}

export function AgentPanel({ project, setSelected, goGuide }) {
  const app = useApp();
  const live = !!(app.agentAt && Date.now() - app.agentAt < 120000);
  const jobs = Object.values(app.jobs).sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
  const feed = [...app.activity].reverse().slice(0, 60);
  const icon = by => (by === 'mcp' ? <Sparkles size={13} /> : by === 'auto' ? <Cog size={13} /> : <Pencil size={13} />);
  return (
    <div className="panel-scroll agent">
      <div className={`conn ${live ? 'live' : ''}`}>
        <Radio size={16} /><div><b>{live ? 'AI connected' : app.mode === 'server' ? 'No AI connected yet' : 'Local AI not linked'}</b><span>{app.mode === 'server' ? (live ? `last action ${ago(app.agentAt)}` : 'Add the MCP connector to your chat app') : 'Run the local studio (npm start) and allow the connection'}</span></div>
        <button className="btn sm" onClick={goGuide}>Setup guide</button>
      </div>
      {jobs.length > 0 && <div className="jobs">{jobs.map(j => <div key={j.id} className={`job ${j.status}`}><b>{j.label}</b><span>{j.status === 'running' ? j.message || 'working…' : j.status === 'done' ? 'done' : j.error}</span>{j.status === 'running' && <i style={{ width: `${Math.max(3, j.progress * 100)}%` }} />}</div>)}</div>}
      <h4 className="feed-h">Live activity</h4>
      <ul className="feed">
        {feed.map((a, i) => <li key={i} className={a.by} onClick={() => { if (a.clipIds?.length) { setSelected(new Set([a.clipIds[0]])); const c = project.clips.find(x => x.id === a.clipIds[0]); if (c) T.seek(c.start); } }}>
          <span className="ic">{icon(a.by)}</span><span className="tx">{a.summary}</span><time>{ago(a.at)}</time></li>)}
        {!feed.length && <li className="none">Edits from you, from autopilot and from your connected AI are listed here as they happen.</li>}
      </ul>
    </div>
  );
}
