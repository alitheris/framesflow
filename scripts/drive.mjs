// Scenario driver for local testing: node scripts/drive.mjs <scenario.mjs>   (scenario exports default async ({call, log}) => ...)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const base = process.env.FRAMESFLOW_URL || 'http://127.0.0.1:4317';
export async function call(name, args = {}) {
  const r = await fetch(`${base}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-framesflow-client': 'mcp' }, body: JSON.stringify({ args }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${j.error}`);
  if (j.result?._images) j.result._images = j.result._images.map(i => ({ ...i, data: `(${Math.round(i.data.length * 0.75 / 1024)} KB)` }));
  return j.result;
}
export async function waitJob(id, every = 2000, label = '') {
  for (;;) {
    const j = await call('get_job', { id });
    process.stdout.write(`\r${label} ${j.status} ${Math.round(j.progress * 100)}% ${j.message || ''}        `);
    if (j.status !== 'running') { console.log(); if (j.status !== 'done') throw new Error(j.error || j.status); return j.result; }
    await new Promise(r => setTimeout(r, every));
  }
}
if (process.argv[2]) {
  const mod = await import(pathToFileURL(path.resolve(process.argv[2])).href);
  await mod.default({ call, waitJob, log: (...a) => console.log(...a) });
}
