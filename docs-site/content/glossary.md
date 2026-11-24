---
title: Glossary
section: Reference
order: 30
description: Terms used throughout Framesflow and these docs.
---

| Term | Meaning |
| --- | --- |
| **Alitheris** | The company behind Framesflow, Kuku Labs and Grow With Ali |
| **Asset** | A media file in the project library (video, image, audio), with metadata |
| **Autopilot** | Rule-based automatic sourcing and placement for every beat, with no chat |
| **Beat** | A sentence-sized visual slot (at most 5 s) tied to an exact window of the voiceover |
| **Cause** | Who made a change (`ui`, `mcp`, `auto`, `system`), which tool, and which clips; drives the activity feed |
| **Clip** | A timed item on a track: video, image, audio, text, graphic or effect |
| **Compositor** | `drawFrame()`: the canvas code that renders one frame for preview and browser export |
| **Contact sheet** | A grid of frames in one image so an AI can look at footage or an animation |
| **Cut-out** | A transparent PNG of a subject made by background removal |
| **Draft** | A structured clone of the project that an operation edits before the store swaps it in |
| **Durable Object** | A Cloudflare object with its own state; here, one per user, holding the studio's WebSocket |
| **Effect layer** | A clip of type `effect` that processes everything on the tracks below it |
| **Frame** | The timeline unit, an integer at the project frame rate |
| **Helper** | The local Node server with every feature (ffmpeg, YouTube, Whisper, animations) |
| **Job** | An observable long-running task with progress, logs and cancel |
| **Keyframe** | A value at a frame; values between keys are interpolated (`linear`, `ease`, `hold`) |
| **LUFS** | Loudness unit used for mastering; the default target is −14 |
| **MCP** | Model Context Protocol: how AI apps call tools |
| **Mix** | The user's chosen percentages of YouTube footage, images and animation |
| **Op** | A pure function in `shared/ops.mjs` that edits a draft project |
| **PKCE** | Proof Key for Code Exchange: protects the OAuth code flow; S256 is required here |
| **Plan** | The AI's shot list; `exec_plan` turns rows into clips |
| **QC** | Quality control against the editing rules |
| **Relay** | The path that carries hosted MCP tool calls to the user's open studio tab |
| **Row Level Security** | A database feature that restricts rows per user |
| **Segment** | A cached, normalised piece of the base track used by the ffmpeg render |
| **Skill** | The knowledge package (`skills/framesflow`) that teaches an AI to use Framesflow and make videos |
| **Tool** | An MCP function the AI can call (90 of them) |
| **Track** | A horizontal layer; array order is the layer order |
| **Voice lock** | Setting that fixes the video length to the end of the transcribed voiceover |
| **WebCodecs** | Browser API used to encode video for the in-browser export |
