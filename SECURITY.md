# Security policy

## Reporting a vulnerability

Please report security problems **privately**. On GitHub use **Security → Report a vulnerability** on this repository (private vulnerability reporting). Include what you found, how to reproduce it, and the impact. Please do not open a public issue or discuss it publicly until it is fixed.

We aim to acknowledge reports within a few days and to fix confirmed issues promptly.

## Scope

In scope: the local helper (`server/`, `mcp/`), the web app (`web/`), the hosted link and contributions (`cloud/worker`), the database schema (`cloud/supabase`), and the CLI.

Examples of issues we want to hear about: a way for a web page to control the local helper, path traversal, SSRF through image import, bypassing the OAuth flow or PKCE, reaching another user's studio through the hosted link, bypassing the $5 contribution minimum, reading another user's project rows, or leaking a secret.

## Design notes

How the protections work is documented on the **Security and rights** page of the docs (`docs-site/content/security.md`).

## Secrets

Never commit secrets. The repository must contain only placeholders and the public Supabase anon key. The Stripe key is a Cloudflare Worker secret (`wrangler secret put STRIPE_SECRET_KEY`). If a secret is ever committed, rotate it immediately.
