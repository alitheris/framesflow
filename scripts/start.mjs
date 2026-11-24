// One-command launcher: builds the web app on first run, starts the server, opens the browser.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || 4317;
const url = `http://127.0.0.1:${port}/#/studio`;

if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
  console.log('First run: building the studio UI…');
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', 'web'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error('UI build failed. Run "npm install" first.'); process.exit(1); }
}

try {
  const ping = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
  if (ping.ok) { console.log(`Framesflow is already running → ${url}`); open(); process.exit(0); }
} catch { /* not running yet */ }

function open() {
  if (process.env.FRAMESFLOW_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* user can open the URL manually */ }
}

const server = spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { cwd: root, stdio: 'inherit' });
setTimeout(open, 1200);
const stop = () => { server.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));
