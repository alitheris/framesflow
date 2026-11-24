# Editing craft in Framesflow

## Timing and pacing
- Units: timeline positions are frames at the project fps (30 default); `startMs/endMs/durMs` arguments are milliseconds. Prefer ms in tool calls.
- Documentary cut length 3–5 s; Shorts 1–2 s; explainers 4–8 s per scene. Faster cuts raise energy; slower cuts add weight. Match the music and the narration.
- Cut on the word that the picture illustrates, a few frames before it lands (anticipation feels natural).
- Rule of three: if a visual repeats, change the angle, scale or treatment the third time.

## Tracks and layers (top = in front)
- `V1` footage, `V2` overlays/animations, extra video tracks above for effect layers, `A1` voiceover, `A2` music, `A3` SFX. Add tracks with `add_track`.
- **Effect layers** (`add_effect_layer`) act like adjustment layers: they apply their effects to everything below for their duration, on their own track. Animate any effect parameter with `set_effect_keyframes` (blur, brightness/contrast, saturation, hue, tint, sepia, grayscale, vignette, grain, glow, pixelate, chromatic, posterize). Use for global grades, dream sequences, glitch hits, vignette over a chapter.

## Keyframes (`set_keyframes`)
Animate `scale`, `x`, `y`, `rotation`, `opacity`, `volume`. Frames are relative to the clip start; interpolation `linear`, `ease` or `hold`.
- Push-in: scale 1 → 1.08 over the clip (`ease`).
- Cut-out entrance: x −30 → 0, opacity 0 → 1, scale 0.8 → 1 over 12–18 frames, `ease`.
- Punch emphasis: scale 1 → 1.12 → 1 over 8 frames on the stressed word.
- Fade audio: `volume` keyframes or `fadeIn/fadeOut` via `edit_clip`.

## Transitions (`list_transitions`)
Cut is the default. Dissolve for time passing, dip to black for chapter ends, whip/zoom for energy, wipes only for graphic styles. Keep one family per video. Never use a transition on every cut.

## Text (`add_text_clip`, `set_text_style`, `list_text_presets`)
- Kinds: title, fact, lower, stat, quote, chapter, caption, subtitle. In/out animations: `fade`, `slideup`, `pop`, `typewriter`, `wordpop`, `karaoke`, `wave`, `shine`, etc.
- Legibility first: ≥ 5% of frame height for body text, outline/shadow on busy footage, ≤ 7 words per card, 2–4 s on screen.
- Keep text inside the 80% title-safe area. For vertical video avoid the bottom 20% and top 10% (platform UI).

## Effects and colour
- One project grade (`update_project grade` or `apply_look`): `cinema`, `documentary`, `archival`, `vivid`, `noir`, `warm`.
- Effects stack per clip (`apply_effect`): subtle only. Strong stylising (glitch, pixelate) is for hits, not the whole video.
- Exposure: keep faces/subjects readable; do not crush blacks to hide poor footage.

## Audio
- Layers: voice (A1) leads, music (A2) at about −30 dB under the voice and ducked automatically, SFX (A3) around −16 dB.
- Video clips can carry their own sound (`set_asset_audio` / the clip `audio` flag). `detach_audio` moves it to its own audio track so it can be moved, cut or muted independently.
- Loudness is mastered to about −14 LUFS in the server render. In browser export, keep levels sensible and avoid clipping.
- Use pauses: 0.3–0.6 s of silence before a reveal is a tool, not a gap.

## Formats
- 16:9 1920×1080 (or 1280×720, 3840×2160). 9:16 1080×1920. Other ratios are not supported (`set_project_format`). Exports are exactly the project size.
- Changing fps rescales clip positions; do it before editing, not after.

## Animation (graphics)
- Built-in graphic scenes (`add_animation`): stat, counter, quote, list, comparison, timeline, chapter.
- Anything custom: HTML animation (`animation.md`).

## QC before render (`run_qc`)
No gaps, nothing past the last word, no clip over 5 s without a reason, no reused source moments, no back-to-back clips from the same video, overlays not covering key action, audio not clipping.
