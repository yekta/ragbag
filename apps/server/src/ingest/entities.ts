import { log, newId, normalizeEntity, parseEntityData } from "@ragbag/shared";
import type { MentionSource } from "@ragbag/shared";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  attachmentTags,
  entities,
  entityTags,
  messageEntities,
  messageTags,
  tags,
} from "../db/schema.js";

// The idempotent write at the end of synthesis (plan §5.5). Re-running must
// converge, not accumulate, and it must never step on anything the user did.
//
// Two tables, for the reason the whole design turns on (plan §2.3): an entity
// is the thing, a mention is one place it showed up. The entity is canonical
// per user and deduplicated by (kind, normalized_value); the mention carries
// what is true about the occurrence rather than about the thing.

export type ResolvedEntity = {
  kind: string;
  /** The display form, as found. */
  value: string;
  /** Per-kind structure; already validated against the registry. */
  data: Record<string, unknown>;
  normalizedValue: string;
  generatedTitle?: string | null;
  generatedSummary?: string | null;
  /** Topic tags the model put on the thing itself. */
  topics?: string[];
  mention: {
    attachmentId: string | null;
    source: MentionSource;
    confidence: number | null;
    snippet: string | null;
  };
};

/**
 * Validate one candidate against its registry entry. Anything that fails is
 * dropped rather than written: a card that cannot render its own data is
 * worse than a missing entity, and a normalizer that is unsure would rather
 * miss a merge than make a wrong one.
 */
export function resolveEntity(input: {
  kind: string;
  value: string;
  data: unknown;
}): { kind: string; value: string; data: Record<string, unknown>; normalizedValue: string } | null {
  const value = input.value.trim();
  if (!value) return null;
  const data = parseEntityData(input.kind, input.data);
  if (!data) return null;
  const normalizedValue = normalizeEntity(input.kind, value, data);
  if (!normalizedValue) return null;
  return { kind: input.kind, value, data, normalizedValue };
}

/**
 * Write one message's entities and mentions, converging on whatever the run
 * found.
 *
 * The delete is scoped to ingestion's own rows: `source in ('regex','ai')` and
 * `dismissed_at is null`, so a mention the user added by hand and a mention
 * they dismissed both survive every future run. That tombstone is what makes
 * re-ingestion safe: dismiss a hallucinated address once and it stays
 * dismissed.
 */
export async function writeEntities(input: {
  userId: string;
  messageId: string;
  found: readonly ResolvedEntity[];
}): Promise<{ key: string; entityId: string }[]> {
  const { userId, messageId } = input;
  const written: { key: string; entityId: string }[] = [];

  // What the user has already said "no" to on this message, at any of its
  // parts: dismissing an address means the address, not that one occurrence.
  const tombstoned = new Set(
    (
      await db
        .select({ entityId: messageEntities.entityId })
        .from(messageEntities)
        .where(
          and(
            eq(messageEntities.messageId, messageId),
            dsql`${messageEntities.dismissedAt} is not null`,
          ),
        )
    ).map((r) => r.entityId),
  );

  await db
    .delete(messageEntities)
    .where(
      and(
        eq(messageEntities.messageId, messageId),
        inArray(messageEntities.source, ["regex", "ai"]),
        dsql`${messageEntities.dismissedAt} is null`,
      ),
    );

  for (const found of input.found) {
    // `data = entities.data || excluded.data` merges rather than replaces: a
    // later run that learned less about a link (no page fetch, say) must not
    // throw away the title an earlier one found.
    const [row] = await db
      .insert(entities)
      .values({
        id: newId(),
        userId,
        kind: found.kind,
        value: found.value,
        normalizedValue: found.normalizedValue,
        data: found.data,
        generatedTitle: found.generatedTitle ?? null,
        generatedSummary: found.generatedSummary ?? null,
      })
      .onConflictDoUpdate({
        target: [entities.userId, entities.kind, entities.normalizedValue],
        set: {
          data: dsql`${entities.data} || excluded.data`,
          value: dsql`excluded.value`,
          generatedTitle: dsql`coalesce(excluded.generated_title, ${entities.generatedTitle})`,
          generatedSummary: dsql`coalesce(excluded.generated_summary, ${entities.generatedSummary})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: entities.id });
    if (!row) continue;
    written.push({ key: `${found.kind}:${found.normalizedValue}`, entityId: row.id });

    if (tombstoned.has(row.id)) continue;

    await db
      .insert(messageEntities)
      .values({
        id: newId(),
        messageId,
        entityId: row.id,
        attachmentId: found.mention.attachmentId,
        userId,
        source: found.mention.source,
        confidence: found.mention.confidence,
        snippet: found.mention.snippet,
      })
      .onConflictDoNothing();

    if (found.topics?.length) {
      await applyAiTags({ userId, topics: found.topics, entityId: row.id });
    }
  }

  return written;
}

/**
 * Entities with no live mention are filtered from every view (the queries do
 * that), so orphans are cosmetic rather than wrong. This is the optional GC:
 * rows nothing points at any more, after a message was deleted or re-read.
 */
export async function collectOrphanEntities(userId: string): Promise<number> {
  const deleted = await db
    .delete(entities)
    .where(
      and(
        eq(entities.userId, userId),
        dsql`not exists (select 1 from message_entities me where me.entity_id = ${entities.id})`,
      ),
    )
    .returning({ id: entities.id });
  if (deleted.length > 0) log.debug("collected orphan entities", { userId, n: deleted.length });
  return deleted.length;
}

// --- tags ---
//
// Ingestion owns `source = 'ai'` and replaces them wholesale on every run.
// User tags are never touched and win when the AI picks the same name: the
// junction's primary key is (thing, tag), so an insert that would duplicate a
// user row simply does nothing.

const MAX_TAGS = 20;

/**
 * Replace one thing's AI tags. Names are lowercased and deduped here so the
 * user's vocabulary converges instead of fragmenting on case.
 */
export async function applyAiTags(input: {
  userId: string;
  topics: readonly string[];
  types?: readonly string[];
  messageId?: string;
  attachmentId?: string;
  entityId?: string;
}): Promise<void> {
  const planned = [
    ...(input.types ?? []).map((name) => ({ kind: "type" as const, name })),
    ...input.topics.map((name) => ({ kind: "topic" as const, name })),
  ]
    .map((t) => ({ ...t, name: t.name.trim().toLowerCase().slice(0, 64) }))
    .filter((t) => t.name.length > 0);

  // One row per NAME, most specific kind first: the model routinely returns
  // the same word as a type and a topic, and those are separate rows in
  // `tags` (the key is user+kind+name), so both used to be attached and the
  // card showed the same word twice.
  const byName = new Map<string, { kind: "type" | "topic"; name: string }>();
  for (const tag of planned) if (!byName.has(tag.name)) byName.set(tag.name, tag);
  const wanted = [...byName.values()].slice(0, MAX_TAGS);

  if (wanted.length > 0) {
    await db
      .insert(tags)
      .values(wanted.map((t) => ({ id: newId(), userId: input.userId, ...t })))
      .onConflictDoNothing();
  }

  const rows =
    wanted.length > 0
      ? await db
          .select({ id: tags.id, kind: tags.kind, name: tags.name })
          .from(tags)
          .where(
            and(
              eq(tags.userId, input.userId),
              inArray(
                tags.name,
                wanted.map((t) => t.name),
              ),
            ),
          )
      : [];
  const wantedIds = rows.filter((r) => byName.get(r.name)?.kind === r.kind).map((r) => r.id);

  if (input.messageId) {
    await db
      .delete(messageTags)
      .where(and(eq(messageTags.messageId, input.messageId), eq(messageTags.source, "ai")));
    if (wantedIds.length > 0) {
      await db
        .insert(messageTags)
        .values(
          wantedIds.map((tagId) => ({
            messageId: input.messageId!,
            tagId,
            source: "ai" as const,
          })),
        )
        .onConflictDoNothing(); // a user tag on the same tag id wins
    }
  }

  if (input.attachmentId) {
    await db
      .delete(attachmentTags)
      .where(
        and(eq(attachmentTags.attachmentId, input.attachmentId), eq(attachmentTags.source, "ai")),
      );
    if (wantedIds.length > 0) {
      await db
        .insert(attachmentTags)
        .values(
          wantedIds.map((tagId) => ({
            attachmentId: input.attachmentId!,
            tagId,
            source: "ai" as const,
          })),
        )
        .onConflictDoNothing();
    }
  }

  if (input.entityId) {
    await db
      .delete(entityTags)
      .where(and(eq(entityTags.entityId, input.entityId), eq(entityTags.source, "ai")));
    if (wantedIds.length > 0) {
      await db
        .insert(entityTags)
        .values(
          wantedIds.map((tagId) => ({
            entityId: input.entityId!,
            tagId,
            source: "ai" as const,
          })),
        )
        .onConflictDoNothing();
    }
  }
}

/** The owner's topic vocabulary, fed to the prompt so tags converge. */
export async function existingTopicNames(userId: string, limit = 300): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.kind, "topic")))
    .limit(limit);
  return rows.map((r) => r.name);
}
