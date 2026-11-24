import React, { useEffect, useRef, useState } from 'react';
import { Upload, Search, Download, Eye, Loader2, Link2, Film, Music2, ImageIcon, Plus, CheckCircle2, Circle, Crosshair, ExternalLink, Clapperboard, Trash2, Pencil } from 'lucide-react';
import { useApp, tool, upload, askAudio, toast, thumbUrl, msFrame, frameMs, fmtMs, tc } from '../api';
import { EFFECTS as EFFECT_DEFS } from '../../../shared/model.mjs';
import { Sparkles } from 'lucide-react';
import { Chip, parseTime, hhmmss } from './ui';
import * as T from './transport';

/* ----------------------------------------------------------------- Media library */
export function MediaPanel({ project, setSelected }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const assets = Object.values(project.assets).sort((a, b) => b.createdAt - a.createdAt);
  const add = async files => { setBusy(true); try { for (const f of files) await askAudio(await upload(f)); } catch { /* toast */ } finally { setBusy(false); } };
  const placeAtPlayhead = async a => {
    const startMs = frameMs(Math.floor(T.getFrame())), isA = a.kind === 'audio';
    await tool('place_clip', { assetId: a.id, track: isA ? 'A2' : 'V1', startMs, durMs: isA ? a.duration : a.kind === 'image' ? 3000 : Math.min(a.duration, 4000), allowLong: true, replace: false, force: true });
  };
  const removeAsset = async a => {
    if (!confirm(`Delete "${a.name}" from the library? Clips using it stay but lose their media.`)) return;
    try { const r = await tool('delete_assets', { ids: [a.id] }); toast(r.removed ? 'Deleted.' : 'Asset not found.'); }
    catch { /* toast */ }
  };
  return (
    <div className="panel-scroll">
      <input ref={ref} type="file" multiple accept="video/*,audio/*,image/*" hidden onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
      <div className="dropzone" onClick={() => ref.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add([...e.dataTransfer.files]); }}>
        {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}<span>Import video, audio or images</span>
      </div>
      {assets.some(a => !project.clips.some(c => c.assetId === a.id)) && <button className="btn sm ghost" style={{ margin: '-4px 0 10px' }} onClick={async () => { const r = await tool('delete_assets', { unused: true }); toast(`Removed ${r.removed} unused file(s).`); }}>Remove unused media</button>}
      <div className="assets">
        {assets.map(a => {
          const t = a.thumbs;
          return (
            <div key={a.id} className="asset" draggable onDragStart={e => e.dataTransfer.setData('application/x-ff-asset', a.id)} onDoubleClick={() => placeAtPlayhead(a)} title="Drag to the timeline · double-click to place at the playhead">
              <div className="asset-th" style={t ? { backgroundImage: `url(${thumbUrl(project, a)})`, backgroundSize: `${t.n * 100}% 100%`, backgroundPosition: '0 0' } : null}>
                {!t && (a.kind === 'audio' ? <Music2 size={20} /> : <Film size={20} />)}
                {a.kind === 'audio' && <Music2 size={20} className="over" />}
                <small>{a.kind === 'image' ? 'IMG' : fmtMs(a.duration)}</small>
                <button className="icon sm asset-del" title="Delete from library" onClick={e => { e.stopPropagation(); removeAsset(a); }}><Trash2 size={13} /></button>
              </div>
              <div className="asset-meta"><b>{a.name}</b>{a.source?.url ? <span className="yt"><Link2 size={11} /> {a.source.channel}</span> : <span>{a.kind} {a.width ? `· ${a.width}×${a.height}` : ''}</span>}</div>
              <button className="icon sm" onClick={() => placeAtPlayhead(a)} title="Place at playhead"><Plus size={14} /></button>
            </div>
          );
        })}
        {!assets.length && <p className="empty">No media yet. Imported files, downloaded YouTube clips and anything your AI adds will show up here.</p>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- YouTube finder */
const fmtViews = n => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : n);
const fmtDur = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function YouTubePanel({ project, beatSel, setBeatSel }) {
  const beat = project.beats.find(b => b.id === beatSel);
  const [q, setQ] = useState('');
  const [cc, setCc] = useState(false);
  const [style, setStyle] = useState('any');
  const [durSec, setDurSec] = useState(5);
  const [maxMin, setMaxMin] = useState(0);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(null);       // video id with expanded controls
  const [look, setLook] = useState({});          // id -> {img, times, cols, loading}
  const [start, setStart] = useState({});        // id -> "m:ss"
  const [info, setInfo] = useState({});

  useEffect(() => { if (beat && !q) setQ(beat.queries[0] || ''); }, [beat?.id]); // eslint-disable-line

  const search = async (query = q) => {
    if (!query.trim()) return;
    const m = query.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    setBusy('search');
    try {
      if (m) { const i = await tool('youtube_info', { url: `https://www.youtube.com/watch?v=${m[1]}` }); setResults([{ ...i, url: i.url }]); setInfo(x => ({ ...x, [i.id]: i })); setOpen(i.id); }
      else { const r = await tool('search_youtube', { query, limit: 12, license: cc ? 'cc' : 'any', style, ...(maxMin ? { maxSec: maxMin * 60 } : {}) }); setResults(r.results); setOpen(null); }
    } catch { /* toast */ } finally { setBusy(''); }
  };
  const inspect = async v => {
    const s = parseTime(start[v.id] ?? '0:00') ?? 0;
    setLook(l => ({ ...l, [v.id]: { loading: true } }));
    try {
      const r = await tool('inspect_youtube', { url: v.url, startMs: s, endMs: s + 12000, frames: 6, cols: 3 });
      setLook(l => ({ ...l, [v.id]: { img: r._images[0], times: r.frameTimesMs, cols: 3 } }));
    } catch { setLook(l => ({ ...l, [v.id]: null })); }
  };
  const loadInfo = async v => { if (info[v.id]) return; try { setInfo(x => ({ ...x, [v.id]: null })); const i = await tool('youtube_info', { url: v.url }, { quiet: true }); setInfo(x => ({ ...x, [v.id]: i })); } catch { /* ignore */ } };
  const toggle = v => { setOpen(o => (o === v.id ? null : v.id)); loadInfo(v); };

  const place = async (v, toBeat) => {
    const s = parseTime(start[v.id] ?? '0:00') ?? 0;
    const withAudio = window.confirm('Download the audio too?\n\nOK = video + audio\nCancel = picture only (smaller; the clip will be silent)');
    setBusy('dl' + v.id);
    try {
      if (toBeat && beat) { await tool('place_clip', { beatId: beat.id, withAudio, youtube: { url: v.url, startMs: s, endMs: s + durSec * 1000, query: q } }); toast(`Placed on beat ${beat.id}.`); }
      else { await tool('download_youtube', { url: v.url, startMs: s, endMs: s + durSec * 1000, withAudio }); toast(`Downloaded ${durSec}s into the library.`); }
    } catch { /* toast */ } finally { setBusy(''); }
  };
  const startSec = v => parseTime(start[v.id] ?? '0:00') ?? 0;

  return (
    <div className="panel-scroll yt">
      {beat ? (
        <div className="beat-ctx">
          <header><Crosshair size={14} /><b>Beat {beat.id}</b><span>{(((beat.endMs ?? beat.endFrame * 1000 / 30) - (beat.startMs ?? beat.startFrame * 1000 / 30)) / 1000).toFixed(1)}s</span><button className="icon sm" onClick={() => setBeatSel(null)} aria-label="Clear beat">✕</button></header>
          <p>“{beat.text}”</p>
          <div className="chips">{beat.queries.map(x => <Chip key={x} onClick={() => { setQ(x); search(x); }}>{x}</Chip>)}</div>
        </div>
      ) : <p className="note">Select a beat in the Beats tab (or on the timeline) to place footage exactly on its words.</p>}
      <form className="searchbar" onSubmit={e => { e.preventDefault(); search(); }}>
        <Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search YouTube or paste a video link" />
        <button className="btn sm" disabled={busy === 'search'}>{busy === 'search' ? <Loader2 size={14} className="spin" /> : 'Search'}</button>
      </form>
      <div className="yt-filters">
        <select value={style} onChange={e => setStyle(e.target.value)} title="Content style filter">
          <option value="any">Any content</option>
          <option value="faceless">Faceless (no vlogs/talking)</option>
          <option value="movie">Movie & film scenes</option>
        </select>
        <select value={maxMin} onChange={e => setMaxMin(+e.target.value)}><option value={0}>Any length</option><option value={10}>≤ 10 min</option><option value={30}>≤ 30 min</option><option value={2}>≤ 2 min</option></select>
        <label className="check"><input type="checkbox" checked={cc} onChange={e => setCc(e.target.checked)} /> CC</label>
      </div>
      <div className="yt-results">
        {results.map(v => {
          const L = look[v.id], I = info[v.id], isOpen = open === v.id;
          return (
            <article key={v.id} className={`yt-card ${isOpen ? 'open' : ''}`}>
              <div className="yt-main" onClick={() => toggle(v)}>
                <div className="yt-th" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${v.id}/mqdefault.jpg)` }}><small>{fmtDur(v.durationSec)}</small></div>
                <div className="yt-meta"><b>{v.title}</b><span>{v.channel} · {fmtViews(v.views)} views</span>{I?.isCreativeCommons && <Chip tone="ok">CC licence</Chip>}</div>
              </div>
              {isOpen && (
                <div className="yt-ctl">
                  <iframe
                    title={`Preview ${v.title}`}
                    className="yt-preview"
                    src={`https://www.youtube-nocookie.com/embed/${v.id}?start=${startSec(v)}&autoplay=0&modestbranding=1&rel=0`}
                    allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen />
                  {I && <p className="note">{I.license}{I.mostReplayed?.length ? ` · most replayed: ${I.mostReplayed.map(h => hhmmss(h.startSec * 1000)).join(', ')}` : ''}{I.mostReplayed?.length ? <span className="chips">{I.mostReplayed.map(h => <Chip key={h.startSec} onClick={() => setStart(s => ({ ...s, [v.id]: hhmmss(h.startSec * 1000).replace(/\.0$/, '') }))}>▶ {hhmmss(h.startSec * 1000)}</Chip>)}</span> : null}</p>}
                  <div className="row3">
                    <label className="fld"><span>Start (m:ss)</span><input value={start[v.id] ?? '0:00'} onChange={e => setStart(s => ({ ...s, [v.id]: e.target.value }))} /></label>
                    <label className="fld"><span>Length (s)</span><input type="number" min="1" max="60" value={durSec} onChange={e => setDurSec(Math.max(1, Math.min(60, +e.target.value || 5)))} /></label>
                    <button className="btn" onClick={() => inspect(v)} disabled={L?.loading}>{L?.loading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} Frames</button>
                  </div>
                  {L?.img && (
                    <div className="sheet">
                      <img src={`data:${L.img.mimeType};base64,${L.img.data}`} alt="Frames from the video" />
                      <div className="sheet-grid" style={{ gridTemplateColumns: `repeat(${L.cols}, 1fr)` }}>{L.times.map(t => <button key={t} onClick={() => setStart(s => ({ ...s, [v.id]: hhmmss(t).replace(/\.0$/, '') }))}>{hhmmss(t)}</button>)}</div>
                    </div>
                  )}
                  <div className="row2">
                    <button className="btn primary" disabled={!beat || busy === 'dl' + v.id} onClick={() => place(v, true)} title={beat ? `Place ${durSec}s from ${start[v.id] ?? '0:00'}` : 'Select a beat first'}>{busy === 'dl' + v.id ? <Loader2 size={14} className="spin" /> : <Clapperboard size={14} />} Place on beat</button>
                    <button className="btn" disabled={busy === 'dl' + v.id} onClick={() => place(v, false)}><Download size={14} /> Download part to library</button>
                  </div>
                  <a className="link" href={v.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open on YouTube</a>
                </div>
              )}
            </article>
          );
        })}
        {!results.length && busy !== 'search' && <p className="empty">Only the 5 s you choose are downloaded — never whole videos. Licences are recorded for the sources list.</p>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Titles (text presets) */
const TITLE_PRESETS = [
  { label: 'Bold Title', kind: 'title', style: { fontSize: 120, animIn: 'pop' } },
  { label: 'Typewriter', kind: 'title', style: { fontSize: 90, animIn: 'typewriter', font: 'Courier New', weight: 700 } },
  { label: 'Kinetic Pop', kind: 'title', style: { fontSize: 130, animIn: 'wordpop', weight: 900 } },
  { label: 'Karaoke', kind: 'caption', style: { animIn: 'karaoke', fontSize: 64, weight: 900 } },
  { label: 'Blur In', kind: 'title', style: { animIn: 'blurin', fontSize: 110 } },
  { label: 'Neon', kind: 'title', style: { animIn: 'neon', fontSize: 110, color: '#b9a6ff' } },
  { label: 'Glitch', kind: 'title', style: { animIn: 'glitchtext', fontSize: 110 } },
  { label: 'Shine Sweep', kind: 'title', style: { animIn: 'shine', fontSize: 110 } },
  { label: 'Tracking In', kind: 'title', style: { animIn: 'tracking', fontSize: 84, letterSpacing: 6 } },
  { label: 'Bounce', kind: 'title', style: { animIn: 'bounce', fontSize: 120 } },
  { label: 'Elastic', kind: 'title', style: { animIn: 'elastic', fontSize: 120 } },
  { label: 'Wave', kind: 'title', style: { animIn: 'wave', fontSize: 110 } },
  { label: 'Mask Reveal', kind: 'title', style: { animIn: 'maskreveal', fontSize: 100 } },
  { label: 'Split Slide', kind: 'title', style: { animIn: 'splitslide', fontSize: 100 } },
  { label: 'Slide Up', kind: 'title', style: { animIn: 'slideup', fontSize: 100 } },
  { label: 'Rotate In', kind: 'title', style: { animIn: 'rotatein', fontSize: 100 } },
  { label: 'Lower Third', kind: 'lower', style: { animIn: 'slideup' } },
  { label: 'Fact Card', kind: 'fact', style: { animIn: 'slideup' } },
  { label: 'Big Stat', kind: 'stat', style: { animIn: 'scalein' } },
  { label: 'Quote', kind: 'quote', style: { animIn: 'fade' } },
  { label: 'Chapter', kind: 'chapter', style: { animIn: 'maskreveal' } },
  { label: 'Subtitle', kind: 'subtitle', style: { animIn: 'slideup', fontSize: 54 } },
];

export function TitlesPanel({ project, setSelected }) {
  const startMs = frameMs(Math.floor(T.getFrame()));
  const add = async preset => {
    try {
      const r = await tool('add_text_clip', { kind: preset.kind, title: preset.label, startMs, endMs: startMs + 3000, style: preset.style });
      if (r?.clipId) setSelected(new Set([r.clipId]));
    } catch { /* toast */ }
  };
  return (
    <div className="panel-scroll">
      <p className="note">Click a preset to add animated text at the playhead. Every style is editable in the inspector.</p>
      <div className="preset-grid">
        {TITLE_PRESETS.map(p => (
          <button key={p.label} className="preset" onClick={() => add(p)}>
            <span className="preset-preview" style={{ fontFamily: p.style.font || 'Montserrat', fontWeight: p.style.weight || 800, fontSize: Math.min(15, (p.style.fontSize || 96) / 8) }}>{p.label}</span>
            <small>{p.kind} · {p.style.animIn}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Effects gallery */
export function EffectsPanel({ project, selected }) {
  const clip = selected.size === 1 ? project.clips.find(c => c.id === [...selected][0]) : null;
  const [q, setQ] = useState('');
  const list = EFFECT_DEFS.filter(e => !q || e.label.toLowerCase().includes(q.toLowerCase()) || e.group.toLowerCase().includes(q.toLowerCase()));
  if (!clip) return <div className="panel-scroll"><p className="empty">Select a clip on the timeline, then click an effect to stack it. Effects are live in the preview and baked into the render.</p></div>;
  return (
    <div className="panel-scroll">
      <div className="beat-ctx"><header><Sparkles size={14} /><b>{clip.label || clip.type}</b><span>{clip.effects?.length || 0} effect(s) applied</span></header></div>
      <form className="searchbar" onSubmit={e => e.preventDefault()}>
        <Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter effects" />
      </form>
      <div className="preset-grid">
        {list.map(e => (
          <button key={e.id} className="preset" onClick={() => tool('apply_effect', { clipId: clip.id, type: e.id }, { quiet: true })}>
            <span className="preset-preview" style={{ fontSize: 13 }}>{e.label}</span>
            <small>{e.group} · {e.params.length} param{e.params.length === 1 ? '' : 's'}</small>
          </button>
        ))}
      </div>
      <p className="note">Tune parameters per instance in the Inspector → Effects stack.</p>
    </div>
  );
}
export function BeatsPanel({ project, beatSel, setBeatSel, setTab, setSelected }) {
  const beats = project.beats;
  const fps = project.settings?.fps || 30;
  const clipFor = b => project.clips.find(c => c.track === 'V1' && c.beatId === b.id);
  const [editing, setEditing] = useState(null);   // beat id
  const [draft, setDraft] = useState('');
  const [chEdit, setChEdit] = useState(null);     // chapter id
  const [chDraft, setChDraft] = useState('');
  const beatFrame = b => (b.startMs != null ? Math.round(b.startMs * fps / 1000) : b.startFrame);

  const saveBeat = async id => {
    try { await tool('update_beat', { id, text: draft }); setEditing(null); } catch { /* toast */ }
  };
  const deleteBeat = async id => {
    if (!confirm('Delete this beat? Clips placed on it are kept.')) return;
    try { await tool('delete_beat', { id }); if (beatSel === id) setBeatSel(null); } catch { /* toast */ }
  };
  const saveChapter = async (id, title) => {
    const chapters = project.chapters.map(c => (c.id === id ? { ...c, title } : c)).map(c => ({ title: c.title, startMs: c.startMs }));
    try { await tool('set_chapters', { chapters }); setChEdit(null); } catch { /* toast */ }
  };
  const deleteChapter = async id => {
    const chapters = project.chapters.filter(c => c.id !== id).map(c => ({ title: c.title, startMs: c.startMs }));
    try { await tool('set_chapters', { chapters }); } catch { /* toast */ }
  };
  const addChapter = async () => {
    const title = prompt('Chapter title');
    if (!title) return;
    const chapters = [...project.chapters.map(c => ({ title: c.title, startMs: c.startMs })), { title, startMs: frameMs(Math.floor(T.getFrame()), fps) }];
    try { await tool('set_chapters', { chapters }); } catch { /* toast */ }
  };

  return (
    <div className="panel-scroll beats">
      {!beats.length && <p className="empty">No beats yet. Transcribe the voiceover to build them, then edit or delete them here.</p>}
      {beats.map(b => {
        const c = clipFor(b);
        return (
          <article key={b.id} className={`beat-row ${beatSel === b.id ? 'sel' : ''} ${c ? 'ok' : 'todo'}`} onClick={() => { setBeatSel(b.id); setSelected(new Set()); T.seek(beatFrame(b)); }}>
            <header>
              {c ? <CheckCircle2 size={14} /> : <Circle size={14} />}<b>{b.id}</b>
              <span>{tc(beatFrame(b), true, fps)}</span>
              <span className="beat-btns">
                <button className="icon sm" title="Edit text" onClick={e => { e.stopPropagation(); setEditing(b.id); setDraft(b.text); }}><Pencil size={12} /></button>
                <button className="icon sm" title="Search footage" onClick={e => { e.stopPropagation(); setBeatSel(b.id); setTab('youtube'); }}><Search size={12} /></button>
                <button className="icon sm danger" title="Delete beat" onClick={e => { e.stopPropagation(); deleteBeat(b.id); }}><Trash2 size={12} /></button>
              </span>
            </header>
            {editing === b.id ? (
              <div className="beat-edit" onClick={e => e.stopPropagation()}>
                <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveBeat(b.id); }} autoFocus />
                <button className="btn sm" onClick={() => saveBeat(b.id)}>Save</button>
                <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : <p>{b.text}</p>}
            <div className="chips">{(b.keywords || []).slice(0, 5).map(k => <Chip key={k.text} tone={k.type}>{k.text}</Chip>)}{b.factOverlay?.needed && <Chip tone="fact">fact card</Chip>}</div>
            {c?.source && <small className="src"><Link2 size={11} /> {c.source.title}</small>}
          </article>
        );
      })}

      <div className="grp" style={{ marginTop: 18 }}>
        <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>Chapters
          <button className="btn sm" onClick={addChapter}><Plus size={12} /> Add at playhead</button>
        </h4>
        {(project.chapters || []).map(ch => (
          <div key={ch.id} className="chapter-row">
            {chEdit === ch.id ? (
              <>
                <input value={chDraft} onChange={e => setChDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveChapter(ch.id, chDraft); }} autoFocus />
                <button className="btn sm" onClick={() => saveChapter(ch.id, chDraft)}>Save</button>
              </>
            ) : (
              <>
                <b onClick={() => T.seek(frameMs(Math.round(ch.startMs * fps / 1000), fps))} title="Seek here">{ch.title}</b>
                <small>{fmtMs(ch.startMs)}</small>
                <span className="beat-btns">
                  <button className="icon sm" title="Rename" onClick={() => { setChEdit(ch.id); setChDraft(ch.title); }}><Pencil size={12} /></button>
                  <button className="icon sm danger" title="Delete" onClick={() => deleteChapter(ch.id)}><Trash2 size={12} /></button>
                </span>
              </>
            )}
          </div>
        ))}
        {!(project.chapters || []).length && <p className="note">No chapters yet. Add one at the playhead.</p>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Web images (Openverse) */
export function ImagesPanel({ project }) {
  const [q, setQ] = useState('');
  const [orient, setOrient] = useState('');
  const [png, setPng] = useState(false);
  const [cut, setCut] = useState(false);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  const search = async () => {
    if (!q.trim()) return;
    setBusy('search');
    try { setRes((await tool('search_images', { query: q, limit: 24, pngOnly: png, ...(orient ? { orientation: orient } : {}) }, { quiet: true })).results); }
    catch (e) { toast(e.message || 'Image search failed', 'error'); } finally { setBusy(''); }
  };
  const add = async (r, place) => {
    setBusy(r.id);
    try {
      const startMs = frameMs(Math.floor(T.getFrame()));
      await tool('import_image', {
        url: r.url, name: r.title.slice(0, 60), removeBackground: cut,
        credit: { title: r.title, creator: r.creator || undefined, license: r.license || undefined, licenseUrl: r.licenseUrl || undefined, landingUrl: r.landingUrl || undefined, attribution: r.attribution || undefined },
        ...(place ? { place: { track: cut ? 'V2' : 'V1', startMs, durMs: 3000 } } : {}),
      });
      toast(cut ? 'Added as a transparent cut-out.' : place ? 'Placed at the playhead.' : 'Added to your media.');
    } catch { /* toast */ } finally { setBusy(''); }
  };
  return (
    <div className="panel-scroll">
      <div className="yt-search">
        <input value={q} placeholder="Search free images (e.g. blue whale)…" onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
        <button className="btn" onClick={search} disabled={busy === 'search'}>{busy === 'search' ? <Loader2 className="spin" size={14} /> : <Search size={14} />} Search</button>
      </div>
      <div className="row2" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
        <select value={orient} onChange={e => setOrient(e.target.value)}><option value="">Any shape</option><option value="wide">Wide</option><option value="tall">Tall</option><option value="square">Square</option></select>
        <label className="check"><input type="checkbox" checked={png} onChange={e => setPng(e.target.checked)} /> PNG only</label>
        <label className="check" title="Cut the subject out into a transparent PNG (runs locally, ~25 s per image)"><input type="checkbox" checked={cut} onChange={e => setCut(e.target.checked)} /> Remove background</label>
      </div>
      <p className="note">Openly licensed images that allow commercial use. Credits are saved with each image.</p>
      {res && !res.length && <p className="note">No images found. Try different words.</p>}
      <div className="img-grid">
        {(res || []).map(r => (
          <div key={r.id} className="img-card">
            <img src={r.thumbnail} alt={r.title} loading="lazy" />
            <div className="img-meta"><b title={r.title}>{r.title}</b><small>{r.license}{r.creator ? ` · ${r.creator}` : ''}</small></div>
            <div className="img-act">
              <button className="btn sm" disabled={!!busy} onClick={() => add(r, false)}>{busy === r.id ? <Loader2 className="spin" size={12} /> : <Plus size={12} />} Add</button>
              <button className="btn sm" disabled={!!busy} onClick={() => add(r, true)}>Place</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- HTML animations */
export function AnimationsPanel({ project }) {
  const [tpls, setTpls] = useState(null);
  const [sel, setSel] = useState('title-card');
  const [vars, setVars] = useState({});
  const [dur, setDur] = useState(3);
  const [custom, setCustom] = useState(false);
  const [html, setHtml] = useState('<div class="pill">NEW</div>\n<style>\n.pill{position:absolute;left:50%;top:50%;translate:-50% -50%;padding:2vmin 5vmin;border-radius:9vmin;background:#d8f36a;color:#16200c;font:800 6vmin "Segoe UI",Arial,sans-serif;animation:pop .5s cubic-bezier(.2,1.4,.3,1) both,out .4s ease-in calc(var(--ff-dur) - .4s) both}\n@keyframes pop{from{opacity:0;scale:.5}to{opacity:1;scale:1}}\n@keyframes out{to{opacity:0;scale:.8}}\n</style>');
  const [busy, setBusy] = useState(false);
  useEffect(() => { tool('list_animation_templates', {}, { quiet: true }).then(r => setTpls(r.templates)).catch(() => setTpls([])); }, []);
  const t = (tpls || []).find(x => x.id === sel);
  const val = k => vars[sel]?.[k] ?? t?.vars.find(v => v.key === k)?.def ?? '';
  const create = async () => {
    setBusy(true);
    try {
      const startMs = frameMs(Math.floor(T.getFrame()));
      const args = { durationMs: Math.round(dur * 1000), name: custom ? 'Custom animation' : t?.label, place: { track: 'V2', startMs } };
      if (custom) args.html = html; else { args.template = sel; args.vars = Object.fromEntries((t?.vars || []).map(v => [v.key, val(v.key)])); }
      const r = await tool('create_animation', args);
      if (r?.warnings?.length) toast(r.warnings[0], 'error');
      else toast('Animation added on V2 at the playhead.');
    } catch { /* toast */ } finally { setBusy(false); }
  };
  return (
    <div className="panel-scroll">
      <p className="note">Animated scenes rendered from HTML (like HyperFrames): they become transparent video clips you can move, trim and keyframe. Needs Edge or Chrome installed.</p>
      <div className="anim-tabs">
        {(tpls || []).map(x => <button key={x.id} className={!custom && sel === x.id ? 'on' : ''} onClick={() => { setCustom(false); setSel(x.id); }} title={x.description}>{x.label}</button>)}
        <button className={custom ? 'on' : ''} onClick={() => setCustom(true)}>Custom HTML</button>
      </div>
      {!custom && t && (
        <div className="anim-form">
          <p className="note">{t.description}</p>
          {t.vars.map(v => (
            <label key={v.key} className="fld"><span>{v.label}</span>
              <input type={v.key === 'accent' ? 'color' : 'text'} value={val(v.key)} onChange={e => setVars(s => ({ ...s, [sel]: { ...(s[sel] || {}), [v.key]: e.target.value } }))} />
            </label>
          ))}
        </div>
      )}
      {custom && (
        <div className="anim-form">
          <textarea className="anim-html" spellCheck={false} value={html} onChange={e => setHtml(e.target.value)} />
          <p className="note">Plain HTML + CSS animations. Use <code>vmin</code> units and <code>--ff-dur</code> for the clip length. Ask your AI to write these with <code>animation_guide</code>.</p>
        </div>
      )}
      <label className="fld"><span>Length (seconds)</span><input type="number" min="0.5" max="60" step="0.5" value={dur} onChange={e => setDur(Math.max(0.5, Math.min(60, +e.target.value || 3)))} /></label>
      <button className="btn" disabled={busy} onClick={create}>{busy ? <><Loader2 className="spin" size={14} /> Rendering…</> : <><Sparkles size={14} /> Create at playhead</>}</button>
    </div>
  );
}
