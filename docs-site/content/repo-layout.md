---
title: Repository layout
section: How it works
order: 2
description: Every folder and the important files in it.
---

```text
framesflow-studio/
├─ bin/framesflow.mjs          the command line (start, doctor, skill, mcp, call, tools)
├─ shared/                     code that runs in BOTH the browser and Node
│  ├─ model.mjs                project model v3, catalogs, keyframe maths, validation (checkClip)
│  ├─ ops.mjs                  pure editing operations (place, split, effects, keyframes, audio…)
│  ├─ textfx.mjs               text animation maths (shared by preview and render)
│  ├─ graphics.mjs             built-in animation graphics layout (stat, counter, quote…)
│  └─ brand.mjs                names, links and short copy for the Alitheris family
├─ server/                     the local helper (Node)
│  ├─ index.mjs                Express REST + WebSocket + static files + MCP over HTTP
│  ├─ tools.mjs                the tool registry (all 90 tools) and the director prompt
│  ├─ store.mjs                the single source of truth for the open project (undo, save, broadcast)
│  ├─ timeline.mjs             server wrappers around ops plus I/O paths (downloads, imports)
│  ├─ media.mjs                ffprobe, thumbnails, waveform peaks, black-bar detection, imports
│  ├─ youtube.mjs              search, info, section download, contact sheets (yt-dlp)
│  ├─ transcribe.mjs           Whisper, or script alignment with silence detection
│  ├─ beats.mjs                sentences → visual beats, keywords, chapters
│  ├─ autopilot.mjs            automatic sourcing and placement
│  ├─ qc.mjs                   quality checks against the editing rules
│  ├─ render.mjs               timeline → MP4 with ffmpeg
│  ├─ overlay.mjs              text and graphic frames as transparent PNG sequences
│  ├─ exporter.mjs             deliverables: timeline log, sources list, QC report
│  ├─ images.mjs               web image search (Openverse) and hardened downloads
│  ├─ bgremove.mjs             background removal (BiRefNet-lite)
│  ├─ htmlanim.mjs             HTML → transparent video (headless Edge/Chrome)
│  ├─ animtemplates.mjs        ready-made animation scenes
│  ├─ animation-guide.md       the authoring contract for HTML animations
│  ├─ director.md              the production ruleset served by get_editor_rules
│  ├─ jobs.mjs                 observable long-running jobs
│  └─ lib.mjs                  config, process helpers, security checks
├─ mcp/                        build.mjs (MCP server from the registry), stdio.mjs (bridge)
├─ web/                        the React app (Vite)
│  ├─ index.html, vite.config.js, public/ (favicon, logo intro, config.json)
│  └─ src/
│     ├─ main.jsx              routes, boot, login gate, intro
│     ├─ api.js                one api surface for server mode and local mode
│     ├─ local.mjs             browser mode: IndexedDB store and the browser-runnable tools
│     ├─ cloud.js              Google login, relay client, project sync
│     ├─ Auth.jsx              login screen and the AI-connect consent page
│     ├─ Landing.jsx, Guide.jsx
│     ├─ site/                 About, Docs, Support, Thanks, Terms, Privacy, layout and footer
│     └─ studio/               Studio, Timeline, Preview, compositor.js, export.mjs, audio.js,
│                              transport.js, RightPanels, LibraryPanels, MixerPanel, AutoPanel…
├─ cloud/
│  ├─ worker/                  Cloudflare Worker: OAuth, MCP, relay (Durable Object), contributions
│  ├─ supabase/schema.sql      the projects table with Row Level Security
│  └─ README.md                step-by-step setup
├─ skills/framesflow/          the skill: SKILL.md and references/
├─ scripts/                    start, doctor, dev, call, drive, export-tools, build-skill, build-docs
├─ tests/                      core.test.mjs (unit), mcp-smoke.mjs (end-to-end smoke)
├─ docs-site/                  this documentation website (content, assets, diagrams)
├─ workspace/                  default data folder (projects, media, renders): never committed
├─ package.json, package-lock.json, netlify.toml, opencode.json, Start-Framesflow.bat
└─ README.md
```

## Generated files you may see

| File | Made by | Used by |
| --- | --- | --- |
| `cloud/worker/src/tools.json` | `npm run build:cloud` (`scripts/export-tools.mjs`) | The hosted MCP, to list tools without the studio |
| `cloud/worker/src/skill.json` | `npm run build:cloud` (`scripts/build-skill.mjs`) | The hosted MCP's `get_framesflow_skill` |
| `skills/framesflow/references/tools.md` | `scripts/build-skill.mjs` | The skill's tool reference |
| `web/dist/` | `npm run build` | The static site and the local helper |
| `docs-site/dist/` | `npm run docs` | These docs |

All generated files are rebuilt from the code, so never edit them by hand.

## Where things go (rules of thumb)

- Logic that changes the project: **`shared/ops.mjs`**, so the browser and the helper agree.
- Anything that needs the file system, ffmpeg, the network or child processes: **`server/`**.
- Anything a user sees: **`web/src`**.
- A new capability for the AI: a tool in **`server/tools.mjs`**, plus a line in the skill if the AI needs guidance.
- Nothing in `shared/` may import Node or browser APIs.
