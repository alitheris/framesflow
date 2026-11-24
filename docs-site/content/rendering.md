---
title: Rendering and export
section: The editor
order: 1
description: How a frame is drawn in the preview, how the browser exports, and how the ffmpeg render rebuilds the same result.
---

Framesflow has **three renderers** that must agree: the **canvas compositor** (preview), the **WebCodecs export** (browser mode, same compositor) and the **ffmpeg render** (helper). This page explains each and how exact sizes are guaranteed.

## 1. The canvas compositor (`web/src/studio/compositor.js`)

`drawFrame(ctx, project, frame, sources, env)` renders one frame at the project's pixel size:

1. Clear to black.
2. For each **video track from the bottom up** (the last track in the array is drawn first):
   - Any **effect layers** on that track are applied first to everything already drawn (the tracks below).
   - Then the track's clips active at this frame: images, videos, text and graphic clips. If a clip is in its transition window the previous clip is drawn as well and `drawWithTransition` blends them.
3. Each media clip is drawn to an **offscreen buffer** so its effects stay inside the layer:
   - transform: translate, rotate, scale around the centre, using keyframes (`propAt`) and a Ken Burns push for images;
   - `contain` or `cover` fit; baked-in crop from `asset.crop`;
   - effect parameters resolved for this frame (`resolveEffects`), so keyframed effects animate;
   - CSS-filter based effects (blur, brightness/contrast, saturation, hue, sepia, grayscale, invert) and procedural effects (vignette, grain, glow, tint, posterize, pixelate, chromatic aberration, glitch);
   - the clip's colour grade.
4. The buffer is composited with the clip's opacity (including fades). A `mask` rectangle is then blurred in place.

**Effect layers** (`drawEffectLayer`) copy the current canvas to a scratch buffer, redraw it through the layer's filter chain with the layer's strength as alpha, then apply procedural effects on top.

Text and built-in graphics are not images: `shared/textfx.mjs` and `shared/graphics.mjs` compute per-frame states (position, scale, alpha, per-word timing) that the canvas draws, and the server's PNG renderer draws the **same states** for ffmpeg.

## 2. Browser export (`web/src/studio/export.mjs`)

Browser mode has no ffmpeg, so it exports with **WebCodecs**:

1. Pick a codec the browser supports: H.264 High or Main (`avc1.640028`, `avc1.4d0028`), otherwise VP9 (`vp09.00.10.08`). Audio is AAC or Opus.
2. **Mix audio offline** with an `OfflineAudioContext`, using the same gain, fade, EQ and ducking logic as the preview. Video clips whose own sound is switched on are included (`audioClips()`).
3. Draw every frame with the compositor at the full project size, scale down for drafts (half size), encode with `VideoEncoder` and push to `mp4-muxer`.
4. Return an MP4 blob. Progress and cancel are supported; the UI thread yields every few frames.

## 3. The ffmpeg render (`server/render.mjs`)

`renderProject(project, { quality })` builds the same picture with filters. The stages:

### Size
`final` renders at exactly `settings.width × settings.height`. `draft` keeps the same aspect ratio with a 960-pixel long side (960×540 or 540×960), both dimensions forced even. A single bug here once produced 1920×540 files because the draft height formula was applied to the final width; both modes now derive the size from the project, and tests render 16:9 and 9:16 to confirm the output dimensions.

### 1. Footage segments
The **base track** is turned into normalised segments: each clip is scaled and cropped to the frame (or letterboxed for `contain`), speed-adjusted, given its colour grade, effect filters, mask (`delogo`), fades, Ken Burns and keyframed scale, position and rotation (as ffmpeg expressions). Segments are rendered to `cache/segments/<hash>.mp4`; the hash covers every property that affects the pixels, so re-rendering after a small edit reuses most segments. Transitions between two clips become **joint segments** using ffmpeg's `xfade` where an equivalent exists, and custom paths for the rest.

Keyframes become nested `if(lt(n, f), …)` expressions evaluated per frame; the nesting is built from the last segment backwards so the earliest segment is tested first. Alpha video (HTML animations) is decoded with `-c:v libvpx-vp9`, the only decoder that reads the alpha plane.

### 2. Overlays
All other video tracks are composited bottom to top over the concatenated base with `overlay` filters:

| Clip | How |
| --- | --- |
| Text, built-in graphics | Per-frame transparent PNG sequences from `overlay.mjs` (same maths as the preview) |
| Images and videos | Fit, then rotate on a fixed square canvas (ffmpeg fixes `rotate` output size at start), then scale per frame, with keyframed scale, position, rotation and average opacity |
| **Effect layers** | `split` the composite so far, run the effect chain on a copy, and `blend` it back with `all_expr='A*(1-op)+B*op'` only between the layer's start and end times |

Keyframed **exposure, saturation and hue** are frame-exact (`eq=…:eval=frame`, `hue=h=expr`). Other keyframed effect parameters use the average over the clip, because ffmpeg filters such as `gblur` take fixed values. A few stylisations (glitch, posterize) are preview-only.

### 3. Audio master
Audio clips (including video clips with sound on) go through per-clip trim, speed, volume with keyframes, gain, fades, EQ, compressor, echo and reverb, then are grouped into **voice**, **music** and **effects** buses:

- the voice bus gets a high-pass, compressor and limiter;
- music is **side-chain ducked** under the voice and faded out at the end;
- the buses are mixed and trimmed to the video length;
- a **two-pass `loudnorm`** brings the result to the project loudness (−14 LUFS by default, −1.5 dBTP).

### 4. Encode and verify
Final: H.264 High, CRF 18, AAC 320 kbps at 48 kHz. Draft: ultrafast, CRF 28. Afterwards ffprobe verifies resolution, frame rate, codec, duration against the expected length (drift in milliseconds), and the measured loudness, and returns this as `verification`.

## Why three renderers?

A browser cannot run ffmpeg, and ffmpeg cannot run a canvas. Sharing the maths (text, graphics, keyframes, effect parameters) and testing the results against each other is the compromise that keeps "what you see is what exports" true without a server for casual use and with full quality when the helper is available.

## Debugging a render

Set `FF_DEBUG=1` to print the final `filter_complex` graph. Look at the file in `projects/<id>/renders/`. Keep the cached segments (`cache/segments`) to speed up retries.
