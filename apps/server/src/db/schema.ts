import type {
  AttachmentStatus,
  AudioSegment,
  BlobVariants,
  IngestStage,
  JobStatus,
  MentionSource,
  MessageStatus,
  TagKind,
  TagSource,
} from "@ragbag/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres is the source of truth (plan §3). Zero syncs the subset defined in
// @ragbag/contracts; timestamps are timestamptz here and epoch-ms numbers on
// the wire. App tables are plural and keyed by uuid (v7, minted on the
// device); better-auth's own tables stay singular and untouched, and app rows
// keep `user_id text` referencing them, because better-auth mints its own ids
// and is not worth fighting for cosmetic consistency.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

// --- better-auth tables (users/sessions live in the same Postgres) ---

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Added by the better-auth anonymous plugin (dev login only).
  isAnonymous: boolean("is_anonymous"),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  ...timestamps,
});

// --- app tables (plan §3.1) ---

export const blobs = pgTable(
  "blobs",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    originalName: text("original_name"),
    ...timestamps,
  },
  // NOT unique on (user_id, sha256): bytes are deduplicated by the storage
  // key (<user_id>/<sha256>), so several rows may point at one object. That
  // lets every client keep the blob id it minted offline: a row whose id the
  // server reassigned would orphan the attachment that already referenced it.
  (t) => [index("blobs_user_sha256_idx").on(t.userId, t.sha256)],
);

/**
 * One send: the user's text plus N ordered attachments (plan §2.1). The
 * `generated_*`, `status`, `error` and `processed_at` columns are ingestion's
 * and nothing else writes them; `text` and `favorite` are the user's and
 * ingestion never touches them. That split is why derived columns can live on
 * the same row instead of in a second table.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    favorite: boolean("favorite").notNull().default(false),
    text: text("text"),
    generatedTitle: text("generated_title"),
    generatedSummary: text("generated_summary"),
    lang: text("lang"),
    status: text("status").$type<MessageStatus>().notNull().default("pending"),
    error: text("error"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("messages_user_created_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`deleted_at is null`),
  ],
);

/**
 * Authored, immutable, ordered (plan §2.2). `position` is what "exactly as it
 * was sent" means, so it is load-bearing for rendering rather than a derived
 * rank. `blob_id` is deliberately NOT a foreign key: with the offline upload
 * queue a message can sync before its blob row exists, which the pipeline
 * models as WaitingError.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    position: integer("position").notNull(),
    blobId: uuid("blob_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    /** Blurhash-style stand-in, so an evicted thumb still paints (plan §6.5). */
    placeholder: text("placeholder"),
    waveform: jsonb("waveform").$type<number[]>(),
    /** Which derivatives exist; the keys are derived from the source sha. */
    variants: jsonb("variants").$type<BlobVariants>().notNull().default({}),
    generatedTitle: text("generated_title"),
    generatedSummary: text("generated_summary"),
    status: text("status").$type<AttachmentStatus>().notNull().default("pending"),
    error: text("error"),
  },
  (t) => [index("attachments_message_position_idx").on(t.messageId, t.position)],
);

/**
 * The heavy text, split off for one reason only: sync priority (plan §7). The
 * chat preloads without it and the search index gets a second, deeper pass
 * once the first one has landed.
 */
export const attachmentContents = pgTable("attachment_contents", {
  attachmentId: uuid("attachment_id")
    .primaryKey()
    .references(() => attachments.id, { onDelete: "cascade" }),
  contentMd: text("content_md").notNull(),
  truncated: boolean("truncated").notNull().default(false),
  segments: jsonb("segments").$type<AudioSegment[]>(),
});

/**
 * Derived, canonical, per user (plan §2.3). `kind` is an open text column on
 * purpose: no enum, no check constraint, so a row whose kind this build has
 * never heard of is just data and renders through the generic fallback card.
 * Per-kind structured fields live in `data`, validated by the registry.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    generatedTitle: text("generated_title"),
    generatedSummary: text("generated_summary"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entities_user_kind_value_idx").on(t.userId, t.kind, t.normalizedValue)],
);

/**
 * One occurrence of an entity inside one message: the mention (plan §2.3). It
 * carries what is true about the *occurrence* rather than about the thing.
 * `dismissed_at` is the tombstone that makes re-ingestion safe: dismiss a
 * hallucinated address once and it stays dismissed through every future run.
 */
export const messageEntities = pgTable(
  "message_entities",
  {
    id: uuid("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    source: text("source").$type<MentionSource>().notNull(),
    confidence: real("confidence"),
    snippet: text("snippet"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // NULLS NOT DISTINCT, or "found in the message text" (attachment_id null)
    // would be insertable twice and every re-run would add another row.
    unique("message_entities_target_key")
      .on(t.messageId, t.entityId, t.attachmentId)
      .nullsNotDistinct(),
    index("message_entities_entity_idx").on(t.entityId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<TagKind>().notNull(),
  },
  (t) => [uniqueIndex("tags_user_kind_name_idx").on(t.userId, t.kind, t.name)],
);

// Three tag join tables, not one polymorphic `taggings`: Zero relationships
// are field-to-field with no discriminator support, so a polymorphic join
// would mean filtering in every related query and losing referential
// integrity. Three tiny tables are cheaper.

export const messageTags = pgTable(
  "message_tags",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").$type<TagSource>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.tagId] })],
);

export const attachmentTags = pgTable(
  "attachment_tags",
  {
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").$type<TagSource>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.attachmentId, t.tagId] })],
);

export const entityTags = pgTable(
  "entity_tags",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").$type<TagSource>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.tagId] })],
);

/**
 * The Postgres-backed job queue (plan §5.1): SELECT ... FOR UPDATE SKIP
 * LOCKED. Server-only, never in the Zero schema. One row per attachment plus
 * one for synthesis, fanned out in the same transaction as the message.
 */
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: uuid("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id"),
    stage: text("stage").$type<IngestStage>().notNull(),
    userId: text("user_id").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("ingest_jobs_status_run_after_idx").on(t.status, t.runAfter),
    // The requeue target: ids are uuids now, so "the job for this part" is
    // named by what it points at rather than by a derived id string. NULLS
    // NOT DISTINCT so the synthesis row (attachment_id null) has exactly one
    // slot per message to be re-armed in.
    unique("ingest_jobs_target_key").on(t.messageId, t.attachmentId, t.stage).nullsNotDistinct(),
  ],
);

/** Per-call AI spend metering. Recording only; nothing here gates ingestion. */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    messageId: uuid("message_id"),
    attachmentId: uuid("attachment_id"),
    kind: text("kind").$type<"vision" | "transcribe" | "enrich" | "extract">().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_events_user_created_idx").on(t.userId, t.createdAt)],
);
