import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Wand2, Library, Youtube, ListVideo, BookOpen, Clapperboard, Plus, ChevronDown, Radio, Sparkles, SlidersHorizontal, Activity as ActivityIcon, Type as TypeIcon, Sliders, AudioLines, ImageIcon } from 'lucide-react';
import { useApp, tool, toast, uiEvents, tc, frameMs, msFrame, totalFrames, curFps, isServer, refreshLocalProjects } from '../api';
import { Logo, Modal, Progress } from './ui';
import * as T from './transport';
import Preview from './Preview';
import Timeline from './Timeline';
import AutoPanel from './AutoPanel';
import { MediaPanel, YouTubePanel, BeatsPanel, TitlesPanel, EffectsPanel, ImagesPanel, AnimationsPanel } from './LibraryPanels';
import { Inspector, AgentPanel } from './RightPanels';
import { MixerPanel } from './MixerPanel';
import RenderDialog from './RenderDialog';
import { createLocalProject, openLocalProject, deleteLocalProject, importLocalProject } from '../local.mjs';
import { useCloud, signOut, fetchCloudProject } from '../cloud';

function TimeCode({ total }) {
  const frame = T.useFrame();
  return <span className="tc"><b>{tc(frame, true, curFps())}</b> <i>/ {tc(total, true, curFps())}</i></span>;
}

function AccountChip() {
  const c = useCloud();
  const [open, setOpen] = useState(false);
  if (!c.enabled || !c.session) return null;
  const email = c.session.user?.email || 'Account';
  const link = { on: ['live', 'AI link connected'], connecting: ['', 'Connecting AI link…'], replaced: ['', 'AI link is open in another tab'], off: ['', 'AI link offline'] }[c.relay] || ['', ''];
  return (
    <div className="acct" onClick={() => setOpen(o => !o)} role="button" tabIndex={0} title={email}>
      <span className="acct-av">{email[0].toUpperCase()}</span>
      {open && <div className="menu acct-menu" onClick={e => e.stopPropagation()}>
        <div className="acct-mail">{email}</div>
        {c.mcpUrl && <div className={`acct-link ${link[0]}`}><i className="dot" /> {link[1]}</div>}
        {c.syncing && <div className="acct-link">Saving to your account…</div>}
        {c.error && <div className="acct-link err">{c.error}</div>}
        <button onClick={() => signOut()}>Sign out</button>
      </div>}
    </div>
  );
}

export default function Studio({ goto }) {
  const app = useApp();
  const cloud = useCloud();
  const project = app.project;
  const [selected, setSelected] = useState(new Set());
  const [beatSel, setBeatSel] = useState(null);
  const [tab, setTab] = useState('media');
  const [rtab, setRtab] = useState('inspector');
  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState(false);
  const [clipboard, setClipboard] = useState([]);

  useEffect(() => { if (project) T.setProject(project); }, [project]);
  useEffect(() => { setSelected(new Set()); setBeatSel(null); T.seek(0); }, [project?.id]);
  useEffect(() => { if (project && [...selected].some(id => !project.clips.some(c => c.id === id))) setSelected(s => new Set([...s].filter(id => project.clips.some(c => c.id === id)))); }, [project]); // eslint-disable-line
  useEffect(() => { const f = e => { const m = e.detail; if (m.clipId) setSelected(new Set([m.clipId])); T.seek(msFrame(m.ms)); }; uiEvents.addEventListener('seek', f); return () => uiEvents.removeEventListener('seek', f); }, []);
  useEffect(() => { if (selected.size === 1) setRtab('inspector'); }, [selected]);

  // let the server (and the AI) know where the playhead is
  useEffect(() => {
    if (!isServer() || app.remote) return;
    let last = -1;
    return T.subscribe(f => { const s = Math.floor(f / 6); if (s !== last) { last = s; fetch('/api/playhead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: frameMs(Math.floor(f)) }) }).catch(() => {}); } });
  }, [app.mode, app.remote]);

  const ops = useMemo(() => ({
    undo: () => tool('undo', {}, { quiet: true }),
    redo: () => tool('redo', {}, { quiet: true }),
    split: async () => {
      if (!project) return;
      const f = Math.floor(T.getFrame());
      let targets = project.clips.filter(c => selected.has(c.id) && f > c.start && f < c.start + c.dur);
      if (!targets.length) targets = project.clips.filter(c => c.track[0] === 'V' && f > c.start && f < c.start + c.dur);
      if (!targets.length) return toast('Move the playhead inside a clip to split it.');
      for (const c of targets) await tool('split_clip', { id: c.id, atMs: frameMs(f) });
    },
    remove: async ripple => { if (!selected.size) return; const ids = [...selected]; setSelected(new Set()); await tool('delete_clips', { ids, ripple }); },
    duplicate: async () => { if (!selected.size) return; const r = await tool('duplicate_clips', { ids: [...selected] }); setSelected(new Set(r.ids)); },
    copy: async () => {
      if (!selected.size) return;
      const clips = project.clips.filter(c => selected.has(c.id)).map(c => ({ ...c }));
      setClipboard(clips);
      try { await navigator.clipboard.writeText(JSON.stringify(clips)); } catch { /* clipboard blocked */ }
      toast(`${clips.length} clip${clips.length > 1 ? 's' : ''} copied — Ctrl+V pastes at the playhead.`);
    },
    cut: async () => { await ops.copy(); ops.remove(false); },
    paste: async () => {
      let clips = clipboard;
      try { if (!clips.length) clips = JSON.parse(await navigator.clipboard.readText()); } catch { /* keep local */ }
      if (!clips?.length) return toast('Nothing to paste. Copy clips first (Ctrl+C).', 'error');
      const at = frameMs(Math.floor(T.getFrame()));
      const minStart = Math.min(...clips.map(c => c.start));
      const shifted = clips.map(c => ({ ...c, start: c.start - minStart + msFrame(at), beatId: null, id: undefined }));
      const r = await tool('add_clips_raw', { clips: shifted });
      setSelected(new Set(r.ids));
    },
    marker: async () => {
      const r = await tool('add_marker', { ms: frameMs(Math.floor(T.getFrame())), label: '' });
      if (r?.marker) toast(`Marker at ${tc(r.marker.frame, true, curFps())}`);
    },
  }), [project, selected, clipboard]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = e => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable]') && e.key !== 'Escape') return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const fps = curFps();
      const clipsSorted = () => [...new Set(project.clips.flatMap(c => [c.start, c.start + c.dur]))].sort((a, b) => a - b);
      if (key === ' ') { e.preventDefault(); T.toggle(); }
      else if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? ops.redo() : ops.undo(); }
      else if (mod && key === 'y') { e.preventDefault(); ops.redo(); }
      else if (mod && key === 'd') { e.preventDefault(); ops.duplicate(); }
      else if (mod && key === 'c') { e.preventDefault(); ops.copy(); }
      else if (mod && key === 'x') { e.preventDefault(); ops.cut(); }
      else if (mod && key === 'v') { e.preventDefault(); ops.paste(); }
      else if (mod && key === 'a') { e.preventDefault(); setSelected(new Set(project.clips.map(c => c.id))); }
      else if (key === 's' && !mod) { e.preventDefault(); ops.split(); }
      else if (key === 'm' && !mod) { e.preventDefault(); ops.marker(); }
      else if (key === 'delete' || key === 'backspace') { e.preventDefault(); ops.remove(e.shiftKey); }
      else if (key === 'arrowleft') { e.preventDefault(); T.step(e.shiftKey ? -fps : -1); }
      else if (key === 'arrowright') { e.preventDefault(); T.step(e.shiftKey ? fps : 1); }
      else if (key === 'arrowup') { e.preventDefault(); const f = Math.floor(T.getFrame()); const p = clipsSorted().filter(x => x < f).pop(); if (p != null) T.seek(p); }
      else if (key === 'arrowdown') { e.preventDefault(); const f = Math.floor(T.getFrame()); const n = clipsSorted().find(x => x > f); if (n != null) T.seek(n); }
      else if (key === 'home') { e.preventDefault(); T.seek(0); }
      else if (key === 'end') { e.preventDefault(); T.seek(T.total()); }
      else if (key === 'j') T.shuttle(-1);
      else if (key === 'k') T.shuttle(0);
      else if (key === 'l') T.shuttle(1);
      else if (key === '\\') { const el = document.querySelector('.tl-scroll'); }
      else if (key === 'escape') { setSelected(new Set()); setBeatSel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, ops]);

  const playing = T.usePlaying();
  if (!project) return <div className="boot"><Logo /><p>Starting Framesflow…</p></div>;

  const total = totalFrames(project);
  const live = !!(app.agentAt && Date.now() - app.agentAt < 120000);
  const running = Object.values(app.jobs).filter(j => j.status === 'running');
  const server = app.mode === 'server';
  const tabs = [
    ['media', 'Media', Library],
    ['titles', 'Titles', TypeIcon],
    ['fx', 'Effects', Sparkles],
    ...(server ? [['auto', 'Auto', Wand2], ['youtube', 'YouTube', Youtube], ['images', 'Images', ImageIcon], ['anim', 'Animate', Clapperboard], ['beats', 'Beats', ListVideo]] : []),
  ];

  const newProject = async () => {
    const name = prompt('Name your new video');
    if (!name) return;
    try {
      if (server) await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      else await createLocalProject(name);
    } catch { /* toast */ }
    setMenu(false);
  };
  const openProject = async id => {
    try {
      if (server) await fetch(`/api/projects/${id}/open`, { method: 'POST' });
      else await openLocalProject(id);
    } catch { /* toast */ }
    setMenu(false);
  };
  const openCloud = async id => {
    try {
      const { existed } = await importLocalProject(await fetchCloudProject(id));
      refreshLocalProjects();
      if (!existed) toast('Opened from your account. Media files stay on the device where you imported them, so re-import them here if clips look empty.');
    } catch (e) { toast(e.message || 'Could not open that project', 'error'); }
    setMenu(false);
  };
  const deleteProject = async id => {
    if (!confirm('Delete this project?')) return;
    if (server) await fetch(`/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
    else { await deleteLocalProject(id); refreshLocalProjects(); }
  };

  return (
    <div className="studio">
      <header className="s-head">
        <a className="s-brand" href="#/" aria-label="Home"><Logo size={28} /><span>framesflow</span></a>
        <span className="sep" />
        <div className="proj" onClick={() => setMenu(m => !m)} role="button" tabIndex={0}><b>{project.name}</b><ChevronDown size={14} />
          {menu && <div className="menu" onClick={e => e.stopPropagation()}>
            {app.projects.map(p => <button key={p.id} className={p.id === project.id ? 'on' : ''} onClick={() => openProject(p.id)}>{p.name}<small>{p.clips} clips</small><span className="del" onClick={e => { e.stopPropagation(); deleteProject(p.id); }}>✕</span></button>)}
            {cloud.session && !server && cloud.cloudProjects.filter(cp => !app.projects.some(p => p.id === cp.id)).map(cp => <button key={cp.id} onClick={() => openCloud(cp.id)}>☁ {cp.name}<small>your account</small></button>)}
            <button className="new" onClick={newProject}><Plus size={14} /> New video</button>
          </div>}
        </div>
        <span className={`local-pill ${server ? '' : 'alt'}`} title={server ? (app.remote ? 'Linked to your local studio at 127.0.0.1:4317' : 'Local studio server') : 'Standalone browser mode — media never leaves this device'}>{server ? (app.remote ? 'LINKED' : 'SERVER') : 'BROWSER'}</span>
        <div className="spacer" />
        {running.length > 0 && <div className="head-job"><Progress value={running[0].progress} label={`${running[0].label}: ${running[0].message || '…'}`} /></div>}
        <AccountChip />
        <button className={`mcp-chip ${live ? 'live' : ''}`} onClick={() => setDialog('guide')} title="Connect your AI over MCP"><Radio size={14} />{live ? 'AI connected' : 'Connect your AI'}</button>
        <button className="btn ghost" onClick={() => setDialog('mixer')} title="Audio mixer"><AudioLines size={14} /> Mixer</button>
        <a className="btn ghost" href="#/guide"><BookOpen size={14} /> Guide</a>
        <a className="btn ghost" href="#/support" title="Framesflow is free. Support its development from $5." style={{ color: 'var(--ai, #d8f36a)' }}>♥ Support</a>
        <button className="btn primary" onClick={() => setDialog('render')} disabled={!project.clips.some(c => c.track[0] === 'V')}><Clapperboard size={15} /> {server ? 'Render' : 'Export'}</button>
      </header>

      <div className="s-main">
        <aside className="s-left">
          <nav className="tabs" role="tablist">{tabs.map(([k, l, I]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={15} />{l}{k === 'beats' && project.beats.length ? <i>{project.beats.length}</i> : null}</button>)}</nav>
          {tab === 'auto' && <AutoPanel project={project} setSelected={setSelected} openRender={() => setDialog('render')} goGuide={() => setDialog('guide')} />}
          {tab === 'media' && <MediaPanel project={project} setSelected={setSelected} />}
          {tab === 'titles' && <TitlesPanel project={project} setSelected={setSelected} />}
          {tab === 'fx' && <EffectsPanel project={project} selected={selected} />}
          {tab === 'images' && <ImagesPanel project={project} />}
          {tab === 'anim' && <AnimationsPanel project={project} />}
          {tab === 'youtube' && <YouTubePanel project={project} beatSel={beatSel} setBeatSel={setBeatSel} />}
          {tab === 'beats' && <BeatsPanel project={project} beatSel={beatSel} setBeatSel={setBeatSel} setTab={setTab} setSelected={setSelected} />}
        </aside>

        <section className="s-center">
          <Preview project={project} selectedIds={selected} />
          <div className="transport">
            <div className="t-left"><TimeCode total={total} /></div>
            <div className="tbtns">
              <button className="icon" onClick={() => T.seek(0)} title="Start (Home)" aria-label="Skip to start"><SkipBack size={16} /></button>
              <button className="icon" onClick={() => T.step(-1)} title="Previous frame (←)" aria-label="Previous frame"><StepBack size={16} /></button>
              <button className="play" onClick={T.toggle} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={19} /> : <Play size={19} />}</button>
              <button className="icon" onClick={() => T.step(1)} title="Next frame (→)" aria-label="Next frame"><StepForward size={16} /></button>
              <button className="icon" onClick={() => T.seek(T.total())} title="End (End)" aria-label="Skip to end"><SkipForward size={16} /></button>
            </div>
            <div className="t-right"><span className="fmt">{project.settings.width}×{project.settings.height} · {project.settings.fps} fps</span></div>
          </div>
        </section>

        <aside className="s-right">
          <nav className="tabs" role="tablist">
            <button role="tab" className={rtab === 'inspector' ? 'on' : ''} onClick={() => setRtab('inspector')}><SlidersHorizontal size={15} />Inspector</button>
            <button role="tab" className={rtab === 'agent' ? 'on' : ''} onClick={() => setRtab('agent')}><ActivityIcon size={15} />Activity{live && <i className="dot" />}</button>
          </nav>
          {rtab === 'inspector' ? <Inspector project={project} selected={selected} ops={ops} /> : <AgentPanel project={project} setSelected={setSelected} goGuide={() => setDialog('guide')} />}
        </aside>
      </div>

      <section className="s-timeline">
        <Timeline project={project} rev={app.rev} selected={selected} setSelected={setSelected} beatSel={beatSel} setBeatSel={id => { setBeatSel(id); if (id) setTab(t => (t === 'youtube' ? t : 'beats')); }} ops={ops} flash={app.flash} clipboard={clipboard} />
      </section>

      {dialog === 'render' && <RenderDialog project={project} onClose={() => setDialog(null)} />}
      {dialog === 'mixer' && <MixerPanel project={project} onClose={() => setDialog(null)} />}
      {dialog === 'guide' && <GuideModal onClose={() => setDialog(null)} remote={app.remote} />}
      {app.toast && <div className={`toast ${app.toast.kind}`} role="status">{app.toast.msg}</div>}
      {server && !app.remote && !app.connected && <div className="offline">Reconnecting to the studio server…</div>}
    </div>
  );
}

function GuideModal({ onClose, remote }) {
  return (
    <Modal title="Connect your AI (MCP)" onClose={onClose} wide>
      <div className="guide-modal">
        <p>Framesflow ships an MCP connector: <b>{remote ? '65+' : '65+'} tools</b> over stdio and HTTP. Your chat AI (Claude, opencode, Cursor…) can edit the timeline, apply effects, animate keyframes, add titles and render — live, while you watch.</p>
        {remote ? (
          <>
            <p className="note ok">Your local studio is running and linked to this page. Add the connector to your AI client:</p>
            <pre>{`claude mcp add framesflow --transport http http://127.0.0.1:4317/mcp`}</pre>
            <p className="note">Claude Desktop (claude_desktop_config.json):</p>
            <pre>{`{"mcpServers":{"framesflow":{"command":"node","args":["<framesflow>/mcp/stdio.mjs"]}}}`}</pre>
            <p className="note">Then say: <i>“Use framesflow: get_status, then add a blur effect to the selected clip and keyframe its scale.”</i></p>
          </>
        ) : (
          <p className="note">This page is running in standalone browser mode. To drive it with an AI, run the local studio (<code>npm start</code> in the framesflow folder) and set <code>FRAMESFLOW_ALLOW_ORIGINS</code> to this site's URL — then reload this page and it will link automatically.</p>
        )}
        <a className="btn" href="#/guide" onClick={onClose}>Full setup guide</a>
      </div>
    </Modal>
  );
}
