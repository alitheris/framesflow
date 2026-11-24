import React, { useMemo, useRef, useState } from 'react';
import { Check, Circle, Loader2, FileText, Mic, Wand2, Search, ShieldCheck, Clapperboard, Sparkles, Plug, Upload, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useApp, tool, upload, toast, msFrame, fmtMs } from '../api';
import { Field, Select, Progress, Chip } from './ui';
import * as T from './transport';

const jobOf = (jobs, type) => Object.values(jobs).filter(j => j.type === type).sort((a, b) => b.startedAt - a.startedAt)[0];

function Step({ n, icon: Icon, title, state, children, hint }) {
  return (
    <section className={`step ${state}`}>
      <header>
        <span className="step-n">{state === 'done' ? <Check size={14} /> : state === 'busy' ? <Loader2 size={14} className="spin" /> : n}</span>
        <Icon size={15} /><h3>{title}</h3>{hint && <small>{hint}</small>}
      </header>
      <div className="step-body">{children}</div>
    </section>
  );
}

export default function AutoPanel({ project, setSelected, openRender, goGuide }) {
  const app = useApp();
  const fileRef = useRef();
  const [busy, setBusy] = useState('');
  const [model, setModel] = useState('base');
  const [lang, setLang] = useState('');
  const [cc, setCc] = useState(false);
  const [qc, setQc] = useState(null);
  const [mix, setMix] = useState({ youtube: 85, image: 10, animation: 5 });
  const tjob = jobOf(app.jobs, 'transcribe'), ajob = jobOf(app.jobs, 'autopilot');
  const transcribing = tjob?.status === 'running', autopiloting = ajob?.status === 'running';
  const voice = project.clips.find(c => c.track === 'A1');
  const covered = project.beats.filter(b => project.clips.some(c => c.track === 'V1' && c.beatId === b.id)).length;
  const hasScript = project.script.trim().length > 20;
  const wordsCount = project.script.trim() ? project.script.trim().split(/\s+/).length : 0;

  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch { /* toast shown */ } finally { setBusy(''); } };
  const onVoice = async f => { if (!f) return; await run('voice', async () => { await upload(f, { role: 'voice' }); toast('Voiceover added to A1. Now transcribe it.'); }); };

  const runQc = () => run('qc', async () => setQc(await tool('run_qc')));
  const focusIssue = i => { if (i.clipIds?.[0]) { setSelected(new Set([i.clipIds[0]])); const c = project.clips.find(x => x.id === i.clipIds[0]); if (c) T.seek(c.start); } };
  const sev = s => (s === 'error' ? <XCircle size={14} /> : s === 'warn' ? <AlertTriangle size={14} /> : <Info size={14} />);

  return (
    <div className="panel-scroll auto">
      <div className="agent-card" onClick={goGuide} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && goGuide()}>
        <Plug size={16} />
        <div><b>{app.agentAt && Date.now() - app.agentAt < 120000 ? 'Your AI is connected' : 'Drive this studio from your chat'}</b>
          <span>{app.agentAt && Date.now() - app.agentAt < 120000 ? 'Its edits appear live on the timeline.' : 'Connect Claude, opencode, Cursor… over MCP →'}</span></div>
      </div>

      <Step n={1} icon={FileText} title="Script" state={hasScript ? 'done' : 'todo'} hint={hasScript ? `${wordsCount} words` : 'paste the narration'}>
        <Field label="Title" value={project.name} onCommit={v => tool('update_project', { name: v })} />
        <Field label="Niche / topic (helps find footage)" value={project.settings.topic} placeholder="e.g. Apollo 11 moon landing, 1969" onCommit={v => tool('update_project', { topic: v })} />
        <Field label="Script (source of truth for spelling, names, numbers)" value={project.script} multiline={7} placeholder="Paste your full script here…" onCommit={v => tool('set_script', { script: v })} />
      </Step>

      <Step n={2} icon={Mic} title="Voiceover" state={voice ? 'done' : busy === 'voice' ? 'busy' : 'todo'} hint={voice ? fmtMs(project.assets[voice.assetId]?.duration || 0) : 'MP3 / WAV'}>
        <input ref={fileRef} type="file" accept="audio/*,video/*" hidden onChange={e => { onVoice(e.target.files[0]); e.target.value = ''; }} />
        <div className={`dropzone ${voice ? 'has' : ''}`} onClick={() => fileRef.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onVoice(e.dataTransfer.files[0]); }}>
          <Upload size={16} /><span>{voice ? 'Replace voiceover' : 'Drop your voiceover here or click to choose'}</span>
        </div>
      </Step>

      <Step n={3} icon={Wand2} title="Map the story" state={project.beats.length ? 'done' : transcribing ? 'busy' : 'todo'} hint={project.beats.length ? `${project.beats.length} beats · ${project.transcript?.engine}` : 'word timestamps → beats'}>
        <div className="row2">
          <Select label="Whisper model" value={model} onChange={setModel} options={['tiny', 'base', 'small', 'medium', 'large']} />
          <Field label="Language" value={lang} placeholder="auto" onCommit={setLang} />
        </div>
        <button className="btn primary wide" disabled={!voice || transcribing} onClick={() => run('tx', () => tool('transcribe_voiceover', { model, ...(lang ? { language: lang } : {}) }))}>
          {transcribing ? <><Loader2 size={15} className="spin" /> Transcribing…</> : <><Wand2 size={15} /> {project.beats.length ? 'Re-transcribe & rebuild beats' : 'Transcribe word-by-word'}</>}
        </button>
        {transcribing && <Progress value={0.3 + 0.6 * Math.min(1, (Date.now() - tjob.startedAt) / 90000)} label="Whisper is listening (first run downloads the model)" />}
        {project.transcript?.notes?.map((n, i) => <p key={i} className="note warn">{n}</p>)}
        {project.transcript && <p className="note">Word-by-word transcript ready — the AI can now plan the whole video from it (no AI tokens spent on transcription).</p>}
      </Step>

      <Step n={4} icon={Sparkles} title="Choose the mix" state={project.plan?.mix ? 'done' : 'todo'} hint={project.plan?.mix ? `${project.plan.mix.youtube}% video · ${project.plan.mix.image}% images · ${project.plan.mix.animation}% animation` : 'video / images / animation'}>
        <p className="note">How much of the video should be YouTube footage, how much images (upload them in Media), how much animation? The AI must follow your split — no video made of just one thing.</p>
        <div className="row3">
          <Field label="YouTube %" type="number" value={mix.youtube} onCommit={v => setMix(m => ({ ...m, youtube: Math.max(0, Math.min(100, +v || 0)) }))} />
          <Field label="Images %" type="number" value={mix.image} onCommit={v => setMix(m => ({ ...m, image: Math.max(0, Math.min(100, +v || 0)) }))} />
          <Field label="Animation %" type="number" value={mix.animation} onCommit={v => setMix(m => ({ ...m, animation: Math.max(0, Math.min(100, +v || 0)) }))} />
        </div>
        <button className="btn wide" disabled={mix.youtube + mix.image + mix.animation !== 100} onClick={() => run('mix', () => tool('set_mix', mix)).then(() => toast('Mix saved — the AI will follow it.'))}>Save mix</button>
        <p className="note">Then tell your AI: <i>“Read the transcript and build the complete video following my mix — research every shot, mask watermarks, then exec_plan.”</i></p>
      </Step>

      <Step n={5} icon={Search} title="Find footage on YouTube" state={project.beats.length && covered === project.beats.length ? 'done' : autopiloting ? 'busy' : 'todo'} hint={project.beats.length ? `${covered}/${project.beats.length} beats` : ''}>
        <label className="check"><input type="checkbox" checked={cc} onChange={e => setCc(e.target.checked)} /> Creative Commons only <small>(safer to reuse, smaller pool)</small></label>
        <button className="btn primary wide" disabled={!project.beats.length || autopiloting} onClick={() => run('ap', () => tool('autopilot', { license: cc ? 'cc' : 'any' }))}>
          {autopiloting ? <><Loader2 size={15} className="spin" /> Sourcing clips…</> : <><Sparkles size={15} /> {covered ? 'Fill the remaining beats' : 'Autopilot: find & place every clip'}</>}
        </button>
        {autopiloting && <><Progress value={ajob.progress} label={ajob.message} /><button className="btn ghost wide" onClick={() => tool('cancel_job', { id: ajob.id })}>Stop</button></>}
        {ajob?.status === 'done' && ajob.result?.failed?.length > 0 && <div className="note warn"><b>{ajob.result.failed.length} beats need a manual pick.</b> Select them in the Beats tab → YouTube.</div>}
        <p className="note">Autopilot is the offline mode. For better judgement, let your AI look at frames and choose: connect it over MCP.</p>
      </Step>

      <Step n={6} icon={ShieldCheck} title="Quality check" state={qc ? (qc.pass ? 'done' : 'warn') : 'todo'} hint="gaps · 5 s cap · reuse · sync">
        <button className="btn wide" onClick={runQc} disabled={busy === 'qc'}>{busy === 'qc' ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} Run QC</button>
        {qc && <>
          <div className={`qc-sum ${qc.pass ? 'ok' : 'bad'}`}>{qc.pass ? 'No blocking errors' : `${qc.errors} error${qc.errors > 1 ? 's' : ''}`} · {qc.warnings} warning{qc.warnings === 1 ? '' : 's'}</div>
          <div className="qc-stats"><Chip>{qc.stats.visualSegments} clips</Chip><Chip>avg {qc.stats.avgSegmentSec}s</Chip><Chip>max {qc.stats.maxSegmentSec}s</Chip><Chip>{qc.stats.youtubeFootagePct}% YouTube</Chip><Chip>{qc.stats.uniqueSourceVideos} videos</Chip></div>
          <ul className="issues">{qc.issues.map((i, k) => <li key={k} className={i.severity} onClick={() => focusIssue(i)}>{sev(i.severity)}<span>{i.message}</span></li>)}</ul>
        </>}
      </Step>

      <Step n={7} icon={Clapperboard} title="Render" state={project.lastRender ? 'done' : 'todo'} hint={project.lastRender?.file}>
        <button className="btn primary wide" disabled={!project.clips.some(c => c.track === 'V1')} onClick={openRender}><Clapperboard size={15} /> Render video…</button>
      </Step>
    </div>
  );
}
