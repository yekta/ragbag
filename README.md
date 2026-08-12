# ragbag

An info-dump app with a message-like interface. Dump anything — links, photos, notes, PDFs,
screenshots — and it gets indexed intelligently so everything is searchable later. A smart
bookmark / second-brain hybrid.

**Stack:** TypeScript pnpm monorepo · React web (also the Electron renderer, later) · Expo mobile
(later) · Node/Hono API · Postgres + pgvector · [Zero](https://zero.rocicorp.dev) for local-first
sync · Cloudflare R2 (S3 API) for blobs · OpenAI for enrichment/search · better-auth (Google).

## Layout

```
apps/
  web/            React 19 + Vite + TanStack Router + Tailwind v4
  server/         Hono API: auth, Zero /query + /mutate, blob presigning, ingestion
packages/
  contracts/      Zero schema, shared synced queries + custom mutators, zod API payloads
  client-runtime/ Per-platform Zero glue: store setup, blob upload queue + cache,
                  Tier-1 local search index
  shared/         Small pure utilities (ids, urls, mime, time, logging)
```

`apps/desktop`, `apps/mobile`, and `apps/marketing` arrive in later milestones (M5/M6).
Internal packages export raw `.ts` — no build step for packages.

## Development

Prereqs: Node ≥ 22, pnpm 11 (`corepack enable`), Docker (for Postgres).

```sh
pnpm install
cp .env.example .env          # defaults work for local dev; DEV_LOGIN=true
docker compose up -d postgres # Postgres 17 + pgvector, wal_level=logical
pnpm dev                      # turbo: API server (:3001) + web (:5173)
pnpm dev:zero-cache           # zero-cache (:4848), in a second terminal
```

The server runs drizzle migrations on boot (creates tables + the `zero_data`
publication zero-cache replicates). The web dev server proxies `/api` to the API
server so auth cookies stay first-party. Sign-in is Google OAuth (set
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); with `DEV_LOGIN=true` a dev-only
anonymous sign-in button appears so sync can be exercised without credentials.

**Blobs** go straight to R2/S3 via presigned URLs. With no bucket configured,
the server falls back to local-disk storage (`LOCAL_BLOB_DIR`, default
`.data/blobs` in dev) served through HMAC-presigned URLs — so file dumps work
out of the box.

**Ingestion** runs inside the API process (`INGEST_WORKER=false` to disable): a
Postgres job queue (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`) feeds the
classify → extract → enrich → index pipeline. Without `OPENAI_API_KEY` it still
extracts and indexes content; AI summaries, tags, and embeddings are skipped.
Embeddings additionally need pgvector (the compose image has it; a bare local
Postgres may not — migration `0002` adapts either way).

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`.

Acceptance proofs (each needs the dev stack running — postgres + server, plus
zero-cache for the two that sync):

```sh
cd apps/server
pnpm exec tsx scripts/sync-proof.mts    # M1: two Zero clients through zero-cache
pnpm exec tsx scripts/blob-proof.mts    # M2: presign → upload → dedupe → download
pnpm exec tsx scripts/ingest-proof.mts  # M4: dump → queue → extract → index → sync
```

## Self-hosting

`docker compose up` runs the whole backend: API server + zero-cache + Postgres. Bring your own
OpenAI key (optional — without it, ingestion skips the AI stages) and any S3-compatible bucket
(optional too — blobs otherwise land on a mounted volume). See `.env.example`. Same images and
code paths as the hosted SaaS.
