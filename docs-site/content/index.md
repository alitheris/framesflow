---
title: Framesflow, explained
section: Start here
order: 0
description: What Framesflow is, how the repository is organised, and where to read next.
---

**Framesflow** is a free AI video studio your chat can operate. It is a multi-track video editor that runs in a browser tab. A set of **90 tools** (exposed over the Model Context Protocol, MCP) lets an AI assistant such as Claude edit the timeline while you watch every change appear live. It is built by **Alitheris**, the company behind Framesflow, [Kuku Labs](https://kukulabs.online) and [Grow With Ali](https://growwithali.com).

These docs explain **how this repository works**, from the data model to the render pipeline, so you can run it, extend it, deploy it and trust it.

## The idea in one picture

{{diagram:architecture}}

One studio UI, one set of editing operations, three ways to run it:

1. **Browser mode:** open the website and edit. Nothing to install. The shared editing operations run inside the tab, projects live in the browser's IndexedDB, and the video is exported with WebCodecs.
2. **Local helper:** a small Node server on your own computer adds everything a web page cannot do: ffmpeg rendering, downloading sections of YouTube videos, Whisper transcription, image search, background removal and HTML animations. It also speaks MCP itself.
3. **Cloud (optional):** a Cloudflare Worker gives each user a single MCP link with Google login, relays an AI's tool calls to the user's open studio tab, and takes contributions through Stripe. Supabase stores accounts and project files (never media).

## What makes the design work

- **One source of truth for edits.** Every change, whether it comes from the mouse or an AI tool, goes through the same pure functions in `shared/ops.mjs` operating on a draft copy of the project. The server and the browser import the very same file, so behaviour cannot drift.
- **What you see is what exports.** The canvas compositor draws every frame in the preview and in the browser export. The ffmpeg render rebuilds the same result with filters. Both are tested against each other with real renders.
- **Everything is observable.** Each tool call is a labelled change with an undo step, an activity-feed line and a highlight on the clips it touched.
- **The AI is taught, not just connected.** A skill (`skills/framesflow`) teaches an assistant how every kind of video is made and how to use the tools well, including rights and platform-policy guidance.

## Reading guide

| If you want to… | Read |
| --- | --- |
| Run it in five minutes | [Getting started](getting-started.html) |
| Understand the moving parts | [Architecture](architecture.html), [Repository layout](repo-layout.html) |
| Know exactly what a project is | [The project model](project-model.html) and [Shared operations](shared-ops.html) |
| See how video gets made | [Rendering](rendering.html) and [The AI pipeline](ai-pipeline.html) |
| Use or add a tool | [MCP and the tool registry](mcp.html), [Tool reference](tool-reference.html), [Extending Framesflow](extending.html) |
| Deploy the website, login and donations | [Cloud and accounts](cloud.html), [Contributions with Stripe](donations.html), [Deployment](deployment.html) |
| Check security and limits | [Security](security.html), [Known limits](limits.html) |

## Numbers at a glance

| | |
| --- | --- |
| MCP tools | 90 (51 run in the browser alone) |
| Transitions | 25 |
| Effects | 18, with keyframes on 14 of them |
| Text animations | 28 in, 7 out |
| Formats | exact 16:9 and 9:16 (720p, 1080p, 4K) |
| Frame rates | 24, 25, 30, 50, 60 |
| Tests | 20 unit tests, 16 hosted-link integration tests |

> The tool reference, catalogs and skill pages in these docs are **generated from the source code** every time the docs are built, so those numbers and tables cannot go stale.
