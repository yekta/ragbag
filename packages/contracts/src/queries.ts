import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.js";

// Shared synced queries. The same definitions run on the client (against the
// local store) and on the server (/api/zero/query), where ctx comes from the
// authenticated session; the userId filters below ARE the access control.

/**
 * The window on the archive.
 *
 * Explicit from day one and unbounded today (`null`). Sync volume is not
 * solved, only made solvable (plan §14.1): when the archive outgrows one
 * payload, paging is a value passed here rather than a query rewrite, and the
 * search index is diff-based, so a window that grows or shrinks reconciles
 * instead of rebuilding.
 */
export const windowArgs = z.object({
  limit: z.number().int().positive().max(50_000).nullable(),
});

const idArgs = z.object({ id: z.string() });

export const queries = defineQueries({
  /**
   * The chat. Preloaded on startup so the whole archive is available offline;
   * `attachment_contents` deliberately rides in a second query (below) that
   * starts only once this one has landed (plan §7).
   */
  messages: defineQuery(windowArgs, ({ args, ctx }) => {
    const q = zql.messages
      .where("userId", ctx.userID)
      .where("deletedAt", "IS", null)
      .related("attachments", (a) => a.orderBy("position", "asc"))
      // Dismissed mentions are tombstones for the pipeline, not rows for the
      // UI: they never reach a card (plan §2.3).
      .related("mentions", (m) => m.where("dismissedAt", "IS", null).related("entity"))
      .related("tags", (t) => t.related("tag"))
      .orderBy("createdAt", "desc");
    return args.limit === null ? q : q.limit(args.limit);
  }),

  /**
   * The heavy text, synced after the chat. `attachment_contents` has no
   * user_id of its own, so ownership is enforced through the attachment it
   * hangs off; that existence check IS the access control here.
   */
  contents: defineQuery(({ ctx }) =>
    zql.attachmentContents.whereExists("attachment", (a) => a.where("userId", ctx.userID)),
  ),

  /** One message, with everything on it, for the detail overlay. */
  message: defineQuery(idArgs, ({ args, ctx }) =>
    zql.messages
      .where("userId", ctx.userID)
      .where("id", args.id)
      .related("attachments", (a) => a.orderBy("position", "asc").related("content"))
      .related("mentions", (m) => m.where("dismissedAt", "IS", null).related("entity"))
      .related("tags", (t) => t.related("tag"))
      .one(),
  ),

  /**
   * One file, with everything on it, for the file panel.
   *
   * A file is one of the things this app keeps, not a detail of the message it
   * arrived in: the rail lists it, search gives it its own row, and the
   * pipeline writes its own title, summary, tags and mentions against it. This
   * is the query that lets it have a page of its own.
   *
   * Its mentions are the entities found *in this file*, which is a narrower
   * set than the message's and the one thing no other query can answer: on a
   * message they arrive mixed in with what its text and its other files said.
   *
   * The message rides along for the header and the way back, and its liveness
   * is asked separately: a soft-deleted message keeps its attachment rows, so
   * without this check a link to a file would outlive the message it was sent
   * in (the same rule `entities` applies to mentions).
   */
  attachment: defineQuery(idArgs, ({ args, ctx }) =>
    zql.attachments
      .where("userId", ctx.userID)
      .where("id", args.id)
      .whereExists("message", (m) => m.where("deletedAt", "IS", null))
      .related("content")
      .related("message")
      .related("mentions", (m) => m.where("dismissedAt", "IS", null).related("entity"))
      .related("tags", (t) => t.related("tag"))
      .one(),
  ),

  /**
   * Every entity with its live mentions attached, which is what the Things
   * rail counts. Mentions to deleted messages are excluded here rather than
   * filtered downstream, so a deleted message cannot leave a ghost address in
   * the rail; an entity with no live mentions drops out of every view
   * (plan §5.5).
   */
  entities: defineQuery(({ ctx }) =>
    zql.entities
      .where("userId", ctx.userID)
      .related("mentions", (m) =>
        m
          .where("dismissedAt", "IS", null)
          .whereExists("message", (msg) => msg.where("deletedAt", "IS", null)),
      )
      .related("tags", (t) => t.related("tag")),
  ),

  /** One entity plus every message that mentions it, for the entity detail. */
  entity: defineQuery(idArgs, ({ args, ctx }) =>
    zql.entities
      .where("userId", ctx.userID)
      .where("id", args.id)
      .related("mentions", (m) =>
        m
          .where("dismissedAt", "IS", null)
          .whereExists("message", (msg) => msg.where("deletedAt", "IS", null))
          .related("message", (msg) =>
            msg.related("attachments", (a) => a.orderBy("position", "asc")),
          )
          .related("attachment"),
      )
      .related("tags", (t) => t.related("tag"))
      .one(),
  ),

  tags: defineQuery(({ ctx }) => zql.tags.where("userId", ctx.userID).orderBy("name", "asc")),

  /**
   * The kinds of thing this user keeps: their whole set, seeded at signup and
   * theirs to edit.
   *
   * Disabled types ride along rather than being filtered out here. Disabling a
   * type means "stop extracting", not "forget what it is": everything it found
   * stays, and it keeps its labels, its card and its page. The rail and the
   * prompt are what drop it (`EntityTypes.rail` / `.kinds` in @ragbag/shared),
   * and settings needs the row to offer turning it back on.
   *
   * Alphabetical by label, so the rail's order is stable, and fields by
   * `position`, so the prompt, the card and Details agree on it.
   */
  entityTypes: defineQuery(({ ctx }) =>
    zql.entityTypes
      .where("userId", ctx.userID)
      .related("fields", (f) => f.orderBy("position", "asc"))
      .orderBy("label", "asc"),
  ),
});
