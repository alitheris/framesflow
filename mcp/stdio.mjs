#!/usr/bin/env node
// stdio MCP bridge: lets Claude Desktop / Claude Code / opencode / Cursor talk to the running Framesflow server.
// If the studio is not running it is started automatically (detached) so the user just opens their chat.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcp } from './build.mjs';
import { tools, DIRECTOR_PROMPT } from '../server/tools.mjs';

const BASE = process.env.FRAMESFLOW_URL || `http://127.0.0.1:${process.env.PORT || 4317}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function alive() { try { return (await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; } }
async function ensureServer() {
  if (await alive()) return;
  if (process.env.FRAMESFLOW_URL) throw new Error(`Framesflow is not reachable at ${BASE}`);
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, FRAMESFLOW_QUIET: '1' } });
  child.unref();
  for (let i = 0; i < 40; i++) { await sleep(500); if (await alive()) return; }
  throw new Error('Could not start the Framesflow server. Run "npm start" in the framesflow-studio folder and retry.');
}

async function invoke(name, args) {
  await ensureServer();
  const r = await fetch(`${BASE}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-framesflow-client': 'mcp' }, body: JSON.stringify({ args }) });
  const j = await r.json().catch(() => ({ error: 'Bad response from studio' }));
  if (!r.ok) throw new Error(j.error || `Studio error ${r.status}`);
  return j.result;
}

const server = buildMcp({ tools, invoke, directorPrompt: DIRECTOR_PROMPT });
await server.connect(new StdioServerTransport());
