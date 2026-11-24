# Contributing to Framesflow

Thanks for helping. Framesflow is built by [Alitheris](https://framesflow.online). The full technical documentation is in `docs-site/` (build it with `npm run docs`) and published at https://docs.framesflow.online.

## Set up

```bash
npm install
npm run doctor      # checks ffmpeg, yt-dlp, Whisper, Edge/Chrome
npm start           # the studio with every feature at http://127.0.0.1:4317
npm run dev         # hot-reload UI on :5173
```

Node 20 or newer. ffmpeg and ffprobe are needed for the render tests.

## Before you open a pull request

```bash
npm test                 # unit + render tests
npm run build            # the web app
npm run build:cloud      # regenerate cloud/worker/src/tools.json, skill.json and skills/framesflow/references/tools.md
npm run docs             # the docs site must still build (and links must resolve)
```

The generated files must be committed up to date; CI fails if they are not.

Changes to the hosted link (`cloud/worker`) also need its tests: start `wrangler dev` as described in `docs-site/content/testing.md`, then `cd cloud/worker && npm test`.

## Where to put things

- Logic that changes a project belongs in `shared/ops.mjs` as a **pure function** of a draft (no I/O), so the browser and the helper behave the same. Add a unit test.
- Anything with files, ffmpeg, the network or child processes belongs in `server/`.
- A new AI capability is a tool in `server/tools.mjs` with an instructional description. Add it to `LOCAL_OPS` in `web/src/local.mjs` if the browser can run it. Mention it in the skill when the AI needs guidance.
- If two runtimes must agree (preview and render), share the maths instead of duplicating it.
- Keep dependencies' licences compatible with a commercial hosted product (see the Security and rights page). Do not add AGPL or non-commercial dependencies or models.

Step-by-step recipes (effects, transitions, text animations, templates, skill and docs pages) are in the docs under **Extending Framesflow**.

## Style

ES modules, no TypeScript, small functions, explicit validation errors written so an AI can fix its call. Prefer plain code over clever code.

## Rights and content

Do not commit media you do not have the right to share. `workspace/` is git-ignored: keep it that way.

## License

By contributing you agree that your contribution is licensed under the project's [MIT license](LICENSE).

## Reporting security problems

See `SECURITY.md`. Please do not open public issues for vulnerabilities.
