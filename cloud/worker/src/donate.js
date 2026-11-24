// Contributions through the owner's own Stripe account (Stripe Checkout, hosted by Stripe: card data never touches this code).
// The browser asks for an amount; this Worker validates it (minimum $5, any amount above) and creates the Checkout Session
// with the secret key stored as a Worker secret (npx wrangler secret put STRIPE_SECRET_KEY).
import { json, cors } from './lib.js';

export const MIN_USD = 5;
export const MAX_USD = 999999.99; // Stripe's per-payment ceiling for USD
const PRESETS = [5, 10, 25, 50, 100];
const apiBase = env => (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

/** "12", "12.5", 12.5 → cents, or null when not a valid amount in [MIN_USD, MAX_USD]. */
export function toCents(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(/^\$/, '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents < MIN_USD * 100 || cents > Math.round(MAX_USD * 100)) return null;
  return cents;
}

export function donateConfig(env, origin) {
  return json({ enabled: !!env.STRIPE_SECRET_KEY, minUsd: MIN_USD, maxUsd: MAX_USD, presets: PRESETS, currency: 'usd' }, 200, cors(origin));
}

export async function createCheckout(req, env, origin) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Contributions are not switched on yet.' }, 503, cors(origin));
  let body; try { body = await req.json(); } catch { return json({ error: 'Send JSON like {"amount": 10}' }, 400, cors(origin)); }
  const cents = toCents(body?.amount);
  if (cents === null) return json({ error: `Enter an amount from $${MIN_USD} to $${MAX_USD.toLocaleString('en-US')}.` }, 400, cors(origin));
  const app = env.APP_URL.replace(/\/$/, '');
  const form = new URLSearchParams({
    mode: 'payment',
    submit_type: 'donate',
    success_url: `${app}/#/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${app}/#/support`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': 'Support Framesflow',
    'line_items[0][price_data][product_data][description]': 'A contribution to the development of Framesflow, by Alitheris.',
    'payment_intent_data[description]': 'Framesflow support',
    'metadata[source]': 'framesflow.online',
    'metadata[amount_cents]': String(cents),
  });
  let r;
  try { r = await fetch(`${apiBase(env)}/v1/checkout/sessions`, { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form }); }
  catch { return json({ error: 'Could not reach the payment provider. Try again in a moment.' }, 502, cors(origin)); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) return json({ error: 'The payment provider could not start the checkout. Try again, or contact us.' }, 502, cors(origin));
  return json({ url: j.url }, 200, cors(origin));
}

/** For the thank-you page: was this session paid, and how much? Only returns status and amount. */
export async function checkSession(id, env, origin) {
  if (!env.STRIPE_SECRET_KEY || !/^cs_[A-Za-z0-9_]{8,200}$/.test(id)) return json({ paid: false }, 200, cors(origin));
  try {
    const r = await fetch(`${apiBase(env)}/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    const j = await r.json();
    if (!r.ok || j?.metadata?.source !== 'framesflow.online') return json({ paid: false }, 200, cors(origin));
    return json({ paid: j.payment_status === 'paid', amount: j.amount_total ? j.amount_total / 100 : null, currency: j.currency || 'usd' }, 200, cors(origin));
  } catch { return json({ paid: false }, 200, cors(origin)); }
}
