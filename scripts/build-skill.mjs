// Builds the skill's generated reference (tools.md) from the live tool registry and bundles the whole skill
// into cloud/worker/src/skill.json so the hosted MCP can serve it (get_framesflow_skill) with no studio open.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools } from '../server/tools.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.join(root, 'skills', 'framesflow');
const first = d => String(d || '').split(/\s+/).join(' ').split(/(?<=[.!?]) /)[0].slice(0, 220);

const lines = ['# Tool reference (generated)', '', `Generated from the live tool registry (${tools.length} tools). Run \`get_*\` / read each tool's description for full parameters; the MCP client shows every schema.`, '', '| Tool | What it does |', '| --- | --- |'];
for (const t of tools) lines.push(`| \`${t.name}\` | ${first(t.description).split('|').join('/')} |`);
fs.writeFileSync(path.join(skillDir, 'references', 'tools.md'), lines.join('\n') + '\n');

const files = {};
const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(md|json)$/.test(f.name)) files[path.relative(skillDir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8'); } };
walk(skillDir);
const out = path.join(root, 'cloud', 'worker', 'src', 'skill.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ name: 'framesflow', files }) /* no timestamp: keeps the generated file deterministic for CI */);
console.log(`Skill: ${Object.keys(files).length} files, ${Object.values(files).reduce((n, s) => n + s.length, 0)} chars → ${path.relative(root, out)}; tools.md lists ${tools.length} tools`);
process.exit(0);
