import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import SiteLayout from './SiteLayout';
import { BRAND } from '../../../shared/brand.mjs';

export default function About() {
  return (
    <SiteLayout title="About" kicker="Framesflow by Alitheris">
      <p className="lead">Framesflow is an AI video studio your chat can operate. You bring a script and a voice; your AI places footage on the exact words, animates graphics, mixes sound and renders the video, while you watch the timeline change live and keep full control.</p>

      <h2>Why it exists</h2>
      <p>Making a good video takes research, writing, voice, visuals, editing and polish. Most tools make you do each by hand. Framesflow turns the editing and the busywork into tools an AI can call, so you can spend your time on the story. It comes with a skill that teaches your AI how videos are really made: from faceless YouTube documentaries to Shorts, explainers and promos.</p>

      <h2>What you get</h2>
      <ul>
        <li>A multi-track studio in your browser with an exact 16:9 and 9:16 export.</li>
        <li>90 MCP tools: placement, keyframes, effects on their own layer, audio, text, quality checks and more.</li>
        <li>HTML animations rendered to transparent clips, and free image search with one-click cut-outs.</li>
        <li>A one-link connection for Claude and other AI apps, and an optional local helper for YouTube downloads and server rendering.</li>
        <li>The Framesflow skill: playbooks, recipes and rights guidance for every kind of video.</li>
      </ul>

      <h2>{BRAND.company.name}</h2>
      <p>{BRAND.company.name} is the company behind Framesflow and its sister products. We build practical tools for creators who work online.</p>
      <div className="cards">
        {BRAND.family.map(f => (
          <a key={f.id} className="card" href={f.url} target="_blank" rel="noopener">
            <b>{f.name} <ArrowUpRight size={15} /></b>
            <span>{f.tagline}</span>
            <span style={{ marginTop: 6 }}>{f.blurb}</span>
            <small>{f.url.replace('https://', '')}</small>
          </a>
        ))}
      </div>

      <h2>Use it responsibly</h2>
      <p>You are responsible for having the right to use the footage, images, music and voices in your videos, and for following the rules of the platforms you publish on. Framesflow records sources and licences to help, but it cannot decide that for you. Read the <a href="#/terms">Terms</a>.</p>

      <h2>Support</h2>
      <p>Framesflow is free. If it helps you, you can <a href="#/support">support its development</a> from $5.</p>
    </SiteLayout>
  );
}
