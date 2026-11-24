---
title: Cloud and accounts
section: Cloud and accounts
order: 1
description: Google login, the one-link hosted MCP, the relay to your studio tab, and project sync.
---

The cloud layer is **optional** and is designed to run on free tiers. It does three things: sign people in, give each person a single MCP link, and keep their project files with their account. It never stores media, and it never runs a user's tools itself: tools execute in the user's own studio tab.

{{diagram:cloud-relay}}

## Pieces

| Piece | Where | Job |
| --- | --- | --- |
| Supabase | Hosted | Google sign-in (Auth), the `projects` table with Row Level Security |
| Worker | Cloudflare Workers | OAuth 2.1 authorization server, MCP endpoint, WebSocket entry, contributions |
| `StudioRelay` | Durable Object (SQLite-backed, free plan) | One per user. Holds the WebSocket from the user's open studio tab and forwards tool calls |
| KV namespace `OAUTH` | Cloudflare KV | Registered clients, pending authorizations, codes, token hashes |
| Studio website | Static host | Login screen, consent page, relay client, project sync |

## The login handshake (OAuth 2.1 with PKCE)

MCP clients such as Claude discover the server from its metadata and sign the user in through a browser.

1. The client reads `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
2. It **registers itself** (dynamic client registration, `POST /register`). Redirect URIs must be `https://…` or loopback `http://…`; at most 5; no fragments. A client id like `ffc_…` is stored for 90 days.
3. It sends the user to `GET /authorize` with a PKCE `code_challenge` (`S256` is mandatory). The Worker checks the client and the exact redirect URI, stores a pending request (10 minutes) and redirects to the studio website's `#/authorize?req=…`.
4. The website signs the user in with Google through Supabase if needed, shows **"Connect <app> to your studio?"** with the app's name and where it returns to, and on **Allow** calls `POST /authorize/approve` with the user's Supabase access token.
5. The Worker verifies that token by asking Supabase (`/auth/v1/user`), mints a **single-use authorization code** (5 minutes, stored hashed) and returns the redirect.
6. The client calls `POST /token` with the code and the PKCE verifier. The Worker checks client, redirect and verifier, burns the code, and returns an **access token** (1 hour) and a **refresh token** (30 days). Both are stored only as SHA-256 hashes. Refresh tokens **rotate**: the old one stops working when used.

| KV key | Content | Lifetime |
| --- | --- | --- |
| `client:<id>` | name, redirect URIs | 90 days |
| `authreq:<id>` | pending authorization | 10 minutes |
| `code:<hash>` | user id, client, challenge | 5 minutes, single use |
| `at:<hash>` | user id, client | 1 hour |
| `rt:<hash>` | user id, client | 30 days, rotated on use |

## The MCP endpoint

`POST /mcp` accepts JSON-RPC (single or batch) with a bearer token. Without one it answers `401` with a `WWW-Authenticate` header pointing at the resource metadata, which is how clients start the login. Implemented methods: `initialize`, `ping`, `tools/list`, `tools/call`, and the `notifications/*` (answered `202`). It is **stateless**: no session ids, no server-sent events, so it fits the free Worker model.

- `tools/list` returns the tools the connected studio can run. The studio sends a `hello` with its tool names (or `"*"` when a helper is attached); with no studio connected the list falls back to the 51 browser tools.
- `tools/call` forwards to the user's relay and returns the result as MCP content (JSON text plus any images).
- `get_framesflow_skill` is answered by the Worker itself from a bundled copy of the skill.

## The relay

The studio tab opens `wss://<mcp-host>/ws` with the subprotocol `bearer.<supabase access token>` (browsers cannot set headers on WebSockets). The Worker verifies the token, then hands the socket to that user's Durable Object. The object:

- keeps **one active tab** per account (a new connection closes the old with code 4000 and the tab shows "open in another tab");
- answers keep-alive `ping` with `pong` without waking up;
- stores the studio's `hello` (tool list, project name);
- on a call, sends `{type:'call', id, name, args}` to the tab and waits up to **85 seconds** for `{type:'result', id, ok, result|error}`;
- returns a clear message when no tab is open ("Open the studio and keep the tab open").

The tab runs the tool through `relayTool()` in `web/src/api.js`: in browser mode through the shared operations, with a helper through REST. Users are isolated because the Durable Object is addressed by the verified user id.

## Project sync

When signed in and in browser mode, `cloud.js` pushes the project to the user's own row after 4 seconds of quiet:

- the row is `projects(user_id, id, name, data jsonb, updated_at)` with primary key `(user_id, id)`;
- `data` is the project **without** media: blobs, poster images and waveform data are stripped and each asset is marked `mediaOnOtherDevice`;
- Row Level Security allows each user to read and write only rows where `auth.uid() = user_id`.

Cloud-only projects appear in the project menu; opening one imports it into IndexedDB (never overwriting a local project with the same id). Media must be re-imported on a new device.

## Configuration

| Where | Setting |
| --- | --- |
| `web/public/config.json` | `supabaseUrl`, `supabaseAnonKey` (public by design), `mcpUrl`, `contactEmail`. With `supabaseUrl` empty the site works without login |
| `cloud/worker/wrangler.toml` | `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, the KV id, the custom domain route |
| Worker secret | `STRIPE_SECRET_KEY` (see [Contributions](donations.html)) |
| Dev only | `DEV_AUTH=1` accepts fake `dev_<id>` tokens. Never set it in production |

## Free-tier facts

Workers Free allows 100,000 requests per day. Supabase Free projects pause after a week without activity (they wake on the next login). Durable Objects with SQLite storage are available on the Workers Free plan.

## What is verified

The Worker is tested end to end in Cloudflare's real runtime (`workerd`) with a stand-in for Supabase and Stripe: registration rules, PKCE, single-use codes, rotation, the MCP protocol with the official SDK client, the relay, tab replacement and user isolation. The studio's login screen, consent page, relay and sync were exercised in a browser against those stand-ins. **Verify your own deployment** (real Google login, real Supabase, real domain) with the checklist in [Deployment](deployment.html).
