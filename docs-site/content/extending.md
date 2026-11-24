---
title: Extending Framesflow
section: Build and run
order: 5
description: Recipes for adding a tool, an operation, an effect, a transition, a text animation, a template, a skill page or a docs page.
---

## Add a tool

1. **Operation (if it edits the project).** Add `opMyThing(d, args)` to `shared/ops.mjs`. It mutates the draft, ends written clips with `checkClip`, and returns `{ result, summary, clipIds }`. No I/O.
2. **Tool.** In `server/tools.mjs`:

   ```js
   def('my_thing', 'What it does, when to use it, what it returns.', { clipId: z.string(), amount: z.number().min(0).max(1) },
     async (a, ctx) => {
       store.mutate(cause(ctx, 'my_thing', { summary: 'Did my thing' }), d => opMyThing(d, a));
       return { ok: true };
     });
   ```
3. **Run in the browser too (optional).** Add `my_thing: (d, a) => { ops.opMyThing(d, a); return { ok: true }; }` to `LOCAL_OPS` in `web/src/local.mjs`. Its name is then included in `LOCAL_TOOL_NAMES`, which the hosted link uses.
4. **UI (optional).** Call `tool('my_thing', args)` from a panel or the inspector.
5. **Tell the AI.** Mention it in `skills/framesflow/SKILL.md` and the right reference; the generated `tools.md` updates itself.
6. **Rebuild generated files:** `npm run build:cloud` (tool list and skill bundle for the hosted link), then `npm run docs`.
7. **Test it:** add a unit test to `tests/core.test.mjs`. The skill test also fails if the skill mentions a tool that does not exist.

## Add an effect

1. `shared/model.mjs`: add an entry to `EFFECTS` (`id`, `label`, `group`, `params` with min, max, step, default). If it can be keyframed, add it to `EFFECT_KEYFRAMABLE`.
2. **Preview:** `web/src/studio/compositor.js`: add it to `effectFilter()` if it maps to a canvas CSS filter, otherwise to `drawProcedural()`.
3. **Render:** `server/render.mjs` `effectFilters()`: add the ffmpeg filter. If ffmpeg can take an expression for a parameter (like `eq`), also list it in `EFFECT_KEYFRAMABLE_RENDER_EXACT` and handle the expression.
4. Check it in a real render with an effect layer (see `tests/render.test.mjs`).

## Add a transition

`shared/model.mjs` `TRANSITIONS`: set `xfade` to an ffmpeg `xfade` name if one matches, or `null` and implement a custom path in `render.mjs` and in `drawWithTransition` (compositor).

## Add a text animation

`shared/textfx.mjs`: add a preset to `TEXT_FX` (or `TEXT_FX_OUT`) mapping progress to a drawable state, and add its id to `TEXT_ANIMS_IN` or `TEXT_ANIMS_OUT` in `model.mjs`. Both the canvas and the server's PNG renderer use the same function.

## Add a built-in graphic kind

`shared/graphics.mjs`: add the kind to `GRAPHIC_KINDS`, handle it in `graphicScene()` and `checkGraphic()`.

## Add an HTML animation template

Append to `ANIMATION_TEMPLATES` in `server/animtemplates.mjs`: `{ id, label, description, vars:[{key,label,def}], html }`. Use `{{var}}` for text and `{{json:var}}` inside scripts. Use `vmin` units and `var(--ff-dur)` for exits. Check it with `snapshot_animation` and a render.

## Add or change the skill

Edit files in `skills/framesflow/` and run `npm run build:skill`. It regenerates `references/tools.md` and the bundle for the hosted link. The skill tests check structure and that every tool it names exists.

## Add a docs page

Create `docs-site/content/my-page.md` with front matter:

```text
---
title: My page
section: How it works      (one of the sections in scripts/build-docs.mjs)
order: 9
description: One line for search engines and the page header.
---
```

Write Markdown; use `{{diagram:name}}` to embed `docs-site/diagrams/name.svg`. Run `npm run docs`. The sidebar, search index, previous/next links and table of contents are built automatically.

## Code conventions

- ES modules everywhere, no TypeScript, no build step for server code.
- `shared/` imports nothing from Node or the browser.
- Prefer small pure functions and explicit validation messages written for an AI to read.
- Keep tool descriptions instructional (see [MCP and the tool registry](mcp.html)).
- When two runtimes must agree, share the maths instead of duplicating it.
