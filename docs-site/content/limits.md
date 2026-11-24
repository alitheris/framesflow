---
title: Known limits
section: Reference
order: 40
description: An honest list of what Framesflow does not do, or does only in some runtimes.
---

Knowing the edges is part of trusting a tool. This page lists them plainly.

## By runtime

| Capability | Browser only | With the helper | Notes |
| --- | --- | --- | --- |
| Edit, preview, text, effects, keyframes, tracks | yes | yes | 51 tools |
| Export | WebCodecs MP4 (Chrome or Edge) | ffmpeg render with loudness mastering | The ffmpeg render is the quality reference |
| YouTube search and section download | no | yes | Needs yt-dlp. May breach YouTube's terms: user's decision |
| Whisper transcription, beats, plan, autopilot | no | yes | Without Whisper, timings are aligned from silences |
| Free image search, cut-outs | no | yes | Cut-outs need about 3 GB RAM |
| HTML animations | no | yes | Needs Edge or Chrome on that computer |
| Hosted MCP link | yes (needs the tab open) | yes | One active tab per account |

## Editing and rendering

- Only **exact 16:9 and 9:16** formats. No square or 4:5.
- Keyframed effect parameters other than exposure, saturation and hue use the **keyframe average** in the ffmpeg render (the preview and browser export are per frame). Overlay clips' **opacity keyframes** are averaged in the ffmpeg render. Glitch and posterize are preview-only stylisations.
- Effect layers on the **base track** are not applied by the ffmpeg render (use a track above it).
- The ffmpeg render has no subtitle or caption burning other than text clips.
- Text uses a fixed font list (7) and system fonts in HTML animations.
- A single project is open at a time in the helper.

## Accounts and cloud

- Cloud sync stores the **project JSON only**. Media stays on the device that imported it.
- Syncing is last-write-wins for the current project; there is no merge of simultaneous edits from two devices.
- Free-tier ceilings apply: 100,000 Worker requests per day, a paused Supabase project after a week of inactivity.
- The hosted link works only while a studio tab is open (that is where the tools run).
- The hosted MCP does not offer server-sent events or resumable sessions.

## AI behaviour

- An assistant cannot see footage unless it calls `inspect_youtube` or `snapshot_animation`; autopilot never sees.
- The skill gives guidance, not guarantees. Always review the result before publishing.
- Nothing here promises views, monetisation or income.

## Verification status

The hosted components were verified against local stand-ins for Supabase and Stripe and in Cloudflare's real Worker runtime. Real-world checks (Google sign-in on your domain, a live Stripe payment, a real Claude connector) must be done after deployment; use the checklist in [Deployment](deployment.html).

## Platform and policy

- YouTube's monetisation rules (reused or mass-produced content), copyright and Content ID are outside Framesflow's control.
- Platform terms change; check the current rules of every platform you publish on.
