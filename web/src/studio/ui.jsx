// Small shared UI pieces.
import React, { useEffect, useRef, useState } from 'react';

export function Logo({ size = 30 }) {
  return <span className="ff-mark" style={{ width: size, height: size }} aria-label="Framesflow"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 30V16C9 9 13 7 19 7H22V13H19C16 13 15 14 15 17V30H9ZM7 17H20V22H7V17Z" fill="currentColor" /><path d="M22 33V19C22 12 26 10 32 10H35V16H32C29 16 28 17 28 20V33H22ZM20 20H33V25H20V20Z" fill="currentColor" /></svg></span>;
}

/** Range input that updates instantly and sends to the server shortly after (and on release). */
export function Slider({ label, value, min, max, step = 0.01, unit = '', onCommit, fmt, keyframed }) {
  const [v, setV] = useState(value);
  const timer = useRef();
  useEffect(() => setV(value), [value]);
  const push = (x, now) => { clearTimeout(timer.current); if (now) onCommit(x); else timer.current = setTimeout(() => onCommit(x), 140); };
  return (
    <label className="fld sl">
      <span>{label}{keyframed ? <em className="kf-dot" title="Keyframed" /> : null}<b>{fmt ? fmt(v) : (+v).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => { const x = +e.target.value; setV(x); push(x, false); }} onPointerUp={e => push(+e.target.value, true)} onKeyUp={e => push(+e.target.value, true)} />
    </label>
  );
}

/** Text/number input committing on blur or Enter. */
export function Field({ label, value, onCommit, type = 'text', placeholder, multiline, suffix, width, disabled, mono }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => { if (String(v) !== String(value ?? '')) onCommit(type === 'number' ? +v : v); };
  const props = { value: v, placeholder, disabled, className: mono ? 'mono' : '', onChange: e => setV(e.target.value), onBlur: commit, onKeyDown: e => { if (e.key === 'Enter' && !multiline) e.currentTarget.blur(); } };
  return (
    <label className="fld" style={width ? { width } : null}>
      {label && <span>{label}</span>}
      <span className="fld-in">{multiline ? <textarea rows={multiline} {...props} /> : <input type={type} {...props} />}{suffix && <em>{suffix}</em>}</span>
    </label>
  );
}

export function Select({ label, value, options, onChange }) {
  return (
    <label className="fld"><span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => o.group
          ? <optgroup key={o.group} label={o.group}>{o.items.map(it => <option key={it.v} value={it.v}>{it.l}</option>)}</optgroup>
          : <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
      </select>
    </label>
  );
}

export function Progress({ value, label }) {
  return <div className="prog" role="progressbar" aria-valuenow={Math.round(value * 100)}><i style={{ width: `${Math.max(2, value * 100)}%` }} />{label && <span>{label}</span>}</div>;
}

export function Chip({ children, tone, onClick, title }) { return <span className={`chip ${tone || ''} ${onClick ? 'btn' : ''}`} onClick={onClick} title={title}>{children}</span>; }

export function useCopy() {
  const [copied, setCopied] = useState(null);
  return [copied, async (text, id = 'x') => { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } setCopied(id); setTimeout(() => setCopied(null), 1600); }];
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close">✕</button></header>
        {children}
      </section>
    </div>
  );
}

export const hhmmss = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
export const parseTime = str => { const p = String(str).trim().split(':').map(Number); if (p.some(Number.isNaN)) return null; return Math.round(p.reduce((a, b) => a * 60 + b, 0) * 1000); };
export const ago = at => { if (!at) return ''; const s = Math.max(0, (Date.now() - at) / 1000); return s < 5 ? 'just now' : s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
