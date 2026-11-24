# Tool reference (generated)

Generated from the live tool registry (90 tools). Run `get_*` / read each tool's description for full parameters; the MCP client shows every schema.

| Tool | What it does |
| --- | --- |
| `get_status` | Check the studio: ffmpeg, yt-dlp and Whisper availability, studio URL and the open project. |
| `get_editor_rules` | Return the full faceless-YouTube editing ruleset (roles, footage rules, pacing, hook, transitions, audio, QC, deliverables). |
| `get_project` | Full timeline state: settings, tracks, assets and every clip with frame/ms positions and YouTube sources. |
| `list_projects` | List saved projects. |
| `create_project` | Create a new empty project and open it in the studio. |
| `open_project` | Open a saved project by id. |
| `update_project` | Change project name, script, niche/topic (used to refine YouTube queries), colour grade preset, accent colour or music level. |
| `set_script` | Store the full script text. |
| `set_metadata` | Save the five title ideas and five thumbnail texts (included in the QC report). |
| `undo` | Undo the last edit. |
| `redo` | Redo. |
| `list_assets` | List library assets (video, audio, images) with ids you can place. |
| `delete_assets` | Remove assets from the library (their files too). |
| `import_media` | Copy a local file (video, audio or image) into the project library. |
| `import_voiceover` | Import the voiceover audio, put it on A1 at 0:00 (replacing any previous voiceover). |
| `use_asset_as_voiceover` | Use an asset already in the library as the voiceover (A1). |
| `transcribe_voiceover` | Word-level timestamps for the voiceover (Whisper if installed, script-aligned otherwise), then locks the timeline length to the voice end and builds visual beats. |
| `set_transcript` | Provide your own word timings (e.g. |
| `get_transcript` | Sentences with ms timings (set words:true for every word). |
| `build_beats` | Re-segment the transcript into visual beats (≤5 s each, paced for retention). |
| `get_beats` | The sentence visual map: every beat with exact ms window, spoken text, keywords, suggested YouTube queries, notes and whether it has a clip. |
| `update_beat` | Save your director notes on a beat: meaning/visual idea, emotion, better search queries, keywords, whether it needs a fact overlay — or just edit its text. |
| `delete_beat` | Delete a beat (and its note). |
| `add_beat` | Add one beat manually: {startMs, endMs, text}. |
| `set_beats` | Replace the beat list wholesale (advanced): [{startMs,endMs,text,keywords?,queries?}]. |
| `set_chapters` | Set chapters: [{title,startMs}] (Hook, Setup, Rising Action, Climax, Payoff, CTA). |
| `search_youtube` | Search YouTube. |
| `youtube_info` | Full details for a video: license, chapters, "most replayed" peaks (great in-points), max quality, description. |
| `inspect_youtube` | LOOK at a stretch of a YouTube video: returns a contact-sheet image (frames left-to-right, top-to-bottom) so you can judge relevance, cleanliness (watermarks, logos, burned-in text) and the exact moment. |
| `find_clips_for_beat` | Server-side candidate search for a beat: runs its queries, ranks results by the editing rules and proposes an in-point. |
| `download_youtube` | Download a section of a YouTube video into the library (only that part is fetched, 1 s padding each side). |
| `get_framesflow_skill` | READ FIRST. |
| `search_images` | Search the web for openly licensed images (Openverse: Wikimedia Commons, Flickr, NASA, museums…). |
| `import_image` | Download an image from a public https URL (e.g. |
| `remove_background` | Cut the subject out of an image in the library and save it as a new transparent PNG asset (runs locally with an open-licence AI model; the first run downloads ~45 MB, then ~25 s per image on CPU). |
| `animation_guide` | READ THIS before writing HTML animations: the contract (deterministic, seekable, transparent), what is allowed, how to reference library images with asset://<id>, how to build full animated scenes, and a worked example. |
| `list_animation_templates` | Ready-made animated scenes you can drop in with create_animation {template, vars}: title card, lower third, big counting number, animated bar chart. |
| `snapshot_animation` | LOOK at an animation before rendering it: returns a contact sheet of frames (default at 0%, 33%, 66%, 97% of the clip) over a grey background so you can check layout, overflow, timing and style. |
| `create_animation` | Make an animation clip from HTML/CSS/JS (or a template) — like HyperFrames: the page is seeked frame by frame in a headless browser and rendered to a TRANSPARENT video the size of the project, imported to the library and |
| `update_animation` | Re-render an existing animation asset with new variables, new html and/or a new duration. |
| `place_clip` | Put a clip on the timeline. |
| `add_overlay` | Add a graphic on V2, timed to spoken words: fact card (name/date/place/number), chapter card, lower third, big stat, quote or title. |
| `add_audio` | Place music (A2) or sound effects (A3) from the library. |
| `edit_clip` | Patch one or more clips. |
| `move_clip` | Move a clip to a new start time (ms) and optionally another track. |
| `trim_clip` | Trim a clip: change duration (ms) and/or source in-point (ms). |
| `split_clip` | Split a clip at a timeline time (ms). |
| `delete_clips` | Remove clips by id. |
| `duplicate_clips` | Duplicate clips right after themselves (or at offsetMs). |
| `add_clips_raw` | Insert clips exactly as given (used by the studio for paste/drop). |
| `add_track` | Add an extra video (new top layer) or audio track. |
| `remove_track` | Remove a track and every clip on it. |
| `reorder_tracks` | Reorder tracks (top of the list = topmost video layer). |
| `set_track` | Mute/lock/solo or rename a track. |
| `apply_look` | Apply a colour/transition style to the whole video in one go: grade preset (project-wide), and optionally a transition for every cut or Ken Burns on stills. |
| `clear_timeline` | Remove every clip from the given tracks (default: V1 and V2). |
| `list_transitions` | The inbuilt transition catalog: id, label, group and default duration (frames) for each. |
| `list_effects` | The inbuilt per-clip effect catalog with every parameter and its range. |
| `list_text_presets` | Text clip catalogs: in/out animations, fonts, kinds and positions. |
| `add_text_clip` | Add a styled, animated text clip (title, lower third, caption…). |
| `set_text_style` | Edit an existing text clip: change words (text:{title,body,label}) and/or the full style object. |
| `apply_effect` | Apply an effect from the catalog to a clip (e.g. |
| `update_effect` | Change parameters of one effect instance on a clip (get instance ids from get_project → clip.effects). |
| `remove_effect` | Remove one effect instance from a clip. |
| `clear_effects` | Remove every effect from one clip (clipId) or from all clips. |
| `set_keyframes` | Animate a property over time: scale, x, y, rotation, opacity or volume. |
| `clear_keyframes` | Remove keyframes from a clip (one property or all). |
| `detach_audio` | Detach the sound of a video clip onto its own audio track (same timing/volume) so it can be moved, cut, faded or muted separately. |
| `set_asset_audio` | Choose whether a library video plays its own audio when placed on the timeline (new placements use this setting). |
| `add_effect_layer` | Add an EFFECT LAYER: a separate timeline layer (own track) that applies effects to everything beneath it for its duration, like an adjustment layer. |
| `set_effect_keyframes` | Animate ONE PARAMETER of an effect over time (works on effect layers and on effects applied to normal clips). |
| `clear_effect_keyframes` | Remove keyframes from an effect parameter (or all parameters of that effect instance). |
| `set_markers` | Replace all timeline markers: [{frame/ms, label?, color?}]. |
| `add_marker` | Add one marker at a time position (ms or frame). |
| `set_project_format` | Set canvas format/size (formatId from FORMATS: hd, hd720, uhd, vertical — 16:9 or 9:16 ONLY — or raw width/height), fps (24/25/30/50/60 — clips are rescaled) and voiceLock (lock the video length to the voiceover end, use |
| `set_mix` | Store the user’s mix decision for this video: percentages of YouTube footage, images and animation. |
| `set_plan` | Store (or replace) the shot list: rows covering the voiceover back-to-back with no gaps or overlaps. |
| `get_plan` | The current plan: the user’s mix %, every shot-list row (voiceover window, source cut, watermark notes) and per-row coverage on the timeline. |
| `exec_plan` | Materialise the shot list onto the timeline. |
| `add_animation` | Add an animated graphic (the browser-rendered equivalent of a motion-graphics clip): kind stat / counter / quote / list / comparison / timeline / chapter, plus its data. |
| `set_clip_mask` | Blur out a watermark/logo/burned-text region on a clip: x,y,w,h are 0..1 fractions of the frame (e.g. |
| `export_notes` | Write compact editor notes (overview, one-line-per-shot table, used-clips register, watermark report, QC) to notes.md next to the project — the short version of the documentary-editor PDF, capped so it prints in about 30 |
| `set_playhead` | Move the studio playhead (and optionally zoom the timeline onto a clip) so the user sees what you are talking about. |
| `run_qc` | Check the edit against the rules: gaps, 5 s cap, reuse, 3-per-video, adjacency, footage ratio, pacing, sync to beats, overlay timing, hook, licences. |
| `render_video` | Render the final MP4 with ffmpeg (1080p30 H.264 High, AAC 48 kHz, loudness-normalised to −14 LUFS, ends exactly at the voice end). |
| `autopilot` | Fully automatic mode: for every beat without a clip, search YouTube, rank candidates by the rules, download only the chosen moment and place it exactly on the beat (plus fact overlays). |
| `get_job` | Status/progress/result of a background job (render, autopilot, transcription). |
| `list_jobs` | Recent background jobs. |
| `cancel_job` | Cancel a running job. |
| `export_package` | Write the deliverables next to the render: timeline_log.csv/json, transcript_timing.json (editing record, not subtitles), sources.txt (licence flags) and retention_qc_report.md. |
