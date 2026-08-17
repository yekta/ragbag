import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { Transaction } from "@rocicorp/zero";
import {
  BEHAVIOUR_KINDS,
  FIELD_TYPES,
  catalogEntry,
  fieldRowsFor,
  freeName,
  isUuid,
  kindFromLabel,
  newId,
  slugFromLabel,
  typeRowFor,
} from "@ragbag/shared";
import type { EntityTypeFieldRow, EntityTypeRow } from "@ragbag/shared";
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

// --- entity types (plan §7.2) ---
//
// Validation here mirrors the check constraints on `entity_types` and
// `entity_type_fields`, because they are answering different questions: the
// database is the backstop that cannot be got round, and the mutator is the
// error message a person reads.

/** More than this on one type and the prompt is paying for a form, not a shape. */
export const MAX_TYPE_FIELDS = 24;

const typeFieldArgs = z
  .object({
    /** snake_case: one spelling for the jsonb key, the wire and the prompt. */
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "field names are snake_case: postal_code, not Postal Code"),
    label: z.string().trim().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    values: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    required: z.boolean().default(false),
    description: z.string().max(400).optional(),
    /** Place in the dedupe key, 1-based. Absent for a field outside it. */
    keyRank: z.number().int().positive().max(MAX_TYPE_FIELDS).optional(),
  })
  .refine(
    (spec) => (spec.type === "enum") === Boolean(spec.values?.length),
    "an enum field needs a list of values, and no other kind of field may have one",
  );

const typeFieldsArgs = z
  .array(typeFieldArgs)
  .min(1, "a type is its fields: it needs at least one")
  .max(MAX_TYPE_FIELDS)
  .refine(
    (fields) => new Set(fields.map((f) => f.name)).size === fields.length,
    "two fields cannot share a name: they would be one key in the data",
  )
  .refine((fields) => {
    const ranks = fields.map((f) => f.keyRank).filter((rank) => rank !== undefined);
    return new Set(ranks).size === ranks.length;
  }, "two fields cannot share a place in the key");

/** The copy every type carries, and the only part of one that is editable. */
const typeCopy = {
  label: z.string().trim().min(1).max(60),
  plural: z.string().trim().min(1).max(60),
  slug: z.string().regex(/^[a-z0-9-]{1,48}$/, "a slug is lowercase letters, digits and dashes"),
  icon: z.string().max(40),
  hint: z.string().trim().min(1).max(500),
  examples: z.array(z.string().trim().min(1).max(80)).max(10),
  titleTemplate: z.string().max(120).nullish(),
};

export const installEntityTypeArgs = z.object({ id: uuidArg, kind: z.string().max(40) });

export const createEntityTypeArgs = z.object({
  id: uuidArg,
  label: typeCopy.label,
  plural: typeCopy.plural,
  // Derived from the label when it is not given, and suffixed either way if
  // something else already answers to it.
  slug: typeCopy.slug.optional(),
  icon: typeCopy.icon.default("sparkles"),
  hint: typeCopy.hint,
  examples: typeCopy.examples.default([]),
  titleTemplate: typeCopy.titleTemplate,
  fields: typeFieldsArgs,
});

/** Everything but `kind`, which is immutable once entities reference it (§10.1). */
export const updateEntityTypeArgs = z.object({
  id: uuidArg,
  label: typeCopy.label.optional(),
  plural: typeCopy.plural.optional(),
  slug: typeCopy.slug.optional(),
  icon: typeCopy.icon.optional(),
  hint: typeCopy.hint.optional(),
  examples: typeCopy.examples.optional(),
  titleTemplate: typeCopy.titleTemplate,
  rail: z.boolean().optional(),
});

export const setEntityTypeEnabledArgs = z.object({ id: uuidArg, enabled: z.boolean() });
export const setEntityTypeFieldsArgs = z.object({ id: uuidArg, fields: typeFieldsArgs });
export const removeEntityTypeArgs = z.object({ id: uuidArg, deleteEntities: z.boolean() });

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

async function mustOwnType(tx: Transaction, userID: string, id: string) {
  const type = await tx.run(zql.entityTypes.where("id", id).one());
  if (!type || type.userId !== userID) throw new Error("Type not found");
  return type;
}

/**
 * Write one type and its fields.
 *
 * `version` starts at 1 and the field inserts each bump it again through the
 * trigger in migration 0001, so the authoritative row lands a few versions
 * higher than this optimistic one. Cosmetic: a version is only ever compared
 * against the one stamped on an entity, never shown.
 */
async function insertType(
  tx: Transaction,
  userID: string,
  id: string,
  row: EntityTypeRow & { origin: "catalog" | "user" },
  fields: readonly EntityTypeFieldRow[],
): Promise<void> {
  await tx.mutate.entityTypes.insert({
    id,
    userId: userID,
    kind: row.kind,
    label: row.label,
    plural: row.plural,
    slug: row.slug,
    icon: row.icon,
    hint: row.hint,
    titleTemplate: row.titleTemplate ?? undefined,
    examples: row.examples ?? [],
    rail: row.rail,
    enabled: row.enabled ?? true,
    origin: row.origin,
    version: 1,
  });
  await insertFields(tx, id, fields);
}

/** Field rows in array order, because that order IS `position`. */
async function insertFields(
  tx: Transaction,
  typeId: string,
  fields: readonly EntityTypeFieldRow[],
): Promise<void> {
  for (const [position, spec] of fields.entries()) {
    await tx.mutate.entityTypeFields.insert({
      id: newId(),
      typeId,
      name: spec.name,
      label: spec.label,
      type: spec.type,
      values: spec.values ?? undefined,
      required: spec.required,
      description: spec.description ?? undefined,
      position,
      keyRank: spec.keyRank ?? undefined,
    });
  }
}

/** What the settings form sends, as the rows the two tables hold. */
function fieldRowsFromArgs(
  fields: z.infer<typeof setEntityTypeFieldsArgs>["fields"],
): EntityTypeFieldRow[] {
  return fields.map((spec, position) => ({
    name: spec.name,
    label: spec.label,
    type: spec.type,
    values: spec.values ?? null,
    required: spec.required,
    description: spec.description ?? null,
    position,
    keyRank: spec.keyRank ?? null,
  }));
}

/**
 * Everything of one kind, gone: the deliberate half of deleting a type
 * (plan §9.2), behind a typed confirmation in the UI.
 *
 * One statement on the server, because an archive holds thousands of links and
 * `message_entities` cascades from `entities` in Postgres. The optimistic run
 * has neither a cascade nor a bulk delete, so it walks the rows, mentions
 * first: a mention whose entity is gone is a row every view would have to
 * guard against.
 */
async function deleteEntitiesOfKind(tx: Transaction, userID: string, kind: string): Promise<void> {
  if (tx.location === "server") {
    await tx.dbTransaction.query("delete from entities where user_id = $1 and kind = $2", [
      userID,
      kind,
    ]);
    return;
  }
  for (const entity of await tx.run(zql.entities.where("userId", userID).where("kind", kind))) {
    for (const mention of await tx.run(zql.messageEntities.where("entityId", entity.id))) {
      await tx.mutate.messageEntities.delete({ id: mention.id });
    }
    await tx.mutate.entities.delete({ id: entity.id });
  }
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

  /**
   * The settings screen, as mutations. A type is the user's own row, so adding,
   * editing, disabling and deleting one are ordinary writes against the tables
   * every client already syncs, with no server API of their own.
   */
  entityType: {
    /**
     * Copy a catalog entry into this user's rows. The catalog is in
     * @ragbag/shared, so the optimistic run has exactly the data the server
     * does, and this is also how a deleted type is restored.
     */
    install: defineMutator(installEntityTypeArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const def = catalogEntry(args.kind);
      if (!def) throw new Error(`There is no ${args.kind} in the catalog`);
      const mine = await tx.run(zql.entityTypes.where("userId", userID));
      if (mine.some((type) => type.kind === def.kind)) {
        throw new Error(`You already have ${def.plural}`);
      }
      await insertType(
        tx,
        userID,
        args.id,
        {
          ...typeRowFor(def),
          // The kind is the catalog's, and it is free (checked above). The slug
          // is a URL, and a type the user made could be sitting on it.
          slug: freeName(
            def.slug,
            mine.map((type) => type.slug),
            { separator: "-", max: 48 },
          ),
          origin: "catalog",
        },
        fieldRowsFor(def),
      );
    }),

    create: defineMutator(createEntityTypeArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const mine = await tx.run(zql.entityTypes.where("userId", userID));
      // Derived once, here, because a kind is what every entity of this type
      // will reference and there is no renaming it afterwards (plan §10.1).
      // The behaviour kinds are in the taken list on purpose: a user type that
      // landed on `link` by accident would inherit the URL matcher and the page
      // fetcher, so calling a type "Links" gets `links` or `links_2` instead.
      const kind = freeName(kindFromLabel(args.label), [
        ...mine.map((type) => type.kind),
        ...BEHAVIOUR_KINDS,
      ]);
      await insertType(
        tx,
        userID,
        args.id,
        {
          kind,
          label: args.label,
          plural: args.plural,
          slug: freeName(
            args.slug ?? slugFromLabel(args.label),
            mine.map((type) => type.slug),
            { separator: "-", max: 48 },
          ),
          icon: args.icon,
          hint: args.hint,
          titleTemplate: args.titleTemplate ?? null,
          examples: args.examples,
          rail: true,
          version: 1,
          origin: "user",
        },
        fieldRowsFromArgs(args.fields),
      );
    }),

    /** The copy, never the kind. Renaming "Phone Numbers" is a user action. */
    update: defineMutator(updateEntityTypeArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnType(tx, userID, args.id);
      let slug: string | undefined;
      if (args.slug !== undefined) {
        const mine = await tx.run(zql.entityTypes.where("userId", userID));
        slug = freeName(
          args.slug,
          mine.filter((type) => type.id !== args.id).map((type) => type.slug),
          { separator: "-", max: 48 },
        );
      }
      // Only what was actually sent: an absent key is "leave it alone", which
      // is what makes this one mutator serve the whole editor and the rail
      // toggle without either of them having to send the other's fields.
      await tx.mutate.entityTypes.update({
        id: args.id,
        ...(args.label !== undefined ? { label: args.label } : {}),
        ...(args.plural !== undefined ? { plural: args.plural } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(args.icon !== undefined ? { icon: args.icon } : {}),
        ...(args.hint !== undefined ? { hint: args.hint } : {}),
        ...(args.examples !== undefined ? { examples: args.examples } : {}),
        ...(args.titleTemplate !== undefined ? { titleTemplate: args.titleTemplate ?? null } : {}),
        ...(args.rail !== undefined ? { rail: args.rail } : {}),
      });
    }),

    /** Stop extracting, keep everything. The gentlest of the three (§9.2). */
    setEnabled: defineMutator(setEntityTypeEnabledArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnType(tx, userID, args.id);
      await tx.mutate.entityTypes.update({ id: args.id, enabled: args.enabled });
    }),

    /**
     * Replace-all: one form submit is one mutation, covering add, edit, remove
     * and reorder together. Editing is safe by construction: the trigger bumps
     * the version, the next ingest under a newer version replaces `data` rather
     * than merging into it, and a value whose field is gone still shows at the
     * end of Details under a humanized label.
     */
    setFields: defineMutator(setEntityTypeFieldsArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      await mustOwnType(tx, userID, args.id);
      for (const row of await tx.run(zql.entityTypeFields.where("typeId", args.id))) {
        await tx.mutate.entityTypeFields.delete({ id: row.id });
      }
      await insertFields(tx, args.id, fieldRowsFromArgs(args.fields));
    }),

    /**
     * Delete the type, and its things only if that is what was asked for.
     *
     * Without `deleteEntities` the entities stay: `entities.kind` is open text,
     * so they render through the generic card under a humanized version of
     * their own kind. They stop being browsable as a group, which is what the
     * dialog says out loud.
     */
    remove: defineMutator(removeEntityTypeArgs, async ({ tx, ctx, args }) => {
      const { userID } = mustBeLoggedIn(ctx);
      const type = await mustOwnType(tx, userID, args.id);
      if (args.deleteEntities) await deleteEntitiesOfKind(tx, userID, type.kind);
      // Postgres cascades these; the local store has no cascade of its own, so
      // the optimistic run drops them itself.
      for (const row of await tx.run(zql.entityTypeFields.where("typeId", args.id))) {
        await tx.mutate.entityTypeFields.delete({ id: row.id });
      }
      await tx.mutate.entityTypes.delete({ id: args.id });
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
