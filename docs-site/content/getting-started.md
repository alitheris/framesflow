---
title: Getting started
section: Start here
order: 1
description: Run Framesflow from a clone, from npm, or just in the browser, and connect an AI.
---

## Requirements

| Need | For | Notes |
| --- | --- | --- |
| A modern browser (Chrome or Edge recommended) | Everything | The WebCodecs export needs Chrome or Edge. |
| Node.js 20 or newer | The local helper, the CLI | Tested on Node 24. |
| ffmpeg and ffprobe | Rendering, thumbnails, waveforms | Put them on `PATH` or set `FFMPEG_PATH`, `FFPROBE_PATH`. |
| yt-dlp | YouTube search and section download | Optional. Set `YTDLP_PATH` if not on `PATH`. |
| Whisper | Word-level transcription | Optional. Without it Framesflow aligns your script to the audio using silence detection. |
| Microsoft Edge or Google Chrome | HTML animations | Optional. Found automatically; set `FRAMESFLOW_CHROME` to override. |

Run `node bin/framesflow.mjs doctor` (or `npx framesflow-studio doctor`) to see which of these are present and how to fix gaps.

## Three ways in

### 1. In the browser, nothing to install
Open the website and click **Open studio**. Import media, edit on the timeline and export an MP4. Projects are stored in IndexedDB on that device.

### 2. The local helper (every feature)
From a clone of the repository:

```bash
npm install
npm run doctor      # checks ffmpeg, yt-dlp, Whisper, Edge/Chrome
npm start           # builds the UI on first run, starts http://127.0.0.1:4317, opens the browser
```

From npm (after the package is published):

```bash
npx framesflow-studio start
```

The first run builds the web app into `web/dist`. The server listens only on `127.0.0.1`. Projects, downloads and renders live in the workspace folder (see [Configuration](configuration.html)).

### 3. Hosted site plus cloud link
A deployed Framesflow site (see [Deployment](deployment.html)) lets a visitor sign in with Google and use a single MCP link. When a helper is also running on the visitor's computer and the site's origin is allowed (`FRAMESFLOW_ALLOW_ORIGINS`), the site links to it automatically and every tool becomes available.

## Connect an AI

| Client | How |
| --- | --- |
| Claude Code, local | `claude mcp add framesflow --transport http http://127.0.0.1:4317/mcp` |
| Claude Code or Claude on the web, hosted link | `claude mcp add --transport http framesflow https://mcp.framesflow.online/mcp`, then `/mcp` to sign in |
| Claude Desktop (stdio) | add `{"mcpServers":{"framesflow":{"command":"node","args":["<path>/mcp/stdio.mjs"]}}}` to its config |
| opencode | open the repository folder; `opencode.json` is included |
| Cursor, VS Code, Gemini CLI, Codex CLI | see the in-app guide at `#/guide` for each client's snippet |

Then say: *"Use framesflow: call get_framesflow_skill, then get_status, then build a faceless video from my voiceover and script."*

## Install the skill

The skill teaches an AI how to use Framesflow and how every kind of video is made.

```bash
npx framesflow-studio skill install          # into ~/.claude/skills/framesflow
npx framesflow-studio skill install --project  # into ./.claude/skills
```

Any connected assistant can also read it on demand with the tool `get_framesflow_skill`. See [The skill](skill.html).

## Your first video, by hand

1. **Media tab:** drag in a voiceover and some clips. For a video that has sound you are asked whether to import its audio.
2. Drag clips onto **V1**. Drag the edge to trim; press `S` to split at the playhead; `Del` deletes (`Shift+Del` ripple-deletes).
3. **Titles tab:** add a title or lower third. **Effects tab:** apply an effect, or press **+ Effect** in the timeline toolbar for an effect layer.
4. **Export** (browser mode) or **Render** (helper) from the top right. Output is exactly 1920×1080 or 1080×1920 (or the size you chose).
