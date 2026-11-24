// Small helpers shared by the Worker modules (Web Crypto only, no dependencies).
const enc = new TextEncoder();

export const b64url = bytes => {
  let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256Hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256B64url = async s => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** Constant-time string compare. */
export const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const cors = (origin = '*') => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
  'access-control-max-age': '86400',
  vary: 'origin',
});

/** Redirect URIs a client may register: https anywhere, or http on loopback (desktop clients). */
export function validRedirectUri(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.hash) return false;
  if (x.protocol === 'https:') return true;
  return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
}

export const bearerOf = req => { const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || ''); return m ? m[1] : null; };
