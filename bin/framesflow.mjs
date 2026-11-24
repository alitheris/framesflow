#!/usr/bin/env node
// framesflow: the command line for Framesflow Studio (by Alitheris), in the spirit of `npx hyperframes`.
//   npx framesflow-studio start            open the studio with every feature (the local helper)
//   npx framesflow-studio doctor           check ffmpeg, yt-dlp, Whisper and your browser
//   npx framesflow-studio skill install    install the Framesflow skill for Claude Code and other agents
//   npx framesflow-studio mcp              stdio MCP bridge (for Claude Desktop, Cursor, opencode …)
//   npx framesflow-studio call <tool> [json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BRAND } from '../shared/brand.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const skillSrc = path.join(root, 'skills', 'framesflow');
const [cmd = 'help', ...args] = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : fallback; };
const run = file => { process.argv = [process.argv[0], file, ...args]; return import(pathToFileURL(path.join(root, file)).href); };

const HELP = `
Framesflow ${pkg.version}  ·  ${BRAND.product.tagline}
Built by ${BRAND.company.name}  ·  ${BRAND.product.url}

Usage: framesflow <command>

  start [--port 4317]        Start the studio on this computer with every feature
  doctor                     Check ffmpeg, yt-dlp, Whisper and Edge/Chrome, and say how to fix gaps
  skill install              Install the Framesflow skill into ~/.claude/skills
        --project              install into ./.claude/skills instead
        --dir <folder>         install into <folder>/framesflow
  skill path                 Print where the skill files are
  skill show [file]          Print SKILL.md or a reference (e.g. references/video-types.md)
  mcp                        Run the stdio MCP server (Claude Desktop, Cursor, opencode …)
  call <tool> [json]         Call any studio tool from the terminal
  tools                      List every tool
  version

Connect an AI without installing anything: ${BRAND.product.url}/#/guide

Built by ${BRAND.company.name}:
${BRAND.family.map(f => `  ${f.name.padEnd(14)} ${f.url}  ${f.tagline}`).join('\n')}
Support the project (from $${BRAND.support.minUsd}): ${BRAND.support.url}
`;

function skillInstall() {
  const target = flag('--dir') && flag('--dir') !== true ? path.resolve(String(flag('--dir')), 'framesflow')
    : flag('--project') ? path.resolve('.claude', 'skills', 'framesflow')
    : path.join(os.homedir(), '.claude', 'skills', 'framesflow');
  if (!fs.existsSync(path.join(skillSrc, 'SKILL.md'))) { console.error('The skill files are missing from this installation.'); process.exit(1); }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(skillSrc, target, { recursive: true, force: true });
  const n = fs.readdirSync(path.join(target, 'references')).length;
  console.log(`✔ Installed the Framesflow skill (SKILL.md + ${n} references)\n  → ${target}\n`);
  console.log('Your AI can now read how to operate Framesflow and how every kind of video is made.');
  console.log('Restart your agent (for example Claude Code) so it picks the skill up.\n');
  console.log(`Made by ${BRAND.company.name}. Need a narrator? ${BRAND.family[0].name}: ${BRAND.family[0].url}`);
}

switch (cmd) {
  case 'start': { const p = flag('--port'); if (p && p !== true) process.env.PORT = String(p); await run('scripts/start.mjs'); break; }
  case 'doctor': await run('scripts/doctor.mjs'); break;
  case 'mcp': await run('mcp/stdio.mjs'); break;
  case 'call': await run('scripts/call.mjs'); break;
  case 'tools': {
    const { tools } = await import(pathToFileURL(path.join(root, 'server', 'tools.mjs')).href);
    for (const t of tools) console.log(`${t.name.padEnd(26)} ${String(t.description).split(/\s+/).join(' ').slice(0, 90)}`);
    console.log(`\n${tools.length} tools`); process.exit(0); break;
  }
  case 'skill': {
    const sub = args.shift() || 'install';
    if (sub === 'install') skillInstall();
    else if (sub === 'path') console.log(skillSrc);
    else if (sub === 'show') { const f = path.resolve(skillSrc, args[0] || 'SKILL.md'); if (!f.startsWith(skillSrc) || !fs.existsSync(f)) { console.error('No such skill file.'); process.exit(1); } process.stdout.write(fs.readFileSync(f, 'utf8')); }
    else { console.error('Use: framesflow skill install | path | show [file]'); process.exit(1); }
    break;
  }
  case 'version': case '--version': case '-v': console.log(pkg.version); break;
  case 'help': case '--help': case '-h': console.log(HELP); break;
  default: console.error(`Unknown command "${cmd}".`); console.log(HELP); process.exit(1);
}
