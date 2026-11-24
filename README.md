# Framesflow Studio

**The free AI video studio your chat can operate.** By [Alitheris](https://framesflow.online). Website: https://framesflow.online

A pro, AI-driven video editor that runs in your browser — deployable as a static site **and** connectable over **MCP** (one hosted link, or a local helper) so your chat AI (Claude, opencode, Cursor…) edits the timeline live while you watch. It ships with a **skill** that teaches your AI how every kind of video is made, from faceless YouTube documentaries to Shorts, explainers and promos.

```bash
npx framesflow-studio start             # the studio with every feature (YouTube, Whisper, animations, render)
npx framesflow-studio doctor            # check ffmpeg, yt-dlp, Whisper and Edge/Chrome
npx framesflow-studio skill install     # install the Framesflow skill for Claude Code and other agents
```

**Documentation:** how everything works, in detail, is in [`docs-site/`](docs-site) (build it with `npm run docs`; published at https://docs.framesflow.online). Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security: [`SECURITY.md`](SECURITY.md).

**License:** [MIT](LICENSE), © 2026 Alitheris. The names "Framesflow", "Alitheris", "Kuku Labs" and "Grow With Ali" and their logos are not licensed for use as the name of a different product; forks should use their own name.

**From Alitheris:** [Kuku Labs](https://kukulabs.online) (AI voiceovers without credit anxiety: text to speech, voice cloning, voice editor) · [Grow With Ali](https://growwithali.com) (find the online income method that fits your life). Framesflow is free; you can [support its development](https://framesflow.online/#/support) from $5.

- **Pro editor** – unlimited video/audio tracks, free placement with overlaps, 25 inbuilt transitions, 18-effect stack, keyframe animation (scale/position/rotation/opacity/volume), 22 animated text presets with full typography control, markers, copy/paste, slip/slide/roll/ripple trims, snapping, JKL shuttle, unlimited undo.
- **Canvas compositor** – every transition, effect, keyframe and text animation is rendered live in a canvas preview. What you see is exactly what exports.
- **Audio tools** – WebAudio mixer with per-track faders, mute/solo, live meters, per-clip EQ / reverb / compressor / delay, sidechain-ducked music, −14 LUFS loudness (render).
- **Formats** – exact 16:9 and 9:16 canvases (720p → 4K), 24/25/30/50/60 fps. Exports are exactly the project size. Clip positions rescale when you change fps.
- **MCP connector** – **90 tools** over **stdio** and **Streamable HTTP**; every AI edit appears live in the studio (Activity feed, clip highlight, playhead jump).
- **AI pipeline** – Whisper word timing → beat map → YouTube sourcing (`inspect_youtube` contact sheets) → autopilot → rule QC → ffmpeg render (xfade transitions, animated-text PNG sequences, per-clip effects, keyframes baked in).
- **Two runtime modes**
  - **Server mode** (`npm start` on 127.0.0.1:4317): full power — ffmpeg render, YouTube, Whisper, autopilot, MCP.
  - **Browser mode** (any static host, e.g. Netlify): media stays on-device, editing runs through the same shared engine, projects persist in IndexedDB, export via **WebCodecs MP4** — no login, no upload.
  - Deployed pages auto-link to a local studio if one is running (set `FRAMESFLOW_ALLOW_ORIGINS=https://yoursite.netlify.app` on the server).

## Run it

Requirements: **Node 20+**, **ffmpeg** (server mode only), **yt-dlp** (YouTube features), optional **Whisper**.

```bash
npm install
npm run doctor     # checks ffmpeg / yt-dlp / whisper
npm start          # server mode: http://127.0.0.1:4317  (first run builds the UI)
npm run dev        # hot-reload development (UI on :5173)
```

Windows: double-click `Start-Framesflow.bat`.

## Deploy to Netlify (browser mode)

`netlify.toml` is included: build command `npm run build`, publish directory `web/dist`. Or drag `web/dist` into Netlify Drop — the editor opens directly, no login, no backend. Everything works except the server-only features (YouTube import, Whisper, ffmpeg render) which use browser export instead.

## Connect your AI

| Client | How |
|---|---|
| Claude Code | `claude mcp add framesflow --transport http http://127.0.0.1:4317/mcp` |
| opencode | open this folder (`opencode.json` included) |
| Claude Desktop | `claude_desktop_config.json` → `{"mcpServers":{"framesflow":{"command":"node","args":["<path>/mcp/stdio.mjs"]}}}` |

Then say: *“Use framesflow: get_status, then build a faceless video from voice.mp3 and script.txt”* — or drive the pro editor directly: *“add a wipeleft transition between the first two clips, apply a glow effect to the second, and keyframe its scale from 1 to 1.4 with ease.”*

New pro tools: `list_transitions` `list_effects` `list_text_presets` `add_text_clip` `set_text_style` `apply_effect` `update_effect` `remove_effect` `clear_effects` `set_keyframes` `clear_keyframes` `add_track` `remove_track` `reorder_tracks` `set_markers` `add_marker` `set_project_format`.

Effects, audio and images: `add_effect_layer` `set_effect_keyframes` `clear_effect_keyframes` (effects on their own timeline layer, keyframable) · `detach_audio` `set_asset_audio` (video clips carry their own audio when switched on; `download_youtube` / `import_media` ask whether to keep it) · `search_images` `import_image` `remove_background` (free openly licensed web images with credits logged to `sources.txt`; local AI cut-out to a transparent PNG using an MIT/Apache model — first run downloads ~45 MB). HTML animations (HyperFrames-style): `animation_guide` `list_animation_templates` `snapshot_animation` `create_animation` `update_animation` — the AI writes HTML/CSS/JS (or picks a template), the page is seeked frame by frame in headless Edge/Chrome and rendered to a transparent VP9 video clip placed on the timeline; library images are usable inside as `asset://<id>`. Needs Edge or Chrome installed (server mode).

Transparent cut-outs default to contain-fit and animate with `set_keyframes` (scale, x, y, rotation, opacity) on an overlay track.

## Accounts + hosted MCP link (optional)

`cloud/` holds the Google-login and one-link MCP setup for framesflow.online (Supabase + a Cloudflare Worker, free tiers): see `cloud/README.md`. Without a Supabase URL in `web/public/config.json` the studio runs exactly as before.

## Layout

```
shared/    model v3 + pure timeline ops + text-FX math (used by BOTH server and browser)
server/    express + ws, MCP tool registry, ffmpeg render, yt-dlp, whisper, autopilot, QC
mcp/       stdio bridge + MCP server builder
web/       React studio (canvas compositor, pro timeline, inspector, mixer, WebCodecs export)
scripts/   start, doctor, dev, call (CLI for any tool), drive (scenario runner)
tests/     unit tests + MCP smoke test
```

## Honest limits

- Autopilot cannot see; use `inspect_youtube` (or the *Look at 12 s* button) before placing footage. Licences are logged; you decide what is safe to publish.
- Browser export uses WebCodecs (Chrome/Edge). For long/4K projects or VP9-only browsers, run the local ffmpeg render.
- Only localhost can reach the server unless you opt in origins via `FRAMESFLOW_ALLOW_ORIGINS`.
