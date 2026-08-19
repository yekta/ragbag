import type { queries } from "@ragbag/contracts";
import type { QueryResultType } from "@rocicorp/zero";

// Row shapes as the UI receives them from Zero (query result types, including
// the related attachments/mentions/tags), derived from the shared query
// definitions so a contracts change breaks the build here instead of at
// runtime.

export type Messages = QueryResultType<typeof queries.messages>;
export type Message = Messages[number];
export type Attachment = Message["attachments"][number];
/** One occurrence of an entity inside a message, with the entity attached. */
export type Mention = Message["mentions"][number];
export type MessageTagLink = Message["tags"][number];

export type MessageDetail = QueryResultType<typeof queries.message>;
/** The detail view's attachments carry their content_md; the chat's do not. */
export type DetailAttachment = NonNullable<MessageDetail>["attachments"][number];

/**
 * The entity columns, without relations: what a card needs and what a mention
 * carries. `EntityRow` (which also has its mentions and tags) is assignable to
 * it, so one card component serves the chat strip, the things list and the
 * entity page.
 */
export type EntityFields = NonNullable<Mention["entity"]>;

export type EntityRows = QueryResultType<typeof queries.entities>;
export type EntityRow = EntityRows[number];
export type EntityDetail = QueryResultType<typeof queries.entity>;

export type AttachmentContent = QueryResultType<typeof queries.contents>[number];
export type TagRow = QueryResultType<typeof queries.tags>[number];

/**
 * One of the user's entity types, with its fields: what settings edits.
 *
 * Not the same thing as `EntityTypeRow` in @ragbag/shared, which is the
 * structural shape the compiler reads. This is the synced row, ids and all,
 * because the mutators address a type by its id.
 */
export type TypeRow = QueryResultType<typeof queries.entityTypes>[number];
export type TypeFieldRow = TypeRow["fields"][number];
