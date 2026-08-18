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
// `groupHits`): a message and its files are one row, and a thing is always its
// own row rather than folded into whichever message happened to match too.

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

/** One row of results: a message (with the file that matched, if one did), or a thing. */
export type Result = {
  group: ResultGroup;
  /** Which hit put it here, for its score and the terms it matched. */
  hit: SearchHit;
  /** A Messages row: the message, and the file inside it that matched. */
  message?: Message;
  attachment?: Attachment;
  /** A Things row: the thing itself. */
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
  return useMemo(() => {
    const hits = index.search(query);
    if (hits.length === 0) return [];
    const byMessage = new Map(messages.map((m) => [m.id, m]));
    const byEntity = new Map(entities.map((e) => [e.id, e]));

    return groupHits(hits, {
      hasMessage: (id) => byMessage.has(id),
      hasEntity: (id) => byEntity.has(id),
    }).map((row) => {
      const message = row.messageId ? byMessage.get(row.messageId) : undefined;
      return {
        group: row.group,
        hit: row.hit,
        message,
        attachment: row.attachmentId
          ? message?.attachments.find((a) => a.id === row.attachmentId)
          : undefined,
        entity: row.entityId ? byEntity.get(row.entityId) : undefined,
      };
    });
  }, [index, messages, entities, query]);
}
