import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { Transaction } from "@rocicorp/zero";
import { isUuid, newId } from "@ragbag/shared";
import { z } from "zod";
import { mustBeLoggedIn } from "./context.js";
import { zql } from "./schema.js";

// Shared custom mutators (plan §4.2): the client runs them optimistically
// against its local store; zero-cache forwards each mutation to
// /api/zero/mutate where the SAME function runs authoritatively (Zod-validated
// args, ctx from the server session, Postgres writes, server-only side
// effects).
//
// Conflict policy is last-writer-wins per mutation: single-user data, no CRDTs.

/** One send carries at most this many files (plan §8.5: said out loud in the UI). */
export const MAX_ATTACHMENTS = 10;

const uuidArg = z.string().refine(isUuid, "id must be a UUID");

const attachmentArgs = z.object({
  id: uuidArg,
  blobId: uuidArg,
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  // Known on the capturing device before the server sees the file, so the
  // bubble has its geometry from the first frame on every device (plan §8.3).
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  placeholder: z.string().max(1_024).optional(),
  waveform: z.array(z.number()).max(512).optional(),
});

export const createMessageArgs = z
  .object({
    id: uuidArg,
    text: z.string().max(100_000).optional(),
    attachments: z.array(attachmentArgs).max(MAX_ATTACHMENTS).default([]),
  })
  .refine(
    (args) => Boolean(args.text?.trim()) || args.attachments.length > 0,
    "a message needs text, a file, or both",
  )
  // The composer enforces this too, and has to: it is what the counter on the
  // attach button counts. But the client is not the only writer.
  .refine(
    (args) => new Set(args.attachments.map((a) => a.id)).size === args.attachments.length,
    "attachment ids must be distinct",
  );

export const editMessageArgs = z.object({ id: uuidArg, text: z.string().max(100_000) });
export const setFavoriteArgs = z.object({ id: uuidArg, favorite: z.boolean() });
export const deleteMessageArgs = z.object({ id: uuidArg });
export const retryIngestArgs = z.object({ id: uuidArg });
export const retryAttachmentArgs = z.object({ id: uuidArg });

export const mentionArgs = z.object({
  messageId: uuidArg,
  entityId: uuidArg,
  attachmentId: uuidArg.nullish(),
});

const tagNames = z.array(z.string().trim().min(1).max(64)).max(50);
export const setMessageTagsArgs = z.object({ messageId: uuidArg, names: tagNames });
export const setAttachmentTagsArgs = z.object({ attachmentId: uuidArg, names: tagNames });
export const setEntityTagsArgs = z.object({ entityId: uuidArg, names: tagNames });

/** Loads a message and throws unless it exists and belongs to the caller. */
async function mustOwnMessage(tx: Transaction, userID: string, id: string) {
  const message = await tx.run(zql.messages.where("id", id).one());
  if (!message || message.userId !== userID) throw new Error("Message not found");
  return message;
}

async function mustOwnAttachment(tx: Transaction, userID: string, id: string) {
  const attachment = await tx.run(zql.attachments.where("id", id).one());
  if (!attachment || attachment.userId !== userID) throw new Error("Attachment not found");
  return attachment;
}

async function mustOwnEntity(tx: Transaction, userID: string, id: string) {
  const entity = await tx.run(zql.entities.where("id", id).one());
  if (!entity || entity.userId !== userID) throw new Error("Entity not found");
  return entity;
}

/**
 * Fan out the ingestion jobs for a message: one per attachment plus one for
 * synthesis, all queued in this same transaction, then wake the worker.
 *
 * `ingest_jobs` is not in the Zero schema, so this goes through the
 * adapter-agnostic raw SQL escape hatch, and only on the authoritative run.
 * The conflict target is the (message, attachment, stage) unique index, so a
 * retry re-arms the existing row rather than piling up duplicates.
 *
 * Synthesis is queued alongside the parts rather than after them: its handler
 * checks for non-terminal attachment jobs and throws WaitingError, which the
 * worker already treats as "reschedule without burning an attempt". No
 * dependency graph, and it reuses the mechanism that handles the
 * blob-not-yet-uploaded case (plan §5.1).
 */
async function enqueueIngest(
  tx: Transaction,
  userID: string,
  messageId: string,
  attachmentIds: readonly string[],
): Promise<void> {
  if (tx.location !== "server") return;

  const upsert = `insert into ingest_jobs
      (id, message_id, attachment_id, stage, user_id, status, attempts, run_after, created_at, updated_at)
    values (gen_random_uuid(), $1, $2, $3, $4, 'queued', 0, now(), now(), now())
    on conflict (message_id, attachment_id, stage) do update
      set status = 'queued', attempts = 0, run_after = now(),
          last_error = null, updated_at = now()`;

  for (const attachmentId of attachmentIds) {
    await tx.dbTransaction.query(upsert, [messageId, attachmentId, "attachment", userID]);
  }
  await tx.dbTransaction.query(upsert, [messageId, null, "synthesis", userID]);
  // Wake the worker without waiting for its poll tick.
  await tx.dbTransaction.query(`select pg_notify('ingest_wake', $1)`, [messageId]);
}

/**
 * Resolve tag names to ids, creating the rows that do not exist yet.
 *
 * Ids are minted inside the mutator, so the optimistic and authoritative runs
 * mint different ones: fine, the server result is authoritative and replaces
 * local state.
 */
async function resolveTagIds(
  tx: Transaction,
  userID: string,
  names: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const existing = await tx.run(zql.tags.where("userId", userID).where("kind", "topic"));
  const idByName = new Map(existing.map((t) => [t.name, t.id]));
  for (const name of wanted) {
    if (!idByName.has(name)) {
      const id = newId();
      await tx.mutate.tags.insert({ id, userId: userID, name, kind: "topic" });
      idByName.set(name, id);
    }
  }
  return new Set(wanted.map((name) => idByName.get(name)!));
}

export const mutators = defineMutators({
  message: {
    /**
     * One send: the message row, its attachment rows in the order they were
     * picked, and the jobs that will read them. Attachments are immutable
     * after this, the same as every messaging app.
     */
    create: defineMutator(createMessageArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const now = Date.now();
      const text = args.text?.trim() || undefined;

      await tx.mutate.messages.insert({
        id: args.id,
        userId: userID,
        createdAt: now,
        updatedAt: now,
        favorite: false,
        text,
        status: "pending",
      });

      // `position` is the index in the array the composer sent, which is the
      // order the files were picked in: contiguous from zero by construction.
      for (const [position, a] of args.attachments.entries()) {
        await tx.mutate.attachments.insert({
          id: a.id,
          messageId: args.id,
          userId: userID,
          position,
          blobId: a.blobId,
          filename: a.filename,
          mime: a.mime,
          size: a.size,
          width: a.width,
          height: a.height,
          durationMs: a.durationMs,
          placeholder: a.placeholder,
          waveform: a.waveform,
          variants: {},
          status: "pending",
        });
      }

      await enqueueIngest(
        tx,
        userID,
        args.id,
        args.attachments.map((a) => a.id),
      );
    }),

    /** Editing the text re-runs synthesis only, never per-attachment extraction. */
    edit: defineMutator(editMessageArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnMessage(tx, userID, args.id);
      await tx.mutate.messages.update({
        id: args.id,
        text: args.text.trim() || null,
        updatedAt: Date.now(),
      });
      await enqueueIngest(tx, userID, args.id, []);
    }),

    setFavorite: defineMutator(setFavoriteArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnMessage(tx, userID, args.id);
      await tx.mutate.messages.update({
        id: args.id,
        favorite: args.favorite,
        updatedAt: Date.now(),
      });
    }),

    delete: defineMutator(deleteMessageArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnMessage(tx, userID, args.id);
      // Soft delete (plan §3.1); every query filters on deletedAt IS null.
      await tx.mutate.messages.update({
        id: args.id,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }),

    /** Manual re-run: every part that did not finish, plus synthesis. */
    retryIngest: defineMutator(retryIngestArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnMessage(tx, userID, args.id);
      const parts = await tx.run(zql.attachments.where("messageId", args.id));
      const retrying = parts.filter((a) => a.status !== "done");
      for (const part of retrying) {
        await tx.mutate.attachments.update({ id: part.id, status: "pending", error: null });
      }
      await tx.mutate.messages.update({ id: args.id, status: "pending", error: null });
      await enqueueIngest(
        tx,
        userID,
        args.id,
        retrying.map((a) => a.id),
      );
    }),
  },

  attachment: {
    /**
     * Re-run one part. Synthesis rides along: a part that finally extracts
     * changes what the message is about, and leaving the summary and entities
     * describing an archive without it is the stale state this retry exists
     * to clear.
     */
    retry: defineMutator(retryAttachmentArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const attachment = await mustOwnAttachment(tx, userID, args.id);
      await tx.mutate.attachments.update({ id: args.id, status: "pending", error: null });
      await tx.mutate.messages.update({
        id: attachment.messageId,
        status: "processing",
        error: null,
      });
      await enqueueIngest(tx, userID, attachment.messageId, [args.id]);
    }),
  },

  entity: {
    /**
     * The tombstone that makes re-ingestion safe: a dismissed mention is
     * skipped by every future run, so a hallucinated address stays gone
     * (plan §2.3).
     */
    dismiss: defineMutator(mentionArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await setDismissed(tx, userID, args, Date.now());
    }),

    restore: defineMutator(mentionArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await setDismissed(tx, userID, args, null);
    }),
  },

  tag: {
    // Replace the user-applied topic tags on one thing. AI tags (source 'ai')
    // are left untouched; ingestion owns those and replaces them wholesale on
    // every run.
    setForMessage: defineMutator(setMessageTagsArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnMessage(tx, userID, args.messageId);
      const wanted = await resolveTagIds(tx, userID, args.names);
      const existing = await tx.run(zql.messageTags.where("messageId", args.messageId));
      for (const link of existing) {
        if (link.source === "user" && !wanted.has(link.tagId)) {
          await tx.mutate.messageTags.delete({ messageId: args.messageId, tagId: link.tagId });
        }
      }
      const already = new Set(existing.map((l) => l.tagId));
      for (const tagId of wanted) {
        if (!already.has(tagId)) {
          await tx.mutate.messageTags.insert({
            messageId: args.messageId,
            tagId,
            source: "user",
          });
        }
      }
    }),

    setForAttachment: defineMutator(setAttachmentTagsArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnAttachment(tx, userID, args.attachmentId);
      const wanted = await resolveTagIds(tx, userID, args.names);
      const existing = await tx.run(zql.attachmentTags.where("attachmentId", args.attachmentId));
      for (const link of existing) {
        if (link.source === "user" && !wanted.has(link.tagId)) {
          await tx.mutate.attachmentTags.delete({
            attachmentId: args.attachmentId,
            tagId: link.tagId,
          });
        }
      }
      const already = new Set(existing.map((l) => l.tagId));
      for (const tagId of wanted) {
        if (!already.has(tagId)) {
          await tx.mutate.attachmentTags.insert({
            attachmentId: args.attachmentId,
            tagId,
            source: "user",
          });
        }
      }
    }),

    setForEntity: defineMutator(setEntityTagsArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnEntity(tx, userID, args.entityId);
      const wanted = await resolveTagIds(tx, userID, args.names);
      const existing = await tx.run(zql.entityTags.where("entityId", args.entityId));
      for (const link of existing) {
        if (link.source === "user" && !wanted.has(link.tagId)) {
          await tx.mutate.entityTags.delete({ entityId: args.entityId, tagId: link.tagId });
        }
      }
      const already = new Set(existing.map((l) => l.tagId));
      for (const tagId of wanted) {
        if (!already.has(tagId)) {
          await tx.mutate.entityTags.insert({ entityId: args.entityId, tagId, source: "user" });
        }
      }
    }),
  },
});

/** Dismiss/restore share everything but the timestamp they write. */
async function setDismissed(
  tx: Transaction,
  userID: string,
  args: z.infer<typeof mentionArgs>,
  dismissedAt: number | null,
): Promise<void> {
  await mustOwnMessage(tx, userID, args.messageId);
  const mentions = await tx.run(
    zql.messageEntities.where("messageId", args.messageId).where("entityId", args.entityId),
  );
  const target = mentions.find((m) => (m.attachmentId ?? null) === (args.attachmentId ?? null));
  if (!target) throw new Error("Mention not found");
  await tx.mutate.messageEntities.update({ id: target.id, dismissedAt });
}
