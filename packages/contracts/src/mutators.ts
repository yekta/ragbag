import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { Transaction } from "@rocicorp/zero";
import {
  ITEM_KINDS,
  TEXT_ITEM_KINDS,
  isTextKind,
  isUlid,
  newId,
  normalizeUrl,
} from "@ragbag/shared";
import type { ItemKind } from "@ragbag/shared";
import { z } from "zod";
import { mustBeLoggedIn } from "./context.js";
import { zql } from "./schema.js";

// Shared custom mutators (plan §6): the client runs them optimistically
// against its local store; zero-cache forwards each mutation to /api/zero/mutate
// where the SAME function runs authoritatively (Zod-validated args, ctx from
// the server session, Postgres writes, server-only side effects).
//
// Conflict policy is last-writer-wins per mutation: single-user data, no CRDTs.

/**
 * Every dumped item gets an ingestion job (plan §7), notes included: they
 * skip extraction but still get AI tags and a summary. Servers without an
 * OpenAI key complete note jobs as no-ops.
 */
function needsIngest(_kind: ItemKind): boolean {
  return true;
}

const itemId = z.string().refine(isUlid, "item id must be a ULID");

export const createItemArgs = z
  .object({
    id: itemId,
    kind: z.enum(ITEM_KINDS),
    text: z.string().max(100_000).optional(),
    url: z.string().max(8_192).optional(),
    blobId: z.string().optional(),
  })
  .superRefine((args, ctx) => {
    // note/todo/address are all "the user's own words" kinds; they differ in
    // how they render and what you can do with them, not in what they carry.
    if (
      (args.kind === "note" || args.kind === "todo" || args.kind === "address") &&
      !args.text?.trim()
    ) {
      ctx.addIssue({ code: "custom", message: `a ${args.kind} needs text` });
    }
    if (args.kind === "link" && !args.url) {
      ctx.addIssue({ code: "custom", message: "a link needs a url" });
    }
    if ((args.kind === "image" || args.kind === "pdf" || args.kind === "file") && !args.blobId) {
      ctx.addIssue({ code: "custom", message: `a ${args.kind} needs a blobId` });
    }
  });

export const editItemArgs = z.object({
  id: itemId,
  text: z.string().max(100_000),
});

export const setFavoriteArgs = z.object({
  id: itemId,
  favorite: z.boolean(),
});

export const setDoneArgs = z.object({
  id: itemId,
  done: z.boolean(),
});

export const setKindArgs = z.object({
  id: itemId,
  // Only the text kinds convert into each other: a note the user meant as a
  // todo, an address they dumped as a note. A link can't become an image.
  kind: z.enum(TEXT_ITEM_KINDS),
});

export const deleteItemArgs = z.object({
  id: itemId,
});

export const retryIngestArgs = z.object({
  id: itemId,
});

export const setTagsArgs = z.object({
  itemId,
  // Full replacement set of the user's own topic tags for this item.
  names: z.array(z.string().trim().min(1).max(64)).max(50),
});

/** Loads an item and throws unless it exists and belongs to the caller. */
async function mustOwnItem(tx: Transaction, userID: string, id: string) {
  const item = await tx.run(zql.item.where("id", id).one());
  if (!item || item.userId !== userID) {
    throw new Error("Item not found");
  }
  return item;
}

export const mutators = defineMutators({
  item: {
    create: defineMutator(createItemArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const now = Date.now();

      let url: string | undefined;
      if (args.kind === "link") {
        const normalized = normalizeUrl(args.url!);
        if (!normalized) throw new Error("Invalid URL");
        url = normalized;
      }

      await tx.mutate.item.insert({
        id: args.id,
        userId: userID,
        kind: args.kind,
        createdAt: now,
        updatedAt: now,
        favorite: false,
        text: args.text,
        url,
        blobId: args.blobId,
      });
      await tx.mutate.itemContent.insert({
        itemId: args.id,
        status: needsIngest(args.kind) ? "pending" : "done",
      });

      if (tx.location === "server" && needsIngest(args.kind)) {
        // Server-only side effect (plan §7): enqueue an ingestion job in the
        // same transaction. ingest_job is not in the Zero schema, so this goes
        // through the adapter-agnostic raw SQL escape hatch.
        await tx.dbTransaction.query(
          `insert into ingest_job (id, item_id, user_id, status, run_after, created_at, updated_at)
           values ($1, $2, $3, 'queued', now(), now(), now())
           on conflict (id) do nothing`,
          [`ij_${args.id}`, args.id, userID],
        );
        // Wake the worker without waiting for its poll tick.
        await tx.dbTransaction.query(`select pg_notify('ingest_wake', $1)`, [args.id]);
      }
    }),

    edit: defineMutator(editItemArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnItem(tx, userID, args.id);
      await tx.mutate.item.update({
        id: args.id,
        text: args.text,
        updatedAt: Date.now(),
      });
    }),

    setFavorite: defineMutator(setFavoriteArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnItem(tx, userID, args.id);
      await tx.mutate.item.update({
        id: args.id,
        favorite: args.favorite,
        updatedAt: Date.now(),
      });
    }),

    setDone: defineMutator(setDoneArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const item = await mustOwnItem(tx, userID, args.id);
      if (item.kind !== "todo") throw new Error("Only todos can be completed");
      await tx.mutate.item.update({
        id: args.id,
        completedAt: args.done ? Date.now() : null,
        updatedAt: Date.now(),
      });
    }),

    // Reclassify a text item the user (or ingestion) typed wrong.
    setKind: defineMutator(setKindArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const item = await mustOwnItem(tx, userID, args.id);
      if (!isTextKind(item.kind)) {
        throw new Error(`A ${item.kind} cannot be reclassified`);
      }
      await tx.mutate.item.update({
        id: args.id,
        kind: args.kind,
        // Leaving todo drops the done state; it means nothing elsewhere.
        completedAt: args.kind === "todo" ? item.completedAt : null,
        updatedAt: Date.now(),
      });
    }),

    delete: defineMutator(deleteItemArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnItem(tx, userID, args.id);
      // Soft delete (plan §4); queries filter on deletedAt IS null.
      await tx.mutate.item.update({
        id: args.id,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }),

    // Manual re-run of failed (or stuck) ingestion; plan §7: failures are
    // non-fatal and retryable from the UI.
    retryIngest: defineMutator(retryIngestArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnItem(tx, userID, args.id);
      await tx.mutate.itemContent.update({
        itemId: args.id,
        status: "pending",
        error: null,
      });
      if (tx.location === "server") {
        await tx.dbTransaction.query(
          `insert into ingest_job (id, item_id, user_id, status, attempts, run_after, created_at, updated_at)
           values ($1, $2, $3, 'queued', 0, now(), now(), now())
           on conflict (id) do update
             set status = 'queued', attempts = 0, run_after = now(), last_error = null, updated_at = now()`,
          [`ij_${args.id}`, args.id, userID],
        );
        await tx.dbTransaction.query(`select pg_notify('ingest_wake', $1)`, [args.id]);
      }
    }),
  },

  tag: {
    // Replace the user-applied topic tags on an item. AI tags (source 'ai')
    // are left untouched; ingestion owns those.
    setForItem: defineMutator(setTagsArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnItem(tx, userID, args.itemId);

      const wanted = [...new Set(args.names.map((n) => n.trim().toLowerCase()).filter(Boolean))];

      const userTags = await tx.run(zql.tag.where("userId", userID).where("kind", "topic"));
      const tagIdByName = new Map(userTags.map((t) => [t.name, t.id]));

      // Create tag rows that don't exist yet. Ids are minted inside the
      // mutator, so the optimistic and authoritative runs mint different ids:
      // fine: the server result is authoritative and replaces local state.
      for (const name of wanted) {
        if (!tagIdByName.has(name)) {
          const id = newId();
          await tx.mutate.tag.insert({ id, userId: userID, name, kind: "topic" });
          tagIdByName.set(name, id);
        }
      }

      const wantedIds = new Set(wanted.map((name) => tagIdByName.get(name)!));
      const existing = await tx.run(zql.itemTag.where("itemId", args.itemId));

      for (const link of existing) {
        if (link.source === "user" && !wantedIds.has(link.tagId)) {
          await tx.mutate.itemTag.delete({ itemId: args.itemId, tagId: link.tagId });
        }
      }
      const already = new Set(existing.map((l) => l.tagId));
      for (const tagId of wantedIds) {
        if (!already.has(tagId)) {
          await tx.mutate.itemTag.insert({ itemId: args.itemId, tagId, source: "user" });
        }
      }
    }),
  },
});
