// Needs the Worker running with: --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://127.0.0.1:54399 --var APP_URL:http://localhost:5173
// A mock Stripe API is started here, so no real Stripe account or network is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const cfg = await fetch(BASE + '/donate/config').then(r => r.json(), () => null);
const t = cfg?.enabled ? test : test.skip;
if (!cfg?.enabled) console.log('(worker not running with STRIPE_SECRET_KEY — skipping donation tests)');

const seen = [];
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, form: Object.fromEntries(new URLSearchParams(body)) });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_test_abc12345', url: 'https://checkout.stripe.com/c/pay/cs_test_abc12345' }));
    if (req.method === 'GET' && req.url === '/v1/checkout/sessions/cs_test_abc12345') return res.end(JSON.stringify({ id: 'cs_test_abc12345', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata: { source: 'framesflow.online' } }));
    if (req.method === 'GET' && req.url === '/v1/checkout/sessions/cs_test_other9999') return res.end(JSON.stringify({ id: 'cs_test_other9999', payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: {} }));
    res.statusCode = 404; res.end('{}');
  });
});
if (cfg?.enabled) await new Promise(r => stripe.listen(54399, '127.0.0.1', r));
test.after(() => stripe.close());

const donate = (amount, extra = {}) => fetch(BASE + '/donate', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ amount, ...extra }) });

t('config advertises the $5 minimum and presets', () => {
  assert.equal(cfg.minUsd, 5); assert.equal(cfg.currency, 'usd'); assert.deepEqual(cfg.presets.slice(0, 2), [5, 10]); assert.ok(cfg.maxUsd >= 100000);
});

t('amounts below $5 and junk are rejected before Stripe is ever called', async () => {
  const before = seen.length;
  for (const bad of [4.99, 0, -10, 'abc', null, '', 1e9, 1000000, NaN]) {
    const r = await donate(bad);
    assert.equal(r.status, 400, `amount ${JSON.stringify(bad)} must be rejected`);
    assert.match((await r.json()).error, /\$5/);
  }
  assert.equal(seen.length, before, 'no Stripe call for invalid amounts');
});

t('a valid amount creates a donate-style Checkout Session with exactly that amount', async () => {
  const r = await donate(25, { unit_amount: 1, mode: 'subscription', success_url: 'https://evil.example' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal((await r.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_abc12345');
  const call = seen.at(-1);
  assert.equal(call.auth, 'Bearer sk_test_mock');
  assert.equal(call.form.mode, 'payment');
  assert.equal(call.form.submit_type, 'donate');
  assert.equal(call.form['line_items[0][price_data][unit_amount]'], '2500', 'client-supplied extras must not override the validated amount');
  assert.equal(call.form['line_items[0][price_data][currency]'], 'usd');
  assert.equal(call.form.success_url, 'http://localhost:5173/#/thanks?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(call.form.cancel_url, 'http://localhost:5173/#/support');
});

t('cents, strings, dollar signs and big amounts convert exactly', async () => {
  const cases = [[5, '500'], [12.5, '1250'], ['$1,000', '100000'], ['7.255', '726'], [999999.99, '99999999']];
  for (const [input, cents] of cases) {
    const r = await donate(input); assert.equal(r.status, 200, `${input} should be accepted`);
    assert.equal(seen.at(-1).form['line_items[0][price_data][unit_amount]'], cents);
  }
});

t('thank-you page lookup reports paid sessions, and only ours', async () => {
  const ok = await (await fetch(BASE + '/donate/session/cs_test_abc12345')).json();
  assert.deepEqual(ok, { paid: true, amount: 25, currency: 'usd' });
  assert.deepEqual(await (await fetch(BASE + '/donate/session/cs_test_other9999')).json(), { paid: false }, 'sessions without our metadata are not disclosed');
  assert.deepEqual(await (await fetch(BASE + '/donate/session/not-a-session')).json(), { paid: false });
});
