import { groupHits, TimelineSearchIndex } from "@ragbag/client-runtime";
import type { TResultGroup, TSearchDoc, TSearchHit } from "@ragbag/client-runtime";
import type { TEntityTypes } from "@ragbag/shared";
import { useEffect, useMemo, useRef } from "react";
import type {
  TAttachment,
  TAttachmentContent,
  TMessages,
  TEntityRow,
  TEntityRows,
  TMessage,
} from "@ragbag/client-runtime/rows";

// Feeds the local index (client-runtime) from Zero's live queries.
//
// Byte for byte the web app's lib/search.ts, save for where the row types come
// from. That is not laziness: the index, the ranking and the grouping are
// `@ragbag/client-runtime` and are pure, so what is left here is the part that
// needs Zero, and there is nothing about "which rows still exist and what do I
// render them from" that a phone answers differently.

// Three doc
// types share one index (plan §7), built in two passes:
//
//   1. the `messages` query lands: titles, summaries, tags, entity values,
//      filenames. Search works instantly over all of it.
//   2. the `contents` query lands (chained behind it, see app.tsx): the same
//      docs again, now carrying each attachment's `content_md`.
//
// `TimelineSearchIndex.sync()` is diff-based, so the second pass is the same
// call with richer docs and only the changed ones are touched.
//
// Results come back in two sections, Messages and Things (client-runtime's
// `groupHits`). Things means what the sidebar means by it: the pictures and
// files inside messages as much as what the pipeline found in them, each its
// own row rather than folded into the message that carried it.

function messageDoc(message: TMessage): TSearchDoc {
  return {
    id: `message:${message.id}`,
    type: "message",
    messageId: message.id,
    targetId: message.id,
    title: message.generatedTitle ?? "",
    text: message.text ?? "",
    summary: message.generatedSummary ?? "",
    tags: message.tags
      .map((t) => t.tag?.name)
      .filter(Boolean)
      .join(" "),
    // Every entity value found in this message: what makes a tracking number
    // or a vendor name find the message it came in.
    entities: message.mentions
      .map((m) => [m.entity?.value, m.entity?.generatedTitle].filter(Boolean).join(" "))
      .join(" "),
    // Attachment names and titles, so "the pdf about invoices" finds it.
    body: message.attachments
      .map((a) => [a.filename, a.generatedTitle, a.generatedSummary].filter(Boolean).join(" "))
      .join(" "),
  };
}

function attachmentDocs(message: TMessage, bodies: ReadonlyMap<string, string>): TSearchDoc[] {
  return message.attachments.map((attachment) => ({
    id: `attachment:${attachment.id}`,
    type: "attachment" as const,
    messageId: message.id,
    targetId: attachment.id,
    title: attachment.generatedTitle ?? attachment.filename,
    text: attachment.filename,
    summary: attachment.generatedSummary ?? "",
    tags: "",
    entities: "",
    // Empty on the first pass; filled by the second (plan §7).
    body: bodies.get(attachment.id) ?? "",
  }));
}

/**
 * One doc per thing, from the canonical rows rather than from the messages that
 * mention it: a thing is one row in the Things section no matter how many
 * messages carry it, and it has no `messageId` at all.
 *
 * The type's own vocabulary rides along, so "brand" finds every brand and a
 * field's label finds what is under it.
 */
function entityDocs(entities: TEntityRows, types: TEntityTypes): TSearchDoc[] {
  const docs: TSearchDoc[] = [];
  for (const entity of entities) {
    // An entity with no live mention is not in any view, so it is not a result.
    if (entity.mentions.length === 0) continue;
    const data = entity.data as Record<string, unknown>;
    const fields = types.fieldEntries(entity.kind, data);
    docs.push({
      id: `entity:${entity.id}`,
      type: "entity",
      targetId: entity.id,
      title: entity.generatedTitle ?? entity.value,
      text: entity.value,
      summary: entity.generatedSummary ?? "",
      tags: [
        types.label(entity.kind),
        types.sidebarTitle(entity.kind),
        ...entity.tags.map((t) => t.tag?.name).filter(Boolean),
      ].join(" "),
      // The fields, with their labels: a vendor, a locality, a carrier, a
      // tagline are all things people search for by name.
      entities: fields.map((field) => `${field.label} ${field.value}`).join(" "),
      body: "",
    });
  }
  return docs;
}

export function buildSearchDocs(
  messages: TMessages,
  contents: readonly TAttachmentContent[],
  entities: TEntityRows,
  types: TEntityTypes,
): TSearchDoc[] {
  const bodies = new Map(contents.map((c) => [c.attachmentId, c.contentMd]));
  const docs: TSearchDoc[] = [];
  for (const message of messages) {
    docs.push(messageDoc(message));
    docs.push(...attachmentDocs(message, bodies));
  }
  docs.push(...entityDocs(entities, types));
  return docs;
}

export function useTimelineSearch(
  messages: TMessages,
  contents: readonly TAttachmentContent[],
  entities: TEntityRows,
  types: TEntityTypes,
): TimelineSearchIndex {
  const indexRef = useRef<TimelineSearchIndex | null>(null);
  indexRef.current ??= new TimelineSearchIndex();

  useEffect(() => {
    indexRef.current!.sync(buildSearchDocs(messages, contents, entities, types));
  }, [messages, contents, entities, types]);

  return indexRef.current;
}

export { RESULT_GROUPS } from "@ragbag/client-runtime";
export type { TResultGroup } from "@ragbag/client-runtime";

/** One row of results: a message, or a thing (a file, or something found in one). */
export type TResult = {
  group: TResultGroup;
  /** Which hit put it here, for its score and the terms it matched. */
  hit: TSearchHit;
  /** The message this row opens: a Messages row's own, or the one a file came in. */
  message?: TMessage;
  /** A Things row that is a file, alongside the message above. */
  attachment?: TAttachment;
  /** A Things row that is an entity. */
  entity?: TEntityRow;
};

/**
 * Hits joined back to their live rows, grouped and collapsed.
 *
 * The grouping itself is `groupHits` in client-runtime (pure, and tested there);
 * this is the part that needs Zero: which messages and things still exist, and
 * the rows to render them from.
 */
export function useSearchResults(
  index: TimelineSearchIndex,
  messages: TMessages,
  entities: TEntityRows,
  query: string,
): TResult[] {
  // Keyed on the archive rather than on the query: these three answer both
  // "does this still exist" and "what do I render it from", and neither
  // question changes between keystrokes.
  const live = useMemo(() => {
    const byMessage = new Map(messages.map((m) => [m.id, m]));
    const byEntity = new Map(entities.map((e) => [e.id, e]));
    // A file is its own row now, so it is addressed by its own id, and the
    // message it came in rides along: that is what the row opens.
    const byAttachment = new Map<string, { message: TMessage; attachment: TAttachment }>();
    for (const message of messages) {
      for (const attachment of message.attachments) {
        byAttachment.set(attachment.id, { message, attachment });
      }
    }
    return { byMessage, byAttachment, byEntity };
  }, [messages, entities]);

  return useMemo(() => {
    const hits = index.search(query);
    if (hits.length === 0) return [];
    const { byMessage, byAttachment, byEntity } = live;

    return groupHits(hits, {
      hasMessage: (id) => byMessage.has(id),
      hasAttachment: (id) => byAttachment.has(id),
      hasEntity: (id) => byEntity.has(id),
    }).map((row) => {
      const file = row.attachmentId ? byAttachment.get(row.attachmentId) : undefined;
      return {
        group: row.group,
        hit: row.hit,
        message: file?.message ?? (row.messageId ? byMessage.get(row.messageId) : undefined),
        attachment: file?.attachment,
        entity: row.entityId ? byEntity.get(row.entityId) : undefined,
      };
    });
  }, [index, live, query]);
}
