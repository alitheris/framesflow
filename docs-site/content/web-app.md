---
title: The web app
section: How it works
order: 7
description: How the React studio is organised: api layer, timeline, preview, transport and the public pages.
---

The web app is a React 19 app built with Vite (`web/`). It serves three purposes: the **studio**, the **public site** (landing, docs, about, support, legal) and the **account pages** (login and AI-connect consent).

## Routing

There is no router library. `web/src/main.jsx` reads `location.hash`:

| Hash | Page |
| --- | --- |
| `#/` | Landing |
| `#/studio` | The studio (preceded once per session by the logo intro) |
| `#/guide` | Connect your AI |
| `#/authorize?req=…` | OAuth consent for the hosted MCP link |
| `#/docs`, `#/about`, `#/support`, `#/thanks`, `#/terms`, `#/privacy` | Public pages |

Hash routing means the whole site is plain static files with no server rewrites.

## The API layer (`api.js`)

One module hides the runtime. It keeps a small reactive store (`useApp()` via `useSyncExternalStore`) with the mode, revision, project, jobs, activity, flashes and toasts, and exports:

- `init()`: detect the runtime (see [Architecture](architecture.html)).
- `tool(name, args, { quiet })`: run a tool. Server mode calls REST; local mode calls `localTool()`.
- `relayTool(name, args)`: the same, but marked as an AI call (used by the hosted relay).
- `upload(file)`, `askAudio(asset)`: import media (asking whether to keep a video's sound).

## Browser mode (`local.mjs`)

`LocalStore` mirrors the server store: draft clone, undo and redo stacks, a debounced save to IndexedDB (projects and media blobs in two object stores), and subscriptions. `LOCAL_OPS` maps tool names to shared operations, `LOCAL_READ` has the read-only tools, and `localTool()` dispatches. Anything else throws a helpful message ("needs the local Framesflow server").

## The studio (`web/src/studio/`)

| File | Role |
| --- | --- |
| `Studio.jsx` | Layout: header, left panels (Media, Titles, Effects, Auto, YouTube, Images, Animate, Beats), preview, inspector, timeline; project menu; account chip |
| `Timeline.jsx` | Tracks, clips with filmstrips and waveforms, markers, beats and words lanes, snapping, ripple, drag, trim, split, zoom, drop of library items and files |
| `Preview.jsx` | The preview canvas. Manages `<video>` and `<img>` sources per clip, syncs them to the playhead, calls the compositor |
| `compositor.js` | `drawFrame()`: the single function that renders a frame to a canvas |
| `transport.js` | The playback clock, kept **outside React** so scrubbing and playing do not re-render the app. It drives the preview and the audio engine |
| `audio.js` | The WebAudio preview engine: per-clip gain, 3-band EQ, reverb, delay, compressor, track mute/solo |
| `export.mjs` | Browser export with WebCodecs |
| `RightPanels.jsx` | Inspector (timing, transform, keyframes, effects with keyframes, clip audio, animation editor) and the activity panel |
| `LibraryPanels.jsx` | Media, YouTube, Beats, Titles, Effects, Images and Animation panels |
| `MixerPanel.jsx`, `AutoPanel.jsx`, `RenderDialog.jsx` | Mixer, autopilot/plan panel, render dialog |

### Why the transport is separate
Playing at 30 frames per second through React state would redraw the whole app 30 times a second. `transport.js` holds `frame` in a plain variable, notifies subscribers, and exposes `useFrame()` for the few components (the timecode, the playhead) that need it.

### Keyboard
`Space` play/pause, `J`/`K`/`L` shuttle, `S` split, `M` marker, `N` snapping, `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `Ctrl+C`/`Ctrl+V` copy/paste at the playhead, `Del` delete, `Shift+Del` ripple delete.

## Account layer (`cloud.js`, `Auth.jsx`)

Active only when `public/config.json` has a Supabase URL and key. It provides Google sign-in, the relay WebSocket and project sync. See [Cloud and accounts](cloud.html). With the default empty config the app behaves exactly like the offline studio.

## The public pages (`web/src/site/`)

`SiteLayout` gives every page the same nav and footer. The footer carries the Alitheris family block and the legal links. Pages: `About`, `Docs` (a short in-app docs page that points here), `Support` (contribution form), `Thanks`, and `Legal` (Terms and Privacy). Copy such as company and product names comes from `shared/brand.mjs`.

## The logo intro

`public/ff-logo-intro.html` is a self-contained animation. `main.jsx` shows it in an iframe overlay the first time the studio opens in a browser session (skippable, disabled for reduced motion) while the studio loads underneath.

## Build

`npm run build` runs `vite build web` into `web/dist`. The Supabase client is loaded lazily, so visitors who are not using accounts never download it.
