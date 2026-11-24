---
title: Security and rights
section: Build and run
order: 6
description: The threat model, the protections in each layer, and the licence and rights decisions behind the design.
---

## What is protected, and from what

| Layer | Threat | Protection |
| --- | --- | --- |
| Local helper | A web page you visit tries to call the helper on `127.0.0.1` | It binds to `127.0.0.1` only; every request's `Host` must be loopback (blocks DNS rebinding); non-GET requests need an allowed `Origin`; CORS is granted only to origins you list in `FRAMESFLOW_ALLOW_ORIGINS`, with the Private Network Access header |
| Local helper | Path traversal through media URLs | `/media` and `/renders` resolve the path and require it to stay inside the project folder |
| Local helper | Malformed or hostile tool arguments | Strict zod schemas reject unknown keys and wrong types; clips are re-validated by `checkClip` |
| Local helper | Oversized bodies | JSON limit 30 MB; uploads are streamed to a temp folder that is removed afterwards |
| Image import | SSRF: an AI or user supplies an internal URL | HTTPS only, DNS resolved first, private/loopback/link-local ranges refused, every redirect re-validated, content-type and size checked |
| HTML animations | A page tries to read files or call the network | Headless browser with request interception: only `data:` and the local asset URL are allowed; no extensions; time-limited |
| Hosted link | Stealing or replaying an authorization | OAuth 2.1 with **PKCE S256 mandatory**, exact redirect URI match, single-use codes, short-lived tokens stored only as hashes, refresh tokens that rotate |
| Hosted link | Unsafe redirect targets at registration | Only `https://` or loopback `http://`, no fragments, at most 5 |
| Hosted link | One user reaching another user's studio | The Durable Object is addressed by the **verified** user id; tested explicitly |
| Hosted link | Cross-site calls to the consent endpoints | CORS limited to the website origin; approval requires the user's Supabase token and the `Origin` of the site |
| Accounts | Reading other users' projects | Row Level Security: `auth.uid() = user_id` for select, insert, update, delete; composite key `(user_id, id)` |
| Contributions | Paying less than the minimum, or tampering with the session | The amount is validated server side and the session is built only from it; Stripe hosts the page; a restricted key limits the blast radius |
| Secrets | Leaking keys | The Stripe key is a Worker secret; the repository and zips contain only placeholders and the public Supabase anon key |
| Dev shortcuts | Fake tokens in production | `DEV_AUTH` exists only for local tests and must never be set in production |

## Things that are deliberately your responsibility

- **Running the helper exposes your computer's ffmpeg and files to the tools.** That is why it is local-only. Do not expose it to a network or tunnel it publicly.
- **AI assistants can edit and delete project content** through the tools you allow. Use undo, and review before publishing.
- **Downloading from third-party sites** can breach their terms or copyright. The Terms of Use put this on the user and the product logs sources.

## Rights and policy

Framesflow records where media came from (URL, channel, licence, creator) and writes it into `sources.txt`. It cannot decide whether a use is allowed. The skill teaches an assistant to prefer original, public-domain and open-licence material, give credit, never hide a creator's watermark to disguise provenance, and be honest that monetisation is never guaranteed. See [the sourcing and rights guide](skill-sourcing-and-rights.html).

> The shipped `server/director.md` (served by `get_editor_rules`) is the project owner's production ruleset. Review its rules on licences and watermarks against your own legal advice before offering the product publicly.

## Dependency licences

Choices were made so the product can be hosted commercially. Confirm each in the package's own licence file before shipping.

| Dependency | Use | Licence |
| --- | --- | --- |
| `@modelcontextprotocol/sdk`, `express`, `ws`, `zod`, `react`, `vite`, `marked`, `mp4-muxer`, `@napi-rs/canvas`, `@supabase/supabase-js` | Core | MIT |
| `puppeteer-core` | HTML animations | Apache-2.0 |
| `@huggingface/transformers`, ONNX Runtime | Background removal runtime | Apache-2.0 / MIT |
| BiRefNet-lite model | Background removal | MIT |
| `wrangler` | Cloud tooling (dev only) | MIT / Apache-2.0 |
| ffmpeg, yt-dlp, Whisper | Not bundled; the user installs them | Their own licences (ffmpeg builds are LGPL or GPL depending on options) |

**Avoided on purpose:** `@imgly/background-removal` (AGPL-3.0, which would require publishing the product's source), the `RMBG-1.4` model (non-commercial licence), and GSAP (a bespoke licence with restrictions; HTML animations support CSS keyframes and a seek hook instead, and a timeline library can still be inlined by an author who has the right to use it).

## Reporting a problem

Please report vulnerabilities privately to the maintainers (see the repository's `SECURITY.md`) rather than in public issues.
