import type { ItemKind, TagKind } from "@ragbag/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Postgres is the source of truth (plan §2). Zero syncs the subset defined in
// @ragbag/contracts; timestamps are timestamptz here and epoch-ms numbers on
// the wire. All app tables are scoped by user_id.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

// --- better-auth tables (users/sessions live in the same Postgres, plan §9) ---

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

// --- app tables (plan §4) ---

export const blob = pgTable(
  "blob",
  {
    id: text("id").primaryKey(),
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
  // lets every client keep the blob id it minted offline — a row whose id the
  // server reassigned would orphan the item that already referenced it.
  (t) => [index("blob_user_sha256_idx").on(t.userId, t.sha256)],
);

export const item = pgTable(
  "item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ItemKind>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    favorite: boolean("favorite").notNull().default(false),
    // Todos only: null = open, set = done (keeps the "when", unlike a bool).
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    text: text("text"),
    url: text("url"),
    // Deliberately NOT a foreign key: with the offline upload queue (M3), an
    // item can sync before its blob row exists.
    blobId: text("blob_id"),
  },
  (t) => [index("item_user_created_idx").on(t.userId, t.createdAt.desc())],
);

// Derived, written by ingestion — separate from user-authored data.
export const itemContent = pgTable("item_content", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => item.id, { onDelete: "cascade" }),
  title: text("title"),
  description: text("description"),
  siteName: text("site_name"),
  faviconUrl: text("favicon_url"),
  imageUrl: text("image_url"),
  extractedText: text("extracted_text"),
  aiSummary: text("ai_summary"),
  lang: text("lang"),
  status: text("status")
    .$type<"pending" | "processing" | "done" | "failed">()
    .notNull()
    .default("pending"),
  error: text("error"),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
});

export const tag = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<TagKind>().notNull(),
  },
  (t) => [uniqueIndex("tag_user_kind_name_idx").on(t.userId, t.kind, t.name)],
);

export const itemTag = pgTable(
  "item_tag",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    source: text("source").$type<"user" | "ai">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] })],
);

export const collection = pgTable("collection", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ...timestamps,
});

export const collectionItem = pgTable(
  "collection_item",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.itemId] })],
);

// Chunked extracted text for search (plan §4/§8) — server-only, never in the
// Zero schema. Two extra columns live outside drizzle's model and are managed
// by raw SQL in migration 0002: a generated tsvector ("tsv") and, when
// pgvector is installed, "embedding vector(1536)" with an HNSW index.
export const itemChunk = pgTable(
  "item_chunk",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    idx: integer("idx").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.idx] }), index("item_chunk_user_idx").on(t.userId)],
);

// Per-call AI spend metering (plan §7/§11: per-user caps from day one — AI
// ingestion is the COGS of the SaaS).
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    itemId: text("item_id"),
    kind: text("kind").$type<"enrich" | "vision" | "embed">().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_user_created_idx").on(t.userId, t.createdAt)],
);

// Postgres-backed job queue (plan §5): SELECT ... FOR UPDATE SKIP LOCKED.
// Server-only; never in the Zero schema.
export const ingestJob = pgTable(
  "ingest_job",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status")
      .$type<"queued" | "running" | "done" | "failed">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("ingest_job_status_run_after_idx").on(t.status, t.runAfter)],
);
