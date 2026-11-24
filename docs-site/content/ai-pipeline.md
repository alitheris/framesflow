---
title: The AI pipeline
section: AI pipeline
order: 1
description: From script and voiceover to a finished faceless video: transcription, beats, sourcing, plan, autopilot, QC and export.
---

This is the workflow for **faceless documentary-style videos**: a narrated voiceover over footage, images and animation. An AI can drive each step with the tools, or **autopilot** can do a rule-based version with no chat at all. The editing rules live in `server/director.md` (served by `get_editor_rules`); the skill adds the production playbook.

```text
script + voiceover → transcribe → beats → (user chooses the mix) → research → plan → exec_plan → polish → QC → render → export package
```

## 1. Transcription (`server/transcribe.mjs`)

The voice defines the timeline. `transcribe_voiceover` produces `project.transcript`: every word with start and end milliseconds, sentences, and `voiceEndMs`.

| Engine | When | How |
| --- | --- | --- |
| Whisper | Installed (`whisper` on `PATH`) | Word timestamps from the model (`FRAMESFLOW_WHISPER_MODEL`, default `base`) |
| Script alignment | No Whisper | ffmpeg `silencedetect` finds speech and pauses; the script is tokenised and aligned to the audible regions with a Needleman-Wunsch style sequence alignment, so timings are estimated but anchored to real silences |

Locking the transcript sets the project length to the end of the voice (`voiceLock`). Nothing may run past the last spoken word.

## 2. Beats (`server/beats.mjs`)

`build_beats` converts sentences into **beats**: visual slots of at most 5 seconds, split at conjunctions and idea changes, each with the spoken text, exact millisecond window, extracted keywords (names, dates, places, numbers, proper-noun phrases), suggested search queries, an emotion hint and a possible fact overlay. `defaultChapters` proposes chapters. Beats tile the voiceover with no gaps; a test enforces this.

## 3. The mix (asked of the user)

Before sourcing, the AI **asks** what percentage should be YouTube footage, images and animation (`set_mix`; must total 100; no single type may be 100). This is the one question the ruleset allows.

## 4. Research and sourcing (`server/youtube.mjs`, `images.mjs`)

| Tool | What it does |
| --- | --- |
| `search_youtube` | `yt-dlp` flat search (optionally the Creative Commons filter, a "faceless" or "movie" style filter, duration limits) |
| `youtube_info` | Licence, chapters and **"most replayed"** heat-map peaks (good in-points), maximum quality |
| `inspect_youtube` | Downloads a short low-resolution peek and returns a **contact sheet** image so the AI can look at the moment |
| `find_clips_for_beat` | Runs the beat's queries and ranks candidates by the rules, proposing an in-point |
| `download_youtube` | Downloads **only the needed section** (plus 1 second of padding each side) with `--download-sections`; picture only unless audio is requested |
| `search_images`, `import_image` | Free licensed images, see [Images and cut-outs](images-cutouts.html) |

Downloads share a three-slot semaphore so nothing opens dozens at once. Files are cached by video id, range and quality.

## 5. Plan and execute

`set_plan` stores the shot list: rows covering the voiceover back to back, each with the spoken line, its voiceover window and, per type, the source (YouTube URL and in/out), an image asset, or a graphic. `get_plan` reports which rows are placed. `exec_plan` (a job) materialises the rows: it downloads the needed seconds, places clips exactly on their windows, applies masks, adds image push-ins and creates animation clips.

## 6. Autopilot (`server/autopilot.mjs`)

For every beat without a clip, autopilot searches, **scores** candidates and places the best moment. The score rewards keyword overlap with the title and channel, sensible duration, view count and footage-like titles, and penalises reactions, tutorials, news, vlogs, "for kids" content, captions, and videos already used. It picks a start time away from channel intros and from ranges already used. It cannot see; an AI using `inspect_youtube` makes better decisions, and `run_qc` catches problems either way.

## 7. Quality control (`server/qc.mjs`)

`run_qc` returns issues with a severity (`error`, `warn`, `info`), a rule name, a message and clip ids. It checks:

- a voiceover exists, the transcript is locked, footage covers the whole voice,
- no **gaps**, **overlaps** or footage past the end of the voice (`tail`),
- the **5 second** ceiling per visual and **pacing** targets for the first 30 seconds, up to 2 minutes and the rest,
- source rules: no **reuse** of a moment, at most **3 clips per video**, never **consecutive** clips from one video,
- sync between beats and clips, uncovered beats, the footage ratio, music level, overlay timing and the opening hook,
- an informational licence summary.

## 8. Render and the export package

`render_video` runs the ffmpeg render (see [Rendering](rendering.html)). `export_package` writes into the renders folder:

| File | Content |
| --- | --- |
| `timeline_log.csv` / `.json` | Every clip: timing, beat text, keywords, search query, source video, in/out, type |
| `sources.txt` | Every source video with channel, URL and licence (flagging unconfirmed ones), an **IMAGES** section with creators and licences, and a one-line credit |
| `retention_qc_report.md` | The QC result and statistics for review |

## Without an AI

The studio's **Auto** panel exposes the same steps as buttons: upload the voice, transcribe, choose the mix, run autopilot, review in the timeline, fix by hand, render.

## Rights

Sourcing is where legal and platform-policy risk lives. The skill's [sourcing and rights guide](skill-sourcing-and-rights.html) and the Terms of Use put responsibility for rights on the user; Framesflow logs sources and licences to help. See also [Security and rights](security.html).
