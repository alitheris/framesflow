// One StudioRelay Durable Object per user. The user's open studio tab keeps a WebSocket here; MCP tool calls
// arrive from the Worker (/call) and are forwarded to that tab, which runs them on the user's project and replies.
import { DurableObject } from 'cloudflare:workers';

const CALL_TIMEOUT_MS = 85000;
const NO_TAB = 'Your Framesflow studio is not open. Open the studio in your browser, sign in with the same account and keep the tab open, then try again.';

export class StudioRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map(); // call id -> { resolve, timer }
    // keep-alive pings from the tab are answered without waking the object
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      // one active studio tab per account: a new connection replaces the old one
      for (const old of this.ctx.getWebSockets()) { try { old.close(4000, 'replaced by a newer tab'); } catch { /* already closed */ } }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      const headers = {};
      const proto = request.headers.get('X-Chosen-Protocol');
      if (proto) headers['Sec-WebSocket-Protocol'] = proto;
      return new Response(null, { status: 101, webSocket: pair[0], headers });
    }

    if (url.pathname === '/info') {
      const connected = this.ctx.getWebSockets().length > 0;
      const hello = connected ? await this.ctx.storage.get('hello') : null;
      return this.json({ connected, tools: hello?.tools ?? null, project: hello?.project ?? null });
    }

    if (url.pathname === '/call' && request.method === 'POST') {
      const { name, args } = await request.json();
      const sockets = this.ctx.getWebSockets();
      if (!sockets.length) return this.json({ ok: false, error: NO_TAB, code: 'no_tab' });
      const id = crypto.randomUUID();
      const result = new Promise(resolve => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'The studio did not answer in time. If the tool is long-running, call get_job to follow it.', code: 'timeout' }); }, CALL_TIMEOUT_MS);
        this.pending.set(id, { resolve, timer });
      });
      try { sockets[0].send(JSON.stringify({ type: 'call', id, name, args: args || {} })); }
      catch { const p = this.pending.get(id); clearTimeout(p?.timer); this.pending.delete(id); return this.json({ ok: false, error: NO_TAB, code: 'no_tab' }); }
      return this.json(await result);
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    let m; try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch { return; }
    if (m.type === 'hello') {
      const tools = m.tools === '*' ? '*' : Array.isArray(m.tools) ? m.tools.slice(0, 500).map(String) : null;
      await this.ctx.storage.put('hello', { tools, project: typeof m.project === 'string' ? m.project.slice(0, 120) : null, at: Date.now() });
    } else if (m.type === 'result' && typeof m.id === 'string') {
      const p = this.pending.get(m.id);
      if (p) { clearTimeout(p.timer); this.pending.delete(m.id); p.resolve(m.ok ? { ok: true, result: m.result } : { ok: false, error: String(m.error || 'Tool failed') }); }
    }
  }

  async webSocketClose(ws, code, reason) { try { ws.close(code, reason); } catch { /* already closed */ } }
  async webSocketError() { /* the close handler cleans up */ }
}
