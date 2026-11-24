import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import './studio.css';
import './site.css';
import { init, useApp } from './api';
import { Logo } from './studio/ui';
import Landing from './Landing';
import Studio from './studio/Studio';
import Guide from './Guide';
import { LoginScreen, AuthorizePage } from './Auth';
import { initCloud, useCloud } from './cloud';
import About from './site/About';
import Docs from './site/Docs';
import Support from './site/Support';
import Thanks from './site/Thanks';
import { Terms, Privacy } from './site/Legal';

const route = () => {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('guide')) return 'guide';
  if (h.startsWith('studio')) return 'studio';
  if (h.startsWith('authorize')) return 'authorize';
  for (const p of ['about', 'docs', 'support', 'thanks', 'terms', 'privacy']) if (h.startsWith(p)) return p;
  return 'home'; // landing page is the main page; the studio lives at #/studio
};

function Boot() {
  return <div className="boot"><Logo /><p>Starting Framesflow…</p></div>;
}

// Logo intro: plays your FF logo animation once per browser session before the studio appears.
const INTRO_MS = 4600; // the animation settles at ~3.95 s
const seenIntro = () => { try { return sessionStorage.getItem('ff-intro') === '1'; } catch { return false; } };
function Intro({ onDone }) {
  const [leaving, setLeaving] = useState(false);
  const finish = () => { if (leaving) return; setLeaving(true); try { sessionStorage.setItem('ff-intro', '1'); } catch { /* private mode */ } setTimeout(onDone, 450); };
  useEffect(() => { const t = setTimeout(finish, INTRO_MS); return () => clearTimeout(t); }, []);
  return (
    <div className={`intro ${leaving ? 'out' : ''}`} onClick={finish}>
      <iframe title="Framesflow intro" src={`${import.meta.env.BASE_URL}ff-logo-intro.html?background=ink`} />
      <button className="intro-skip" onClick={finish}>Skip</button>
    </div>
  );
}

function App() {
  const app = useApp();
  const [view, setView] = useState(route());
  const cloud = useCloud();
  const [ready, setReady] = useState(app.mode !== 'boot');
  const [intro, setIntro] = useState(() => route() === 'studio' && !seenIntro() && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { Promise.allSettled([init(), initCloud()]).then(() => setReady(true)); }, []);
  useEffect(() => { const f = () => setView(route()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.view = view; document.title = view === 'guide' ? 'Connect your AI · Framesflow' : 'Framesflow Studio'; }, [view]);
  if (!ready || app.mode === 'boot' || !cloud.ready) return <Boot />;
  // with cloud accounts switched on, the studio and the AI-connect page need a signed-in user
  if (cloud.enabled && !cloud.session && (view === 'studio' || view === 'authorize')) {
    return <LoginScreen title={view === 'authorize' ? 'Sign in to connect your AI' : 'Sign in to Framesflow'} note={view === 'authorize' ? 'Sign in with the account you want your AI to edit.' : undefined} />;
  }
  if (view === 'authorize') return <AuthorizePage />;
  const pages = { about: About, docs: Docs, support: Support, thanks: Thanks, terms: Terms, privacy: Privacy };
  if (pages[view]) { const P = pages[view]; return <P />; }
  const page = view === 'guide' ? <Guide goto={() => { location.hash = '#/studio'; }} /> : view === 'home' ? <Landing /> : <Studio />;
  return <>{page}{intro && view === 'studio' && <Intro onDone={() => setIntro(false)} />}</>;
}
createRoot(document.getElementById('root')).render(<App />);
