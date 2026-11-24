---
title: The helper server
section: How it works
order: 5
description: The Node server: REST, WebSocket, store, jobs, media handling and workspace layout.
---

`server/index.mjs` is an Express app plus a WebSocket server. It owns the open project, runs the tools, serves media and renders, and hosts the MCP endpoint. It binds to `127.0.0.1` only (default port 4317).

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /api/ping` | Liveness check, used by the UI to detect a helper |
| `GET /api/health` | ffmpeg, yt-dlp, Whisper availability, workspace path, tool count, last AI activity |
| `GET /api/state` | Current revision, project, jobs, recent activity, project list |
| `GET /api/tools` | Tool names and descriptions |
| `POST /api/tools/:name` | Run a tool. Body `{ "args": { … } }`. Header `x-framesflow-client: mcp` marks the caller as an AI |
| `GET/POST /api/projects`, `POST /api/projects/:id/open`, `DELETE /api/projects/:id` | Project list and switching |
| `POST /api/playhead` | The UI tells the server where the playhead is |
| `POST /api/upload?name=…&role=voice` | Raw file upload (drag and drop). Imports the media; with `role=voice` makes it the voiceover |
| `GET /api/assets/:pid/:id/peaks` | Waveform peaks |
| `GET /media/:pid/*` | Project media, with HTTP Range support for video seeking |
| `GET /renders/:pid/*` | Finished renders (`?download=1` to download) |
| `POST /mcp` | MCP over Streamable HTTP, stateless (a new MCP server per request) |
| `GET/DELETE /mcp` | `405` (no server-sent events) |
| `WS /ws` | Live state, project updates, jobs, seek and agent events |
| everything else | The built web app (`web/dist`) with a single-page fallback |

Arguments to every tool are validated with `z.object(shape).strict()`: unknown keys are errors.

## The store

`server/store.mjs` keeps `store.project` and offers `mutate`, `undo`, `redo`, `create`, `open`, `delete` and `list`.

- `mutate(cause, fn, { history })`: runs `fn` on a structured clone, pushes the old project (as JSON) on the undo stack (limit 80), clears redo, swaps the project in, increments `rev`, schedules a save and broadcasts.
- `cause` is `{ by: 'ui'|'mcp'|'auto'|'system', tool, summary, clipIds, silent }`. It drives the activity feed (kept to the latest 200) and the clip highlight.
- Saving is **atomic**: write `project.json.tmp`, then rename. A 400 ms debounce collapses bursts. `last.json` remembers the open project.
- The server coalesces broadcasts to about one every 80 ms, so a job placing dozens of clips does not flood the UI.

## Jobs

Long work (render, autopilot, transcription, animations, cut-outs, `exec_plan`) runs as a **job**: `{ id, type, label, status, progress, message, log, result, error }`. Jobs emit events (shown live in the UI header), can be cancelled through an `AbortController`, and tools can wait for a short time and otherwise return `{ running: true, jobId }` so an AI client does not time out. The AI then polls `get_job`.

## Media handling (`server/media.mjs`)

| Function | What it does |
| --- | --- |
| `probe` | ffprobe: kind, duration, size, fps, audio and video codecs |
| `importFile` | Copies a file into `assets/`, detects baked-in black bars, registers the asset, then makes thumbnails and waveform peaks in the background |
| thumbnails | A single JPEG strip of up to 40 frames (`tile=Nx1`) per video, one frame for images |
| peaks | ffmpeg decodes to mono 8 kHz PCM; one byte (peak, scaled) per 20 ms is written to `<asset>.peaks` |
| `detectCrop` | ffmpeg `cropdetect` on a few seconds; a symmetric bar crop larger than 3% is stored in `asset.crop` |
| `contactSheet` | Tiles evenly spaced frames into one JPEG (used by `inspect_youtube` so an AI can look at footage) |

## Workspace layout

```text
<workspace>/
├─ last.json                      id of the open project
├─ models/                        cached AI models (background removal)
└─ projects/<id>/
   ├─ project.json
   ├─ assets/                     imported media, thumbnails, peaks
   ├─ cache/
   │  ├─ dl_*, peek_*             downloaded YouTube sections and low-res peeks
   │  └─ segments/                normalised render segments, keyed by content hash
   └─ renders/                    final MP4s and exported packages
```

The workspace is `workspace/` next to the code in a clone, or `~/Framesflow` when installed from npm. Override with `FRAMESFLOW_HOME`. See [Configuration](configuration.html).

## Running binaries

`server/lib.mjs` wraps child processes in `run()` (timeouts, abort signals, stdout/stderr hooks, `windowsHide`) and discovers ffmpeg, yt-dlp and Whisper (`capabilities()`, cached for two minutes; Whisper is detected on `PATH` without spawning it because Python tools start slowly).
