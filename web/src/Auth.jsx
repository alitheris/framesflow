import React, { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Radio } from 'lucide-react';
import { Logo } from './studio/ui';
import { useCloud, signInWithGoogle, requestInfo, decide } from './cloud';
import { BRAND } from '../../shared/brand.mjs';

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
);

export function LoginScreen({ title = 'Sign in to Framesflow', note }) {
  const c = useCloud();
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth">
      <div className="auth-card">
        <a href="#/" className="auth-brand" aria-label="Home"><Logo size={36} /><span>framesflow</span></a>
        <h1>{title}</h1>
        <p className="auth-note">{note || 'Your projects follow your account, and your AI can connect to your studio with one link.'}</p>
        <button className="g-btn" disabled={busy} onClick={async () => { setBusy(true); await signInWithGoogle(); setBusy(false); }}>
          {busy ? <Loader2 className="spin" size={18} /> : <GoogleG />} Continue with Google
        </button>
        {c.error && <p className="auth-err" role="alert">{c.error}</p>}
        <p className="auth-fine">By continuing you agree to the <a href="#/terms">Terms</a> and the <a href="#/privacy">Privacy Policy</a>.</p>
        <p className="auth-fine">Framesflow is built by <b>{BRAND.company.name}</b>, also behind <a href={BRAND.family[0].url} target="_blank" rel="noopener">{BRAND.family[0].name}</a> and <a href={BRAND.family[1].url} target="_blank" rel="noopener">{BRAND.family[1].name}</a>.</p>
      </div>
    </main>
  );
}

/** OAuth consent: an AI app (Claude, etc.) asks to control the signed-in user's studio. */
export function AuthorizePage() {
  const c = useCloud();
  const req = new URLSearchParams((location.hash.split('?')[1]) || '').get('req');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (!req) { setErr('This link is incomplete. Start again from your AI app.'); return; } requestInfo(req).then(setInfo).catch(e => setErr(e.message)); }, [req]);
  const go = async allow => {
    setBusy(allow ? 'allow' : 'deny');
    try { const r = await decide(req, allow); location.assign(r.redirect); }
    catch (e) { setErr(e.message); setBusy(''); }
  };
  const email = c.session?.user?.email;
  return (
    <main className="auth">
      <div className="auth-card">
        <a href="#/" className="auth-brand" aria-label="Home"><Logo size={36} /><span>framesflow</span></a>
        <div className="auth-icon"><Radio size={22} /></div>
        <h1>{info ? <>Connect <b>{info.clientName}</b> to your studio?</> : 'Connect your AI'}</h1>
        {err ? <p className="auth-err" role="alert">{err}</p> : !info ? <p className="auth-note"><Loader2 className="spin" size={16} /> Loading request…</p> : (
          <>
            <p className="auth-note">{info.clientName} (returning to <b>{info.redirectHost}</b>) will be able to <b>read and edit your Framesflow projects</b> while you are signed in as <b>{email}</b>: add clips, text, effects and animations, and ask for renders. It cannot see your other accounts or files on your computer.</p>
            <div className="auth-actions">
              <button className="btn primary" disabled={!!busy} onClick={() => go(true)}>{busy === 'allow' ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />} Allow</button>
              <button className="btn ghost" disabled={!!busy} onClick={() => go(false)}>Cancel</button>
            </div>
            <p className="auth-fine">You can disconnect any time by removing the connector in your AI app.</p>
          </>
        )}
      </div>
    </main>
  );
}
