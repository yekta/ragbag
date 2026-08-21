# Deploying ragbag on Railway

Target layout: three services plus a database, all under one registrable domain:

| host              | service      | public |
| ----------------- | ------------ | ------ |
| `app.ragbag.app`  | web (static) | yes    |
| `api.ragbag.app`  | server       | yes    |
| `zero.ragbag.app` | zero-cache   | yes    |
| (internal)        | Postgres     | no     |

**Why all three are public, and why they must share a domain.** The browser talks to the API
directly (no proxy) and opens the sync websocket to zero-cache directly. zero-cache authenticates
by forwarding the browser's better-auth session cookie to the API (`ZERO_*_FORWARD_COOKIES`), so
that cookie has to be visible on all three hosts. Sibling subdomains of `ragbag.app` are
_same-site_, so one cookie issued for `.ragbag.app` covers them and the default `SameSite=Lax`
still applies: nothing needs `SameSite=None`.

> This does **not** work on Railway's default `*.up.railway.app` domains. `up.railway.app` is on
> the Public Suffix List, so those hosts are separate sites and cannot share a cookie at all. Add
> the custom domains before testing sign-in, or you'll debug a problem that has no fix at that
> layer.

---

## 1. Postgres

Zero replicates via logical decoding, and the ingest pipeline stores embeddings.

```sql
SHOW wal_level;                 -- must be 'logical'
CREATE EXTENSION IF NOT EXISTS vector;
```

Give **zero-cache the direct connection string**, never a pooler: logical replication can't run
through pgbouncer. The API server is fine either way.

---

## 2. `server` → api.ragbag.app

| setting          | value                                        |
| ---------------- | -------------------------------------------- |
| Root Directory   | `/` (the lockfile and `catalog:` live there) |
| Builder          | Dockerfile, `apps/server/Dockerfile`         |
| Build / Start    | none: the Dockerfile does both               |
| Healthcheck path | `/health`                                    |
| Target port      | `3001`                                       |
| Replicas         | **1**                                        |

Watch paths:

```
apps/server/**
packages/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
```

Without Docker: build `pnpm --filter server build`, start `pnpm --filter server start`. Keep that
start script rather than calling `node` directly: its working directory is what makes the
migrator's `./drizzle` path resolve.

`PORT=3001` is set explicitly so the private URL other services use is stable.

Replicas stay at 1: `MIGRATE_ON_START` runs drizzle migrations during boot, and concurrent
migrators race. Scale out only after moving migrations to a release step.

```
NODE_ENV=production
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
BETTER_AUTH_SECRET=<32+ random bytes>
BETTER_AUTH_URL=https://api.ragbag.app
WEB_ORIGIN=https://app.ragbag.app
COOKIE_DOMAIN=.ragbag.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
OPENAI_API_KEY=...
R2_ENDPOINT=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=...
```

Leave `DEV_LOGIN` unset: `env.ts` refuses to boot with it enabled in production, as it does with
the default `BETTER_AUTH_SECRET` and with a **missing `OPENAI_API_KEY`**. Enrichment (summaries,
tags, semantic search) is a core feature, not an add-on: a keyless server used to boot happily and
silently return extraction-only items forever, which reads as a dead app. Now it refuses to start
and names the variable. The boot log states which way it went: `AI enrichment enabled` (with the
models) or, in dev only, `AI enrichment DISABLED`.

No R2? Set `LOCAL_BLOB_DIR=/data/blobs` and mount a volume there instead. With neither, `/api/meta`
reports `blobs: false` and the composer disables attachments.

**R2 bucket CORS, required for browser uploads.** Blob bytes move straight between the browser
and the bucket via presigned URLs, which is a cross-origin request: without a CORS policy on the
bucket, every upload dies in the preflight while everything server-side (ingest, proofs,
`/api/debug/storage`) works, the classic "stuck uploading forever" deploy bug. The API applies
the policy itself on boot when its token can (look for `bucket CORS ready` in the logs). With an
object-scoped token it can't; the log then prints `bucket CORS could not be configured` and this
policy must be added by hand (Cloudflare dashboard → R2 → bucket → Settings → CORS policy):

```json
[
  {
    "AllowedOrigins": ["https://app.ragbag.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Verify from anywhere (expects `access-control-allow-origin` in the response):

```
curl -si -X OPTIONS "$R2_ENDPOINT/$R2_BUCKET/any-key" \
  -H "Origin: https://app.ragbag.app" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" | head -20
```

`GET /api/debug/storage` reports the active driver, a server-side roundtrip, and what the boot-time
CORS check concluded: if the roundtrip passes while browser uploads fail, CORS is the culprit.

**Google Cloud console:** authorized redirect URI is `https://api.ragbag.app/api/auth/callback/google`,
the API host, not the app host. The Expo app needs no second entry there: it opens that same
URL, and `@better-auth/expo` hands the result back to the app's own scheme afterwards.

**`MOBILE_SCHEME`** has to match `scheme` in `apps/mobile/app.config.ts` (`ragbag` by default).
better-auth refuses a callback to a scheme that is not in `trustedOrigins`, and that list is
built from this variable (`apps/server/src/auth.ts`). A mismatch shows up as a sign-in that
opens the browser, completes at Google, and never comes back.

---

## 3. `zero-cache` → zero.ragbag.app

Deploy from the image `rocicorp/zero:1.8.0`. No build, no watch paths.

| setting          | value              |
| ---------------- | ------------------ |
| Healthcheck path | `/keepalive`       |
| Target port      | `4848`             |
| Volume           | mounted at `/data` |

Add the custom domain `zero.ragbag.app` on this service (port `4848`) and the matching DNS
record, same as the other two. It is easy to skip because nothing server-side complains: the app
loads, and the only symptom is the sync websocket failing with `WebSocket connection closed
abruptly`, which is what a browser reports for an unresolvable host.

Give it a long healthcheck grace period: the first boot replicates the whole database into its
SQLite replica and can take minutes. Without the volume it redoes that on every deploy.

```
ZERO_UPSTREAM_DB=<direct, non-pooled Postgres URL>
ZERO_REPLICA_FILE=/data/replica.db
ZERO_APP_PUBLICATIONS=zero_data
ZERO_ADMIN_PASSWORD=<required in production>
ZERO_MUTATE_URL=http://server.railway.internal:3001/api/zero/mutate
ZERO_QUERY_URL=http://server.railway.internal:3001/api/zero/query
ZERO_MUTATE_FORWARD_COOKIES=true
ZERO_QUERY_FORWARD_COOKIES=true
ZERO_ENABLE_CRUD_MUTATIONS=false
```

Only tables in the `zero_data` publication replicate to clients; that's deliberate (auth tables
stay server-side).

---

## 4. `web` → app.ragbag.app

Static build; no Dockerfile, but it does need one proxy rule (see **media**, below).

| setting        | value                     |
| -------------- | ------------------------- |
| Root Directory | `/`                       |
| Build command  | `pnpm --filter web build` |
| Start command  | `pnpm --filter web start` |

`start` is `serve -s dist -l $PORT`. The `-s` is the SPA fallback, and it is load-bearing: every
view in the app is a real path (`/favorites`, `/images`, `/links`, `/tags/<id>`,
`/links/tags/<id>`, …) matched by the router in the browser, so without it a hard refresh on
any of them 404s. What is open over a view is a query param (`?message=<id>`, `?settings=true`),
which needs nothing from the host. `serve` is a runtime dependency of `apps/web` (not a dev one)
so a production prune can't remove it. Hosts that read `_redirects` (Netlify, Cloudflare Pages) get the same rule
from `apps/web/public`; on anything else, point unmatched paths at `index.html` with a **200**, not
a 301.

**Fonts need a cache rule, and it does not come for free.** The app self-hosts both families from
`/fonts` (the argument is at the top of `apps/web/src/fonts.css`). `serve` sends an `ETag` and no
`Cache-Control` at all, which means a conditional request for every face on every load: the round
trip self-hosting exists to avoid. `apps/web/public/serve.json` pins that directory for a year, and
`public/_headers` says the same thing for hosts that read Netlify-style headers instead. On any
other host, set it by hand:

```
/fonts/*   Cache-Control: public, max-age=31536000, immutable
```

`immutable` is safe here only because each filename carries the font's upstream version. Nothing
under `public/` is content-hashed by Vite, so replacing those bytes without renaming the file
strands every browser that already holds it. Check it after a deploy:

```
curl -sI https://app.ragbag.app/fonts/schibsted-grotesk-v7.woff2 | grep -i cache-control
```

**Media addresses the API directly; there is nothing to configure.** Every picture's `src` is
`<VITE_API_URL>/api/media/<blobId>/<variant>` (plan §6.3): one stable string, so the browser can
cache it, lazy-load it, decode it off the main thread and evict it on its own. The media service
worker (`public/media-sw.js`) intercepts exactly that URL and presigns the bytes itself; it is a
static file, so where the API lives reaches it through its own registration URL.

It did not always work that way, and the failure is worth knowing because it is invisible from the
server side. The path used to be origin-relative, which made the web host responsible for routing
`/api/media/*` and `/api/blobs/download-urls` to the API. `serve` (this app's own start command)
cannot proxy anything, so it answered both with `index.html` and a 200, and an `<img>` handed HTML
fires `error`. Every picture then fell back to fetching its untouched original through JS:
megabytes per tile instead of a 30 KB thumbnail, no native lazy loading, and nothing at all to show
where the browser cannot decode a camera HEIC. That was the "photos stay blurred forever" bug. A
host that serves the SPA fallback is now the whole requirement.

`VITE_API_URL` therefore carries media too. It must be the API's public origin, and like every
`VITE_*` value it is baked into the bundle at build time. Both hosts are separate origins under one
registrable domain, which is _same-site_, so the session cookie rides on these requests under
ordinary `SameSite=Lax` rules, exactly as it does for the rest of the API.

Verify after a deploy that the API itself answers, and that the app host is not answering for it:

```
curl -si https://api.ragbag.app/api/media/x/thumb | head -3   # 401 JSON: the route is reachable
curl -sI https://app.ragbag.app/api/media/x/thumb | head -3   # text/html is fine and unused now
```

Watch paths:

```
apps/web/**
packages/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
```

```
VITE_API_URL=https://api.ragbag.app
VITE_ZERO_CACHE_URL=https://zero.ragbag.app
```

Both are **baked into the bundle at build time**. Changing either needs a redeploy; a restart does
nothing.

---

## 5. Smoke test after the first deploy

1. `GET https://api.ragbag.app/health` → `{"ok":true}`.
2. `GET https://zero.ragbag.app/keepalive` → 200.
3. `GET https://api.ragbag.app/api/meta` → `googleAuth: true`, `blobs: true`, `devLogin: false`.
4. Open `https://app.ragbag.app`, sign in with Google. Land back on **app**, not api.
5. Check the cookie in devtools: `__Secure-better-auth.session_token`, `Domain=.ragbag.app`.
   If the domain is `api.ragbag.app` instead, `COOKIE_DOMAIN` didn't take and sync will not
   authenticate: zero-cache has no cookie to forward, so `/api/zero/query` 401s and the client
   reports `ProtocolError: Fetch from API server returned non-OK status 401`. Checkable without
   signing in: `curl -i -X POST https://api.ragbag.app/api/auth/sign-in/social -H 'content-type:
application/json' -d '{"provider":"google","callbackURL":"https://app.ragbag.app/"}'`: the
   `__Secure-better-auth.state` cookie it sets carries the same `Domain` attribute the session
   cookie will.
6. Send a note. The sidebar's sync dot should read **Synced**, and the item should survive a
   reload: that round trip is the proof zero-cache forwarded the cookie and the API accepted it.
7. Attach a file: the chip appears instantly, shows an upload progress ring, and settles
   (exercises presign + R2 + bucket CORS). If it goes red with "The storage bucket blocked the
   browser's upload", the bucket CORS policy is missing, see §2, and `GET /api/debug/storage`
   to confirm the server side is fine.
8. Attach a photo, then open **Images** on a _second_ device. The tile must sharpen within a
   second or two, and the network panel must show a small `api.../api/media/<id>/thumb` fetch. A
   tile that stays blurred while a multi-megabyte `/api/blobs/<id>/download-url` runs is the media
   path failing over to originals: check `VITE_API_URL` and §4.
9. Hard-refresh on `/notes` and on `/item/<id>`: both must render the app (filtered, and with the
   detail drawer open), not 404.
10. Open that note's detail view: an **AI summary and tags** must appear within a few seconds
    (enrichment is the slow stage, the `ingested` log line goes from ~30ms to seconds when AI is
    really running). If a summary never comes, the detail view now says why, and
    `GET /api/debug/ingest` reports worker liveness, queue depth, recent job errors and whether AI
    is configured at all.

## Notes

- The cross-origin client path (absolute API base, `credentials: "include"`, CORS, the Zero
  round-trip) was verified locally by serving the production bundle on one port against the API on
  another. The `COOKIE_DOMAIN` behaviour itself is verified from better-auth's source, not
  end-to-end: localhost has no registrable parent domain to test it with. Step 5 above is that
  check.
- Ingestion runs inside the API process (`INGEST_WORKER=true`). To isolate AI throughput from API
  latency later, deploy a second instance of the same image with `INGEST_WORKER=true` and set it to
  `false` on the API instances.
- AI spend is metered per user (the `ai_usage_events` table prices every call) but never capped.
  Enrichment always runs when a key is configured. `GET /api/debug/ingest` reports the caller's
  last-24h spend. Prompt-cache reads and writes are priced at their own rates, so the figure is
  not a token count multiplied by one number.
- `AI_ENRICH_MODEL` and `AI_TRANSCRIBE_MODEL` are validated at boot against the allow-list in
  `ingest/models.ts`. A value outside it refuses to start, which is deliberate: an unpriceable
  model meters every call at $0.00 and a misspelled one 404s on every message, both of them
  quietly for the life of the deploy.
- AI stages fail **soft**: a bad key, an unavailable model or a rate limit leaves the extraction
  intact, marks the item `done`, and records a classified reason (`OpenAI rejected the API key
(401)`, `OpenAI has no such model for this account (404)`, …) that the item's detail view shows
  next to a **Run enrichment** button. They never burn ingest retries or discard extracted text.
- Items that finished without a summary (e.g. everything sent while a server ran keyless) don't
  re-run on their own: they're `done`. The sidebar offers **Enrich N items**, which re-queues them
  in bulk from the client (up to 250 per click).
