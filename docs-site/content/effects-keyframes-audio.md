---
title: Effects, keyframes and audio
section: The editor
order: 2
description: Effect layers, keyframes on clips and effects, and how sound works on video clips.
---

## Effects on a clip

A clip's `effects` array is an ordered stack of instances. Add one with `apply_effect {clipId, type, params}`, tune it with `update_effect`, remove it with `remove_effect` or `clear_effects`. The catalog (see [Catalogs](catalogs.html)) has 18 effects in groups: Blur and sharpen, Color, Stylize, Distort.

## Effect layers

An **effect layer** is a clip of type `effect` on its own video track. It applies its stack to **everything below it** for its duration, like an adjustment layer in a desktop editor. Create it with `add_effect_layer {effects:[{type, params}], startMs, durMs}` or the **+ Effect** button in the timeline toolbar.

Good uses: a global grade for a chapter, a vignette and grain over the whole film, a glitch hit on a cut, a blur that follows a reveal. Because the layer is a normal clip you can move, trim, split, fade, duplicate and keyframe its strength like any other.

| Property | Behaviour |
| --- | --- |
| Strength | The clip's `opacity` (keyframable) mixes the processed copy with the original |
| Duration | The clip's length on the timeline |
| Order | Tracks higher in the stack apply later; the layer affects only tracks below it |
| Render | Preview, browser export and ffmpeg render all support it |

## Keyframes on clips

`set_keyframes {clipId, property, keys | add}` animates `scale`, `x`, `y`, `rotation`, `opacity` or `volume`. Frames are relative to the clip start. Interpolation:

- `linear`: constant speed,
- `ease`: smoothstep, slow at both ends,
- `hold`: jump to the next value at the next key.

Common patterns:

```text
push-in           scale  0→1.00   30→1.08  (ease)
cut-out entrance  x      0→-40    18→0     (ease)    opacity 0→0  12→1    scale 0→0.8  18→1
emphasis punch    scale  0→1.00   4→1.12   8→1.00
fade out audio    volume 0→1      45→0
```

## Keyframes on effect parameters

`set_effect_keyframes {clipId, effectId, param, keys | add}` animates one parameter of one effect instance. It works on effect layers **and** on effects applied to normal clips. Parameters that can be keyframed:

| Effect | Parameters |
| --- | --- |
| blur, sharpen | `amount` |
| exposure | `brightness`, `contrast` |
| saturation | `amount` |
| hue | `deg` |
| tint | `amount` |
| sepia, grayscale | `amount` |
| vignette | `amount`, `softness` |
| grain | `amount` |
| glow | `amount`, `radius` |
| pixelate | `size` |
| chromatic | `shift` |
| posterize | `levels` |

Validation rejects anything else with a message listing what is allowed. In the inspector each such parameter has a diamond button next to its slider: click it to add a key at the playhead; double-click a key marker to delete it.

Splitting a clip splits effect keyframes too (the right half receives an evaluated key at its first frame).

## Sound on video clips

Video clips are **silent by default**. A video that has sound can play it:

- **At import:** the studio asks "import with audio?". The answer is stored as `asset.useAudio`, and new placements follow it. `import_media {audio}` and `download_youtube {withAudio}` take the choice explicitly.
- **Per clip:** the inspector's *Play this clip's own audio* checkbox, or `edit_clip {audio: true}`.
- **Everywhere:** the preview mixer, the browser export and the ffmpeg render all use `audioClips(project)`, which returns real audio clips plus video clips with `audio: true` whose asset has an audio stream.

### Detach audio

`detach_audio {clipId}` (or the inspector button) turns the clip's sound into an independent audio clip on a sound-effects track with the same timing, volume and fades. The video clip becomes silent. Now you can slide the sound, cut it, change its level or mute it separately.

### YouTube downloads
yt-dlp downloads **picture only** unless audio is requested; the tool requires `withAudio` to be stated (an AI is told to ask the user). Picture-only files are smaller and have no audio stream, which the studio detects.

## Audio effects and the mixer

Each audio clip can have `audioFx`: three EQ bands, reverb, compressor and delay. The mixer panel offers per-track faders, mute, solo and meters. Defaults: voice at 0 dB, music at the project's `musicDb` (−30 by default), sound effects at −16 dB. Music is ducked under the voice automatically in the render.
