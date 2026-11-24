import React, { useEffect } from 'react';
import { ArrowUpRight, Heart } from 'lucide-react';
import { Logo } from '../studio/ui';
import { BRAND } from '../../../shared/brand.mjs';

export function SiteNav() {
  return (
    <nav className="site-nav">
      <a className="brand" href="#/"><Logo />framesflow</a>
      <div className="nav-links">
        <a href="#/docs">Docs</a>
        <a href="#/guide">Connect your AI</a>
        <a href="#/about">About</a>
        <a href="#/support" className="nav-support"><Heart size={13} /> Support</a>
      </div>
      <a className="light-button" href="#/studio">Open studio <ArrowUpRight size={16} /></a>
    </nav>
  );
}

/** The family block + legal links, shown at the bottom of every public page. */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="foot-grid">
        <div>
          <a className="brand" href="#/"><Logo />framesflow</a>
          <p className="foot-line">{BRAND.product.tagline}</p>
          <p className="foot-small">Built by <b>{BRAND.company.name}</b>.</p>
        </div>
        <div>
          <h4>More from {BRAND.company.name}</h4>
          {BRAND.family.map(f => (
            <a key={f.id} className="foot-card" href={f.url} target="_blank" rel="noopener">
              <b>{f.name} <ArrowUpRight size={13} /></b>
              <span>{f.tagline}</span>
            </a>
          ))}
        </div>
        <div>
          <h4>Framesflow</h4>
          <a href="#/docs">Docs and the skill</a>
          <a href={BRAND.docs.url} target="_blank" rel="noopener">Technical documentation</a>
          <a href="#/guide">Connect your AI</a>
          <a href="#/about">About</a>
          <a href="#/support">Support the project</a>
          <a href="#/terms">Terms</a>
          <a href="#/privacy">Privacy</a>
        </div>
      </div>
      <div className="foot-bottom">© {new Date().getFullYear()} {BRAND.company.name}. Framesflow, Kuku Labs and Grow With Ali are products of {BRAND.company.name}.</div>
    </footer>
  );
}

export default function SiteLayout({ title, kicker, children, wide }) {
  useEffect(() => { window.scrollTo(0, 0); if (title) document.title = `${title} · Framesflow`; }, [title]);
  return (
    <div className="site">
      <SiteNav />
      <main className={`site-main ${wide ? 'wide' : ''}`}>
        {kicker && <div className="site-kicker">{kicker}</div>}
        {title && <h1>{title}</h1>}
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
