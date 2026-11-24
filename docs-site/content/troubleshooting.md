---
title: Troubleshooting
section: Build and run
order: 7
description: Symptoms, causes and fixes.
---

Start with `npx framesflow-studio doctor` (or `npm run doctor`): it checks the tools Framesflow needs.

## The studio

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "needs the local Framesflow server" | You are in browser mode and used a helper-only tool (YouTube, render, image search, animations) | Run `npx framesflow-studio start` and open the studio from it |
| Video clips have no sound | Video clips are silent by default | Tick *Play this clip's own audio* in the inspector, or answer "with audio" at import |
| Preview is black for a clip | The media is not loaded in this browser (a cloud project opened on a new device) | Re-import the media |
| Export fails or is huge in the browser | WebCodecs limits | Use Chrome or Edge, a shorter or smaller project, or render with the helper |
| The intro plays every time | `sessionStorage` is cleared or blocked | Normal in private windows |

## The helper

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Port 4317 is already in use" | Framesflow is already running | Open `http://127.0.0.1:4317`, or set `PORT` |
| ffmpeg not found | Not on `PATH` | Install ffmpeg or set `FFMPEG_PATH` |
| YouTube search or download fails | yt-dlp is old or missing, or YouTube changed | `pip install -U yt-dlp`; try again later |
| Age-restricted videos fail | They need a login | Set `YTDLP_COOKIES_BROWSER=chrome` |
| Transcription is rough | No Whisper installed, so timings are aligned from silences | `pip install openai-whisper` |
| Cut-out fails with a memory error | The model needs about 3 GB of free RAM | Close other apps and retry |
| Animation fails: "need Edge or Chrome" | No Chromium-based browser found | Install one or set `FRAMESFLOW_CHROME` |
| The deployed site cannot see the helper | The helper only trusts loopback origins | Start the helper with `FRAMESFLOW_ALLOW_ORIGINS=https://your-site` |

## Renders

| Symptom | Fix |
| --- | --- |
| Output size is not what you expect | Check `set_project_format`; the render uses exactly the project size (draft: 960 long side) |
| A render fails with an ffmpeg error | Re-run with `FF_DEBUG=1` to print the filter graph; the message names the failing filter |
| Slow first render, fast later ones | Segments are cached under `cache/segments`; the first pass builds them |
| Audio too quiet or loud | Loudness is mastered to the project's `loudness` (−14 LUFS by default) |

## Hosted link and accounts

| Symptom | Fix |
| --- | --- |
| "Your Framesflow studio is not open" | Keep the studio tab open and signed in with the same account the AI connected as |
| "AI link is open in another tab" | Only one tab per account is connected; the newest wins |
| The AI sees only a few tools | No helper is attached, so only the 51 browser tools are offered. Run the helper on the same computer |
| Google sign-in loops or fails | Check Supabase Site URL and redirect URLs and the Google OAuth redirect URI |
| `401` from the MCP link | The token expired; reconnect the connector (clients refresh automatically when possible) |
| Contributions say "not switched on" | `STRIPE_SECRET_KEY` is not set on the Worker (check `/donate/config`) |
| Browser console shows CORS errors on login/support | `APP_URL` in `wrangler.toml` must exactly equal the website origin |

## Getting more detail

- The helper prints its URLs and workspace on start.
- The **Activity** panel shows every change and who made it.
- `GET /api/health` reports tool availability.
- Worker logs: `npx wrangler tail` while reproducing.
