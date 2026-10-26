# Deploying Tokyo Circuit Racer on Cloudflare

The game is a static Three.js build (`dist/`) plus a tiny API Worker (`server/worker.ts`) for
player accounts. Both are deployed together as **one Cloudflare Worker with Static Assets** —
Cloudflare's current recommended way to host a site that also needs a backend. Game files are
served straight from Cloudflare's edge cache; only `/api/*` requests run code.

Accounts, career stats and saved race settings live in **Cloudflare D1** (serverless SQLite).
The tables are created automatically on the first API request — there is no migration step.

> GitHub is only used as the place Cloudflare pulls the code from. The game itself is hosted
> and served entirely by Cloudflare. If you'd rather not involve GitHub at all, use
> [Option B](#option-b--deploy-from-your-computer-no-github).

---

## Option A — Automatic deploys from GitHub (Workers Builds)

Every push to the production branch rebuilds and redeploys the game.

1. In the Cloudflare dashboard open **Workers & Pages → Create application → Import a repository**
   and pick `Godo-Bear/car-game23` (authorise the Cloudflare GitHub app if asked).
2. Fill in the build settings:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `tokyo-circuit-racer` — **must match `"name"` in `wrangler.jsonc`** |
   | Production branch | the branch that has the game code (currently `claude/upbeat-darwin-7hs593`, or `main` once it's merged) |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` (the default) |
   | Preview / non-production command | leave the default |
   | Root directory / path | leave empty (`/`) |

3. Click **Deploy**. When the build finishes the game is live at
   `https://tokyo-circuit-racer.<your-subdomain>.workers.dev`.

That's it — on the first deploy Wrangler sees the `DB` binding in `wrangler.jsonc` has no
`database_id` and **creates the `tokyo-racer` D1 database for you** and binds it. Log in /
Create account on the homescreen should work straight away.

### If the build says the D1 database couldn't be created

Create it once by hand and paste its ID into the config:

1. Dashboard → **Storage & Databases → D1 SQL Database → Create** → name it `tokyo-racer`.
2. Copy the **Database ID** and add it to `wrangler.jsonc`:
   ```jsonc
   "d1_databases": [
     { "binding": "DB", "database_name": "tokyo-racer", "database_id": "<paste-id-here>", "migrations_dir": "migrations" }
   ]
   ```
3. Commit and push — Cloudflare redeploys automatically.

---

## Option B — Deploy from your computer (no GitHub)

Requires Node.js 22+.

```bash
npm ci
npx wrangler login        # opens a browser to authorise Wrangler with your Cloudflare account
npm run deploy            # = npm run build && wrangler deploy
```

Wrangler prints the live `*.workers.dev` URL. Run `npm run deploy` again whenever you want to
publish changes.

---

## Custom domain

Workers & Pages → `tokyo-circuit-racer` → **Settings → Domains & Routes → Add → Custom domain**,
then enter a domain (or subdomain) that is on your Cloudflare account, e.g. `race.example.com`.
Cloudflare issues the HTTPS certificate automatically.

---

## Running the full stack locally

```bash
npm run dev        # game only (Vite, hot reload). Accounts fall back to a guest profile.
npm run dev:full   # builds, then runs the real Worker + a local D1 database via `wrangler dev`
```

`dev:full` serves on <http://localhost:8787>; the local database lives in `.wrangler/` (git-ignored).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build fails with a message about the Worker **name** not matching | Rename the Worker in the dashboard to `tokyo-circuit-racer`, or change `"name"` in `wrangler.jsonc` to match it. |
| Build fails during `npm ci` / `npm run build` | Make sure the build uses Node 22+: add an environment variable `NODE_VERSION` = `22` in the build settings. |
| Homescreen says *“Online accounts need the Cloudflare backend”* | The site is being served without the Worker (e.g. `npm run dev`), or the D1 binding is missing — see the D1 section above. |
| Log in works but stats don't update | Check **Workers & Pages → tokyo-circuit-racer → Logs** for API errors. |
| Want to inspect accounts | Dashboard → D1 → `tokyo-racer` → **Console**, e.g. `SELECT username, created_at FROM users;` |

### Security notes

- Passwords are hashed with PBKDF2-SHA256 (100k iterations, per-user salt); only a SHA-256 of
  each session token is stored, and sessions use `HttpOnly; Secure; SameSite=Lax` cookies.
- 10 failed sign-ins for a username lock it for 15 minutes. For stronger protection add a
  Cloudflare **WAF rate-limiting rule** on `/api/login`.
- Race results are submitted by the browser and sanity-checked, not cheat-proof — fine for a
  personal career record, not for a public leaderboard.
