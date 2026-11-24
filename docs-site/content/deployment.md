---
title: Deployment
section: Build and run
order: 4
description: Put the website, the hosted link and the contribution page online, and publish the npm package.
---

Everything can be deployed on free tiers. The full step-by-step with screenshots-free commands is in `cloud/README.md`; this page explains the pieces and the order.

## What gets deployed where

| Part | Built from | Goes to |
| --- | --- | --- |
| Website (studio, landing, docs-lite, support, legal) | `npm run build` → `web/dist` | Cloudflare Pages or Netlify, on your main domain |
| Hosted MCP, login handshake, contributions | `cloud/worker` | Cloudflare Workers, on a subdomain such as `mcp.<domain>` |
| Accounts and project storage | `cloud/supabase/schema.sql` | Supabase |
| This documentation | `npm run docs` → `docs-site/dist` | Any static host, for example `docs.<domain>` |
| Local helper and CLI | the npm package | npm (`framesflow-studio`) |

## Order of operations

1. **Website first** (no accounts needed): upload `web/dist`. The studio works in the browser with no login.
2. **Supabase:** create the project, run `schema.sql`, set Site URL and redirect URLs, enable Google sign-in.
3. **Cloudflare:** put the domain on Cloudflare DNS (free), create the KV namespace, fill `wrangler.toml`, set `STRIPE_SECRET_KEY`, run `npm run deploy`.
4. **Turn login on:** edit `web/public/config.json`, rebuild, upload again.
5. **Docs:** `npm run docs`, upload `docs-site/dist`.
6. **npm package:** `npm publish` (see below).

## Deploying the Worker

```bash
cd cloud/worker
npm install
npx wrangler login
npx wrangler kv namespace create OAUTH        # paste the id into wrangler.toml
npx wrangler secret put STRIPE_SECRET_KEY
npm run deploy                                # regenerates tools.json and skill.json, then wrangler deploy
```

`npm run deploy` first runs `npm run manifest`, which regenerates the tool list (`tools.json`) and the skill bundle (`skill.json`) from the main project, so the hosted link always matches the code. A deployable copy of the Worker that does not need the main project is a folder with `src/`, `wrangler.toml` and `package.json` (`deploy` = `wrangler deploy`); regenerate its JSON files from the main project whenever tools or the skill change.

## Verification checklist after deploying

- [ ] `https://<mcp-host>/health` returns `{"ok":true}` and the tool count.
- [ ] `https://<mcp-host>/donate/config` returns `"enabled": true` (after setting the Stripe secret).
- [ ] The site opens; **Open studio** shows the logo intro, then the studio.
- [ ] With login on: Continue with Google works and the account menu shows **AI link connected**.
- [ ] In Claude: add the connector `https://<mcp-host>/mcp`, sign in, Allow, then ask it to call `get_framesflow_skill` and `get_project`.
- [ ] Support page in Stripe **test mode**: a $5 contribution completes and appears in Stripe; $4 is refused; the thank-you page shows the amount.
- [ ] Switch the Stripe secret to the live key.
- [ ] Terms and Privacy show your contact email.

## Hosting notes

- The site is a single-page app with **hash routes**, so no rewrite rules are needed. `netlify.toml` and the generated `_headers` files add security headers.
- The Worker custom domain requires the domain to use Cloudflare DNS. Until then the Worker answers on its `*.workers.dev` address.
- Changing the domain means updating `APP_URL`, the Supabase redirect URLs, `mcpUrl` in `config.json` and the Google OAuth client.

## Publishing the npm package

```bash
npm login
npm publish --access public     # runs prepublishOnly: tool list, skill, web build, unit tests
```

The project is released under the MIT licence (`LICENSE`, and `"license": "MIT"` in `package.json`). The package includes `bin`, `server`, `shared`, `mcp`, `scripts`, `skills`, `web/dist`, the README and the Windows launcher, about 365 kB. The name `framesflow` on npm belongs to an unpublished package from 2023, so the package is published as `framesflow-studio` and installs both `framesflow` and `framesflow-studio` commands.

## Updating

Pull, `npm install`, `npm test`, `npm run build:cloud`, `npm run build`, redeploy the website, `npm run deploy` in `cloud/worker`, and `npm run docs`.
