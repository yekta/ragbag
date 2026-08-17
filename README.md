# ragbag

A local-first info-dump app. Drop anything (links, photos, notes, PDFs, screenshots, voice
notes) into a chat-like box; an AI pipeline understands it, and it becomes searchable
offline, forever.

The unit of capture is a **message**: free text plus up to ten ordered attachments, sent in
one action, exactly like a chat. Ingestion runs in two phases: each attachment is
understood on its own (vision on images, the text layer or the model on PDFs, transcription
on audio), then a synthesis pass reads the whole message and pulls out **entities**: links,
addresses, tracking numbers, invoices, emails, phones, as canonical, deduplicated things
with their own titles, summaries and tags. Search is local only, and it is complete: the
whole archive lives on every device.

**Stack:** TypeScript pnpm monorepo · React web (also the Electron renderer, later) · Expo
mobile (later) · Node/Hono API · Postgres · [Zero](https://zero.rocicorp.dev) for local-first
sync · Cloudflare R2 (S3 API) for blobs · OpenAI for the AI stages · better-auth (Google).

## Layout

```
apps/
  web/            React 19 + Vite + TanStack Router + Tailwind v4
  server/         Hono API: auth, Zero /query + /mutate, blob presigning, media, ingestion
packages/
  contracts/      Zero schema, shared synced queries + custom mutators, zod API payloads
  shared/         Pure utilities (ids, urls, mime, time, logging) and the entity registry
  client-runtime/ Per-platform Zero glue: store setup, blob upload queue + cache,
                  local search index
```

Internal packages export raw `.ts`: no build step for packages.

**The entity registry** (`packages/shared/src/entities/`) is the one place a kind of thing is
defined: its matcher, its normalizer (the dedupe key), the zod schema for its structured
fields, its prompt hint, its rail row and its URL. Adding a kind is one file and zero
migrations, because `entities.kind` is an open text column and the per-kind fields live in
`data jsonb`. A kind this build has never heard of renders through a generic card rather
than breaking.

## Development

Prereqs: Node ≥ 22, pnpm 11 (`corepack enable`), Docker (for Postgres).

```sh
pnpm install
cp .env.example .env          # defaults work for local dev; DEV_LOGIN=true
docker compose up -d postgres # Postgres 17, wal_level=logical
pnpm dev                      # turbo: API server (:3001) + web (:5173)
                              #   web's dev script waits on the API's /health
                              #   first (wait-on), so Vite never proxies /api
                              #   into a backend that hasn't booted yet
pnpm --filter web exec vite   # UI-only work: skip the wait, no backend needed
pnpm dev:zero-cache           # zero-cache (:4848), in a second terminal
pnpm dev:stop                 # stop everything and free the ports
```

Use `pnpm dev:stop` rather than killing things by port. zero-cache listens on
:4848 _and_ forks a change-streamer on :4849, and `pnpm dev` supervises the API
through a `tsx watch` parent, so killing one process usually leaves either an
orphan holding :4849 (the next start dies with `EADDRINUSE :::4849`) or a
watcher that quietly respawns the server.

The server runs drizzle migrations on boot (creates tables + the `zero_data`
publication zero-cache replicates). The web dev server proxies `/api` to the API
server so auth cookies stay first-party. Sign-in is Google OAuth (set
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); with `DEV_LOGIN=true` a dev-only
anonymous sign-in button appears so sync can be exercised without credentials.

**Blobs** go straight to R2/S3 via presigned URLs. With no bucket configured,
the server falls back to local-disk storage (`LOCAL_BLOB_DIR`, default
`.data/blobs` in dev) served through HMAC-presigned URLs, so file dumps work
out of the box.

**Media** is served from one stable URL per picture, `/api/media/<blobId>/<variant>`
(thumb, display, original), which the server answers with a 302 to a freshly presigned GET
and which a narrow service worker (`apps/web/public/media-sw.js`) caches offline. That path
must be same-origin with the app; in production the web host has to route it to the API
(see DEPLOY.md §4).

**Ingestion** runs inside the API process (`INGEST_WORKER=false` to disable): a
Postgres job queue (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`) feeds one job per
attachment plus one synthesis job per message. Without `OPENAI_API_KEY` it still extracts
everything it can locally (PDF text layers, textual files) and still finds links, emails,
phone numbers and tracking numbers by pattern matching; descriptions, transcripts,
summaries, tags and the judgment-call entities are skipped, and every skipped stage says
so on the row rather than leaving it silently empty.

Image derivatives (HEIC transcode, EXIF orientation, a 1600px display copy, a 400px thumb
and a blurhash placeholder) need **sharp**, whose prebuilt libvips carries AVIF but not
HEIC. The deploy image installs a system libvips that does; where one is missing the
transcode fails softly and the original is kept.

Checks: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`.

Acceptance proofs (each needs the dev stack running: postgres + server, plus
zero-cache for the two that sync):

```sh
cd apps/server
pnpm exec tsx scripts/sync-proof.mts    # two Zero clients through zero-cache
pnpm exec tsx scripts/blob-proof.mts    # presign → upload → dedupe → media URL
pnpm exec tsx scripts/ingest-proof.mts  # drop → fan-out → phase A → phase B → entities
```

Each runs with or without an OpenAI key: the model-dependent assertions are skipped (and
say so) when the server has none.

## Self-hosting

`docker compose up` runs the whole backend: API server + zero-cache + Postgres. Bring your own
OpenAI key (optional: without it, ingestion skips the AI stages) and any S3-compatible bucket
(optional too: blobs otherwise land on a mounted volume). See `.env.example`. Same images and
code paths as the hosted SaaS.
