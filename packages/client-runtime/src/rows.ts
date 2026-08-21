import type { queries } from "@ragbag/contracts";
import type { QueryResultType } from "@rocicorp/zero";

// Row shapes as the UI receives them from Zero (query result types, including
// the related attachments/mentions/tags), derived from the shared query
// definitions so a contracts change breaks the build here instead of at
// runtime.
//
// Shared rather than per-shell. These names are read by every card, list and
// panel in both apps, and there is nothing platform-specific about them: two
// copies would be two places for `TMessage` to mean something slightly
// different. apps/web/src/lib/types.ts re-exports this file so its own imports
// did not have to move.

export type TMessages = QueryResultType<typeof queries.messages>;
export type TMessage = TMessages[number];
export type TAttachment = TMessage["attachments"][number];
/** One occurrence of an entity inside a message, with the entity attached. */
export type TMention = TMessage["mentions"][number];
export type TMessageTagLink = TMessage["tags"][number];

export type TMessageDetail = QueryResultType<typeof queries.message>;
/** The detail view's attachments carry their content_md; the chat's do not. */
export type TDetailAttachment = NonNullable<TMessageDetail>["attachments"][number];

/** One file on its own page: its content, its message, its mentions, its tags. */
export type TAttachmentDetail = QueryResultType<typeof queries.attachment>;

/**
 * The entity columns, without relations: what a card needs and what a mention
 * carries. `TEntityRow` (which also has its mentions and tags) is assignable to
 * it, so one card component serves the chat strip, the things list and the
 * entity page.
 */
export type TEntityFields = NonNullable<TMention["entity"]>;

export type TEntityRows = QueryResultType<typeof queries.entities>;
export type TEntityRow = TEntityRows[number];
export type TEntityDetail = QueryResultType<typeof queries.entity>;

export type TAttachmentContent = QueryResultType<typeof queries.contents>[number];
export type TTagRow = QueryResultType<typeof queries.tags>[number];

/**
 * One of the user's entity types, with its fields: what settings edits.
 *
 * Not the same thing as `TEntityTypeRow` in @ragbag/shared, which is the
 * structural shape the compiler reads. This is the synced row, ids and all,
 * because the mutators address a type by its id.
 */
export type TTypeRow = QueryResultType<typeof queries.entityTypes>[number];
export type TTypeFieldRow = TTypeRow["fields"][number];
