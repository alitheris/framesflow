// Framesflow Studio server: REST + WebSocket for the studio UI, Streamable-HTTP MCP at /mcp, media + render file serving.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { APP_ROOT, HOST, PORT, HOME, hostAllowed, originAllowed, tmpdir, uid, safeName, capabilities } from './lib.mjs';
import { store, assetsDir, rendersDir, projectDir } from './store.mjs';
import { tools, DIRECTOR_PROMPT, setAsVoiceover } from './tools.mjs';
import { jobs } from './jobs.mjs';
import { importFile } from './media.mjs';
import { buildMcp } from '../mcp/build.mjs';

store.init();
const app = express();
app.disable('x-powered-by');

// Only loopback hosts/origins may talk to this server (stops DNS-rebinding and drive-by requests from web pages).
// Opt-in: set FRAMESFLOW_ALLOW_ORIGINS="https://yoursite.netlify.app" so the deployed studio can sync with this local server.
const remoteOrigin = origin => {
  if (!origin) return null;
  const allow = (process.env.FRAMESFLOW_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return originAllowed(origin) && allow.includes(origin) ? origin : null;
};
app.use((req, res, next) => {
  const ro = remoteOrigin(req.headers.origin);
  if (ro) {
    res.set('Access-Control-Allow-Origin', ro);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Private-Network', 'true');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'content-type, x-framesflow-client');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  if (!hostAllowed(req.headers.host)) return res.status(403).json({ error: 'Forbidden host' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req.headers.origin)) return res.status(403).json({ error: 'Forbidden origin' });
  next();
});
app.use(express.json({ limit: '30mb' }));

const toolMap = new Map(tools.map(t => [t.name, t]));
async function invokeTool(name, args, ctx) {
  const t = toolMap.get(name);
  if (!t) throw Object.assign(new Error(`Unknown tool ${name}`), { status: 404 });
  if (ctx?.by === 'mcp') { store.lastAgentAt = Date.now(); store.emit('ui', { type: 'agent', at: store.lastAgentAt, tool: name }); }
  const parsed = z.object(t.shape).strict().safeParse(args || {});
  if (!parsed.success) throw Object.assign(new Error('Invalid arguments: ' + parsed.error.issues.map(i => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')), { status: 400 });
  return t.handler(parsed.data, ctx);
}

// ---------------------------------------------------------------- REST
app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.get('/api/health', async (req, res) => {
  const { ffmpeg, ytdlp, whisper } = await capabilities();
  res.json({ ok: true, ffmpeg, ytdlp, whisper, workspace: HOME, tools: tools.length, appRoot: APP_ROOT, node: process.execPath, port: PORT, lastAgentAt: store.lastAgentAt || 0, platform: process.platform });
});
app.get('/api/state', (req, res) => res.json({ rev: store.rev, project: store.project, jobs: jobs.list(), activity: store.activity.slice(-60), projects: store.list() }));
app.get('/api/tools', (req, res) => res.json(tools.map(t => ({ name: t.name, description: t.description, ui: !!t.ui }))));
app.post('/api/tools/:name', async (req, res) => {
  try {
    const ctx = { by: req.headers['x-framesflow-client'] === 'mcp' ? 'mcp' : 'ui' };
    const result = await invokeTool(req.params.name, req.body?.args, ctx);
    res.json({ result });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/projects', (req, res) => res.json({ open: store.project.id, projects: store.list() }));
app.post('/api/projects', (req, res) => { try { store.create(String(req.body?.name || 'Untitled video').slice(0, 120)); res.json({ ok: true, id: store.project.id }); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/projects/:id/open', (req, res) => { try { store.open(req.params.id); res.json({ ok: true }); } catch (e) { res.status(404).json({ error: e.message }); } });
app.delete('/api/projects/:id', (req, res) => { try { store.delete(req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });

app.post('/api/playhead', (req, res) => { store.playhead = Number(req.body?.ms) || 0; res.json({ ok: true }); });

// raw file upload from the studio (drag & drop / file picker): body is the file, ?name= the original filename
app.post('/api/upload', async (req, res) => {
  const dir = tmpdir();
  const name = safeName(String(req.query.name || 'upload'));
  const tmp = path.join(dir, name);
  try {
    await new Promise((resolve, reject) => { const w = fs.createWriteStream(tmp); req.pipe(w); w.on('finish', resolve); w.on('error', reject); req.on('error', reject); });
    const asset = await importFile(tmp, { name: path.basename(name, path.extname(name)), cause: { by: 'ui', tool: 'upload' }, move: false });
    if (req.query.role === 'voice') setAsVoiceover(store.project.assets[asset.id] || asset, { by: 'ui' });
    res.json({ asset });
  } catch (e) { res.status(400).json({ error: e.message }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

app.get('/api/assets/:pid/:id/peaks', (req, res) => {
  const f = path.join(assetsDir(req.params.pid), path.basename(req.params.id) + '.peaks');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.type('application/octet-stream').set('Cache-Control', 'no-cache').send(fs.readFileSync(f));
});

const rel = req => [].concat(req.params.file || []).join('/');
app.get('/media/:pid/*file', (req, res) => {
  const dir = assetsDir(req.params.pid);
  const file = path.resolve(dir, rel(req));
  if (!file.startsWith(path.resolve(dir) + path.sep)) return res.status(403).end();
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(file); // sendFile supports HTTP Range for video seeking
});
app.get('/renders/:pid/*file', (req, res) => {
  const dir = rendersDir(req.params.pid), file = path.resolve(dir, rel(req));
  if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file)) return res.status(404).end();
  if (req.query.download) res.download(file); else res.sendFile(file);
});

// ---------------------------------------------------------------- MCP over HTTP (stateless)
app.post('/mcp', async (req, res) => {
  try {
    const server = buildMcp({ tools, invoke: (n, a) => invokeTool(n, a, { by: 'mcp' }), directorPrompt: DIRECTOR_PROMPT });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: String(e.message) }, id: null });
  }
});
const noSse = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
app.get('/mcp', noSse); app.delete('/mcp', noSse);

// ---------------------------------------------------------------- web app
const dist = path.join(APP_ROOT, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|mcp|media|renders|ws).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('html').send('<body style="font-family:sans-serif;background:#11120f;color:#eee;padding:40px"><h2>Framesflow server is running</h2><p>The web app is not built yet. Run <code>npm run build</code> (or <code>npm run dev</code> for hot reload).</p></body>'));
}
app.use((err, req, res, next) => { res.status(err.status || 500).json({ error: err.message }); });

// ---------------------------------------------------------------- realtime
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws') || !hostAllowed(req.headers.host) || !originAllowed(req.headers.origin)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const all = m => wss.clients.forEach(ws => send(ws, m));
wss.on('connection', ws => {
  send(ws, { type: 'state', rev: store.rev, project: store.project, jobs: jobs.list(), activity: store.activity.slice(-60), projects: store.list() });
  ws.on('message', buf => { try { const m = JSON.parse(buf); if (m.type === 'playhead') store.playhead = Number(m.ms) || 0; } catch { /* ignore */ } });
});

// coalesce bursts (autopilot places clips quickly) to ≤ ~12 updates/s
let pending = null, timer = null;
store.on('change', ev => {
  if (!pending) pending = { clipIds: new Set(), summaries: [], by: ev.cause.by };
  (ev.cause.clipIds || []).forEach(id => pending.clipIds.add(id));
  if (ev.cause.summary) pending.summaries.push({ summary: ev.cause.summary, by: ev.cause.by, tool: ev.cause.tool });
  pending.rev = ev.rev;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const p = pending; pending = null;
    all({ type: 'project', rev: store.rev, project: store.project, cause: { by: p.by, clipIds: [...p.clipIds] }, activity: p.summaries });
  }, 80);
});
jobs.on('job', job => all({ type: 'job', job }));
store.on('ui', ev => all(ev));

server.listen(PORT, HOST, () => {
  if (!process.env.FRAMESFLOW_QUIET) {
    console.log(`\n  Framesflow Studio  ->  http://${HOST}:${PORT}`);
    console.log(`  MCP (HTTP)         ->  http://${HOST}:${PORT}/mcp`);
    console.log(`  MCP (stdio)        ->  node ${path.join(APP_ROOT, 'mcp', 'stdio.mjs')}`);
    console.log(`  Workspace          ->  ${HOME}\n`);
  }
});
server.on('error', e => { if (e.code === 'EADDRINUSE') { if (!process.env.FRAMESFLOW_QUIET) console.error(`Port ${PORT} is already in use — Framesflow may already be running at http://${HOST}:${PORT}`); process.exit(0); } else throw e; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.saveNow(); process.exit(0); });
