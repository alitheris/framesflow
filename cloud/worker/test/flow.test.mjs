// Integration test: run `npx wrangler dev --var DEV_AUTH:1 --var APP_URL:http://localhost:5173` first, then `npm test`.
// Plays both roles: an AI client doing the OAuth + MCP dance, and the studio tab answering over the relay WebSocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const APP = 'http://localhost:5173';
const up = await fetch(BASE + '/health').then(r => r.ok, () => false);
const t = up ? test : test.skip;
if (!up) console.log(`(worker not running at ${BASE} — skipping)`);

const b64url = b => Buffer.from(b).toString('base64url');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const user = 'dev_' + crypto.randomBytes(4).toString('hex');
const redirect = 'https://claude.ai/api/mcp/auth_callback';
const S = {}; // shared state across the ordered steps

const rpc = async (method, params, id = 1, token = S.access) => {
  const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return { status: r.status, headers: r.headers, body: r.status === 202 ? null : await r.json().catch(() => null) };
};

t('discovery documents point at this server', async () => {
  const pr = await (await fetch(BASE + '/.well-known/oauth-protected-resource')).json();
  assert.match(pr.resource, /^https?:\/\/[^/]+\/mcp$/); // (wrangler dev reports the route host; production reports https://mcp.framesflow.online)
  const as = await (await fetch(BASE + '/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.match(as.registration_endpoint, /\/register$/);
});

t('unauthenticated /mcp is 401 with a resource_metadata hint', async () => {
  const r = await rpc('initialize', {}, 1, null);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata=".*oauth-protected-resource"/);
});

t('dynamic client registration rejects unsafe redirect URIs and accepts good ones', async () => {
  const bad = await fetch(BASE + '/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
  assert.equal(bad.status, 400);
  const js = await fetch(BASE + '/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }) });
  assert.equal(js.status, 400);
  const ok = await fetch(BASE + '/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }) });
  assert.equal(ok.status, 201);
  S.client = (await ok.json()).client_id;
  assert.match(S.client, /^ffc_/);
});

t('authorize needs an exact redirect URI and PKCE S256', async () => {
  const q = (o) => `${BASE}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: S.client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', ...o });
  assert.equal((await fetch(q({ redirect_uri: 'https://evil.example/cb' }), { redirect: 'manual' })).status, 400, 'unregistered redirect must not redirect');
  const noPkce = await fetch(q({ code_challenge_method: 'plain' }), { redirect: 'manual' });
  assert.equal(noPkce.status, 302);
  assert.match(noPkce.headers.get('location'), /error=invalid_request/);
  const good = await fetch(q({}), { redirect: 'manual' });
  assert.equal(good.status, 302);
  const loc = new URL(good.headers.get('location'));
  assert.equal(loc.origin, APP);
  assert.match(loc.hash, /^#\/authorize\?req=/);
  S.req = new URLSearchParams(loc.hash.split('?')[1]).get('req');
});

t('consent page data + approval requires a valid signed-in user', async () => {
  const info = await (await fetch(`${BASE}/authorize/request/${S.req}`)).json();
  assert.equal(info.clientName, 'Claude');
  assert.equal(info.redirectHost, 'claude.ai');
  const anon = await fetch(BASE + '/authorize/approve', { method: 'POST', headers: { origin: APP }, body: JSON.stringify({ req: S.req }) });
  assert.equal(anon.status, 401);
  const ok = await fetch(BASE + '/authorize/approve', { method: 'POST', headers: { origin: APP, authorization: 'Bearer ' + user }, body: JSON.stringify({ req: S.req }) });
  assert.equal(ok.status, 200);
  const { redirect: back } = await ok.json();
  const u = new URL(back);
  assert.equal(u.origin + u.pathname, redirect);
  assert.equal(u.searchParams.get('state'), 'xyz');
  S.code = u.searchParams.get('code');
  assert.ok(S.code);
  const again = await fetch(BASE + '/authorize/approve', { method: 'POST', headers: { origin: APP, authorization: 'Bearer ' + user }, body: JSON.stringify({ req: S.req }) });
  assert.equal(again.status, 404, 'a request can only be approved once');
});

t('token endpoint verifies PKCE, is single-use, and rotates refresh tokens', async () => {
  const form = o => new URLSearchParams({ client_id: S.client, redirect_uri: redirect, ...o });
  const wrong = await fetch(BASE + '/token', { method: 'POST', body: form({ grant_type: 'authorization_code', code: S.code, code_verifier: 'x'.repeat(50) }) });
  assert.equal(wrong.status, 400, 'wrong verifier fails');
  const replay = await fetch(BASE + '/token', { method: 'POST', body: form({ grant_type: 'authorization_code', code: S.code, code_verifier: verifier }) });
  assert.equal(replay.status, 400, 'the code is burned even by a failed attempt');
  // fresh code for the positive path
  const a = await fetch(`${BASE}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: S.client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' }), { redirect: 'manual' });
  const req2 = new URLSearchParams(new URL(a.headers.get('location')).hash.split('?')[1]).get('req');
  const ap = await (await fetch(BASE + '/authorize/approve', { method: 'POST', headers: { origin: APP, authorization: 'Bearer ' + user }, body: JSON.stringify({ req: req2 }) })).json();
  const code2 = new URL(ap.redirect).searchParams.get('code');
  const tk = await fetch(BASE + '/token', { method: 'POST', body: form({ grant_type: 'authorization_code', code: code2, code_verifier: verifier }) });
  assert.equal(tk.status, 200);
  const tokens = await tk.json();
  assert.equal(tokens.token_type, 'Bearer');
  S.access = tokens.access_token; S.refresh = tokens.refresh_token;
  const rf = await fetch(BASE + '/token', { method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: S.refresh }) });
  assert.equal(rf.status, 200);
  const next = await rf.json();
  assert.notEqual(next.refresh_token, S.refresh);
  const old = await fetch(BASE + '/token', { method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: S.refresh }) });
  assert.equal(old.status, 400, 'the old refresh token is dead after rotation');
  S.access = next.access_token;
});

t('MCP initialize + tools/list works with no studio open (browser tools only)', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'framesflow');
  const n = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.access }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(n.status, 202);
  const list = await rpc('tools/list', {}, 2);
  const names = list.body.result.tools.map(x => x.name);
  assert.ok(names.includes('add_effect_layer') && names.includes('detach_audio'));
  assert.ok(!names.includes('download_youtube'), 'helper-only tools are hidden until a helper is attached');
  assert.ok(list.body.result.tools.every(x => x.inputSchema?.type === 'object'));
});

t('the skill tool is answered by the Worker itself, even with no studio open', async () => {
  const list = await rpc('tools/list', {}, 20);
  assert.ok(list.body.result.tools.some(x => x.name === 'get_framesflow_skill'));
  const r = await rpc('tools/call', { name: 'get_framesflow_skill', arguments: {} }, 21);
  assert.equal(r.body.result.isError, undefined);
  const out = JSON.parse(r.body.result.content[0].text);
  assert.equal(out.file, 'SKILL.md');
  assert.match(out.content, /Alitheris/);
  assert.ok(out.available.includes('references/cash-cow-documentaries.md'));
  const ref = await rpc('tools/call', { name: 'get_framesflow_skill', arguments: { file: 'references/cash-cow-documentaries.md' } }, 22);
  assert.match(JSON.parse(ref.body.result.content[0].text).content, /Hook \(0.{1,3}15 s\)/);
  const bad = await rpc('tools/call', { name: 'get_framesflow_skill', arguments: { file: '../../etc/passwd' } }, 23);
  assert.equal(bad.body.result.isError, true);
});

t('calling a tool with no studio open explains what to do', async () => {
  const r = await rpc('tools/call', { name: 'get_project', arguments: {} }, 3);
  assert.equal(r.body.result.isError, true);
  assert.match(r.body.result.content[0].text, /not open/i);
});

t('relay: the studio tab connects, announces its tools, answers calls', async () => {
  const bad = await new Promise(res => { const w = new WebSocket(BASE.replace('http', 'ws') + '/ws', ['bearer.not_a_user']); w.onerror = () => res('rejected'); w.onopen = () => { w.close(); res('opened'); }; });
  assert.equal(bad, 'rejected');
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', ['bearer.' + user]);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
  assert.equal(ws.protocol, 'bearer.' + user, 'server must echo the chosen subprotocol');
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type !== 'call') return;
    if (m.name === 'get_project') ws.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: { name: 'My video', echoed: m.args, _images: [{ mimeType: 'image/png', data: 'AAAA' }] } }));
    else ws.send(JSON.stringify({ type: 'result', id: m.id, ok: false, error: 'boom' }));
  };
  ws.send(JSON.stringify({ type: 'hello', tools: '*', project: 'My video' }));
  await new Promise(r => setTimeout(r, 300));
  const list = await rpc('tools/list', {}, 4);
  assert.ok(list.body.result.tools.some(x => x.name === 'download_youtube'), 'with a helper attached ("*") every tool is offered');
  const ok = await rpc('tools/call', { name: 'get_project', arguments: { limit: 3 } }, 5);
  assert.equal(ok.body.result.isError, undefined);
  assert.match(ok.body.result.content[0].text, /My video/);
  assert.match(ok.body.result.content[0].text, /"limit": 3/);
  assert.equal(ok.body.result.content[1].type, 'image');
  const fail = await rpc('tools/call', { name: 'split_clip', arguments: {} }, 6);
  assert.equal(fail.body.result.isError, true);
  assert.match(fail.body.result.content[0].text, /boom/);
  const unknown = await rpc('tools/call', { name: 'rm_rf', arguments: {} }, 7);
  assert.equal(unknown.body.error.code, -32602);
  S.ws = ws;
});

t('a second tab replaces the first, and users are isolated from each other', async () => {
  const closed = new Promise(res => { S.ws.onclose = e => res(e.code); });
  const ws2 = new WebSocket(BASE.replace('http', 'ws') + '/ws', ['bearer.' + user]);
  await new Promise(r => { ws2.onopen = r; });
  assert.equal(await closed, 4000);
  ws2.onmessage = ev => { const m = JSON.parse(ev.data); ws2.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: { tab: 2 } })); };
  const r = await rpc('tools/call', { name: 'get_project', arguments: {} }, 8);
  assert.match(r.body.result.content[0].text, /"tab": 2/);
  // another account has no tab: it must NOT reach user #1's studio
  const other = 'dev_' + crypto.randomBytes(4).toString('hex');
  const a = await fetch(`${BASE}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: S.client, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' }), { redirect: 'manual' });
  const rq = new URLSearchParams(new URL(a.headers.get('location')).hash.split('?')[1]).get('req');
  const ap = await (await fetch(BASE + '/authorize/approve', { method: 'POST', headers: { origin: APP, authorization: 'Bearer ' + other }, body: JSON.stringify({ req: rq }) })).json();
  const tk = await (await fetch(BASE + '/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: S.client, redirect_uri: redirect, code: new URL(ap.redirect).searchParams.get('code'), code_verifier: verifier }) })).json();
  const iso = await rpc('tools/call', { name: 'get_project', arguments: {} }, 9, tk.access_token);
  assert.match(iso.body.result.content[0].text, /not open/i, 'user B must not reach user A\'s tab');
  ws2.close();
});

