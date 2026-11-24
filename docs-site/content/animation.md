---
title: HTML animations
section: The editor
order: 3
description: How an AI-written web page becomes a transparent video clip, in the spirit of HyperFrames.
---

Framesflow can turn **HTML, CSS and a little JavaScript** into a transparent video clip that sits on the timeline like any other clip. The approach follows the idea behind HyperFrames (HTML rendered to video by seeking a paused timeline frame by frame): a page is treated as a **pure function of time**, seeked to each frame, captured with a transparent background and encoded.

## Why this design

An AI is excellent at writing HTML and CSS: layouts, typography, SVG, keyframe animations. If the page is deterministic, every render is identical, previews are exact, and a result can be edited later by changing the source. The cost is that the page must obey a contract.

## The pipeline (`server/htmlanim.mjs`)

1. **Prepare.** `fillVars` substitutes `{{name}}` (HTML-escaped) and `{{json:name}}` (a safe JavaScript string literal with `<` escaped) into a template. `wrapHtml` makes the document a fixed-size, non-scrolling, **transparent** canvas the size of the project and defines `--ff-w`, `--ff-h` and `--ff-dur` CSS variables. `asset://<id>` becomes a local URL for a library image.
2. **Launch.** `puppeteer-core` starts the user's installed **Edge or Chrome** headless (no browser download). Request interception **blocks all network access**; only `data:` URLs and the local asset URL are answered.
3. **Wait.** Fonts finish loading; an optional `window.__ffReady` promise is awaited.
4. **Seek, then capture, per frame.** For frame `i` at `t = i / fps`: every Web Animation and CSS animation from `document.getAnimations()` is paused and set to `t`; any registered timeline in `window.__timelines` gets `.time(t)`; then `window.__ffSeek(t)` is called if defined. After two animation frames, a PNG screenshot is taken with the default background omitted, so transparency is preserved.
5. **Encode.** The PNGs are streamed into ffmpeg (`image2pipe`) and encoded as **VP9 with alpha** (`yuva420p`, CRF 28) into a WebM.
6. **Import.** The result is imported as an asset flagged `alpha: true`, with the source HTML, template and variables stored in `asset.animation`, and (optionally) placed on a track.

The 3-second 1080p title card renders in about 9 seconds on a laptop.

## Playing it back

- **Preview and browser export:** Chrome decodes VP9 alpha natively, so the `<video>` element composites over the footage in the canvas.
- **ffmpeg render:** the decoder must be `libvpx-vp9` (ffmpeg's built-in VP9 decoder ignores alpha), so the render adds `-c:v libvpx-vp9` for assets with `alpha: true`.
- Black-bar detection is skipped for these assets (transparent pixels would look like bars).

## The contract an animation must follow

| Do | Don't |
| --- | --- |
| Animate with CSS `@keyframes`/`animation`, Web Animations, or draw in `window.__ffSeek(t)` | `Date.now()`, `new Date()`, `performance.now()` |
| Use `animation-fill-mode: both` and finite iteration counts | `Math.random()` (use a seeded generator) |
| Use `vmin`, `vw`, `vh` so one design fits 16:9 and 9:16 | `setTimeout`, `setInterval`, `requestAnimationFrame` |
| Reference library images with `asset://<assetId>` | `fetch`, XHR, WebSocket, remote scripts, images or fonts |
| Land the end state before the clip ends, or add an exit | `infinite` animations |

`lintHtml()` scans the source for these and returns warnings in the tool result.

The full authoring guide, served to AIs by `animation_guide`, is `server/animation-guide.md` and is reproduced in the skill page [HTML animations (skill)](skill-animation.html).

## Tools

| Tool | Use |
| --- | --- |
| `animation_guide` | The contract and a worked example |
| `list_animation_templates` | Title card, lower third, big number (counts up), bar chart |
| `snapshot_animation` | A contact sheet of frames over a grey background so the AI can **look** before rendering |
| `create_animation` | Render and optionally place on a track (default V2) |
| `update_animation` | Re-render an existing animation with new variables, HTML or length; every clip using it is switched to the new asset |

## Templates (`server/animtemplates.mjs`)

Each template is an HTML fragment with `{{variables}}`. They use only CSS keyframes (the counter also defines `__ffSeek`). Adding one is a matter of appending an object with an id, label, description, variable list and HTML; the docs and the tool list pick it up automatically. See [Extending Framesflow](extending.html).

## Safety

The page runs in a headless browser with no network, no file access and no extensions. A strict time limit (60 seconds of video maximum) and per-frame seeking mean a runaway script cannot loop forever in practice, and the browser is always closed in a `finally` block.

## Built-in graphics

Separate from HTML animations, `add_animation` creates **built-in graphic clips** (`stat`, `counter`, `quote`, `list`, `comparison`, `timeline`, `chapter`) whose layout is one pure function (`shared/graphics.mjs`) used by both the canvas and the server's PNG sequence renderer. They are lighter than HTML animations and render in any runtime.

## Limits

- Needs Edge or Chrome on the machine that runs the helper.
- System fonts only.
- Browser-only mode and the hosted link without a helper cannot create them.
- The Bash tool in some sandboxed development setups cannot launch the browser; run such tests from a normal terminal.
