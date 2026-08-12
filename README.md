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
  contracts/      Zero schema + permissions, shared custom mutators, zod API payloads
  client-runtime/ Per-platform Zero glue: store setup, auth token plumbing, blob queue
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

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`.

End-to-end sync proof (two Zero clients through zero-cache + Postgres, M1's
acceptance test — needs the dev stack running):

```sh
pnpm --filter server exec tsx scripts/sync-proof.mts
```

## Self-hosting

`docker compose up` runs the whole backend: API server + zero-cache + Postgres. Bring your own
OpenAI key and any S3-compatible bucket (see `.env.example`). Same images and code paths as the
hosted SaaS.
