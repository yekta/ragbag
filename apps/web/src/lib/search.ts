import { groupHits, TimelineSearchIndex } from "@ragbag/client-runtime";
import type { ResultGroup, SearchDoc, SearchHit } from "@ragbag/client-runtime";
import type { EntityTypes } from "@ragbag/shared";
import { useEffect, useMemo, useRef } from "react";
import type {
  Attachment,
  AttachmentContent,
  Drop,
  EntityRow,
  EntityRows,
  Message,
} from "./types.js";

// Feeds the local index (client-runtime) from Zero's live queries. Three doc
// types share one index (plan §7), built in two passes:
//
//   1. the `drop` query lands: titles, summaries, tags, entity values,
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

function messageDoc(message: Message): SearchDoc {
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

function attachmentDocs(message: Message, bodies: ReadonlyMap<string, string>): SearchDoc[] {
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
function entityDocs(entities: EntityRows, types: EntityTypes): SearchDoc[] {
  const docs: SearchDoc[] = [];
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
  messages: Drop,
  contents: readonly AttachmentContent[],
  entities: EntityRows,
  types: EntityTypes,
): SearchDoc[] {
  const bodies = new Map(contents.map((c) => [c.attachmentId, c.contentMd]));
  const docs: SearchDoc[] = [];
  for (const message of messages) {
    docs.push(messageDoc(message));
    docs.push(...attachmentDocs(message, bodies));
  }
  docs.push(...entityDocs(entities, types));
  return docs;
}

export function useTimelineSearch(
  messages: Drop,
  contents: readonly AttachmentContent[],
  entities: EntityRows,
  types: EntityTypes,
): TimelineSearchIndex {
  const indexRef = useRef<TimelineSearchIndex | null>(null);
  indexRef.current ??= new TimelineSearchIndex();

  useEffect(() => {
    indexRef.current!.sync(buildSearchDocs(messages, contents, entities, types));
  }, [messages, contents, entities, types]);

  return indexRef.current;
}

export { RESULT_GROUPS } from "@ragbag/client-runtime";
export type { ResultGroup } from "@ragbag/client-runtime";

/** One row of results: a message, or a thing (a file, or something found in one). */
export type Result = {
  group: ResultGroup;
  /** Which hit put it here, for its score and the terms it matched. */
  hit: SearchHit;
  /** The message this row opens: a Messages row's own, or the one a file came in. */
  message?: Message;
  /** A Things row that is a file, alongside the message above. */
  attachment?: Attachment;
  /** A Things row that is an entity. */
  entity?: EntityRow;
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
  messages: Drop,
  entities: EntityRows,
  query: string,
): Result[] {
  // Keyed on the archive rather than on the query: these three answer both
  // "does this still exist" and "what do I render it from", and neither
  // question changes between keystrokes.
  const live = useMemo(() => {
    const byMessage = new Map(messages.map((m) => [m.id, m]));
    const byEntity = new Map(entities.map((e) => [e.id, e]));
    // A file is its own row now, so it is addressed by its own id, and the
    // message it came in rides along: that is what the row opens.
    const byAttachment = new Map<string, { message: Message; attachment: Attachment }>();
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
