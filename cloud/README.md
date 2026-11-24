# Framesflow cloud: Google login, one-link MCP and contributions (free tier)

What this adds to **framesflow.online**:

* **Sign in with Google** (Supabase Auth). The studio and the AI-connect page need a signed-in user.
* **One MCP link** for the user's AI app: `https://mcp.framesflow.online/mcp`. The AI app opens a login/consent page on your site once, and from then on edits **that user's open studio tab**. The link also serves the **Framesflow skill** (`get_framesflow_skill`) with no studio open.
* **Projects follow the account**: the project JSON (never media files) is saved to the user's own Supabase rows.
* **Contributions**: a Support page where anyone can contribute **$5 or more (no maximum)** through **your own Stripe account** (Stripe Checkout; card data never touches your site or Worker).

```
Claude ──OAuth + MCP──▶ mcp.framesflow.online (Cloudflare Worker + Durable Object) ──WebSocket──▶ the user's open studio tab
                                  ▲ login/consent                                                   │ runs the tools on their project
                                  └── framesflow.online/#/authorize ── Supabase (Google) ◀──────────┘ saves project JSON
Support page ──amount──▶ Worker /donate ──▶ Stripe Checkout (hosted by Stripe) ──▶ framesflow.online/#/thanks
```

Everything below fits the free plans (Supabase Free, Cloudflare Workers Free; Stripe charges its normal per-payment fees).

## 1. Supabase (login + project storage), about 5 minutes
1. https://supabase.com → **New project** (pick a region near your users). Save the database password somewhere safe.
2. **SQL Editor** → paste the contents of `supabase/schema.sql` → **Run**.
3. **Authentication → URL Configuration**: *Site URL* `https://framesflow.online`; *Redirect URLs* add `https://framesflow.online/**` (and `http://localhost:5173/**` for development).
4. **Google sign-in**: Google Cloud Console → *APIs & Services → Credentials → Create OAuth client ID → Web application*.
   *Authorized redirect URI:* `https://<your-project-ref>.supabase.co/auth/v1/callback` (copy it from Supabase → Authentication → Providers → Google).
   Paste the Google **Client ID** and **Client secret** into that Supabase page and enable it.
5. **Project settings → API**: copy the **Project URL** and the **anon public** key (it is safe in a browser; Row Level Security protects the data).

## 2. Cloudflare (the hosted MCP link + contributions), about 10 minutes
1. Free account at https://dash.cloudflare.com → **Add a site** → `framesflow.online` (Free plan). At your domain registrar change the nameservers to the two Cloudflare gives you. (Needed so `mcp.framesflow.online` can point at the Worker.)
2. In this folder:
   ```bash
   cd cloud/worker
   npm install
   npx wrangler login
   npx wrangler kv namespace create OAUTH      # prints an id
   ```
3. Edit `wrangler.toml`: paste the KV `id`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` from step 1. `APP_URL` is already `https://framesflow.online`.
4. **Stripe key** (for contributions), stored as a secret, never in a file:
   * Stripe Dashboard → *Developers → API keys → Create restricted key*. Give it **Checkout Sessions: Write** (and Read). Nothing else. Copy the key (`rk_live_…`; use `rk_test_…` first to try it in test mode).
   * `npx wrangler secret put STRIPE_SECRET_KEY` and paste it.
5. Deploy (this regenerates the tool list and the bundled skill first):
   ```bash
   npm run deploy
   ```
   Wrangler creates the custom domain `mcp.framesflow.online` automatically. Check `https://mcp.framesflow.online/health` and `https://mcp.framesflow.online/donate/config` (it should say `"enabled": true`).
6. Optional hardening: in Cloudflare → *Security → WAF → Rate limiting rules*, limit `POST /donate` (for example 10 requests per minute per IP) so nobody can spam Checkout Sessions.

## 3. The studio website
1. Edit `web/public/config.json`:
   ```json
   { "supabaseUrl": "https://<ref>.supabase.co", "supabaseAnonKey": "<anon key>", "mcpUrl": "https://mcp.framesflow.online", "contactEmail": "you@example.com" }
   ```
   `contactEmail` is shown on the Terms and Privacy pages. While `supabaseUrl` is empty the site works exactly as before (no login).
2. `npm run build`, then publish `web/dist` to **framesflow.online** (Cloudflare Pages or Netlify; both free; the repo already has a `netlify.toml`).

## 4. Try a contribution
In Stripe **test mode** use card `4242 4242 4242 4242`, any future date, any CVC. Open `https://framesflow.online/#/support`, pick an amount, contribute, and check the payment in the Stripe Dashboard. Then switch to the live restricted key.

## 5. Connect an AI
* **Claude (web/desktop):** Settings → Connectors → *Add custom connector* → `https://mcp.framesflow.online/mcp` → sign in with Google on the page that opens → Allow.
* **Claude Code:** `claude mcp add --transport http framesflow https://mcp.framesflow.online/mcp`, then `/mcp` → Authenticate.

The user keeps their studio open in a browser tab. The account menu (top right) shows **AI link connected**. Without the local helper the browser can run the editing tools (51 of them); with the helper running on the same computer every tool works (YouTube, rendering, image search, HTML animations).

## Local development / tests
```bash
cd cloud/worker
npx wrangler dev --var DEV_AUTH:1 --var APP_URL:http://localhost:5173 --var STRIPE_SECRET_KEY:sk_test_mock --var STRIPE_API_BASE:http://127.0.0.1:54399
npm test        # OAuth + MCP + relay + skill + contribution tests (each skips itself if the dev server is down)
```
`DEV_AUTH` accepts fake `dev_<id>` tokens and must never be set in production. The contribution tests start their own mock Stripe API.

## Security notes
* The Worker stores only OAuth state (hashed tokens, short lived). It never sees projects or media; tool calls run in the user's own browser tab, so an AI can only do what that user's tab can do.
* Access tokens last 1 hour, refresh tokens 30 days and rotate on use. Authorization codes are single-use and PKCE (S256) is mandatory.
* Redirect URIs must be `https://` (or loopback `http://` for desktop apps) and must match exactly what was registered.
* Contributions: the $5 minimum is enforced on the server, the amount comes only from the validated request, and Stripe hosts the payment page.
* One active studio tab per account: a newer tab replaces the older one.
* Free-tier limits to be aware of: Workers 100,000 requests/day; Supabase free projects pause after a week of inactivity (they wake on the next login).
