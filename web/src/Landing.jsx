import React, { useEffect } from 'react';
import { ArrowUpRight, Sparkles, Crosshair, Plug, Monitor, Lock, Youtube, Scissors, Wand2 } from 'lucide-react';
import { Logo } from './studio/ui';
import { SiteFooter } from './site/SiteLayout';
import { BRAND } from '../../shared/brand.mjs';

export default function Landing() {
  useEffect(() => {
    let raf;
    const scroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => document.documentElement.style.setProperty('--scroll', Math.min(window.scrollY / 650, 1))); };
    window.addEventListener('scroll', scroll, { passive: true }); scroll();
    return () => { window.removeEventListener('scroll', scroll); cancelAnimationFrame(raf); };
  }, []);
  const studio = () => { location.hash = '#/studio'; window.scrollTo(0, 0); };
  return (
    <div className="landing">
      <nav><a className="brand" href="#/"><Logo />framesflow<span className="beta">FREE</span></a>
        <div className="nav-links"><a href="#/" onClick={e => { e.preventDefault(); document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth' }); }}>The workflow</a><a href="#/docs">Docs</a><a href="#/guide">Connect your AI</a><a href="#/about">About</a><a href="#/support" style={{ color: 'var(--lime)' }}>Support</a></div>
        <button className="light-button" onClick={studio}>Open studio <ArrowUpRight size={16} /></button></nav>
      <section className="hero">
        <div className="hero-topline"><span><i /> A SCRIPT, A VOICE, AND A CHAT WINDOW</span><span>FREE AI VIDEO STUDIO / BY ALITHERIS</span></div>
        <div className="hero-copy"><h1>Give it a voice.<br /><span>Watch it become a film.</span></h1>
          <div className="hero-aside"><p>Your AI is the editor.<br />You keep the timeline.</p><p className="muted">Connect Claude over MCP, hand it a script and a voiceover, and see YouTube footage land on the exact words — live — in a real multi-track editor.</p>
            <button className="lime-button" onClick={studio}>Start creating <ArrowUpRight size={19} /></button><small><a href="#/guide" style={{ textDecoration: 'underline' }}>How to connect your AI →</a></small></div></div>
        <div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-label">01 / THE SENTENCE-MATCHED CUT</div>
          <div className="floating-note"><Sparkles size={15} /> Claude placed “Armstrong, 1969” on beat 14</div>
          <div className="film-card card-back"><span>EXPLORE / 003</span><div className="mesh" /></div>
          <div className="film-card card-front"><div className="poster-top"><span>FRAMESFLOW<br />LIVE EDIT</span><span>VOL. 02</span></div><div className="sculpture"><div /><div /><div /><div /></div><div className="poster-bottom">every word<br />gets its <em>frame.</em><ArrowUpRight size={46} /></div></div>
          <div className="art-caption"><span>LOCAL BY DESIGN.<br />DIRECTED BY YOUR AI.</span><span className="round-arrow">↓</span></div></div>
        <div className="hero-footer"><span>SCROLL TO EXPLORE ↓</span><span>FRAME-ACCURATE. SOURCE-LOGGED. RENDERED BY FFMPEG.</span><span>002 — ∞</span></div></section>

      <section className="workflow" id="workflow"><div className="section-kicker">01 / FROM SCRIPT TO UPLOAD</div>
        <div className="section-heading"><h2>Say it once.<br />Then <em>watch it cut.</em></h2><p>Whisper locks every word to a millisecond.<br />Your AI maps each sentence to a visual,<br />finds the moment on YouTube, and places it.</p></div>
        <div className="studio-showcase" onClick={studio} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && studio()} aria-label="Open the studio">
          <div className="mock-top"><span className="brand"><Logo size={20} /> Studio</span><span>The night we reached the Moon</span><span className="mock-export">Render ↗</span></div>
          <div className="mock-body"><div className="mock-left"><span>YOUR AI · LIVE</span><p>Find the lunar module descent and cut it to beat 7.</p>
            <div className="mock-chat"><Sparkles size={16} /> inspect_youtube → place_clip<br />✓ 3.4 s · sync error 0 frames</div><span className="fake-input">run_qc ↗</span></div>
            <div className="mock-preview"><div className="mock-orb" /><h3>Eagle has<br /><em>landed.</em></h3><span>FACT OVERLAY · 00:37.5</span></div></div>
          <div className="mock-timeline"><span>V1</span><div className="mock-track purple">01 · Apollo 11 launch</div><div className="mock-track green">02 · Lunar module</div><div className="mock-track orange">A1 · voiceover ▁▃▅▇▅▃▁▃▅▇▅▃</div></div>
          <span className="showcase-cta">Explore the actual studio <ArrowUpRight size={18} /></span></div>
        <div className="steps"><div><span>01</span><h3>Bring script + voice.</h3><p>Drop in your narration and the text. The script stays the source of truth for names, dates and numbers.</p></div>
          <div><span>02</span><h3>Connect your AI.</h3><p>One config line adds Framesflow to Claude, opencode, Cursor and more. It can search, look at frames, and edit.</p></div>
          <div><span>03</span><h3>Review, tweak, render.</h3><p>Pro timeline with snapping, ripple, waveforms and word-level markers. Then a loudness-matched 1080p MP4.</p></div></div></section>

      <section className="manifesto" id="principles"><div className="section-kicker">02 / BUILT FOR FACELESS CHANNELS</div>
        <h2>The editor your<br />AI can actually<br /><span>operate.</span></h2>
        <div className="principles">
          <div><Crosshair /><h3>Frame-accurate.</h3><p>Cuts snap to Whisper word times at 30 fps. Nothing runs past the voiceover — the last frame is the last word.</p></div>
          <div><Youtube /><h3>YouTube-sourced, rule-checked.</h3><p>Downloads only the seconds it needs. No clip reuse, three per video max, never back-to-back, nothing over 5 s. QC enforces it.</p></div>
          <div><Plug /><h3>Real MCP connector.</h3><p>50+ tools over stdio and HTTP. Every call appears on your timeline as it happens, with a live activity log.</p></div>
          <div><Scissors /><h3>A timeline you can trust.</h3><p>Multi-track, trim, split, ripple, snapping, waveforms, filmstrips, beats and words lanes, undo for everything.</p></div>
          <div><Wand2 /><h3>Autopilot if you want it.</h3><p>No chat? One click fills every beat by itself using the same rules, then you refine by hand.</p></div>
          <div><Lock /><h3>Local first.</h3><p>Projects, downloads and renders stay in a folder on your computer. The server only listens on 127.0.0.1.</p></div></div></section>

      <section className="home-family" id="family">
        <div className="section-kicker">03 / FROM {BRAND.company.name.toUpperCase()}</div>
        <h2>Tools for people<br />who create online.</h2>
        <p className="lead">{BRAND.company.name} builds Framesflow and its sister products. They work well together: write, narrate, make the video, and find the path that fits you.</p>
        <div className="cards">
          <a className="card" href="#/studio"><b>{BRAND.product.name} <ArrowUpRight size={15} /></b><span>{BRAND.product.tagline} Edit with your AI, animate, cut out images, render.</span><small>framesflow.online</small></a>
          {BRAND.family.map(f => (
            <a key={f.id} className="card" href={f.url} target="_blank" rel="noopener"><b>{f.name} <ArrowUpRight size={15} /></b><span>{f.tagline}</span><span style={{ marginTop: 6 }}>{f.blurb}</span><small>{f.url.replace('https://', '')}</small></a>
          ))}
        </div>
      </section>

      <section className="final-cta"><span>THERE'S A FILM IN THAT SCRIPT.</span><h2>Let's make<br /><em>it move.</em></h2><button className="lime-button" onClick={studio}>Open the studio <ArrowUpRight size={23} /></button><p style={{ marginTop: 26, fontSize: 13, color: '#9aa58b' }}>Framesflow is free. Find it useful? <a href="#/support" style={{ color: 'var(--lime)', textDecoration: 'underline' }}>Support its development</a>.</p></section>
      <SiteFooter />
    </div>
  );
}

