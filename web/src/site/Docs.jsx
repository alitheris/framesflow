import React from 'react';
import SiteLayout from './SiteLayout';
import { useCloud } from '../cloud';
import { BRAND } from '../../../shared/brand.mjs';

export default function Docs() {
  const { mcpUrl } = useCloud();
  const link = `${mcpUrl || 'https://mcp.framesflow.online'}/mcp`;
  return (
    <SiteLayout title="Docs" kicker="Everything you need to start" wide>
      <p className="lead">Three ways to use Framesflow. Pick one, or combine them.</p>
      <div className="callout"><p><b>Want to know exactly how it works?</b> The full technical documentation explains the architecture, the project model, rendering, every tool, the cloud layer and how to extend it: <a href={BRAND.docs.url} target="_blank" rel="noopener">{BRAND.docs.url.replace('https://', '')}</a>.</p></div>
      <div className="cards">
        <a className="card" href="#/studio"><b>1 · In the browser</b><span>Open the studio, import media, edit by hand, export an exact 16:9 or 9:16 MP4. No install.</span><small>Open the studio →</small></a>
        <a className="card" href="#/guide"><b>2 · With your AI</b><span>Connect Claude (or another MCP app) with one link and let it edit the timeline while you watch.</span><small>Connection guide →</small></a>
        <a className="card" href="#docs-helper" onClick={e => { e.preventDefault(); document.getElementById('docs-helper')?.scrollIntoView({ behavior: 'smooth' }); }}><b>3 · With the helper</b><span>Run the Framesflow helper on your computer for YouTube downloads, Whisper transcripts, image search, HTML animations and the ffmpeg render.</span><small>Install the helper ↓</small></a>
      </div>

      <h2>Connect your AI in one link</h2>
      <p>Add this as a custom connector or remote MCP server, sign in with Google when asked, and allow access. Keep your studio open in a browser tab while the AI works.</p>
      <pre><code>{link}</code></pre>
      <p>Claude Code: <code>claude mcp add --transport http framesflow {link}</code>, then run <code>/mcp</code> and choose Authenticate.</p>

      <h2>The Framesflow skill</h2>
      <p>The skill teaches an AI how to operate Framesflow <em>and</em> how every kind of video is made: faceless YouTube documentaries (the "cash cow" playbook: niche, script, voice, visuals, editing, titles, upload checklist, monetisation and policy reality), explainers, listicles, Shorts and Reels, promos, tutorials and more, plus sourcing and rights guidance and exact tool recipes.</p>
      <ul>
        <li><b>Automatic:</b> any connected AI can call the tool <code>get_framesflow_skill</code> to read it. No install.</li>
        <li><b>Install into Claude Code and other skill-aware agents:</b> <code>npx framesflow-studio skill install</code></li>
        <li><b>Read it as a person:</b> the same playbooks are plain Markdown files in the skill folder.</li>
      </ul>

      <h2 id="docs-helper">The local helper (optional, more power)</h2>
      <p>Some jobs cannot run inside a web page: downloading YouTube sections, Whisper transcription, background removal, HTML animation rendering and the final ffmpeg render. The helper runs these on your own computer.</p>
      <pre><code>npx framesflow-studio start     # opens the studio with every feature
npx framesflow-studio doctor    # checks ffmpeg, yt-dlp, Whisper and your browser</code></pre>
      <p>You need Node 20+ and <a href="https://ffmpeg.org" target="_blank" rel="noopener">ffmpeg</a>. For YouTube downloads add <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener">yt-dlp</a>. Everything stays in a folder on your computer.</p>

      <h2>Make better videos</h2>
      <ul>
        <li><b>Voiceover:</b> {BRAND.family[0].name} makes AI voiceovers with premium voices in 48 languages (<a href={BRAND.family[0].url} target="_blank" rel="noopener">{BRAND.family[0].url.replace('https://', '')}</a>).</li>
        <li><b>Rights:</b> prefer original, public-domain and open-licence material, credit creators, and follow each platform's rules. Framesflow writes a <code>sources.txt</code> with every source and licence when you export.</li>
        <li><b>Exact sizes:</b> exports are exactly 1920×1080 or 1080×1920 (and 1280×720, 3840×2160).</li>
      </ul>

      <h2>Help</h2>
      <p>Run <code>npx framesflow-studio doctor</code> first. If something is still wrong, the <a href="#/guide">connection guide</a> has a troubleshooting section.</p>
    </SiteLayout>
  );
}
