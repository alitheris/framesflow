// Call any studio tool from the terminal:  node scripts/call.mjs get_status   |   node scripts/call.mjs search_youtube '{"query":"apollo 11"}'
const [name, json] = process.argv.slice(2);
if (!name) { console.log('usage: node scripts/call.mjs <tool> [json-args]'); process.exit(1); }
const base = process.env.FRAMESFLOW_URL || 'http://127.0.0.1:4317';
const r = await fetch(`${base}/api/tools/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-framesflow-client': 'mcp' }, body: JSON.stringify({ args: json ? JSON.parse(json) : {} }) });
const j = await r.json();
if (j.result?._images) j.result._images = j.result._images.map(i => `[image ${i.mimeType} ${Math.round(i.data.length / 1365)}KB]`);
console.log(JSON.stringify(j.error ? { error: j.error } : j.result, null, 1));
process.exit(r.ok ? 0 : 1);
