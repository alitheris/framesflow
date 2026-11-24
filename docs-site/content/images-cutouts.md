---
title: Images and cut-outs
section: The editor
order: 4
description: Free licensed image search, safe downloads, one-click background removal and animating the result.
---

## Finding images (`server/images.mjs`)

`search_images` queries **Openverse**, which aggregates openly licensed images from Wikimedia Commons, Flickr, NASA, Smithsonian, museums and more. No API key is needed. Results carry `url`, `thumbnail`, size, `creator`, `license` (for example `BY 2.0`), `licenseUrl`, `landingUrl` and a ready-made `attribution` line.

- Defaults to `license_type=commercial` (licences that allow monetised use) and `mature=false`.
- Filters: `orientation` (wide, tall, square), `pngOnly`, `source` (for example `wikimedia`, `nasa`), `page`.

## Importing safely

`import_image` downloads one image URL into the library. Because the URL comes from an AI or a user, the downloader is hardened:

| Protection | How |
| --- | --- |
| HTTPS only | `http:` and other schemes are rejected |
| No credentials in URLs | `user:pass@host` is rejected |
| No private addresses | DNS is resolved first; loopback, private ranges (10/8, 172.16/12, 192.168/16), link-local (169.254/16), carrier-grade NAT, multicast and IPv6 equivalents are refused (SSRF protection) |
| Redirects re-checked | At most 4 hops, and **every hop** is validated again |
| Content checks | The `Content-Type` must be a supported image type (JPEG, PNG, WebP, GIF, AVIF, BMP); SVG is refused |
| Size limit | 25 MB, enforced while streaming, not only from `Content-Length` |
| Timeout | 30 seconds |

The `credit` object (title, creator, licence, links) is stored in `asset.source` with `type: 'web-image'`. The exported `sources.txt` has an **IMAGES** section listing every image on the timeline with creator, licence and where it is used; a cut-out credits its original photo.

## Cutting out the subject (`server/bgremove.mjs`)

`remove_background` (or `import_image {removeBackground: true}`, or the inspector button) turns an image into a **transparent PNG**.

- **Model:** BiRefNet-lite (`onnx-community/BiRefNet_lite-ONNX`), MIT licence, run through `@huggingface/transformers` (Apache-2.0) and ONNX Runtime. It downloads once (about 45 MB) into the workspace `models/` folder and then works offline.
- **Cost:** about 25 seconds per image on a laptop CPU and roughly 3 GB of free RAM. The model has a fixed 1024 pixel input; the memory arena is disabled to lower peak memory.
- **Output:** the new asset has `transparent: true` and `cutoutOf: <original id>`. New clips default to `fit: 'contain'` so the whole subject shows.

### Why this model

The popular `@imgly/background-removal` package is **AGPL-3.0**: using it in a hosted commercial product would require publishing the product's source. The `RMBG-1.4` model has a non-commercial licence. BiRefNet is MIT and good on general subjects, so it fits a public, monetised site. Licence choices like this are part of the architecture: see [Security and rights](security.html).

## Animating a cut-out

A cut-out placed on an overlay track (V2 or higher) is a normal image clip:

```text
set_keyframes { clipId, property: 'x',       keys: [ {frame:0, value:-40, interp:'ease'}, {frame:18, value:0} ] }
set_keyframes { clipId, property: 'opacity', keys: [ {frame:0, value:0},  {frame:12, value:1} ] }
set_keyframes { clipId, property: 'scale',   keys: [ {frame:0, value:0.8}, {frame:18, value:1} ] }
```

In the ffmpeg render the image is fitted to the frame at scale 1, rotated on a fixed square canvas, then scaled per frame, and positioned with an expression, so the preview and the render agree. The cut-out can also appear **inside an HTML animation** as `<img src="asset://ASSET_ID">`, which opens the door to characters that float, swim and bounce under CSS keyframes.

## Browser-only mode

Image search, import and cut-outs are helper features. Most image hosts block downloads from browser pages and the model is too heavy for many browsers. A future hosted proxy could offer search to the browser; today these tools are helper-only.

## Rights reminder

A cut-out of a copyrighted photo is still that photo. Keep the credit, follow the licence, and see [the skill's sourcing and rights guide](skill-sourcing-and-rights.html).
