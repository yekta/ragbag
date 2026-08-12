# ragbag — Plan

> **How to read this document.** This is the complete, standalone plan for ragbag — assume no other context exists. All technology choices in here are **decided** unless they appear in the "Open decisions" table (§12). Current repo state: **M0–M4 are done** (2026-08-12, checkmarks in §13 with deviation notes); the next step is milestone M5 (Electron desktop shell).

**What it is:** an info-dump app with a message-like interface. You "dump" anything into it — links, photos, notes, PDFs, screenshots — and it indexes the content intelligently so everything becomes searchable later. A smart bookmark/second-brain hybrid.

**Stack in one line:** TypeScript pnpm monorepo · React web app (also the Electron desktop renderer) · Expo mobile app · Node/Hono API server · Postgres + pgvector · **Zero (Rocicorp)** for local-first sync · Cloudflare R2 (S3 API) for blobs · OpenAI (`gpt-5.6-luna` + `text-embedding-3-small`) for enrichment and search · better-auth with **Google OAuth only** · hosted by us on Railway (SaaS), self-hostable via docker-compose.

---

## 1. Product shape

The core loop:

1. **Dump** — a chat-style timeline where you throw things in with zero friction. Text, URLs, images, files, PDFs. From mobile this is primarily the OS share sheet; from desktop it's a global hotkey / tray quick-capture; from web it's the composer.
2. **Ingest** — the server detects what each item is, extracts its real content (article text from links, text from PDFs, OCR/description from images), and enriches it (summary, tags, entities) using OpenAI.
3. **Recall** — three search tiers (§8): instant local keyword search (offline-capable), semantic search when online, and ask-a-question with cited answers. Plus filters by type/tag/date and browsable auto-collections.

**Deployment model:** ragbag is a hosted SaaS operated by us (Railway initially, possibly k3s later). Self-hosting is supported as a secondary path via docker-compose — the app is a multi-part deployment (server + zero-cache + Postgres + an S3-compatible bucket); there is deliberately **no** single-binary ambition.

**Non-goals for v1:** multi-user sharing/collaboration, public link pages, browser extension, video content processing (transcripts/frame analysis are too expensive — video links get metadata-only treatment, §7), billing (groundwork only, §12).

---

## 2. Architecture principles

- **Local-first clients, powered by Zero.** Zero (Rocicorp's sync engine; 1.0 stable since June 2026) keeps a queried subset of the user's data in a local store on every device, serves all reads locally, applies writes optimistically via custom mutators, and syncs continuously. We preload the user's full-timeline query, so in practice each device holds the whole archive and works fully offline.
- **Postgres is the source of truth.** zero-cache replicates from Postgres (logical replication) and streams changes to clients. A client's local store and the server's Postgres are never "the same database": each client holds one authenticated user's slice, materialized by Zero. The SaaS Postgres holds all users.
- **Heavy work happens server-side.** Content fetching, PDF parsing, OCR, AI enrichment, and embedding generation run in the server's ingestion pipeline. Ingestion writes plain Postgres rows; Zero streams the derived data down, so enrichment appears live on every device with no extra plumbing.
- **One web renderer, three shells.** The web app is literally the desktop app's renderer (Electron loads it). Mobile is a native Expo app with its own UI but the same schema, mutators, and client glue.
- **Boring, managed infrastructure.** Managed Postgres, R2 for blobs, two Node services (API + zero-cache). No bespoke sync engine, no separate vector DB, no Redis.

---

## 3. Repo structure & tooling

pnpm workspace, `apps/` + `packages/`:

```
ragbag/
├── apps/
│   ├── web/            # React 19 + Vite + TanStack Router + Tailwind v4
│   ├── desktop/        # Electron shell — loads the web renderer, adds tray,
│   │                   #   global quick-capture, auto-update (electron-builder)
│   ├── mobile/         # Expo (RN), share extension, EAS build profiles
│   ├── server/         # Node API: auth, Zero /query + /mutate endpoints,
│   │                   #   blob presigning, ingestion, search
│   └── marketing/      # (later) landing page
├── packages/
│   ├── contracts/      # The single source of truth shared by all apps:
│   │                   #   Zero schema (tables + relationships + permissions),
│   │                   #   shared custom mutators, Zod schemas for API payloads
│   ├── client-runtime/ # Thin per-platform glue around the Zero client:
│   │                   #   store setup (kvStore per platform), auth token
│   │                   #   plumbing, blob upload queue + lazy blob cache
│   └── shared/         # Small pure utilities (ids, time, url normalization,
│   │                   #   mime sniffing, logging)
├── docs/
├── scripts/
├── docker-compose.yml  # self-host path: server + zero-cache + postgres
├── package.json        # pnpm workspace root
├── pnpm-workspace.yaml # with catalog: for shared dep versions
└── turbo.json
```

`client-runtime` is deliberately thin — Zero owns the local store, optimistic mutations, query engine, and sync. What remains ours: platform wiring, the blob upload/download queue (Zero syncs rows, not files), and auth glue.

| Concern | Choice | Notes |
|---|---|---|
| Package manager | pnpm + workspace `catalog:` | One place to pin shared versions |
| Task runner | Turborepo + Vite | |
| Language | TypeScript everywhere, `"type": "module"` | Internal packages export raw `.ts` via `exports` maps — no build step for packages |
| Validation | Zod (contracts, API payloads, AI outputs) | Plain TS + Zod throughout; no heavyweight FP framework |
| ORM/migrations | drizzle | |
| Lint/format | oxlint + prettier | |
| Tests | Vitest | Integration tests against throwaway Postgres + zero-cache (testcontainers/compose) |
| CI | GitHub Actions: typecheck, lint, test, build, Docker image publish | |

---

## 4. Data model

Everything is an **item** in one timeline. All tables are scoped by `user_id`; derived data lives in separate tables keyed by item id, so ingestion can update enrichment without touching user-authored data. The Zero schema in `contracts` mirrors these tables and adds permissions (`user_id = auth.userId` on every table).

```
item
  id            ulid (client-generated — required for offline create)
  user_id
  kind          'note' | 'link' | 'image' | 'pdf' | 'file'
  created_at, updated_at, deleted_at (soft delete)
  pinned        bool
  text          user's message text (note body, or comment attached to a dump)
  url           for links
  blob_id       for images/pdfs/files

blob
  id, user_id, sha256 (content-addressed), mime, size, original_name
  → bytes in R2 (S3 API) under <user_id>/<sha256>

item_content        # derived, written by ingestion
  item_id, title, description, site_name, favicon_url, image_url (og image),
  extracted_text    # readability article text / PDF text / OCR text
  ai_summary, lang
  status            'pending' | 'processing' | 'done' | 'failed'
  error, processed_at

tag                 # id, user_id, name, kind: 'topic' | 'type' | 'entity'
item_tag            # item_id, tag_id, source: 'user' | 'ai'

collection / collection_item   # manual groupings (v1.5)

search (server-side only, NOT in the Zero schema):
  item_chunk        # chunked extracted text
  + embedding       # vector(1536) via pgvector, HNSW index
  + tsv             # tsvector for server-side keyword search

(zero-cache also keeps its own state in Postgres — CVR + change DBs — plus a
local SQLite replica file. All managed by Zero; not our schema.)
```

Tags are **multi-dimensional** (§7): an item carries several **type** tags (what it *is* — a link can be an article *and* a tutorial *and* code), free-form **topic** tags (what it's *about*), and **entity** tags (who/what it mentions). All three are rows in `tag`/`item_tag`, so filtering and search treat them uniformly.

Synced to clients via Zero: `item`, `item_content` (with `extracted_text` truncated for offline search — full text stays server-side), `tag`, `item_tag`, `collection`. Embedding/chunk tables are excluded from the Zero schema entirely.

---

## 5. Server (`apps/server`) + zero-cache

Two services, both plain Docker images:

**1. The API server** — Node 22+, Hono:

- **auth/** — better-auth endpoints (§9).
- **zero/** — the `/query` and `/mutate` endpoints zero-cache calls: query transform enforces `user_id` scoping/authorization; `/mutate` runs the shared custom mutators server-side (authoritative pass — Zod validation from `contracts`, Postgres writes, side effects like enqueueing ingestion jobs).
- **blobs/** — presigned R2 upload/download URLs; blob metadata rows. Clients transfer blob bytes directly to/from R2 — bytes never stream through the Node service.
- **ingest/** — Postgres-backed job queue (`SELECT … FOR UPDATE SKIP LOCKED`, or pg-boss) + processor pipeline (§7).
- **search/** — embedding generation + hybrid semantic queries (§8).

**2. zero-cache** (Rocicorp's service, run as-is, no custom code):

- Replicates Postgres → a local SQLite replica file; view-syncers serve client queries over WebSocket (port 4848); a replication-manager bridges Postgres. One node initially (both roles in one container); view-syncers scale horizontally later.

| Concern | Choice |
|---|---|
| Database | **Postgres** with `wal_level=logical` (required by Zero; direct connection on the replication path — no pgbouncer there) |
| Vectors | **pgvector** (HNSW, cosine) in the same Postgres — no separate vector DB |
| Job queue | Postgres-backed — no Redis at this scale |
| Blob storage | **Cloudflare R2** via the S3 API (AWS SDK v3, custom endpoint, presigned URLs — zero egress fees). Self-hosters point the same config at any S3-compatible bucket |
| Backups | Managed Postgres PITR + R2 durability — nothing custom |

Why Postgres and not SQLite on the server: this is a hosted multi-user SaaS — managed backups/PITR, metrics, inspectability, painless concurrency, trivial admin/analytics queries, mature pgvector — and Zero requires Postgres. SQLite-class storage exists only *inside clients* (and inside zero-cache's replica, which Zero manages).

---

## 6. Sync: how Zero works here

**Decided: Zero (Rocicorp)** — <https://zero.rocicorp.dev>. 1.0 stable (June 2026), supports web and React Native/Expo, requires exactly the stack chosen above. Choosing it deleted the custom sync engine that earlier drafts had — previously the riskiest build item.

**Read path.** Clients declare ZQL queries against the schema in `contracts` (timeline ordered by `created_at`, item detail with tags, tag list, …). Zero syncs query results into a local store and keeps them live — reads are local and instant, updates stream in. We preload the whole-timeline query on startup so the full archive is available offline, not just recently-viewed screens.

**Write path.** Writes go through **custom mutators** defined once in `contracts` (`createItem`, `editItem`, `deleteItem`, `setTags`, …):
- The client runs the mutator optimistically against its local store — UI updates instantly, offline included; Zero queues unsent mutations and pushes on reconnect.
- zero-cache forwards each mutation to our `/mutate` endpoint, where the *same* mutator runs authoritatively: Zod validation, `user_id` authorization, Postgres write, side effects (enqueue ingestion job for a new item).
- The authoritative result replicates back via zero-cache; optimistic client state reconciles automatically. Conflict policy is effectively last-writer-wins per mutation — fine for single-user data; no CRDTs.

**Derived data flows down for free.** Ingestion writes `item_content`/`item_tag` rows in Postgres → logical replication → zero-cache → every device with a matching query. No extra code.

**Local store per platform** (Zero's pluggable `kvStore`):

| Platform | Store |
|---|---|
| Web | IndexedDB |
| Desktop (Electron renderer) | IndexedDB |
| Mobile (Expo) | `op-sqlite` (fastest; requires dev-client builds — see §10) with `expo-sqlite` as fallback |

**What Zero doesn't cover — stays ours in `client-runtime`:**
- **Blobs.** Zero syncs rows, not files. The capturing device uploads bytes to R2 via presigned URL through a **persistent upload queue** that survives app restarts (critical for the mobile share extension); other devices lazily fetch + cache (mobile: thumbnails + recent originals; desktop/web: more).
- **Local text search index** (§8 Tier 1).
- **Escape hatch:** the mutators + schema in `contracts` are the stable boundary. If Zero ever hard-blocks us, a custom oplog implements the same mutator interface — client code above the boundary wouldn't change.

---

## 7. Ingestion pipeline (the "smart" part)

Every dumped item gets a job (enqueued by `createItem`'s server pass). Stages:

**1. Classify** — cheap and local: URL detection/normalization, MIME sniffing, image vs PDF vs file, video-link detection (YouTube/Vimeo/TikTok/etc. via URL patterns).

**2. Extract** (per kind):

| Kind | Extraction |
|---|---|
| link | Fetch with realistic headers → parse OG/meta/favicon → Readability (via `linkedom`) for article text. Store a snapshot of the extracted HTML so bookmarks survive link rot. |
| link (video) | **Metadata only** — title, channel, thumbnail, description from OG tags/oEmbed. No transcript fetching, no content-level analysis (too expensive for now). Gets a `video` type tag and topic tags inferred from title + description only. |
| pdf | Text layer via `pdfjs-dist`. Scanned/no-text-layer PDFs: rasterize pages and OCR via the vision model, or defer with `status: 'failed'` + manual retry in v1. |
| image | Vision call to `gpt-5.6-luna`: returns a description + any legible text (OCR) as structured output. EXIF date/location extracted locally. |
| note | Nothing to extract. |

**3. Enrich** — one OpenAI call per item. Model: **`gpt-5.6-luna`** — OpenAI's fastest/cheapest tier ($0.20 input / $1.20 output per MTok), the right fit for high-volume tagging. Structured outputs via the SDK's Zod helper, so the response is schema-validated JSON:

```ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

const Enrichment = z.object({
  summary: z.string(),                 // 1–3 sentences
  types: z.array(z.enum([             // multi-label — a link can be several of these
    "article", "blog-post", "news", "paper", "tutorial", "documentation",
    "reference", "code", "tool", "product", "recipe", "review",
    "social-post", "discussion", "video", "podcast", "book",
    "document", "receipt", "invoice", "ticket", "event", "place",
    "screenshot", "meme", "quote", "idea", "todo", "other",
  ])).min(1),
  topics: z.array(z.string()).min(3).max(15),  // lowercase topical tags
  entities: z.array(z.string()),               // people, orgs, products, places
  lang: z.string(),
});

const res = await openai.responses.parse({
  model: "gpt-5.6-luna",
  input: buildEnrichmentPrompt(item),   // extracted content + user's comment
  text: { format: zodTextFormat(Enrichment, "enrichment") },
});
const enrichment = res.output_parsed;
```

Tagging rules:

- **Generous, multi-dimensional tagging.** Every item gets at least one `type` tag — usually several, since a link can be a bunch of things (a Rust tutorial blog post is `blog-post` + `tutorial` + `code`) — plus 3–15 `topics` and any `entities`. Search and filtering are only as good as the tags; this is also what makes Tier-1 keyword search feel semantic (§8).
- **Vocabulary convergence:** the prompt includes the user's existing topic tags so AI tags converge instead of fragmenting ("js" vs "javascript").
- **Videos are tagged shallow:** type `video` + topics from title/description text only. Transcript-based tagging is a future, explicitly-priced feature.
- Backfills / re-index jobs go through OpenAI's **Batch API** (50% cost, async, 24h window) instead of the live path.

**4. Index** — write `item_content`, chunk extracted text, embed, upsert `item_chunk` rows (pgvector + tsvector). Row writes replicate to clients through Zero automatically.

Failures are non-fatal: the item stays in the timeline with `status: 'failed'` and a retry action; enrichment can be manually re-run. **Per-user rate limits and per-item cost caps from day one** — ingestion spend is the main variable cost of the SaaS.

---

## 8. Search — three tiers

Search is deliberately layered. Each tier is a superset of the one below in smarts and cost, and each ships only once the cheaper tier stops being enough.

**Tier 1 — Regular search (v1, ships with the web MVP).**
Keyword/prefix matching over titles, tags, AI summaries, and truncated extracted text. Runs **on-device** against an in-memory index (FlexSearch/MiniSearch) kept live from Zero's query results — instant, search-as-you-type, fully offline, free per query. (Zero's local store isn't FTS5-capable, hence the in-memory index; a few MB at personal-archive scale.)
This tier punches above its weight because ingestion already did semantic work at *write* time: every item carries AI-generated tags and a summary, so a keyword search for "sleep caffeine" hits the caffeine article's tags/summary even when those words never appear in its title.

**Tier 2 — Semantic search (v1.5, M7).**
The query is embedded and matched against content vectors, so *meaning* matches when words don't. **Server-side by necessity, not by choice:** the query must be embedded by the same model as the corpus (**`text-embedding-3-small`** — $0.02/M live, $0.01/M via Batch; embeddings bill input only), and that's an OpenAI API call — so offline semantic search is impossible regardless of where vectors live, and syncing vectors to devices would buy nothing. Content is chunked (~512 tokens, overlapping) and embedded at ingest into **pgvector** (HNSW, cosine).
**Not a separate mode in the UI.** One search box, hybrid ranking: local Tier-1 hits merge with server semantic hits (reciprocal rank fusion) when online; offline it degrades silently to Tier 1.

**Tier 3 — Ask-your-ragbag (v2).**
A different interaction: a *question*, not a lookup — "what was that argument against microservices I saved last month?" Pipeline: Tier-2 retrieval → top chunks to `gpt-5.6-luna` → generated answer **with citations linking back to the source items** (bump the model tier if answer quality demands it). One LLM call per question, so it's a deliberate action (an "Ask" tab / `?` prefix), never fired per keystroke. Built entirely on Tier 2's retrieval — cheap to add once hybrid search works.

Degradation summary: offline → Tier 1. Online → Tier 1+2 blended in one box. Tier 3 on demand.

---

## 9. Auth

**better-auth**, living inside the API server, storing users/sessions in the same Postgres.

- **Sign-in method: Google OAuth only (for now).** No email/magic-link (also means no SMTP dependency), no other providers. better-auth makes adding providers later a config change.
- **Token storage per client:** web → httpOnly cookies; Electron → `safeStorage` (OS keychain); Expo → `expo-secure-store`.
- **Sync auth:** the Zero client is constructed with the session token (JWT); zero-cache forwards it to `/query` and `/mutate`, where every access is scoped to the authenticated `user_id`. Zero schema permissions additionally pin all tables to `auth.userId` as defense in depth. Blob transfers use the same token to request presigned URLs.
- **Offline is unaffected by design:** auth gates *syncing*, never *using* the app. Expired session → you can still browse/search/dump locally; you get a "sign in to sync" nudge on reconnect. Sessions are long-lived (30–90 days, sliding).
- **Desktop/mobile OAuth flow:** system browser + `ragbag://` deep link back into the app (the scheme is needed for the mobile share extension anyway). The share extension reuses the stored token and never performs auth itself.

---

## 10. Clients

### `apps/web`
React 19, Vite, TanStack Router, Tailwind v4; zustand for view-only state (all data state lives in Zero). Screens: virtualized timeline, composer (paste/drag-drop upload through the blob queue), single search box (⌘K overlay), item detail (reader view for links, PDF viewer, image lightbox), tags/collections sidebar, settings.

### `apps/desktop`
Electron wrapping the web renderer. Adds: tray + **global quick-capture hotkey** (small always-ready capture window), OS drag-and-drop onto the dock/tray icon, deep-link auth (`ragbag://`), `electron-updater` auto-update. Built with electron-builder for mac/win/linux.

### `apps/mobile`
Expo with prebuild/CNG and EAS profiles (`development` / `preview` / `production`). The killer feature is capture speed:
- **Share extension** (`expo-share-intent`) — share a URL/photo/PDF from any app into ragbag; writes through the persistent upload queue and syncs when possible.
- Timeline + composer + camera/photo-library dump, offline search, optional push notification when a big ingest finishes.
- Navigation: react-navigation native-stack (no need for file-based routing).
- **Dev builds, not Expo Go.** Expo Go can't host our native requirements — the share extension (a native target), `op-sqlite` (Zero's store), the `ragbag://` scheme for OAuth callbacks, or push notifications. The `development` EAS profile builds a dev client (our own Expo Go with these modules compiled in); day-to-day DX is identical (Metro, QR code, fast refresh) and the shell only rebuilds when native deps change.

---

## 11. Deployment

**Primary (us, SaaS):**
- Railway, four resources: **API server** (Docker image), **zero-cache** (official container), **Railway Postgres** (pgvector, `wal_level=logical`, direct connections for replication — no pgbouncer on that path), **Cloudflare R2** for blobs.
- zero-cache notes: persistent volume for its SQLite replica file; generous startup/shutdown grace periods (initial sync can take minutes); sticky sessions if/when view-syncers scale beyond one node; replication-manager private, view-syncers public on 4848. The same containers move to k3s unchanged if economics/control demand it.
- Ingestion workers become a second instance of the API image (worker-mode flag) when AI throughput needs isolating from API latency.
- Observability: structured logs + OpenTelemetry traces; **per-user AI-spend metering from day one** (it's the COGS).

**Secondary (self-hosters):**
- `docker-compose.yml`: server + zero-cache + Postgres. They bring their own OpenAI key and any S3-compatible bucket (endpoint + credentials in env). Same images, same code paths as production — self-hosting must never fork behavior.

---

## 12. Open decisions

Everything not listed here is decided. 

| Decision | Current default | Alternative | When to revisit |
|---|---|---|---|
| Auth provider set | Google only | Add magic link / more OAuth providers | Post-MVP, by user demand |
| Enrichment model | `gpt-5.6-luna` | Bump OpenAI tier for images/hard cases | If tag/summary quality disappoints |
| Video content processing | Off (metadata-only) | Transcript ingestion + tagging | When cost/value is proven |
| Billing | Not in v1 milestones | Stripe + usage-based ingestion caps | Before public launch |
| Sync engine escape hatch | Zero (decided) | Custom oplog behind the same mutator interface | Only if Zero hard-blocks a platform or query pattern |

---

## 13. Milestones

**M0 — Scaffolding (small)** ✅ *done 2026-08-12*
Workspace, catalogs, turbo, tsconfig bases, lint/format/test wiring, CI + Docker image builds, docker-compose skeleton (server + zero-cache + Postgres running locally), empty apps/packages that typecheck and build.
*As built: web + server + the three packages scaffolded; desktop/mobile/marketing deferred to their own milestones per the sequencing rationale.*

**M1 — Schema, mutators, server core** ✅ *done 2026-08-12*
Zero schema + permissions and the first custom mutators in `contracts`; API server with drizzle migrations, better-auth (Google), `/query` + `/mutate` endpoints, presigned R2 blob flow; zero-cache running against Railway Postgres. A scratch page proving end-to-end sync between two browsers. *De-risks the whole architecture in the first real milestone.*
*As built — two deviations forced by Zero 1.x (it removed the permission system and zero-cache JWT validation): authorization is `ctx.userID` scoping inside the shared queries/mutators, enforced by the `/query`+`/mutate` endpoints (401 without a session); sync auth forwards the better-auth session cookie (web) or bearer token (native shells) instead of JWT+JWKS — same guarantees as §9, less machinery. Additions: dev-only anonymous sign-in behind `DEV_LOGIN` (refused in production) so sync is testable without Google creds; a `zero_data` publication limits replication to the synced tables; automated sync proof in `apps/server/scripts/sync-proof.mts` (two headless Zero clients) instead of the two-browser manual check. Verified locally, not yet against Railway.*

**M2 — Web MVP (local-first from day one)** ✅ *done 2026-08-12*
Timeline (virtualized), composer (text + URL + file upload through the blob queue), item detail, delete/pin/tag — all on Zero queries + mutators, so offline/optimistic behavior comes free rather than being retrofitted. *First usable dogfooding build.*
*As built: chat-style virtualized timeline (day separators, pinned strip, bottom-anchored), composer with paste/drag-drop capture, item-detail route overlay (reader view, PDF viewer, image lightbox, editable comment, tag editor), sidebar with kind/tag filters. Additions the plan implied but didn't name: a **local-disk blob driver** behind the presign API (R2 stays the default; local files with HMAC-presigned URLs are the dev/self-host-without-S3 path, so file dumps need zero setup), `presign-upload` taking the client-minted `blobId` (offline capture mints ids before the server sees them) and only skipping uploads when the bytes really exist, plus `item.relinkBlob` for content-address dedupe fix-ups. Acceptance test: `apps/server/scripts/blob-proof.mts`.*

**M3 — Offline hardening + local search** ✅ *done 2026-08-12*
Persistent blob upload queue + lazy blob cache in `client-runtime`, reconnect/expired-session UX, whole-timeline preload tuning, Tier-1 search index fed by Zero live queries.
*As built: the IndexedDB upload queue (capture is local-only and returns immediately; a background flush presigns/uploads with exponential backoff, resumes on boot, and parks on 401 until re-auth) + LRU download cache; MiniSearch Tier-1 index reconciled incrementally from the live timeline query, surfaced as the ⌘K box; preload switched to `ttl:'forever'`. Deviation worth knowing: the app now opens from a **remembered device identity** instead of a live session — expired session or no network still gets the full local archive plus a "sign in to resume sync" banner, and only an explicit sign-out clears the identity and drops local data.*

**M4 — Ingestion pipeline** ✅ *done 2026-08-12*
Postgres job queue, link extraction (metadata + readability + snapshot), video-link metadata path, PDF text, image description/OCR, `gpt-5.6-luna` enrichment with structured outputs, multi-dimensional tagging + vocabulary convergence, cost metering + per-user caps. Enrichment streams to clients via Zero. *The "smart" promise is real from here.*
*As built: queue worker in the API process (`FOR UPDATE SKIP LOCKED` claim, `LISTEN/NOTIFY` wake, stale-job reclaim, backoff; `INGEST_WORKER=false` hands over to a worker instance per §11). Link extraction via linkedom + Readability with an article snapshot to blob storage; video links are metadata-only (`isVideoUrl` in `shared`); PDF text via pdfjs; images via one `gpt-5.6-luna` vision call; enrichment prompts carry the owner's topic vocabulary for convergence. `ai_usage` prices every call and a rolling-24h per-user budget **skips** (never fails) enrichment. `item_chunk` holds chunks + a generated tsvector, with `embedding vector(1536)` + HNSW when pgvector exists — M7's Tier-2 groundwork, verified end to end against pgvector 0.8.1 (embeddings written at the right dimensionality, cosine ANN retrieval semantically sensible, HNSW index valid for the cosine opclass). A server that gains pgvector after migrating heals itself on the next boot: `ensureVectorColumn()` creates the extension where permitted, adds the column, and builds the index.*
*Deviations: (1) **notes get jobs too** — they skip extraction but still earn AI tags/summary, so `needsIngest` is now unconditional; (2) failures are typed — `WaitingError` (a blob still uploading from an offline device) reschedules without burning an attempt, `PermanentError` (no PDF text layer, refused host) fails immediately, everything else retries up to 4 times; (3) fetching user-supplied URLs added a **baseline SSRF guard** (DNS-resolved private/link-local/CGNAT addresses refused, redirects re-checked per hop, byte cap, timeout) — not in the plan text, but this endpoint fetches arbitrary URLs on a user's behalf; (4) OCR for scanned PDFs is deliberately still deferred, matching §7's "defer with status failed + manual retry". Scanned-PDF rasterization and the Batch API backfill path remain open. Acceptance test: `apps/server/scripts/ingest-proof.mts` (asserts extraction/indexing keyless; AI stages assert only with a key configured).*

**M5 — Desktop**
Electron shell, tray + global quick-capture, deep-link auth, auto-update, packaged builds.

**M6 — Mobile**
Expo app: timeline/composer/search on the same schema + mutators (Zero with `op-sqlite`), share extension wired to the upload queue, deep-link auth, EAS dev/preview/prod builds to TestFlight/internal track.

**M7 — Search Tier 2 + polish**
`text-embedding-3-small` + pgvector + hybrid ranking behind the single search box, dedup on re-dump of the same URL/blob (content-addressing makes this cheap), auto-collections by tag, export (JSON + files).

**M8 — Hardening / launch**
Rate limiting, abuse controls, telemetry (opt-in for self-hosters, on for SaaS), docs + self-hosting guide, marketing page, billing groundwork.

Sequencing rationale: M1 proves the Zero pipeline end to end before any real UI exists; web-before-mobile because ingestion and the blob path iterate fastest in a browser; mobile share-sheet capture is the most valuable client but lands on a proven stack.
