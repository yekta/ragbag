# ragbag

A local-first info-dump app. Drop anything (links, photos, notes, PDFs, screenshots, voice
notes) into a chat-like box; an AI pipeline understands it, and it becomes searchable
offline, forever.

The unit of capture is a **message**: free text plus up to ten ordered attachments, sent in
one action, exactly like a chat. Ingestion runs in two phases: each attachment is
understood on its own (vision on images, the text layer or the model on PDFs, transcription
on audio), then a synthesis pass reads the whole message and pulls out **entities**: links,
addresses, tracking numbers, invoices, emails, phones, IBANs, books, plus whatever kinds you
add yourself, as canonical, deduplicated things with their own titles, summaries and tags.
Search is local only, and it is complete: the whole archive lives on every device, and it
answers in two sections, the messages that matched and the things that matched.

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
  shared/         Pure utilities (ids, urls, mime, time, logging) and the entity types
  client-runtime/ Per-platform Zero glue: store setup, blob upload queue + cache,
                  local search index
```

Internal packages export raw `.ts`: no build step for packages.

## Kinds of thing

**Every kind of thing is a row you own**, in `entity_types` plus `entity_type_fields`. A new
account is seeded with the eight in the catalog (`packages/shared/src/entities/catalog.ts`):
`link`, `tracking`, `address`, `phone`, `email`, `invoice`, `iban`, `book`. From then on they
are yours: rename them, re-word what the model is told to look for, add fields, add kinds of
your own, disable the ones you do not want read for, delete the ones you do not want at all.
That is `/settings/types` in the app, and it is ordinary mutations over rows every client
already syncs: no migration, no deploy, no restart. The next synthesis job reads the table, so
the model is asked for a new kind immediately, and the web app syncs the same rows for its
card, its rail row, its URL and its Details labels.

A type is a **definition** and, for a few kinds, some **behaviour**:

- The definition is data, and it is the whole story for most kinds: a hint telling the model
  what to look for, the fields it fills in, which of them make two of them the same thing, and
  the labels the UI prints. A type with only a definition works end to end.
- The behaviour is code that a row cannot express, attached by kind name
  (`packages/shared/src/entities/behaviours.ts`): the URL matcher and the page fetcher behind
  `link`, the carrier patterns behind `tracking`, the rule that says two invoices are the same
  bill, the IBAN that is one account however it was pasted. Those kinds keep their behaviour
  however you rename them, and their field lists are read-only in settings, because the link
  fetcher writes `site_name` and friends itself.

Field names are snake_case, because one spelling has to serve the `data jsonb` key, the wire
and the prompt; `label` is what a person sees ("Postal Code"), and it defaults to the
humanized name. `key_rank` names the fields that make the thing unique, in order: a thing with
an empty _first_ key field is dropped rather than merged on half a key, and a missing later
one is fine (a book with no author still keys on its title). `type` is one of `text`,
`longtext`, `number`, `integer`, `bool`, `date`, `url`, `enum`, and the check constraints on
these two tables are the whole meta-schema, which is why nothing has to parse or re-validate a
config file.

**The set is closed for any given job.** The synthesis job reads one user's enabled types once,
and the model's `kind` is an enum of exactly those kinds. There is no `other` bucket: a model
allowed to invent kinds invents one spelling per message ("marka adı", "slogan"), and those
merge with nothing, browse nowhere and answer no search. A kind that is not in the set (one you
deleted, or one a newer build declared) is still data, and renders through a generic card.

Adding a type only affects messages ingested after it. To re-read one user's archive with it,
queue synthesis again, which is one model call per message and therefore an operator action
rather than a button:

```sql
insert into ingest_jobs (id, message_id, attachment_id, stage, user_id, status, attempts,
                         run_after, created_at, updated_at)
select gen_random_uuid(), m.id, null, 'synthesis', m.user_id, 'queued', 0, now(), now(), now()
  from messages m where m.deleted_at is null and m.user_id = $1
on conflict (message_id, attachment_id, stage) do update
  set status = 'queued', attempts = 0, run_after = now(), last_error = null, updated_at = now();
select pg_notify('ingest_wake', '');
```

Editing a type bumps `entity_types.version` (a trigger, so it holds however the row was
written), and a re-ingest under a newer version replaces an entity's `data` instead of merging
into it: a renamed or deleted field does not leave its old spelling behind.

Seeding happens once, in better-auth's user-create hook, and is recorded as
`user.types_seeded_at` rather than inferred from "has no types", so a kind you deleted stays
deleted. A job whose user was never seeded (a hook that failed, an account older than the
feature) seeds before it reads the set.

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

Image derivatives (HEIC transcode, EXIF orientation baked in, a 1600px display copy, a
400px thumb and a thumbhash placeholder) come from **sharp**, plus **heic-decode** for the
one thing sharp cannot do. sharp's bundled libheif carries AV1 but not HEVC, and it only
builds against a system libvips at install time and only one ≥ 8.18.3, which no Debian or
Ubuntu release ships; so HEVC comes from libheif compiled to WASM instead. That needs
nothing from the base image, which is why HEIC works in local dev and in the acceptance
proofs as well as in the container. It costs CPU rather than configuration: about 290ms to
decode a 1.1MP image, so a few seconds for a 12MP phone photo, inside a background worker.

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
