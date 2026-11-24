# How every kind of video is made

For each type: **shape** (structure and length), **look**, **sound**, and the **Framesflow recipe**. Always confirm format first: 16:9 (1920×1080) for YouTube/web, 9:16 (1080×1920) for Shorts/Reels/TikTok (`set_project_format`).

## Faceless documentary / mini-doc (YouTube, 6–20 min, 16:9)
**Shape:** hook → context → 3–6 escalating chapters → payoff → outro. **Look:** footage, photos with push-ins, maps, stats, timelines. **Sound:** steady narration, ducked music, light SFX.
**Recipe:** `import_voiceover` → `transcribe_voiceover` → `set_mix` → research with `search_youtube`/`search_images` → `set_plan` → `exec_plan` → `add_animation`/`create_animation` for stats → `run_qc` → `render_video`. Full playbook: `cash-cow-documentaries.md`.

## Explainer (2–8 min)
**Shape:** problem → simple model → example → recap. One idea per scene. **Look:** clean animation, icons, diagrams, bold text; few live clips. **Sound:** friendly voice, light music.
**Recipe:** script in short scenes; for each scene build an animation with `create_animation` (template or custom HTML: SVG shapes drawn with `stroke-dashoffset`, staggered text) placed on V2 over a solid background clip; keep each scene 4–8 s; add `add_text_clip` callouts.

## Top-10 / listicle (5–15 min)
**Shape:** hook with the best item teased → countdown (10→1) with a repeatable card design → final item with the payoff. **Look:** number cards (`create_animation` big-number), strong visuals per item, consistent layout. **Sound:** energetic music, whoosh on each number.
**Recipe:** one `set_plan` row per item plus a card row; reuse the same template with `vars` per item; `add_marker` per item for chapters.

## Shorts / Reels / TikTok (15–60 s, 9:16)
**Shape:** hook in the first 1–2 s (a visual + a line), one idea, a loopable end. **Look:** big word-by-word captions in the safe area (not the bottom 20%/top 10%), fast cuts every 1–2 s, punch-in zooms (`set_keyframes` scale). **Sound:** punchy voice, trending-style but licensed music.
**Recipe:** `set_project_format vertical` → voiceover → `build_beats` → `add_text_clip` with `animIn:"wordpop"` or `karaoke` captions → `set_keyframes` scale 1→1.08 on each clip → `render_video`.

## Motivational / stoicism / quotes (1–10 min)
**Shape:** quote → short reflection → quote. **Look:** slow cinematic footage or imagery, large type, subtle grain/vignette effect layer. **Sound:** deep calm voice, emotional music swelling at the climax.
**Recipe:** footage in V1 with slow dissolves; `add_text_clip` kind `quote`; `add_effect_layer` vignette+grain over the whole video.

## History / biography / geopolitics / true crime
Same as documentary, plus: dates, maps and timelines (`add_animation` timeline), archival imagery (public-domain archives), and strict fact-checking. For living people and crimes: report only what is documented, avoid speculation presented as fact.

## Finance / business / tech news-style
**Shape:** headline → context → numbers → implication. **Look:** charts (`create_animation` bar-chart), screenshots, logos used as references (check rights), stat cards. **Sound:** brisk voice, minimal music. Never present personal investment advice; add a "not financial advice" line when relevant.

## Tutorial / how-to / screen recording (3–15 min)
**Shape:** outcome shown first → steps → recap. **Look:** screen recordings imported with `import_media`, zoom-ins on the action (`set_keyframes` scale/x/y), step number cards, arrows via HTML animation. **Sound:** clear voice, no music during steps.

## Product promo / ad (15–60 s)
**Shape:** pain → product → proof → call to action. **Look:** crisp product shots, cut-out images (`remove_background`) animating in (`set_keyframes`), brand colours, large CTA card. **Sound:** upbeat music, one stinger on the logo.

## Slideshow / photo essay / memorial
Images with slow push-ins (default Ken Burns), 4–6 s each, soft dissolves, text overlays for names/dates, a single emotional track.

## Music video / lyric video
Beat-synced cuts: place `add_marker` on the beat map, cut clips on markers. Lyric text via `add_text_clip` timed to the vocal; effect layer for glow/glitch on drops.

## Podcast / interview clips (vertical)
Import the clip, `build_beats` from the transcript, captions with `karaoke` style, a waveform/animated title from an HTML animation, zoom keyframes on emphasis.

## Relaxation / ambient / loop (long, 1–3 h)
One slow visual set (cut-outs, gradients, nature clips) looped; very low-key audio; avoid abrupt change. Check platform rules for repetitive content.

## Kids' stories / animated shorts
Cut-out characters (`remove_background`) animated with `set_keyframes` (x, y, rotation, scale) over painted backgrounds; narration with warm voice; simple text. Check platform "made for kids" requirements.

## Data video / chart race
Use HTML animation: build bars from data in JS (deterministic), animate with CSS; label values; keep each frame readable at phone size.

## Rules of thumb for all types
1. One idea per shot, one message per scene.
2. The hook decides the video; the first 3 seconds matter most for Shorts, 15 seconds for long form.
3. Keep text inside the 80% safe area; keep key action inside the central 90%.
4. Audio quality beats video quality: clean voice, even levels, no clipping.
5. Be consistent: same fonts, colours, card styles across a channel.
