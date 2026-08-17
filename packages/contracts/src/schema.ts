import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  json,
  number,
  relationships,
  string,
  table,
} from "@rocicorp/zero";
import type { ReadonlyJSONObject } from "@rocicorp/zero";
import type {
  AttachmentStatus,
  AudioSegment,
  BlobVariants,
  MentionSource,
  MessageStatus,
  TagKind,
  TagSource,
} from "@ragbag/shared";

// The Zero schema mirrors the synced subset of the Postgres schema (plan
// §3.4). Client column names are camelCase, mapped to snake_case server
// columns. Postgres `uuid` columns are first class: zero-cache maps them to
// `string` and casts parameters back with ::text::uuid, so nothing here needs
// a text fallback. `jsonb` maps to `json<T>()`.
//
// Deliberately NOT synced: blobs (bytes live in R2, metadata is server-side),
// ingest_jobs, ai_usage_events, and all auth tables.

const messages = table("messages")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().from("deleted_at").optional(),
    favorite: boolean(),
    /** The user's own words. Ingestion never writes this. */
    text: string().optional(),
    generatedTitle: string().from("generated_title").optional(),
    generatedSummary: string().from("generated_summary").optional(),
    lang: string().optional(),
    status: enumeration<MessageStatus>(),
    error: string().optional(),
    processedAt: number().from("processed_at").optional(),
  })
  .primaryKey("id");

const attachments = table("attachments")
  .columns({
    id: string(),
    messageId: string().from("message_id"),
    userId: string().from("user_id"),
    position: number(),
    blobId: string().from("blob_id"),
    filename: string(),
    mime: string(),
    size: number(),
    width: number().optional(),
    height: number().optional(),
    durationMs: number().from("duration_ms").optional(),
    placeholder: string().optional(),
    waveform: json<number[]>().optional(),
    variants: json<BlobVariants>(),
    generatedTitle: string().from("generated_title").optional(),
    generatedSummary: string().from("generated_summary").optional(),
    status: enumeration<AttachmentStatus>(),
    error: string().optional(),
  })
  .primaryKey("id");

/** Split off from `attachments` for sync priority only (plan §7). */
const attachmentContents = table("attachmentContents")
  .from("attachment_contents")
  .columns({
    attachmentId: string().from("attachment_id"),
    contentMd: string().from("content_md"),
    truncated: boolean(),
    segments: json<AudioSegment[]>().optional(),
  })
  .primaryKey("attachmentId");

const entities = table("entities")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    // string(), not enumeration<EntityKind>(): a client on an older build that
    // receives a kind it has never heard of would otherwise have a value its
    // type cannot represent. As a string it is data, and the generic fallback
    // card renders it (plan §3.3).
    kind: string(),
    value: string(),
    normalizedValue: string().from("normalized_value"),
    // Per-kind structure, shaped by the registry entry for `kind` and
    // validated there before it is ever written (plan §3.3).
    data: json<ReadonlyJSONObject>(),
    generatedTitle: string().from("generated_title").optional(),
    generatedSummary: string().from("generated_summary").optional(),
    firstSeenAt: number().from("first_seen_at"),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("id");

/** One occurrence of an entity inside one message (plan §2.3). */
const messageEntities = table("messageEntities")
  .from("message_entities")
  .columns({
    id: string(),
    messageId: string().from("message_id"),
    entityId: string().from("entity_id"),
    attachmentId: string().from("attachment_id").optional(),
    userId: string().from("user_id"),
    source: enumeration<MentionSource>(),
    confidence: number().optional(),
    snippet: string().optional(),
    dismissedAt: number().from("dismissed_at").optional(),
  })
  .primaryKey("id");

const tags = table("tags")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    name: string(),
    kind: enumeration<TagKind>(),
  })
  .primaryKey("id");

const messageTags = table("messageTags")
  .from("message_tags")
  .columns({
    messageId: string().from("message_id"),
    tagId: string().from("tag_id"),
    source: enumeration<TagSource>(),
  })
  .primaryKey("messageId", "tagId");

const attachmentTags = table("attachmentTags")
  .from("attachment_tags")
  .columns({
    attachmentId: string().from("attachment_id"),
    tagId: string().from("tag_id"),
    source: enumeration<TagSource>(),
  })
  .primaryKey("attachmentId", "tagId");

const entityTags = table("entityTags")
  .from("entity_tags")
  .columns({
    entityId: string().from("entity_id"),
    tagId: string().from("tag_id"),
    source: enumeration<TagSource>(),
  })
  .primaryKey("entityId", "tagId");

// Junction rows are exposed rather than the two-hop shortcut to `tags`,
// because `source` is what tells the UI which tags are the user's own
// (editable) and which are ingestion's (it owns them, and replaces them on
// every run). Each junction carries a `tag` of its own for the name.

const messageRelationships = relationships(messages, ({ many }) => ({
  attachments: many({ sourceField: ["id"], destField: ["messageId"], destSchema: attachments }),
  mentions: many({ sourceField: ["id"], destField: ["messageId"], destSchema: messageEntities }),
  tags: many({ sourceField: ["id"], destField: ["messageId"], destSchema: messageTags }),
}));

const attachmentRelationships = relationships(attachments, ({ one, many }) => ({
  message: one({ sourceField: ["messageId"], destField: ["id"], destSchema: messages }),
  content: one({
    sourceField: ["id"],
    destField: ["attachmentId"],
    destSchema: attachmentContents,
  }),
  mentions: many({ sourceField: ["id"], destField: ["attachmentId"], destSchema: messageEntities }),
  tags: many({ sourceField: ["id"], destField: ["attachmentId"], destSchema: attachmentTags }),
}));

const attachmentContentRelationships = relationships(attachmentContents, ({ one }) => ({
  attachment: one({ sourceField: ["attachmentId"], destField: ["id"], destSchema: attachments }),
}));

const entityRelationships = relationships(entities, ({ many }) => ({
  mentions: many({ sourceField: ["id"], destField: ["entityId"], destSchema: messageEntities }),
  tags: many({ sourceField: ["id"], destField: ["entityId"], destSchema: entityTags }),
}));

const messageEntityRelationships = relationships(messageEntities, ({ one }) => ({
  message: one({ sourceField: ["messageId"], destField: ["id"], destSchema: messages }),
  entity: one({ sourceField: ["entityId"], destField: ["id"], destSchema: entities }),
  attachment: one({ sourceField: ["attachmentId"], destField: ["id"], destSchema: attachments }),
}));

const messageTagRelationships = relationships(messageTags, ({ one }) => ({
  message: one({ sourceField: ["messageId"], destField: ["id"], destSchema: messages }),
  tag: one({ sourceField: ["tagId"], destField: ["id"], destSchema: tags }),
}));

const attachmentTagRelationships = relationships(attachmentTags, ({ one }) => ({
  attachment: one({ sourceField: ["attachmentId"], destField: ["id"], destSchema: attachments }),
  tag: one({ sourceField: ["tagId"], destField: ["id"], destSchema: tags }),
}));

const entityTagRelationships = relationships(entityTags, ({ one }) => ({
  entity: one({ sourceField: ["entityId"], destField: ["id"], destSchema: entities }),
  tag: one({ sourceField: ["tagId"], destField: ["id"], destSchema: tags }),
}));

const tagRelationships = relationships(tags, ({ many }) => ({
  messages: many(
    { sourceField: ["id"], destField: ["tagId"], destSchema: messageTags },
    { sourceField: ["messageId"], destField: ["id"], destSchema: messages },
  ),
}));

export const schema = createSchema({
  tables: [
    messages,
    attachments,
    attachmentContents,
    entities,
    messageEntities,
    tags,
    messageTags,
    attachmentTags,
    entityTags,
  ],
  relationships: [
    messageRelationships,
    attachmentRelationships,
    attachmentContentRelationships,
    entityRelationships,
    messageEntityRelationships,
    messageTagRelationships,
    attachmentTagRelationships,
    entityTagRelationships,
    tagRelationships,
  ],
  // All reads/writes go through synced queries + custom mutators.
  enableLegacyQueries: false,
  enableLegacyMutators: false,
});

export type Schema = typeof schema;

export const zql = createBuilder(schema);

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: Schema;
  }
}
