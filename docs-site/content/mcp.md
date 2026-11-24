---
title: MCP and the tool registry
section: How it works
order: 6
description: How tools are defined once and served over stdio, local HTTP, the hosted link and REST.
---

The **Model Context Protocol (MCP)** lets an AI app call tools exposed by a server. Framesflow defines each tool **once** and serves it four ways.

| Transport | Used by | Implemented in |
| --- | --- | --- |
| REST `POST /api/tools/:name` | The studio UI, scripts, the `call` command | `server/index.mjs` |
| MCP over Streamable HTTP at `http://127.0.0.1:4317/mcp` | Claude Code and other HTTP clients, locally | `server/index.mjs` with `mcp/build.mjs` |
| MCP over stdio | Claude Desktop, Cursor, opencode, VS Code | `mcp/stdio.mjs` with `mcp/build.mjs` |
| MCP over the hosted link `https://<mcp-host>/mcp` | Any MCP client, anywhere, with login | `cloud/worker` |

## Defining a tool

Every tool is one `def(...)` call in `server/tools.mjs`:

```js
def('add_effect_layer',
  'Add an EFFECT LAYER: a separate timeline layer … Returns clipId and the effect instance ids.',
  {                                   // a zod shape = the input schema
    startMs: ms.optional(), durMs: ms.optional(),
    effects: z.array(z.object({ type: z.string(), params: z.record(z.any()).optional() })).min(1),
  },
  async (a, ctx) => {                 // the handler
    const r = store.mutate(cause(ctx, 'add_effect_layer', { summary: 'Added effect layer' }),
                           d => opAddEffectLayer(d, a));
    return { clipId: r.clip.id, track: r.clip.track };
  },
  { ui: true });                      // optional flags
```

- The **description** is what the AI reads, so write it as instructions: when to use it, what it returns, what to ask the user first.
- The **shape** becomes the JSON schema the client shows and the validator the server applies.
- The **handler** returns a plain object. A special `_images: [{ mimeType, data }]` field is turned into MCP image content (used for contact sheets and animation snapshots).
- `ctx.by` is `'mcp'` or `'ui'`. Pass it to `cause()` so the activity feed knows who acted.

## Turning the registry into an MCP server

`mcp/build.mjs` registers each tool with the MCP SDK: `server.registerTool(name, { description, inputSchema: shape }, handler)`. The handler calls `invoke(name, args)` (in-process for the HTTP endpoint, over REST for the stdio bridge), then:

- serialises the result as pretty JSON text (cut at 60,000 characters),
- appends any `_images` as image blocks,
- converts thrown errors into `{ isError: true, content: [{ type: 'text', text }] }` so the AI reads the message and can correct itself.

It also registers:

| Item | What |
| --- | --- |
| **Server instructions** | Short guidance every client receives: start with `get_framesflow_skill`, then `get_status`; credit the Alitheris family briefly and never inside the user's video |
| **Prompt** `make_faceless_video` | Runs the full documentary workflow from a voiceover path and script |
| **Resource** `framesflow://editor-rules` | The production ruleset (`server/director.md`) |

## The stdio bridge

`mcp/stdio.mjs` is a thin process an AI app launches. It builds the same MCP server but forwards each tool call to the helper over REST with `x-framesflow-client: mcp`. If the helper is not running it starts one detached, so users only have to open their chat. Set `FRAMESFLOW_URL` to point it at another server.

## The hosted link

The Worker cannot import the registry (it runs on Cloudflare), so a build step writes `cloud/worker/src/tools.json` (every tool's name, description and JSON schema, plus the list of tools that run in a browser). The Worker serves that list and relays calls to the user's studio tab. See [Cloud and accounts](cloud.html). The one exception is `get_framesflow_skill`, which the Worker answers itself from a bundled copy of the skill so it works even when no studio is open.

## Which tools run where

| Where | Tools | Why |
| --- | --- | --- |
| Browser and helper | 51: read tools (`get_project`, `get_status`, catalogs), placement, text, effects, keyframes, tracks, markers, audio flags, built-in graphics, undo/redo | They only transform the project JSON |
| Helper only | The other 39: YouTube, transcription, beats, plan execution, autopilot, image search, cut-outs, HTML animations, render, export | They need files, ffmpeg, the network, Whisper or a headless browser |

When a studio connects to the hosted link it announces what it can run (`"*"` when a helper is attached); the Worker offers only those tools, so an AI never sees a tool that cannot work.

## Writing good tool descriptions

1. Say **when** to use it and what to do before (for example "ASK THE USER before calling").
2. State **units** (milliseconds, frames, 0 to 1).
3. Name the **follow-up tools** (`inspect_youtube` before `place_clip`; `get_job` to poll).
4. Keep parameter descriptions on the zod fields: they appear in the client.
5. Return **useful ids** (`clipId`, `assetId`, effect instance ids) so the next call can use them.
