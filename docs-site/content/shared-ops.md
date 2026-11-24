---
title: Shared operations
section: How it works
order: 4
description: The pure functions every edit goes through, in the browser and on the server.
---

`shared/ops.mjs` is the heart of Framesflow. Every function takes a **draft** project as its first argument, changes it, and returns a small result object. There is no I/O and no global state, so the same file runs in Node and in the browser, and it is easy to test.

```js
// the shape every op follows
export function opAddEffectLayer(d, a = {}) {
  // validate inputs, mutate the draft d …
  d.clips.push(checkClip(d, clip));
  return { clip, summary: 'Added effect layer "Blur"', clipIds: [clip.id] };
}
```

The `summary` and `clipIds` feed the activity feed and the clip highlight. The caller (the server's `store.mutate`, or the browser's `LocalStore.mutate`) provides the draft clone, the undo step, persistence and broadcasting.

## The operations

| Area | Operations |
| --- | --- |
| Place and create | `opPlaceClip`, `opAddText`, `opAddAnimation`, `opAddEffectLayer`, `opAddClipsRaw` |
| Edit clips | `opPatchClips`, `opMoveClip`, `opTrimClip`, `opSplitClip`, `opDeleteClips` (optional ripple), `opDuplicateClips`, `opSetMask`, `opApplyLook`, `opClearTimeline` |
| Tracks | `opAddTrack`, `opRemoveTrack`, `opReorderTracks`, `opSetTrack` |
| Markers | `opSetMarkers`, `opAddMarker` |
| Effects | `opApplyEffect`, `opUpdateEffect`, `opRemoveEffect`, `opClearEffects` |
| Keyframes | `opSetKeyframes`, `opClearKeyframes`, `opSetEffectKeyframes`, `opClearEffectKeyframes` |
| Audio | `opDetachAudio` |
| Text | `opSetTextStyle` |
| Project | `opSetProjectFormat`, `opSetPlan` |

## Behaviours worth knowing

### Placing a clip (`opPlaceClip`)
Resolves a start from `beatId`, `startMs` or `startFrame`, and a duration from `durFrames`, `durMs`, the beat window or the asset. On the base track a clip is capped at 5 seconds unless `allowLong`. If the project is voice-locked, a clip cannot run past the end of the voiceover. Video clips pick up `audio` from the request or the asset's `useAudio`; transparent cut-outs default to `fit: 'contain'`.

### Splitting (`opSplitClip`)
The right half gets a fresh id, a re-based source offset (`in`), and **both** clip keyframes and effect keyframes are split: the right side receives an evaluated key at frame 0 so motion continues seamlessly, the left side keeps keys up to the cut. Effect instances on the right half get new ids.

### Effect layers (`opAddEffectLayer`)
Creates a new video track on top (role `effect`) unless a `track` is given, then a clip of type `effect` with an effects list. Parameters can carry keyframes from the start.

### Detaching audio (`opDetachAudio`)
Requires a video clip whose asset really has audio. The video clip's `audio` becomes `false`; a new audio clip with the same timing, source range, speed, volume and volume keyframes is created on a free sound-effects track, or on a new track if none has room.

### Project format (`opSetProjectFormat`)
Accepts a format id or a width/height pair, rejects anything that is not exactly 16:9 or 9:16, and rescales the timeline if the frame rate changes.

## Validation: `checkClip`

Each operation ends by calling `checkClip(project, clip)` (in `shared/model.mjs`). It throws a clear error for invalid input, so the tool result an AI sees explains what to fix: for example `Effect invert parameter "amount" cannot be keyframed (allowed: none)`.

## The same ops in two hosts

| Host | Wrapper | Draft and history | Persistence |
| --- | --- | --- | --- |
| Helper | `server/timeline.mjs`, `server/tools.mjs`, `store.mutate` | structured clone, undo stack of 80 | atomic `project.json` |
| Browser | `web/src/local.mjs` (`LOCAL_OPS` map, `LocalStore.mutate`) | structured clone, undo stack | IndexedDB |

`LOCAL_OPS` lists the tools that can run in the browser; `LOCAL_TOOL_NAMES` is exported from it and used by the hosted MCP to decide which tools to offer.

## Testing the ops

`tests/core.test.mjs` exercises the ops directly (no server, no browser), for example: splitting an effect layer re-bases effect keyframes; detaching audio moves the sound to its own track; transparent cut-outs default to contain-fit. See [Testing](testing.html).
