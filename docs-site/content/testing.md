---
title: Testing
section: Build and run
order: 3
description: What is tested, how to run it, and what each test proves.
---

## Run everything

```bash
npm test                       # unit + render tests (render tests need ffmpeg; they skip without it)
cd cloud/worker && npm test    # hosted-link tests (need the local Worker running, see below)
```

## Unit tests: `tests/core.test.mjs` (20)

Pure logic, no server or browser.

| Area | Examples |
| --- | --- |
| Transcript and beats | Sentences split on terminal punctuation, not abbreviations; beats tile the voiceover with no gaps and none over 5 s; keyword extraction finds names, years and joined proper nouns; chapters cover the runtime |
| Model | v2 projects migrate to v3; keyframes evaluate and split across cuts; project length locks to the voice only when `voiceLock` is set |
| Operations | tracks, effects, markers, ripple delete; effect layers live on their own track; effect keyframes interpolate and validate; splitting re-bases effect keyframes; cut-outs default to contain-fit; video audio is opt-in and detachable |
| QC | gaps, 5 s limit, reuse, back-to-back sources |
| Credits | the sources list credits web images and credits the original of a cut-out |
| HTML animations | variables are escaped for HTML and for script contexts; the wrapper makes a fixed transparent canvas; the linter flags clocks, randomness, timers and the network |
| Skill and brand | every skill reference exists and is linked; **every tool name the skill mentions is a real tool**; the skill never tells an AI to hide watermarks; brand data is right |

## Render tests: `tests/render.test.mjs` (4)

These render tiny real projects with ffmpeg and inspect the output files:

- 16:9 and 9:16: **final and draft renders have exactly the right pixel size**, keep the aspect ratio, and have even dimensions;
- an **effect layer** with keyframes darkens the picture inside its time window and returns to normal after it;
- video audio is silent by default, audible when switched on, and still audible after **detach audio**.

They use a throw-away `FRAMESFLOW_HOME` and clean up after themselves.

## Hosted-link tests: `cloud/worker/test` (16)

They run against the real Worker runtime (`workerd`) through Wrangler:

```bash
cd cloud/worker
npx wrangler dev --var DEV_AUTH:1 --var APP_URL:http://localhost:5173 \
  --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://127.0.0.1:54399
# in another terminal
npm test
```

| File | Proves |
| --- | --- |
| `flow.test.mjs` | Discovery documents; `401` with a metadata hint; dynamic client registration rejects unsafe redirect URIs; `authorize` needs an exact redirect and PKCE S256; consent requires a signed-in user and works once; the token endpoint checks PKCE, burns codes, rotates refresh tokens; MCP `initialize` and `tools/list`; the skill tool works with no studio; a studio tab connects, announces its tools and answers calls; a second tab replaces the first; **one user cannot reach another user's tab** |
| `donate.test.mjs` | The $5 minimum and all the amount rules, exact cents, ignored injected fields, thank-you lookups (uses its own mock Stripe) |

Each file skips itself with a message when the Worker is not running or not configured.

## Other checks

- `node tests/mcp-smoke.mjs` is an end-to-end check against a **running** studio, over both the stdio bridge and the HTTP endpoint: it lists tools, calls `get_status`, checks that a bad call returns an error, and reads the prompt.
- The official MCP SDK client was used to confirm protocol compatibility with the Worker (`initialize`, list tools, call a tool).

## Writing a test for a new operation

```js
test('my op does X', () => {
  const p = newProject('t');
  const r = opMyThing(p, { /* args */ });
  assert.equal(p.clips.length, 1);
});
```

Because operations are pure functions of a draft, most features need no mocks at all.

## Environment notes

Tests that launch a browser (HTML animations) need a normal desktop shell with Edge or Chrome installed. Some locked-down or sandboxed shells cannot launch a browser even though the code is correct.
