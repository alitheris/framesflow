// Audio mixer: per-track faders, mute/solo, live master meter (WebAudio analyser).
import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Headphones, Lock, Unlock, X } from 'lucide-react';
import { tool, toast } from '../api';
import { Modal } from './ui';
import { level } from './audio';

export function MixerPanel({ project, onClose }) {
  const [, force] = useState(0);
  const meterRef = useRef(), raf = useRef(0);
  const tracks = project.tracks;

  useEffect(() => {
    const tick = () => {
      const l = level();
      if (meterRef.current) meterRef.current.style.width = `${Math.min(100, l * 140)}%`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const setGain = async (id, db) => {
    try { await tool('set_track', { id, gainDb: db }, { quiet: true }); }
    catch { toast('Track gain needs the local server (or use per-clip gain in the inspector).', 'error'); }
  };

  return (
    <Modal title="Audio mixer" onClose={onClose}>
      <div className="mixer">
        <div className="mix-tracks">
          {tracks.filter(t => t.kind === 'audio').map(t => (
            <div key={t.id} className={`mix-strip ${t.muted ? 'muted' : ''}`}>
              <header><b>{t.name}</b><small>{t.id}</small></header>
              <input type="range" className="fader" min={-40} max={6} step={1} value={t.gainDb ?? 0} onChange={e => setGain(t.id, +e.target.value)} style={{ '--fill': `${((t.gainDb ?? 0) + 40) / 46 * 100}%` }} />
              <span className="mix-db">{(t.gainDb ?? 0) > 0 ? '+' : ''}{t.gainDb ?? 0} dB</span>
              <div className="mix-btns">
                <button className={t.muted ? 'on' : ''} onClick={() => tool('set_track', { id: t.id, muted: !t.muted }, { quiet: true })}>{t.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                <button className={t.solo ? 'on' : ''} onClick={() => tool('set_track', { id: t.id, solo: !t.solo }, { quiet: true })}><Headphones size={14} /></button>
                <button className={t.locked ? 'on' : ''} onClick={() => tool('set_track', { id: t.id, locked: !t.locked }, { quiet: true })}>{t.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
              </div>
              <p className="note">{t.role === 'music' ? `Music ducking: ${project.settings.musicDb} dB` : t.role === 'sfx' ? 'SFX −16 dB default' : t.role === 'voice' ? 'Voice processing on render' : ''}</p>
            </div>
          ))}
        </div>
        <div className="mix-master">
          <b>Master</b>
          <div className="meter"><i ref={meterRef} /></div>
          <span>{Math.round((project.settings.masterVolume ?? 1) * 100)}%</span>
          <input type="range" min={0} max={2} step={0.05} value={project.settings.masterVolume ?? 1} onChange={e => tool('update_project', { masterVolume: +e.target.value }, { quiet: true })} />
          <p className="note">Render normalises loudness to {project.settings.loudness} LUFS.</p>
        </div>
      </div>
    </Modal>
  );
}
