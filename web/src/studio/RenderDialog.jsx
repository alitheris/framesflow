import React, { useRef, useState } from 'react';
import { Clapperboard, Download, FolderOutput, Loader2, CheckCircle2 } from 'lucide-react';
import { useApp, tool, toast } from '../api';
import { Modal, Progress, Field } from './ui';
import { exportVideo } from './export.mjs';

export default function RenderDialog({ project, onClose }) {
  const app = useApp();
  const local = app.mode !== 'server';
  const [quality, setQuality] = useState('final');
  const [name, setName] = useState(project.name);
  const [jobId, setJobId] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [browserOut, setBrowserOut] = useState(null); // {url, size}
  const [bp, setBp] = useState(null); // {p, stage}
  const abortRef = useRef(null);
  const job = jobId ? app.jobs[jobId] : null;
  const last = project.lastRender;
  const busy = (job?.status === 'running') || !!bp;

  const start = async () => {
    if (local) {
      setBp({ p: 0, stage: 'Preparing' });
      try {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const blob = await exportVideo(project, { quality, onProgress: (p, stage) => setBp({ p, stage }), signal: ctrl.signal });
        const url = URL.createObjectURL(blob);
        setBrowserOut({ url, size: blob.size });
      } catch (e) {
        if (e.name !== 'AbortError') toast(`Export failed: ${e.message}`, 'error');
      } finally { setBp(null); }
      return;
    }
    try { const r = await tool('render_video', { quality, name }); setJobId(r.jobId); setPkg(null); } catch { /* toast */ }
  };
  const makePackage = async () => { try { setPkg(await tool('export_package')); } catch { /* toast */ } };
  const result = job?.status === 'done' ? job.result : null;
  const shown = local ? null : result || (last ? { name: last.file, url: `/renders/${project.id}/${encodeURIComponent(last.file)}`, verification: last.verification } : null);
  const dlName = `${name.replace(/[^\w.\- ]+/g, '_') || 'video'}_${quality === 'draft' ? 'draft' : project.settings.height + 'p'}.mp4`;

  return (
    <Modal title={local ? 'Export video (in your browser)' : 'Render video'} onClose={onClose} wide>
      <div className="render">
        <div className="render-opts">
          <Field label="File name" value={name} onCommit={setName} />
          <div className="seg">
            <button className={quality === 'final' ? 'on' : ''} onClick={() => setQuality('final')} disabled={busy}><b>Final · {project.settings.height}p</b><span>{local ? 'H.264 MP4 · WebCodecs' : 'H.264 High · AAC 48 kHz · −14 LUFS'}</span></button>
            <button className={quality === 'draft' ? 'on' : ''} onClick={() => setQuality('draft')} disabled={busy}><b>Draft · half size</b><span>Fast check of sync and pacing</span></button>
          </div>
          <p className="note">{local
            ? 'Export runs entirely in this browser — nothing is uploaded. Every frame goes through the same compositor as the preview.'
            : 'Rendering happens on your computer with ffmpeg. Footage segments are cached, so re-rendering after small edits is much faster.'}</p>
          {bp ? (
            <>
              <Progress value={bp.p} label={`${bp.stage} — ${Math.round(bp.p * 100)}%`} />
              <button className="btn ghost wide" onClick={() => abortRef.current?.abort()}>Cancel</button>
            </>
          ) : busy ? (
            <>
              <Progress value={job.progress} label={job.message} />
              <button className="btn ghost wide" onClick={() => tool('cancel_job', { id: job.id })}>Cancel</button>
            </>
          ) : (
            <button className="btn primary wide" onClick={start}><Clapperboard size={15} /> Start {local ? 'export' : quality === 'final' ? 'final render' : 'draft'}</button>
          )}
          {job?.status === 'failed' && <p className="note warn">{job.error}</p>}
        </div>
        {local && browserOut && (
          <div className="render-out">
            <h4><CheckCircle2 size={15} /> {dlName}</h4>
            <video src={browserOut.url} controls preload="metadata" />
            <p className="note ok">{(browserOut.size / 1e6).toFixed(1)} MB · MP4 (H.264 + AAC)</p>
            <a className="btn primary" href={browserOut.url} download={dlName}><Download size={14} /> Download MP4</a>
          </div>
        )}
        {!local && shown && (
          <div className="render-out">
            <h4><CheckCircle2 size={15} /> {shown.name}</h4>
            <video src={shown.url} controls preload="metadata" />
            <table className="verify"><tbody>
              <tr><td>Resolution</td><td>{shown.verification.resolution} @ {shown.verification.fps} fps</td></tr>
              <tr><td>Codec</td><td>{shown.verification.videoCodec} · {shown.verification.audio}</td></tr>
              <tr><td>Length</td><td>{shown.verification.durationSec.toFixed(3)} s <small>(expected {shown.verification.expectedSec}s, drift {shown.verification.driftMs} ms)</small></td></tr>
              <tr><td>Loudness</td><td>{shown.verification.loudness ? `${shown.verification.loudness.integrated} LUFS · peak ${shown.verification.loudness.truePeak} dBTP` : 'n/a'}</td></tr>
              <tr><td>Size</td><td>{shown.verification.sizeMB} MB</td></tr>
            </tbody></table>
            <div className="row2">
              <a className="btn primary" href={`${shown.url}?download=1`}><Download size={14} /> Download MP4</a>
              <button className="btn" onClick={makePackage}><FolderOutput size={14} /> Export log package</button>
            </div>
            {pkg && <p className="note ok">Saved timeline log, transcript timing, sources list and QC report to <code>{pkg.dir}</code></p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
