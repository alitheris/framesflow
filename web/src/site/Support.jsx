import React, { useEffect, useState } from 'react';
import { Heart, Loader2, ShieldCheck } from 'lucide-react';
import SiteLayout from './SiteLayout';
import { useCloud } from '../cloud';
import { BRAND } from '../../../shared/brand.mjs';

const fmt = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Parse what the person typed: "25", "$1,000", "12.50". Returns a number or null. */
export const parseAmount = v => { const n = Number(String(v).trim().replace(/^\$/, '').replace(/,/g, '')); return String(v).trim() && Number.isFinite(n) ? n : null; };

export default function Support() {
  const { mcpUrl } = useCloud();
  const [cfg, setCfg] = useState(null);       // { enabled, minUsd, maxUsd, presets }
  const [preset, setPreset] = useState(25);   // number, or null when typing a custom amount
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const min = cfg?.minUsd ?? BRAND.support.minUsd;
  const max = cfg?.maxUsd ?? 999999.99;
  const amount = preset ?? parseAmount(custom);
  const valid = amount !== null && amount >= min && amount <= max;

  useEffect(() => {
    if (!mcpUrl) { setCfg({ enabled: false }); return; }
    fetch(`${mcpUrl}/donate/config`).then(r => r.json()).then(setCfg).catch(() => setCfg({ enabled: false }));
  }, [mcpUrl]);

  const go = async () => {
    if (!valid) { setErr(amount !== null && amount < min ? `The minimum is ${fmt(min)}.` : `Enter an amount from ${fmt(min)} up.`); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${mcpUrl}/donate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }) });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error || 'Something went wrong. Please try again.');
      location.assign(j.url);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <SiteLayout title="Support Framesflow" kicker="Keep it free, keep it improving">
      <p className="lead">Framesflow is free to use. If it saves you time or helps you ship a video, you can chip in to fund development: new effects, faster renders, better tools, and more free features.</p>

      <div className="donate-box">
        <b style={{ fontSize: 17 }}>Choose an amount (USD)</b>
        <div className="amt-row" role="group" aria-label="Amount">
          {(cfg?.presets || [5, 10, 25, 50, 100]).map(p => (
            <button key={p} className={`amt ${preset === p ? 'on' : ''}`} onClick={() => { setPreset(p); setCustom(''); setErr(''); }}>{fmt(p)}</button>
          ))}
          <label className={`amt-custom ${preset === null ? 'on' : ''}`}>
            <span>$</span>
            <input inputMode="decimal" placeholder="Other amount" value={custom} aria-label="Other amount in dollars"
              onFocus={() => setPreset(null)} onChange={e => { setCustom(e.target.value); setPreset(null); setErr(''); }} />
          </label>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#9aa28b' }}>Minimum {fmt(min)}. No maximum: give as much as you like.</p>
        {cfg && !cfg.enabled && <p className="donate-err">Contributions are not switched on yet. Please check back soon.</p>}
        {err && <p className="donate-err" role="alert">{err}</p>}
        <button className="lime-button donate-go" disabled={busy || !cfg?.enabled || !valid} onClick={go}>
          {busy ? <><Loader2 className="spin" size={18} /> Opening secure checkout…</> : <><Heart size={18} /> {valid ? `Contribute ${fmt(amount)}` : 'Contribute'}</>}
        </button>
        <p className="donate-fine"><ShieldCheck size={13} style={{ verticalAlign: '-2px' }} /> Payment is handled by Stripe on its own secure page; we never see your card details. Contributions are voluntary, are not tax-deductible, and are non-refundable except where the law requires. See the <a href="#/terms">Terms</a>.</p>
      </div>

      <h2>Where it goes</h2>
      <ul>
        <li>Development time on the studio, the MCP tools and the skill that teaches your AI how videos are made.</li>
        <li>Hosting and the free tiers we rely on as more people use the hosted link.</li>
        <li>Documentation, templates and examples.</li>
      </ul>
      <p>Other ways to help: tell a friend, share a video you made, or try {BRAND.family[0].name} (<a href={BRAND.family[0].url} target="_blank" rel="noopener">{BRAND.family[0].url.replace('https://', '')}</a>) for AI voiceovers.</p>
    </SiteLayout>
  );
}
