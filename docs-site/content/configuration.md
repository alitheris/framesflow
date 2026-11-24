---
title: Configuration
section: Build and run
order: 2
description: Every environment variable, config file and setting.
---

## Helper and CLI environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | Helper port (always bound to `127.0.0.1`) |
| `FRAMESFLOW_HOME` | `workspace/` in a clone, `~/Framesflow` from npm | Where projects, media, caches, renders and models live |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Binaries |
| `YTDLP_PATH` | `yt-dlp` | YouTube downloader |
| `WHISPER_PATH` | `whisper` | Whisper command |
| `FRAMESFLOW_WHISPER_MODEL` | `base` | Whisper model size |
| `YTDLP_COOKIES_BROWSER` | unset | Browser name for yt-dlp `--cookies-from-browser` (age-restricted videos) |
| `FRAMESFLOW_CHROME` | auto | Path to Edge or Chrome for HTML animations |
| `FRAMESFLOW_ALLOW_ORIGINS` | unset | Comma-separated website origins allowed to link to this helper (for the deployed studio) |
| `FRAMESFLOW_QUIET=1` | | No start-up banner (used by the stdio bridge) |
| `FRAMESFLOW_NO_OPEN=1` | | `start` does not open a browser |
| `FRAMESFLOW_URL` | `http://127.0.0.1:4317` | Where `call` and the stdio bridge connect |
| `FF_DEBUG=1` | | Print the ffmpeg `filter_complex` of each render |

## Website: `web/public/config.json`

```json
{
  "supabaseUrl": "",
  "supabaseAnonKey": "",
  "mcpUrl": "https://mcp.example.com",
  "contactEmail": ""
}
```

Read at start-up. With `supabaseUrl` or `supabaseAnonKey` empty, accounts are off. `mcpUrl` is the hosted MCP origin (also used by the Support page). `contactEmail` appears on the Terms and Privacy pages. The anon key is **public by design**: Row Level Security protects data.

## Worker: `cloud/worker/wrangler.toml`

| Setting | Meaning |
| --- | --- |
| `routes` | The custom domain for the Worker (for example `mcp.framesflow.online`) |
| `APP_URL` | The website origin. Used for redirects and as the only CORS origin for login and contributions |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Used to verify user tokens |
| `[[kv_namespaces]] OAUTH` | OAuth state |
| `[[durable_objects.bindings]] RELAY` | The relay class `StudioRelay` |

Secrets (set with `wrangler secret put`): `STRIPE_SECRET_KEY`. Development-only variables: `DEV_AUTH=1`, `STRIPE_API_BASE` (point at a mock).

## Workspace folder

See [The helper server](server.html#workspace-layout). It is safe to delete `cache/` to reclaim space; segments and downloads are rebuilt on demand. Never commit `workspace/` (it is in `.gitignore`).

## Docs build

`DOCS_REPO_URL` (optional) adds a GitHub link to the docs header when running `npm run docs`.
