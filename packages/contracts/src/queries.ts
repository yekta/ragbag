import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.js";
import "./context.js";

// Shared synced queries. The same definitions run on the client (against the
// local store) and on the server (/api/zero/query), where ctx comes from the
// authenticated session — the userId filters below ARE the access control.

export const queries = defineQueries({
  // The whole-timeline query — preloaded on startup so the full archive is
  // available offline (plan §6).
  timeline: defineQuery(({ ctx }) =>
    zql.item
      .where("userId", ctx.userID)
      .where("deletedAt", "IS", null)
      .related("content")
      .related("tags")
      // The junction rows too: `source` tells the UI which tags are the
      // user's own (editable) vs. AI-applied (ingestion owns them).
      .related("itemTags", (q) => q.related("tag"))
      .orderBy("createdAt", "desc"),
  ),

  item: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
    zql.item
      .where("userId", ctx.userID)
      .where("id", args.id)
      .related("content")
      .related("itemTags", (q) => q.related("tag"))
      .one(),
  ),

  tags: defineQuery(({ ctx }) => zql.tag.where("userId", ctx.userID).orderBy("name", "asc")),
});
