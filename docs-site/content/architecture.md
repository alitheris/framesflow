---
title: Architecture
section: How it works
order: 1
description: The components, the three runtimes and what happens when a tool is called.
---

## Components

| Component | Folder | Runs in | Role |
| --- | --- | --- | --- |
| Studio UI | `web/` | Browser | React app: timeline, preview compositor, inspector, panels, public site pages |
| Shared core | `shared/` | Browser and Node | Project model, pure editing operations, text and graphics math, brand data |
| Helper server | `server/` | Node | REST, WebSocket, tool registry, project store, ffmpeg render, YouTube, Whisper, images, animations |
| MCP layer | `mcp/` | Node | Builds an MCP server from the tool registry (HTTP endpoint and stdio bridge) |
| CLI | `bin/`, `scripts/` | Node | `framesflow` command, doctor, launcher, tool caller |
| Cloud | `cloud/` | Cloudflare, Supabase | Hosted MCP link, login handshake, relay, contributions, database schema |
| Skill | `skills/` | Any AI | Knowledge for assistants |
| Docs | `docs-site/` | Static host | This website |

## The three runtimes

{{diagram:architecture}}

The UI never cares which runtime it is in. `web/src/api.js` exposes one `tool(name, args)` function and one reactive state object. It decides at start-up:

1. If the page is served by the helper (`127.0.0.1`/`localhost`) and `/api/ping` answers, it uses **server mode** and keeps in sync over a WebSocket.
2. Otherwise, if a helper is reachable at `http://127.0.0.1:4317` (and allows this origin), it uses **server mode, remote**: it polls the helper's state.
3. Otherwise it uses **local mode**: shared operations run in the tab and projects are stored in IndexedDB.

In **server mode** the Node process owns the project. In **local mode** the browser does. The operations are identical.

## What happens when a tool is called

{{diagram:edit-flow}}

1. **Caller.** An AI over MCP, or the UI over REST (`POST /api/tools/:name`). Calls from MCP carry the header `x-framesflow-client: mcp` so the studio can show "AI connected".
2. **Registry.** Each tool is a record `{name, description, shape (zod), handler}` in `server/tools.mjs`. The arguments are validated with a strict zod schema (unknown keys are rejected).
3. **Shared op.** The handler calls a pure function from `shared/ops.mjs` on a draft clone of the project. Heavy work (downloads, renders) happens around it.
4. **Store.** `store.mutate(cause, fn)` clones the project, applies `fn` to the clone, pushes the previous state onto the undo stack (max 80), increments `rev`, schedules an atomic save to disk (400 ms debounce) and broadcasts the change.
5. **Broadcast.** The server coalesces bursts to roughly 12 updates per second and sends the whole project plus a "cause" (who, which tool, which clip ids) to every WebSocket client.
6. **UI.** The timeline redraws, the preview recomputes the frame, the touched clips flash.
7. **Activity.** Each change adds a line to the activity feed ("Claude placed Apollo 11 on beat 14").

## Design decisions worth knowing

- **Pure ops over mutable services.** An operation takes a draft and returns a small summary. It does no I/O. That makes it trivially testable and lets the same code run in the browser.
- **Frames for the timeline, milliseconds for sources.** Timeline positions are integer frames at the project frame rate. Source offsets and transcript times are milliseconds. Changing the frame rate rescales positions.
- **Layer order is array order.** `project.tracks[0]` is the topmost video track. The compositor draws from the bottom up.
- **Heavy features are server-side tools, not browser features.** The browser cannot run yt-dlp, ffmpeg or a headless browser, so those tools exist only in the helper. The tool list the hosted MCP offers is filtered by what the connected studio can actually run.
- **Free tiers first.** The cloud layer is designed to run on Cloudflare Workers Free, Supabase Free and Stripe's pay-as-you-go fees.
- **Licences matter.** Dependencies are chosen to be usable in a commercial hosted product: for example the background-removal model is MIT, and AGPL libraries are avoided (see [Images and cut-outs](images-cutouts.html)).
