---
title: Contributions with Stripe
section: Cloud and accounts
order: 2
description: How the Support page takes $5-or-more contributions through your own Stripe account.
---

The **Support** page lets anyone contribute **$5 or more, with no upper limit** (Stripe's own per-payment ceiling for USD is $999,999.99). Payments go to **your own Stripe account** through **Stripe Checkout**, Stripe's hosted payment page, so card details never touch your website or your Worker.

## Flow

```text
Support page ──{amount}──▶ Worker POST /donate ──▶ Stripe API (create Checkout Session)
       ▲                                                   │
       └──────── redirect to the Stripe-hosted page ◀──────┘
Stripe page ──paid──▶ success_url  https://<site>/#/thanks?session_id=…
Thanks page ──▶ Worker GET /donate/session/:id ──▶ shows "your $X contribution went through"
```

## Endpoints (in `cloud/worker/src/donate.js`)

| Endpoint | Purpose |
| --- | --- |
| `GET /donate/config` | `{ enabled, minUsd: 5, maxUsd, presets, currency }`. `enabled` is true only when the Stripe secret is configured |
| `POST /donate` | Body `{ "amount": 25 }`. Validates and creates a Checkout Session; returns `{ url }` |
| `GET /donate/session/:id` | For the thank-you page: `{ paid, amount, currency }`. Only reports sessions this site created (metadata `source=framesflow.online`) |

CORS for these routes allows only the website's origin (`APP_URL`).

## Validation (server side, the only place that counts)

`toCents()` accepts a number or a string such as `"$1,250.50"`, rounds to whole cents and rejects anything below **500 cents** or above the Stripe ceiling, and anything that is not a finite number. The browser form applies the same rule to give instant feedback, but the Worker never trusts it. Extra fields in the request (such as `unit_amount`, `mode` or `success_url`) are **ignored**: the Checkout Session is built only from the validated amount.

The session uses `mode=payment`, `submit_type=donate` (Stripe shows a "Donate" button), one line item "Support Framesflow" with `price_data` in USD, and success and cancel URLs on your site.

## Setting up Stripe

1. In Stripe, create a **restricted API key** with only **Checkout Sessions: Write** (and Read). A restricted key limits damage if it ever leaks.
2. Store it as a Worker secret: `npx wrangler secret put STRIPE_SECRET_KEY`. It is never written to a file or sent to the browser.
3. Try it in **test mode** with a `rk_test_…` key and the card `4242 4242 4242 4242`, then switch the secret to the live key.
4. Optional: add a Cloudflare rate-limiting rule for `POST /donate`.

## Wording

The page calls these **contributions** to support development and states that they are voluntary, not tax-deductible, and non-refundable except where the law requires. Whether a for-profit company may call them "donations", and any tax treatment, depends on your jurisdiction and Stripe's rules for your account: confirm with Stripe or an accountant.

## Tests

`cloud/worker/test/donate.test.mjs` starts a **mock Stripe API**, points the Worker at it with `STRIPE_API_BASE`, and checks: amounts under $5, zero, negative, junk, null and over-limit are rejected **before Stripe is called**; $25 produces exactly 2500 cents and ignores injected fields; strings and cents convert exactly (`"$1,000"` → 100000, `12.5` → 1250); and the session lookup discloses only this site's sessions.
