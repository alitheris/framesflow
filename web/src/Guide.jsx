import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, Terminal, Plug, Play, MessageSquare, Wrench, ShieldAlert, Radio, CircleCheck, CircleX } from 'lucide-react';
import { useApp, connect } from './api';
import { Logo, useCopy } from './studio/ui';
import { useCloud } from './cloud';

const clients = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'claude-desktop', name: 'Claude Desktop' },
  { id: 'opencode', name: 'opencode' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'vscode', name: 'VS Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'codex', name: 'Codex CLI' },
  { id: 'other', name: 'Anything else' },
];

function Code({ text, lang, id, title }) {
  const [copied, copy] = useCopy();
  return (
    <figure className="code">
      {(title || lang) && <figcaption><span>{title || lang}</span><button onClick={() => copy(text, id)}>{copied === id ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button></figcaption>}
      {!(title || lang) && <button className="code-copy" onClick={() => copy(text, id)}>{copied === id ? <Check size={13} /> : <Copy size={13} />}</button>}
      <pre><code>{text}</code></pre>
    </figure>
  );
}

export default function Guide() {
  const app = useApp();
  const [client, setClient] = useState(() => (/mac/i.test(navigator.platform) ? 'claude-code' : 'claude-code'));
  const [tools, setTools] = useState([]);
  useEffect(() => { connect(); fetch('/api/tools').then(r => r.json()).then(setTools).catch(() => {}); }, []);
  const h = app.health;
  const win = (h?.platform || navigator.platform).toLowerCase().startsWith('win');
  const root = h?.appRoot || (win ? 'C:\\path\\to\\framesflow-studio' : '/path/to/framesflow-studio');
  const sep = win ? '\\' : '/';
  const stdio = `${root}${sep}mcp${sep}stdio.mjs`;
  const node = h?.node ? (win ? 'node' : 'node') : 'node';
  const url = `http://127.0.0.1:${h?.port || 4317}/mcp`;
  const cloud = useCloud();
  const hostedUrl = cloud.enabled && cloud.mcpUrl ? `${cloud.mcpUrl}/mcp` : '';
  const live = !!(app.agentAt && Date.now() - app.agentAt < 120000);
  const j = o => JSON.stringify(o, null, 2);

  const cfg = useMemo(() => ({
    'claude-code': [
      { title: 'Terminal — recommended (HTTP)', lang: 'bash', text: `claude mcp add framesflow --transport http ${url}` },
      { title: 'Terminal — stdio (auto-starts the studio)', lang: 'bash', text: win ? `claude mcp add framesflow -- node "${stdio}"` : `claude mcp add framesflow -- node "${stdio}"` },
    ],
    'claude-desktop': [
      { title: win ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '~/Library/Application Support/Claude/claude_desktop_config.json', lang: 'json', text: j({ mcpServers: { framesflow: { command: 'node', args: [stdio] } } }) },
    ],
    opencode: [
      { title: 'opencode.json — stdio (auto-starts the studio)', lang: 'json', text: j({ $schema: 'https://opencode.ai/config.json', mcp: { framesflow: { type: 'local', command: ['node', stdio], enabled: true } } }) },
      { title: 'opencode.json — HTTP (studio already running)', lang: 'json', text: j({ $schema: 'https://opencode.ai/config.json', mcp: { framesflow: { type: 'remote', url, enabled: true } } }) },
    ],
    cursor: [
      { title: '~/.cursor/mcp.json  (or .cursor/mcp.json in a project)', lang: 'json', text: j({ mcpServers: { framesflow: { command: 'node', args: [stdio] } } }) },
      { title: 'HTTP alternative', lang: 'json', text: j({ mcpServers: { framesflow: { url } } }) },
    ],
    vscode: [
      { title: '.vscode/mcp.json', lang: 'json', text: j({ servers: { framesflow: { type: 'stdio', command: 'node', args: [stdio] } } }) },
      { title: 'HTTP alternative', lang: 'json', text: j({ servers: { framesflow: { type: 'http', url } } }) },
    ],
    gemini: [
      { title: '~/.gemini/settings.json', lang: 'json', text: j({ mcpServers: { framesflow: { command: 'node', args: [stdio] } } }) },
      { title: 'HTTP alternative', lang: 'json', text: j({ mcpServers: { framesflow: { httpUrl: url } } }) },
    ],
    codex: [
      { title: '~/.codex/config.toml', lang: 'toml', text: `[mcp_servers.framesflow]\ncommand = "node"\nargs = ['${stdio}']` },
    ],
    other: [
      { title: 'Streamable HTTP endpoint', lang: 'text', text: url },
      { title: 'or a stdio command', lang: 'text', text: `node ${stdio}` },
    ],
  }), [url, stdio, win]);

  const notes = {
    'claude-code': <>Add <code>--scope user</code> to make it available in every folder. Check it with <code>claude mcp list</code> or type <code>/mcp</code> inside Claude Code. Your Framesflow workflow also appears as the slash command <code>/mcp__framesflow__make_faceless_video</code>.</>,
    'claude-desktop': <>Open <b>Settings → Developer → Edit Config</b>, paste the block (merge it if you already have <code>mcpServers</code>), then <b>fully quit and reopen</b> Claude Desktop. Desktop launches the stdio bridge itself and the bridge starts the studio if it is not running. Look for the tools icon under the chat box.</>,
    opencode: <>Put this in <code>opencode.json</code> in your project, or in <code>~/.config/opencode/opencode.json</code> to use it everywhere. Restart opencode, then run <code>/mcp</code> to confirm <b>framesflow</b> is connected.</>,
    cursor: <>Open <b>Cursor Settings → MCP</b> to see the server turn green after you save the file.</>,
    vscode: <>Run <b>MCP: List Servers</b> from the command palette to start it. Tools are available in Agent mode.</>,
    gemini: <>Restart Gemini CLI and type <code>/mcp</code> to list connected servers.</>,
    codex: <>Restart Codex CLI; <code>/mcp</code> lists the tools it picked up.</>,
    other: <>Any client that supports MCP over <b>stdio</b> or <b>Streamable HTTP</b> works. Prefer stdio when the client can launch a command; use the HTTP URL when it only accepts a URL. Note that the HTTP endpoint is local-only (127.0.0.1), so cloud-hosted chat apps cannot reach it.</>,
  };

  const groups = useMemo(() => {
    const g = { 'Start here': ['get_status', 'get_editor_rules', 'get_project'], 'Script & voice': ['set_script', 'import_voiceover', 'transcribe_voiceover', 'get_transcript', 'build_beats', 'get_beats', 'update_beat', 'set_chapters'], 'YouTube': ['search_youtube', 'youtube_info', 'inspect_youtube', 'find_clips_for_beat', 'download_youtube'], 'Edit the timeline': ['place_clip', 'add_overlay', 'add_audio', 'edit_clip', 'move_clip', 'trim_clip', 'split_clip', 'delete_clips', 'apply_look', 'clear_timeline'], 'Check & deliver': ['run_qc', 'render_video', 'get_job', 'export_package', 'autopilot'] };
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    return Object.entries(g).map(([k, names]) => [k, names.map(n => byName[n]).filter(Boolean)]);
  }, [tools]);

  const firstPrompt = `Use the framesflow tools. Call get_status, then get_editor_rules.\nThen build a faceless YouTube video from my files:\n- Voiceover: ${win ? 'C:\\Users\\me\\Videos\\voice.mp3' : '/Users/me/Videos/voice.mp3'}\n- Script: (paste the script, or give the path to a .txt)\n- Niche: History · Title: The night we reached the Moon\nWork autonomously: transcribe, map every sentence, find YouTube clips (look at them with inspect_youtube before placing), add fact overlays, run_qc and fix everything, then render.`;

  return (
    <div className="guide">
      <nav className="g-nav"><a className="brand" href="#/"><Logo />framesflow</a><div><a href="#/">Home</a><a className="light-button" href="#/studio">Open studio <ArrowUpRight size={16} /></a></div></nav>
      <header className="g-hero">
        <span className="kicker">MCP CONNECTOR</span>
        <h1>Let your AI <em>drive the studio.</em></h1>
        <p>Framesflow runs on your computer and speaks MCP, so any compatible chat app can edit the timeline for you. Every call it makes shows up here in real time — clips land on the beats, overlays fade in, the playhead jumps to what it is talking about.</p>
        <div className="g-status">
          <span className={`pill ${h?.ffmpeg?.ok ? 'ok' : 'bad'}`}>{h?.ffmpeg?.ok ? <CircleCheck size={14} /> : <CircleX size={14} />} ffmpeg</span>
          <span className={`pill ${h?.ytdlp?.ok ? 'ok' : 'bad'}`}>{h?.ytdlp?.ok ? <CircleCheck size={14} /> : <CircleX size={14} />} yt-dlp</span>
          <span className={`pill ${h?.whisper?.ok ? 'ok' : 'warn'}`}>{h?.whisper?.ok ? <CircleCheck size={14} /> : <CircleX size={14} />} Whisper {h?.whisper?.ok ? '' : '(optional)'}</span>
          <span className={`pill ${live ? 'ok' : ''}`}><Radio size={14} /> {live ? 'AI connected' : 'waiting for an AI'}</span>
        </div>
      </header>

      <div className="g-body">
        <aside className="g-toc"><b>On this page</b>
          {[['how', 'How it works'], ['start', '1 · Start the studio'], ['connect', '2 · Connect your AI'], ['test', '3 · Test it'], ['run', '4 · Make a video'], ['tools', 'Tool reference'], ['fix', 'Troubleshooting'], ['legal', 'Footage & licences']].map(([id, l]) => <a key={id} href={`#/guide`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}>{l}</a>)}
        </aside>

        <main>
          {hostedUrl && (
            <section id="hosted">
              <h2><Plug size={20} /> Connect with one link</h2>
              <p>Copy this link into your AI app. You sign in with Google once, and from then on your AI edits the studio you have open in this browser.</p>
              <Code text={hostedUrl} title="Your MCP link" id="hosted-url" />
              <ol>
                <li><b>Claude (web or desktop):</b> Settings → Connectors → Add custom connector → paste the link → sign in when asked.</li>
                <li><b>Claude Code:</b> run <code>claude mcp add --transport http framesflow {hostedUrl}</code>, then type <code>/mcp</code> and choose Authenticate.</li>
                <li>Keep your studio open in a browser tab while the AI works. It shows every change live.</li>
              </ol>
              <p className="note">Editing tools work straight away. YouTube downloads, rendering, image search and HTML animations also work when the Framesflow helper is running on your computer.</p>
            </section>
          )}
          <section id="how">
            <h2><Plug size={20} /> How it works</h2>
            <div className="flow">
              <div><b>Your chat app</b><span>Claude, opencode, Cursor…</span></div><i>MCP</i>
              <div><b>Framesflow server</b><span>127.0.0.1:{h?.port || 4317} · {tools.length || 50}+ tools</span></div><i>live sync</i>
              <div className="hl"><b>This studio</b><span>timeline updates instantly</span></div>
            </div>
            <p>The server owns the project. Your AI calls tools (<code>place_clip</code>, <code>add_overlay</code>, <code>run_qc</code> …) and the studio mirrors every change over a WebSocket. You can grab the mouse at any time — trim, drag, split — and the AI sees your edits on its next call. Footage is downloaded by <b>yt-dlp</b> (only the few seconds you need), assembled and rendered by <b>ffmpeg</b>, all locally.</p>
          </section>

          <section id="start">
            <h2><Terminal size={20} /> 1 · Start the studio</h2>
            <p>You need Node.js 20+, <a href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer">ffmpeg</a> and <a href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">yt-dlp</a> on your PATH. For millisecond-accurate word timing install Whisper (<code>pip install openai-whisper</code>) — without it Framesflow estimates timings from the script and pauses.</p>
            <Code lang="bash" id="start" text={`cd framesflow-studio\nnpm install\nnpm run build\nnpm start        # studio at http://127.0.0.1:${h?.port || 4317}`} />
            <p className="muted">With the stdio method below you can skip <code>npm start</code>: the connector launches the studio in the background the first time your AI calls a tool. Run <code>npm run doctor</code> to check your setup.</p>
          </section>

          <section id="connect">
            <h2><Plug size={20} /> 2 · Connect your AI</h2>
            <div className="seg-tabs" role="tablist">{clients.map(c => <button key={c.id} role="tab" aria-selected={client === c.id} className={client === c.id ? 'on' : ''} onClick={() => setClient(c.id)}>{c.name}</button>)}</div>
            {cfg[client].map((b, i) => <Code key={client + i} {...b} id={client + i} />)}
            <p className="callout">{notes[client]}</p>
            <p className="muted">Config file formats change between versions; if a client rejects the snippet, check its MCP docs and keep these two values: command <code>node</code> with argument <code>{stdio}</code>, or URL <code>{url}</code>.</p>
          </section>

          <section id="test">
            <h2><Play size={20} /> 3 · Test it</h2>
            <p>Open this studio in a browser tab next to your chat, then say:</p>
            <Code lang="chat" id="t1" text={`Use framesflow get_status and tell me what's available.`} />
            <p>The <b>AI connected</b> badge in the studio header turns green and the Activity tab starts logging. Now try something visible:</p>
            <Code lang="chat" id="t2" text={`With framesflow: search YouTube for "Apollo 11 launch footage", inspect the best result around 0:30, and download a 4 second clip into the library.`} />
          </section>

          <section id="run">
            <h2><MessageSquare size={20} /> 4 · Make a video from a script + voice</h2>
            <p>Paste this (edit the paths). It follows your cash-cow ruleset: Whisper timing, sentence-by-sentence visual map, YouTube-only footage, no clip reuse, ≤ 5 s per shot, fact overlays timed to the words, QC, then render.</p>
            <Code lang="chat" id="prompt" text={firstPrompt} />
            <p>In Claude Code you can also run the built-in prompt: <code>/mcp__framesflow__make_faceless_video</code> and fill in the voiceover path. Or skip the chat entirely and press <b>Autopilot</b> in the studio's Auto tab — a rule-based fallback that needs no AI.</p>
            <ol className="steps-list">
              <li><b>Watch it happen.</b> Beats appear first, then clips land on them one by one with a highlight glow.</li>
              <li><b>Step in anywhere.</b> Select a clip, drag its edges, open the Inspector, or pick a beat and use the YouTube tab to swap the footage.</li>
              <li><b>Ask for changes.</b> “Make the first 30 seconds faster”, “replace beat 12 with something cleaner”, “add a chapter card at the climax”.</li>
            </ol>
          </section>

          <section id="tools">
            <h2><Wrench size={20} /> Tool reference</h2>
            <p className="muted">{tools.length} tools exposed over MCP. Your AI sees these descriptions and picks the right call by itself.</p>
            {groups.map(([g, list]) => <div key={g} className="tgroup"><h3>{g}</h3>{list.map(t => <div key={t.name} className="tool"><code>{t.name}</code><span>{t.description}</span></div>)}</div>)}
          </section>

          <section id="fix">
            <h2><ShieldAlert size={20} /> Troubleshooting</h2>
            <dl className="faq">
              <dt>The AI says it can't connect / no tools show up</dt><dd>Restart the chat app after editing its config. For HTTP, make sure <code>npm start</code> is running and <code>{url.replace('/mcp', '/api/health')}</code> opens in your browser. Prefer the stdio snippet — it starts the studio itself.</dd>
              <dt>“spawn node ENOENT” on Windows</dt><dd>The client can't find Node. Use the full path in <code>command</code>, e.g. <code>{win ? 'C:\\\\Program Files\\\\nodejs\\\\node.exe' : '/usr/local/bin/node'}</code>.</dd>
              <dt>YouTube downloads fail</dt><dd>Update yt-dlp (<code>yt-dlp -U</code>) — YouTube changes often. Age-restricted or members-only videos need cookies: set <code>YTDLP_COOKIES_BROWSER=chrome</code> before starting the studio.</dd>
              <dt>Timing is a little off</dt><dd>Install Whisper. Without it timings are estimated from your script and detected pauses. Larger models (<code>small</code>, <code>medium</code>) are more accurate but slower on CPU.</dd>
              <dt>Port 4317 is busy</dt><dd>Start with <code>PORT=4400 npm start</code> (PowerShell: <code>$env:PORT=4400; npm start</code>) and use that port in the URL above.</dd>
              <dt>Where are my files?</dt><dd><code>{h?.workspace || 'workspace/'}</code> — one folder per project with its media, cache and renders.</dd>
            </dl>
          </section>

          <section id="legal">
            <h2><ShieldAlert size={20} /> Footage &amp; licences</h2>
            <p>Framesflow records the uploader, URL, in/out points and any licence YouTube reports for every clip, and flags what it could not confirm in <code>sources.txt</code>. Use the <b>Creative Commons</b> filter when you can. Downloading and reusing other people's videos can breach YouTube's Terms of Service and copyright law; editing, cropping or colour-grading does not by itself make it fair use. You are responsible for what you publish.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
