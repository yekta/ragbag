import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  number,
  relationships,
  string,
  table,
} from "@rocicorp/zero";
import type { ItemKind, TagKind } from "@ragbag/shared";

// The Zero schema mirrors the synced subset of the Postgres schema (plan §4).
// Client column names are camelCase, mapped to snake_case server columns.
// Deliberately NOT synced: blob (bytes live in R2, metadata is server-side),
// ingest_job, item_chunk/embeddings, and all auth tables.

export type ContentStatus = "pending" | "processing" | "done" | "failed";
export type TagSource = "user" | "ai";

const item = table("item")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    kind: enumeration<ItemKind>(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
    deletedAt: number().from("deleted_at").optional(),
    pinned: boolean(),
    // User's message text: note body, or comment attached to a dump.
    text: string().optional(),
    url: string().optional(),
    blobId: string().from("blob_id").optional(),
  })
  .primaryKey("id");

// Derived data written by the ingestion pipeline; separate table so ingestion
// never touches user-authored rows. extracted_text is truncated for clients.
const itemContent = table("itemContent")
  .from("item_content")
  .columns({
    itemId: string().from("item_id"),
    title: string().optional(),
    description: string().optional(),
    siteName: string().from("site_name").optional(),
    faviconUrl: string().from("favicon_url").optional(),
    imageUrl: string().from("image_url").optional(),
    extractedText: string().from("extracted_text").optional(),
    aiSummary: string().from("ai_summary").optional(),
    lang: string().optional(),
    status: enumeration<ContentStatus>(),
    error: string().optional(),
    processedAt: number().from("processed_at").optional(),
  })
  .primaryKey("itemId");

const tag = table("tag")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    name: string(),
    kind: enumeration<TagKind>(),
  })
  .primaryKey("id");

const itemTag = table("itemTag")
  .from("item_tag")
  .columns({
    itemId: string().from("item_id"),
    tagId: string().from("tag_id"),
    source: enumeration<TagSource>(),
  })
  .primaryKey("itemId", "tagId");

const collection = table("collection")
  .columns({
    id: string(),
    userId: string().from("user_id"),
    name: string(),
    createdAt: number().from("created_at"),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("id");

const collectionItem = table("collectionItem")
  .from("collection_item")
  .columns({
    collectionId: string().from("collection_id"),
    itemId: string().from("item_id"),
    createdAt: number().from("created_at"),
  })
  .primaryKey("collectionId", "itemId");

const itemRelationships = relationships(item, ({ one, many }) => ({
  content: one({
    sourceField: ["id"],
    destField: ["itemId"],
    destSchema: itemContent,
  }),
  tags: many(
    { sourceField: ["id"], destField: ["itemId"], destSchema: itemTag },
    { sourceField: ["tagId"], destField: ["id"], destSchema: tag },
  ),
  itemTags: many({
    sourceField: ["id"],
    destField: ["itemId"],
    destSchema: itemTag,
  }),
}));

const itemTagRelationships = relationships(itemTag, ({ one }) => ({
  item: one({ sourceField: ["itemId"], destField: ["id"], destSchema: item }),
  tag: one({ sourceField: ["tagId"], destField: ["id"], destSchema: tag }),
}));

const tagRelationships = relationships(tag, ({ many }) => ({
  items: many(
    { sourceField: ["id"], destField: ["tagId"], destSchema: itemTag },
    { sourceField: ["itemId"], destField: ["id"], destSchema: item },
  ),
}));

const collectionRelationships = relationships(collection, ({ many }) => ({
  items: many(
    { sourceField: ["id"], destField: ["collectionId"], destSchema: collectionItem },
    { sourceField: ["itemId"], destField: ["id"], destSchema: item },
  ),
}));

export const schema = createSchema({
  tables: [item, itemContent, tag, itemTag, collection, collectionItem],
  relationships: [
    itemRelationships,
    itemTagRelationships,
    tagRelationships,
    collectionRelationships,
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
