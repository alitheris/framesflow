// Builds the documentation website (docs-site/dist): static HTML, no framework, deployable anywhere.
//   npm run docs                 → docs-site/dist
//   node scripts/build-docs.mjs --out <folder>
// Content: docs-site/content/*.md (hand-written) + pages generated from the real code (tool reference, catalogs, skill).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { tools } from '../server/tools.mjs';
import { LOCAL_TOOL_NAMES } from '../web/src/local.mjs';
import * as M from '../shared/model.mjs';
import { GRAPHIC_KINDS } from '../shared/graphics.mjs';
import { ANIMATION_TEMPLATES } from '../server/animtemplates.mjs';
import { BRAND } from '../shared/brand.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'docs-site');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(site, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = process.env.DOCS_REPO_URL || '';
const SECTIONS = ['Start here', 'How it works', 'The editor', 'AI pipeline', 'Cloud and accounts', 'Build and run', 'Reference', 'The skill'];

// ------------------------------------------------------------------ helpers
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = s => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const mdCell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function frontMatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { meta, body: raw.slice(m[0].length) };
}

// ------------------------------------------------------------------ generated pages
const CATEGORIES = [
  ['Project and status', ['get_status', 'get_editor_rules', 'get_framesflow_skill', 'get_project', 'update_project', 'set_project_format', 'set_markers', 'add_marker', 'undo', 'redo', 'set_playhead', 'clear_timeline', 'delete_assets', 'set_metadata']],
  ['Script, voice and beats', ['set_script', 'import_voiceover', 'use_asset_as_voiceover', 'transcribe_voiceover', 'get_transcript', 'build_beats', 'get_beats', 'update_beat', 'add_beat', 'delete_beat', 'set_chapters']],
  ['Sourcing: YouTube, images, media', ['search_youtube', 'youtube_info', 'inspect_youtube', 'find_clips_for_beat', 'download_youtube', 'import_media', 'search_images', 'import_image', 'remove_background']],
  ['Plan and place', ['set_mix', 'set_plan', 'get_plan', 'exec_plan', 'place_clip', 'add_overlay', 'add_audio', 'autopilot']],
  ['Edit clips and tracks', ['edit_clip', 'move_clip', 'trim_clip', 'split_clip', 'delete_clips', 'duplicate_clips', 'add_clips_raw', 'apply_look', 'set_clip_mask', 'add_track', 'remove_track', 'reorder_tracks', 'set_track']],
  ['Motion, effects, text', ['set_keyframes', 'clear_keyframes', 'list_effects', 'apply_effect', 'update_effect', 'remove_effect', 'clear_effects', 'add_effect_layer', 'set_effect_keyframes', 'clear_effect_keyframes', 'list_transitions', 'list_text_presets', 'add_text_clip', 'set_text_style', 'add_animation']],
  ['HTML animation', ['animation_guide', 'list_animation_templates', 'snapshot_animation', 'create_animation', 'update_animation']],
  ['Audio', ['detach_audio', 'set_asset_audio']],
  ['Quality, render, export, jobs', ['run_qc', 'render_video', 'export_package', 'export_notes', 'get_job', 'list_jobs', 'cancel_job']],
];

function typeOf(s) {
  if (!s) return 'any';
  if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(' \\| ');
  if (s.anyOf) return s.anyOf.map(typeOf).join(' \\| ');
  if (s.type === 'array') return `array of ${typeOf(s.items)}`;
  if (s.type === 'object' && s.properties) return `object {${Object.keys(s.properties).join(', ')}}`;
  if (s.type === 'object') return 'object';
  if (s.type === 'integer' || s.type === 'number') return `${s.type}${s.minimum != null || s.maximum != null ? ` (${s.minimum ?? ''}…${s.maximum ?? ''})` : ''}`;
  return s.type || 'any';
}

function toolsPage() {
  const byName = new Map(tools.map(t => [t.name, t]));
  const used = new Set();
  let md = `${tools.length} tools. Every tool works over MCP (stdio, local HTTP, and the hosted link) and through the studio's REST API. The "Runs in" column says whether the browser alone can run the tool or whether it needs the local helper (the Node server).\n\n`;
  md += '| Category | Tools |\n| --- | --- |\n';
  const groups = [];
  for (const [cat, names] of CATEGORIES) { const list = names.filter(n => byName.has(n)); list.forEach(n => used.add(n)); groups.push([cat, list]); }
  const rest = tools.map(t => t.name).filter(n => !used.has(n)); if (rest.length) groups.push(['Other', rest]);
  for (const [cat, list] of groups) md += `| ${cat} | ${list.map(n => `[\`${n}\`](#${slug(n)})`).join(', ')} |\n`;
  md += '\n';
  for (const [cat, list] of groups) {
    md += `\n## ${cat}\n`;
    for (const n of list) {
      const t = byName.get(n);
      const schema = zodToJsonSchema(z.object(t.shape || {}), { target: 'jsonSchema7', $refStrategy: 'none' });
      const props = Object.entries(schema.properties || {});
      const req = new Set(schema.required || []);
      md += `\n### \`${n}\`\n\n${t.description}\n\n**Runs in:** ${LOCAL_TOOL_NAMES.includes(n) ? 'browser and helper' : 'helper only (Node server)'}\n\n`;
      if (props.length) {
        md += '| Parameter | Type | Required | Notes |\n| --- | --- | --- | --- |\n';
        for (const [k, s] of props) md += `| \`${k}\` | ${mdCell(typeOf(s))} | ${req.has(k) ? 'yes' : 'no'} | ${mdCell([s.description, s.default !== undefined ? `default ${JSON.stringify(s.default)}` : ''].filter(Boolean).join('. '))} |\n`;
      } else md += '_No parameters._\n';
    }
  }
  return { title: 'Tool reference', section: 'Reference', order: 10, description: `All ${tools.length} MCP tools with parameters, generated from the live registry.`, body: md };
}

function catalogsPage() {
  let md = 'Generated from `shared/model.mjs`, `shared/graphics.mjs` and `server/animtemplates.mjs`, so these tables always match the code.\n\n';
  md += `## Formats and frame rates\n\n| id | label | size |\n| --- | --- | --- |\n${M.FORMATS.map(f => `| \`${f.id}\` | ${f.label} | ${f.w}×${f.h} |`).join('\n')}\n\nFrame rates: ${M.FPS_OPTIONS.join(', ')}. Only exact 16:9 and 9:16 are accepted (\`validSize\`).\n\n`;
  md += `## Transitions (${M.TRANSITIONS.length})\n\n| id | label | group | default frames | ffmpeg path |\n| --- | --- | --- | --- | --- |\n${M.TRANSITIONS.map(t => `| \`${t.id}\` | ${t.label} | ${t.group} | ${t.dur} | ${t.xfade ? `xfade \`${t.xfade}\`` : 'custom render path'} |`).join('\n')}\n\n`;
  md += `## Effects (${M.EFFECTS.length})\n\nKeyframable parameters can be animated with \`set_effect_keyframes\`. The ffmpeg render is frame-exact for ${Object.entries(M.EFFECT_KEYFRAMABLE_RENDER_EXACT).map(([k, v]) => `\`${k}\` (${v.join(', ')})`).join(', ')} and uses the keyframe average for the rest; the browser preview and export evaluate every keyframed parameter per frame.\n\n| id | label | group | parameters (min…max, default) | keyframable |\n| --- | --- | --- | --- | --- |\n`;
  md += M.EFFECTS.map(e => `| \`${e.id}\` | ${e.label} | ${e.group} | ${e.params.length ? e.params.map(p => p.type === 'color' ? `\`${p.key}\` color ${p.def}` : p.type === 'select' ? `\`${p.key}\` ${p.options.join('/')}` : `\`${p.key}\` ${p.min}…${p.max} (${p.def})`).join('; ') : 'none'} | ${(M.EFFECT_KEYFRAMABLE[e.id] || []).join(', ') || 'no'} |`).join('\n') + '\n\n';
  md += `## Clip property keyframes\n\n\`${M.KEYFRAMABLE.join('`, `')}\` with interpolation \`linear\`, \`ease\` (smoothstep) or \`hold\`.\n\n`;
  md += `## Text\n\nKinds: ${M.TEXT_KINDS.map(k => `\`${k}\``).join(', ')}.\n\nPositions: ${M.TEXT_POSITIONS.map(k => `\`${k}\``).join(', ')}.\n\nIn animations (${M.TEXT_ANIMS_IN.length}): ${M.TEXT_ANIMS_IN.map(k => `\`${k}\``).join(', ')}.\n\nOut animations (${M.TEXT_ANIMS_OUT.length}): ${M.TEXT_ANIMS_OUT.map(k => `\`${k}\``).join(', ')}.\n\nFonts: ${M.TEXT_FONTS.map(f => f.label).join(', ')}.\n\n`;
  md += `## Colour grades\n\n| preset | values |\n| --- | --- |\n${Object.entries(M.GRADES).map(([k, v]) => `| \`${k}\` | ${Object.keys(v).length ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ') : 'none'} |`).join('\n')}\n\n`;
  md += `## Built-in animation graphics\n\nKinds for \`add_animation\`: ${GRAPHIC_KINDS.map(k => `\`${k}\``).join(', ')}. They render identically in the browser compositor and the ffmpeg render (one shared layout function).\n\n`;
  md += `## HTML animation templates\n\n${ANIMATION_TEMPLATES.map(t => `### \`${t.id}\` ${t.label}\n\n${t.description}\n\nVariables: ${t.vars.map(v => `\`${v.key}\` (${v.label}, default "${v.def}")`).join(', ')}\n`).join('\n')}\n`;
  md += `## Audio effects per clip\n\n\`audioFx\`: \`eq.low/mid/high\` (dB, −18…18), \`reverb\`, \`compressor\`, \`delay\` (0…1).\n`;
  return { title: 'Catalogs', section: 'Reference', order: 20, description: 'Transitions, effects, text animations, grades, formats and templates, generated from the code.', body: md };
}

function skillPages() {
  const dir = path.join(root, 'skills', 'framesflow');
  const fix = s => s.replace(/references\/([a-z-]+)\.md/g, (m, n) => `skill-${n}.html`);
  const pages = [];
  const main = frontMatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  pages.push({ file: 'skill', title: 'The Framesflow skill', section: 'The skill', order: 0, description: 'The skill that teaches an AI to operate Framesflow and how every kind of video is made.', body: `> This is the actual \`SKILL.md\` that ships with Framesflow (install it with \`npx framesflow-studio skill install\`; any connected AI can also read it with the tool \`get_framesflow_skill\`).\n\n${fix(main.body).replace(/^# .*\n/, '')}` });
  const order = ['cash-cow-documentaries', 'video-types', 'editing-craft', 'sourcing-and-rights', 'animation', 'recipes', 'brand', 'tools'];
  for (const [i, n] of order.entries()) {
    const f = path.join(dir, 'references', `${n}.md`);
    if (!fs.existsSync(f)) continue;
    const raw = fs.readFileSync(f, 'utf8');
    const title = (/^# (.+)$/m.exec(raw) || [, n])[1];
    pages.push({ file: `skill-${n}`, title, section: 'The skill', order: i + 1, description: `Skill reference: ${title}`, body: fix(raw).replace(/^# .*\n/, '') });
  }
  return pages;
}

// ------------------------------------------------------------------ markdown → html
function render(md, toc) {
  const renderer = {
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      const id = slug(text);
      if (depth === 2 || depth === 3) toc.push({ depth, id, text: String(text).replace(/`/g, '') });
      return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
    },
    code({ text, lang }) {
      return `<pre data-lang="${esc(lang || '')}"><code>${esc(text)}</code></pre>\n`;
    },
    table(token) {
      const head = token.header.map((h, i) => `<th>${this.parser.parseInline(h.tokens)}</th>`).join('');
      const rows = token.rows.map(r => `<tr>${r.map(c => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
    },
  };
  marked.use({ renderer, gfm: true });
  // diagrams: {{diagram:name}} → inline SVG
  const withDiagrams = md.replace(/\{\{diagram:([a-z0-9-]+)\}\}/g, (_, n) => {
    const f = path.join(site, 'diagrams', `${n}.svg`);
    // Markdown ends an HTML block at a blank line, so the SVG must not contain any
    return fs.existsSync(f) ? `\n<figure class="diagram">${fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).join('\n')}</figure>\n` : `<p>(missing diagram ${n})</p>`;
  });
  return marked.parse(withDiagrams);
}

// ------------------------------------------------------------------ collect pages
const pages = [];
for (const f of fs.readdirSync(path.join(site, 'content')).filter(x => x.endsWith('.md')).sort()) {
  const { meta, body } = frontMatter(fs.readFileSync(path.join(site, 'content', f), 'utf8'));
  pages.push({ file: f.replace(/\.md$/, ''), title: meta.title || f, section: meta.section || 'Start here', order: Number(meta.order ?? 50), description: meta.description || '', body });
}
for (const p of [toolsPage(), catalogsPage()]) pages.push({ file: slug(p.title), ...p });
pages.push(...skillPages());

const secIdx = s => { const i = SECTIONS.indexOf(s); return i < 0 ? 99 : i; };
pages.sort((a, b) => secIdx(a.section) - secIdx(b.section) || a.order - b.order || a.title.localeCompare(b.title));
const flat = pages.map(p => ({ ...p, href: p.file === 'index' ? 'index.html' : `${p.file}.html` }));

// ------------------------------------------------------------------ html shell
const LOGO = '<span class="logo-mark">F</span>';
function nav(current) {
  let html = '';
  for (const s of SECTIONS) {
    const items = flat.filter(p => p.section === s);
    if (!items.length) continue;
    html += `<div class="nav-group"><h4>${esc(s)}</h4>${items.map(p => `<a href="${p.href}"${p.file === current ? ' class="active" aria-current="page"' : ''}>${esc(p.title)}</a>`).join('')}</div>`;
  }
  return html;
}

function shell(p, bodyHtml, toc, i) {
  const prev = flat[i - 1], next = flat[i + 1];
  const tocHtml = toc.length ? `<aside class="toc" aria-label="On this page"><h4>On this page</h4>${toc.map(t => `<a class="d${t.depth}" href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : '<aside class="toc"></aside>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)} · Framesflow Docs</title>
<meta name="description" content="${esc(p.description || 'How Framesflow works, in detail.')}">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/docs.css">
</head>
<body>
<header class="top">
  <button class="menu-btn" aria-label="Menu" id="menu-btn">☰</button>
  <a class="brand" href="index.html">${LOGO}<b>framesflow</b><span>docs</span></a>
  <div class="search"><input id="q" type="search" placeholder="Search the docs…" autocomplete="off" aria-label="Search the docs"><div id="results" role="listbox"></div></div>
  <nav class="top-links"><a href="${BRAND.product.url}">Website</a>${REPO ? `<a href="${esc(REPO)}">GitHub</a>` : ''}<a href="${BRAND.support.url}">Support</a></nav>
</header>
<div class="layout">
  <nav class="side" id="side" aria-label="Documentation">${nav(p.file)}</nav>
  <main class="content">
    <article>
      <div class="kicker">${esc(p.section)}</div>
      <h1>${esc(p.title)}</h1>
      ${bodyHtml}
    </article>
    <div class="pager">${prev ? `<a class="prev" href="${prev.href}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.href}"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}</div>
    <footer class="foot">
      <p>Framesflow ${esc(pkg.version)} · built by <b>${esc(BRAND.company.name)}</b>. Also from ${esc(BRAND.company.name)}: ${BRAND.family.map(f => `<a href="${f.url}">${esc(f.name)}</a>`).join(' · ')}.</p>
      <p>These docs are generated from the source code: the tool reference, catalogs and skill pages update automatically when the code changes.</p>
    </footer>
  </main>
  ${tocHtml}
</div>
<script src="assets/docs.js" defer></script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
for (const f of fs.readdirSync(path.join(site, 'assets'))) fs.copyFileSync(path.join(site, 'assets', f), path.join(OUT, 'assets', f));
const searchIndex = [];
flat.forEach((p, i) => {
  const toc = [];
  const html = render(p.body, toc);
  fs.writeFileSync(path.join(OUT, p.href), shell(p, html, toc, i));
  // search index: one entry per h2 section
  const parts = p.body.split(/\n(?=## )/);
  parts.forEach((part, k) => {
    const h = k === 0 ? '' : (/^## (.+)$/m.exec(part) || [, ''])[1].replace(/`/g, '');
    const text = part.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (text) searchIndex.push({ t: p.title, h, u: p.href + (h ? `#${slug(h)}` : ''), x: text });
  });
});
fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(searchIndex));
fs.writeFileSync(path.join(OUT, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=3600\n/*.html\n  Cache-Control: no-cache\n');
fs.writeFileSync(path.join(OUT, '404.html'), fs.readFileSync(path.join(OUT, 'index.html'), 'utf8').replace(/<article>[\s\S]*?<\/article>/, '<article><h1>Page not found</h1><p>That page does not exist. Use the menu or search to find what you need, or <a href="index.html">go to the start</a>.</p></article>').replace(/<aside class="toc"[\s\S]*?<\/aside>/, '<aside class="toc"></aside>'));
console.log(`Docs: ${flat.length} pages, ${searchIndex.length} search entries → ${OUT}`);
process.exit(0);
