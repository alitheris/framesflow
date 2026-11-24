# Recipes: exact tool-call sequences

Replace values with the user's. `ms` = milliseconds. Check `get_status` first: recipes marked **(server)** need the Framesflow helper.

## A. Faceless documentary from script + voiceover (server)
1. `get_status`, `get_project`.
2. `update_project {name, script, niche, topic}` or `set_script {script, title}`.
3. `import_voiceover {path}` (or ask the user to upload), then `transcribe_voiceover` (job: poll `get_job`). Check `get_transcript`.
4. **Ask the user** for the mix (YouTube footage % / images % / animation %). `set_mix` (sums to 100, none 100).
5. `build_beats` then `get_beats`. Read the whole transcript, write a 10-line summary: theme, subjects, places, period, emotional arc.
6. For each beat: `search_youtube {query, license:"cc"}` first; `youtube_info` for the licence; `inspect_youtube {url, startMs, endMs}` to look at the exact moment; images via `search_images` + `import_image {credit}`.
7. `set_plan {rows}` covering the voiceover back-to-back (type youtube/image/animation per row; two timestamps per row: voiceover window and source cut).
8. `exec_plan` (job). Then fix failures reported.
9. Polish: `add_effect_layer` (global vignette/grain), `set_keyframes` push-ins on stills, `add_overlay` fact cards, chapters via `set_chapters`.
10. `run_qc` → fix → `render_video {quality:"draft"}` to check → `render_video {quality:"final"}` → `export_package`.
11. Deliver per SKILL.md (assumptions, checks, credits).

## B. Short / Reel / TikTok from a voiceover (server or browser)
1. `set_project_format {formatId:"vertical"}`.
2. Voiceover → `transcribe_voiceover` (server) or user-provided captions.
3. Visuals: 1–2 s clips (`place_clip`), cut-outs (`import_image {removeBackground:true}`).
4. Captions: `add_text_clip {kind:"caption", style:{animIn:"wordpop"|"karaoke", fontSize:64}}` per phrase, centred.
5. Energy: `set_keyframes` scale 1 → 1.08 per clip; `add_effect_layer` flash on the hook.
6. Hook check: something visual and a line in the first 2 s. End so the first frame can follow (loop).
7. Render/export.

## C. Explainer with animated scenes (server for animations)
1. Write scene list (title, one idea, 4–8 s each, narration line).
2. Background: a colour/gradient clip or footage on V1.
3. For each scene: `snapshot_animation` (look!) → `create_animation {html|template, vars, durationMs, place:{track:"V2", startMs}}`.
4. Numbers: template `big-number` or `bar-chart`. Titles: `title-card`. Names: `lower-third`.
5. Add music (`add_audio`), duck is automatic; add SFX on key reveals.
6. Render.

## D. Animated cut-out image over footage (server)
1. `search_images {query, pngOnly:true}` → pick a subject.
2. `import_image {url, credit, removeBackground:true, place:{track:"V2", startMs, durMs:3000}}` → returns `clipId`.
3. `set_keyframes {clipId, property:"x", keys:[{frame:0,value:-40,interp:"ease"},{frame:20,value:0}]}`, same for `opacity` and `scale`.
4. Optional: `add_effect_layer` with a soft shadow-like vignette; or an HTML animation that places the cut-out via `asset://<id>`.

## E. Add a global look
`add_effect_layer {startMs:0, durMs:<full length>, effects:[{type:"vignette",params:{amount:0.35}},{type:"grain",params:{amount:0.25}}]}`. Animate a parameter: `set_effect_keyframes {clipId, effectId, param:"amount", keys:[…]}`.

## F. Detach video sound, then cut it
`set_asset_audio {assetId, useAudio:true}` (or the clip `audio` flag via `edit_clip`) → `detach_audio {clipId}` → the sound becomes an audio clip on its own track.

## G. Browser-only editing (no helper)
Available: read tools, `place_clip` (library assets), text, effects, keyframes, tracks, markers, audio flags, built-in animation graphics, undo/redo. Not available: YouTube, image search, cut-outs, HTML animations, server render. Tell the user to run the Framesflow helper for those.

## H. Recover from problems
- Tool says "needs the local server": runtime is `browser`; either use another approach or ask the user to start the helper.
- `exec_plan` rows skipped: read the report, fix `UNVERIFIED` rows by researching them, re-run.
- Gaps found by `run_qc`: `get_beats` with `onlyUncovered:true`.
- Render too slow/heavy: `render_video {quality:"draft"}` first.
- Always `get_project` after a long run to confirm the state before reporting.
