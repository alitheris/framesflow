# How to write an animation for the studio (HTML → transparent video clip)

You write one HTML document (or fragment). The studio opens it in a headless browser at the project's exact
size, **seeks it to every frame time `t`** (like HyperFrames does with a paused timeline), takes a transparent
screenshot of each frame and encodes them to a transparent video that goes on the timeline. So the page must be
a **pure function of time**.

## The contract
1. **Canvas** = the project size (16:9 → 1920×1080, 9:16 → 1080×1920). Use `vmin`, `vw`, `vh` units so one design works for both. CSS variables `--ff-w`, `--ff-h` (px) and `--ff-dur` (clip length, e.g. `3s`) are always defined.
2. **Background is transparent** unless you paint one. Full-screen scenes: paint your own background. Overlays (titles, lower thirds, callouts, cut-out characters): leave it transparent so the footage shows through.
3. **Animate with CSS `@keyframes` / `animation`, WAAPI, or SVG/canvas drawn from `window.__ffSeek(t)`.**
   - Every CSS/Web animation is automatically paused and seeked to `t` each frame. Use `animation-fill-mode: both` (or `forwards`), finite iteration counts, and `animation-delay` to sequence things.
   - For things CSS cannot do (counters, canvas drawing, generated DOM), define `window.__ffSeek = t => { ... }` (t in seconds). It is called before every frame; draw the state for that exact `t`.
   - A paused timeline library registered as `window.__timelines["id"]` (any object with `.time(t)` / `.pause()`, e.g. a GSAP timeline you inline yourself) is also seeked.
4. **Forbidden / pointless:** `Date.now()`, `new Date()`, `performance.now()`, `Math.random()` (use a seeded PRNG), `setTimeout`/`setInterval`/`requestAnimationFrame`, `fetch`/XHR/WebSocket, remote `<script src>`/images/fonts, infinite animations. The network is blocked. The tool returns warnings when it spots these.
5. **Images:** use `asset://<assetId>` for anything in the media library (e.g. a transparent cut-out PNG from `remove_background`): `<img src="asset://a_123abc">`. Data URIs and inline SVG also work.
6. **Fonts:** only fonts installed on this computer (Segoe UI, Arial, Georgia, Impact, Courier New, Trebuchet MS, Verdana…). Montserrat/Poppins work only if installed.
7. **Timing:** the clip lasts `durationMs`. Land the end state before the end, or add an exit animation at `calc(var(--ff-dur) - .5s)`. Plan the beats in seconds first (0–.3 s enter, hold, exit last .4 s).
8. **Safe area:** keep key content inside the central 90% (and text inside 80%) of the frame.
9. Keep the document small and self-contained (one file, inline `<style>` and `<script>`).

## Building a full animated scene
Compose several absolutely positioned elements, each with its own `animation-delay` (stagger by .08–.2 s), easing
`cubic-bezier(.2,.9,.2,1)` for entrances and `ease-in` for exits. Layer: background shapes → content → accents.
Use SVG for icons, charts and drawn lines (`stroke-dasharray` + `stroke-dashoffset` animation draws a line).
Build repeated elements with a small script at load time (it runs once, deterministically) and animate them with CSS using
per-element custom properties (`style="--i:3"` → `animation-delay: calc(var(--i) * .12s)`).

## Workflow
1. `list_animation_templates` – start from a template when one fits (`create_animation` with `template` + `vars`).
2. Write your own HTML for anything else. Call `snapshot_animation` first: it returns a contact sheet of 4 frames so you can **look** before rendering. Fix layout/overflow/timing.
3. `create_animation` renders the clip, imports it as a transparent video asset and places it (default on overlay track V2 at the given time).
4. Change it later with `update_animation` (new html or variables); every clip using it is swapped.

## Minimal example
```html
<div class="pill">NEW</div>
<style>
.pill{position:absolute;left:50%;top:50%;translate:-50% -50%;padding:2vmin 5vmin;border-radius:9vmin;background:#d8f36a;color:#16200c;
  font:800 6vmin 'Segoe UI',Arial,sans-serif;animation:pop .5s cubic-bezier(.2,1.4,.3,1) both, out .4s ease-in calc(var(--ff-dur) - .4s) both}
@keyframes pop{from{opacity:0;scale:.5}to{opacity:1;scale:1}}
@keyframes out{to{opacity:0;scale:.8}}
</style>
```
