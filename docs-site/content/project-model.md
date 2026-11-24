---
title: The project model
section: How it works
order: 3
description: Exactly what a project contains: units, tracks, clips, assets, effects, keyframes, beats and the plan.
---

A project is one JSON document (`version: 3`), created by `newProject()` in `shared/model.mjs`. It is stored as `projects/<id>/project.json` by the helper, in IndexedDB in browser mode, and as a slimmed-down copy (without media) in Supabase when a user is signed in.

## Units

| Thing | Unit | Why |
| --- | --- | --- |
| Timeline positions: `clip.start`, `clip.dur`, marker `frame`, keyframe `frame` | **frames** at `settings.fps` | Frame accuracy; integers |
| Source offsets: `clip.in`, `source.inMs`, transcript word times, beat `startMs/endMs` | **milliseconds** | Independent of the project frame rate |
| Tool arguments such as `startMs`, `durMs` | milliseconds | Friendlier for AIs; converted with `msToFrame` |
| Keyframe frames | relative to the clip start | A clip can move without rewriting its keys |

Changing `fps` (`set_project_format`) rescales `start`, `dur`, fades, markers and beats so the same moments stay put.

## Top level

```json
{
  "version": 3, "id": "p_ab12cd34ef", "name": "My video", "createdAt": 1767225600000,
  "settings": { "fps": 30, "width": 1920, "height": 1080, "loudness": -14, "musicDb": -30,
                "grade": "cinema", "accent": "#d8f36a", "niche": "", "topic": "", "voiceLock": false },
  "script": "", "meta": { "titleIdeas": [], "thumbnailIdeas": [], "notes": "" },
  "tracks": [ ... ], "assets": { ... }, "clips": [ ... ], "markers": [ ... ],
  "plan": null, "transcript": null, "beats": [], "chapters": []
}
```

- `settings.voiceLock`: when true the video length is locked to the end of the transcribed voiceover (the AI pipeline). Otherwise the length is the end of the last clip.
- `settings.width/height`: only exact 16:9 or 9:16 are accepted (`validSize`).
- `loudness` is the mastering target in LUFS; `musicDb` is the default music level under the voice.

## Tracks

```json
{ "id": "V1", "kind": "video", "name": "Footage", "role": "base", "muted": false, "locked": false, "solo": false }
```

The defaults are `V2` Graphics (overlay), `V1` Footage (base), `A1` Voiceover, `A2` Music, `A3` SFX. **The order of the array is the layer order**: index 0 is the topmost video track. `add_track` puts new video tracks on top and new audio tracks at the end. A video track with role `effect` holds effect layers.

## Assets

Assets are the media library: `{ id, kind: 'video'|'image'|'audio', name, file, duration, width, height, hasAudio, source, thumbs, peaks, crop, ... }`.

| Field | Meaning |
| --- | --- |
| `file` | File name inside `projects/<id>/assets/` (helper) |
| `source` | Where it came from: `{type:'youtube', url, title, channel, license, rangeStartMs, rangeEndMs}`, `{type:'web-image', url, creator, license, ...}`, `{type:'animation', template}` |
| `useAudio` | For videos with sound: whether new placements play their own audio |
| `transparent` | A cut-out PNG: new clips default to contain-fit |
| `cutoutOf` | Id of the original image a cut-out came from (used to credit the original) |
| `alpha`, `animation` | A transparent HTML-animation video, and the HTML/variables that made it (so it can be re-rendered) |
| `crop` | Detected baked-in black bars `{x,y,w,h}`, applied by the compositor and the render |
| `peaks` | Waveform file: one byte per 20 ms (50 per second) |

## Clips

`defaultClip()` shows every field:

| Field | Meaning |
| --- | --- |
| `id`, `track`, `type` | `type` is `video`, `image`, `audio`, `text`, `graphic` or `effect` |
| `start`, `dur` | Frames on the timeline |
| `in`, `speed` | Source offset (ms) and playback speed (0.1 to 8) |
| `volume`, `gainDb`, `fadeIn`, `fadeOut` | Audio level and fades (frames) |
| `audio` | **Video clips only.** `true` plays the clip's own sound; `false` is silent (the default) |
| `scale`, `x`, `y`, `rotation`, `opacity` | Transform. `x`, `y` are percent of the frame |
| `fit` | `cover` (default) or `contain` (show the whole image) |
| `flipH`, `flipV`, `kenburns`, `grade`, `mask` | Look controls. `mask` is a normalised rectangle that is blurred (hides a region) |
| `transition` | `{type, dur}` applied at the start of the clip |
| `effects` | Array of effect instances `{id, type, params, keyframes?}` |
| `keyframes` | Per-property key arrays `{frame, value, interp}`; frames are relative to the clip start |
| `audioFx` | `{eq:{low,mid,high}, reverb, compressor, delay}` |
| `text`, `graphic` | Payload for text and built-in graphic clips |
| `source`, `beatId`, `label` | Provenance, link to a beat, display name |

### Clip types

- **video / image:** media on a video track. Images get a gentle push-in unless contain-fit or scale keyframes are set.
- **audio:** sound on an audio track.
- **text:** a styled, animated title. Kind, font, size, weight, colour, stroke, shadow, background, alignment and in/out animations live in `clip.text`.
- **graphic:** a built-in animated card (`stat`, `counter`, `quote`, `list`, `comparison`, `timeline`, `chapter`).
- **effect:** an effect layer: no media, only `effects`. It processes everything on the tracks below it for its duration.

## Effects and keyframes

An effect instance is `{ id: 'e_…', type: 'blur', params: { amount: 8 }, keyframes: { amount: [{frame: 0, value: 0, interp: 'linear'}, ...] } }`. The effective value at a clip-local frame is `effectParamAt(effect, key, frame)`: keyframes override the static `params`. `resolveEffects()` returns a copy with every keyframed parameter evaluated for a frame, which is what the compositor uses.

Interpolation is `linear`, `ease` (smoothstep) or `hold`. Before the first key the first value applies; after the last key the last value applies.

## Beats, transcript, plan, chapters

- `transcript`: `{ engine, words:[{w,s,e}], sentences, voiceEndMs }`.
- `beats`: sentence-sized visual slots `{id, startMs, endMs, startFrame, endFrame, text, keywords, queries, ...}`, at most 5 seconds each.
- `plan`: the AI's shot list `{ mix:{youtube,image,animation}, rows:[...] }`. Rows cover the voiceover back to back; `exec_plan` materialises them into clips.
- `chapters`: `{id, title, startMs, endMs}`.

## Validation

`checkClip(project, clip)` normalises and validates a clip in place and throws on invalid input: unknown track or asset, wrong media type for the track, speed/scale/position/opacity out of range, unknown effect or transition, non-keyframable effect parameter, bad keyframe values, a missing `text` or `graphic` payload. Every operation that writes a clip ends with it, so an invalid project is never saved.

## Migration

`migrateProject()` upgrades older projects (v1, v2) in place and never throws: it fills defaults, renames legacy transitions and upgrades text styles.
