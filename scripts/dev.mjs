// Runs the studio server and the Vite dev server (hot reload) together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const server = run(process.execPath, ['server/index.mjs']);
const web = run('npx', ['vite', 'web']);
const stop = () => { server.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('\n  Hot-reload studio:  http://127.0.0.1:5173\n');
