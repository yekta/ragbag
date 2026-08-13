# Deploying ragbag on Railway

Target layout — three services plus a database, all under one registrable domain:

| host              | service      | public |
| ----------------- | ------------ | ------ |
| `app.ragbag.app`  | web (static) | yes    |
| `api.ragbag.app`  | server       | yes    |
| `zero.ragbag.app` | zero-cache   | yes    |
| —                 | Postgres     | no     |

**Why all three are public, and why they must share a domain.** The browser talks to the API
directly (no proxy) and opens the sync websocket to zero-cache directly. zero-cache authenticates
by forwarding the browser's better-auth session cookie to the API (`ZERO_*_FORWARD_COOKIES`), so
that cookie has to be visible on all three hosts. Sibling subdomains of `ragbag.app` are
_same-site_, so one cookie issued for `.ragbag.app` covers them and the default `SameSite=Lax`
still applies — nothing needs `SameSite=None`.

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

Give **zero-cache the direct connection string**, never a pooler — logical replication can't run
through pgbouncer. The API server is fine either way.

---

## 2. `server` → api.ragbag.app

| setting          | value                                        |
| ---------------- | -------------------------------------------- |
| Root Directory   | `/` (the lockfile and `catalog:` live there) |
| Builder          | Dockerfile, `apps/server/Dockerfile`         |
| Build / Start    | none — the Dockerfile does both              |
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
start script rather than calling `node` directly — its working directory is what makes the
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

Leave `DEV_LOGIN` unset — `env.ts` refuses to boot with it enabled in production, as it does with
the default `BETTER_AUTH_SECRET`.

No R2? Set `LOCAL_BLOB_DIR=/data/blobs` and mount a volume there instead. With neither, `/api/meta`
reports `blobs: false` and the composer disables attachments.

**Google Cloud console:** authorized redirect URI is `https://api.ragbag.app/api/auth/callback/google`
— the API host, not the app host.

---

## 3. `zero-cache` → zero.ragbag.app

Deploy from the image `rocicorp/zero:1.8.0`. No build, no watch paths.

| setting          | value              |
| ---------------- | ------------------ |
| Healthcheck path | `/keepalive`       |
| Target port      | `4848`             |
| Volume           | mounted at `/data` |

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

Only tables in the `zero_data` publication replicate to clients — that's deliberate (auth tables
stay server-side).

---

## 4. `web` → app.ragbag.app

Static build; no Dockerfile, no proxy.

| setting        | value                     |
| -------------- | ------------------------- |
| Root Directory | `/`                       |
| Build command  | `pnpm --filter web build` |
| Start command  | `pnpm --filter web start` |

`start` is `serve -s dist -l $PORT`. The `-s` is the SPA fallback — without it a hard refresh on
`/item/<id>` 404s, because the router uses history routing. `serve` is a runtime dependency of
`apps/web` (not a dev one) so a production prune can't remove it.

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
   authenticate.
6. Dump a note. The sidebar's sync dot should read **Synced**, and the item should survive a
   reload — that round trip is the proof zero-cache forwarded the cookie and the API accepted it.
7. Attach a file, confirm it uploads and the thumbnail renders (exercises presign + R2).
8. Hard-refresh on `/item/<id>` — must render, not 404.

## Notes

- The cross-origin client path (absolute API base, `credentials: "include"`, CORS, the Zero
  round-trip) was verified locally by serving the production bundle on one port against the API on
  another. The `COOKIE_DOMAIN` behaviour itself is verified from better-auth's source, not
  end-to-end — localhost has no registrable parent domain to test it with. Step 5 above is that
  check.
- Ingestion runs inside the API process (`INGEST_WORKER=true`). To isolate AI throughput from API
  latency later, deploy a second instance of the same image with `INGEST_WORKER=true` and set it to
  `false` on the API instances.
- `AI_USER_DAILY_BUDGET_USD` (default 1) caps per-user AI spend over a rolling 24h window and skips
  enrichment above it — it never fails ingestion.
