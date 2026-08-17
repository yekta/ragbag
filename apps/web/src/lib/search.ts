import { TimelineSearchIndex } from "@ragbag/client-runtime";
import type { SearchDoc, SearchHit } from "@ragbag/client-runtime";
import { entityLabel, faceForMime } from "@ragbag/shared";
import { useEffect, useMemo, useRef } from "react";
import type { AttachmentContent, Drop, Message } from "./types.js";

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

function entityDocs(message: Message): SearchDoc[] {
  const seen = new Set<string>();
  const docs: SearchDoc[] = [];
  for (const mention of message.mentions) {
    const entity = mention.entity;
    if (!entity || seen.has(entity.id)) continue;
    seen.add(entity.id);
    docs.push({
      id: `entity:${entity.id}`,
      type: "entity",
      messageId: message.id,
      targetId: entity.id,
      title: entity.generatedTitle ?? entity.value,
      text: entity.value,
      summary: entity.generatedSummary ?? "",
      tags: entityLabel(entity.kind),
      // The structured fields, flattened: a vendor, a locality, a carrier are
      // all things people search for by name.
      entities: Object.values(entity.data ?? {})
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" "),
      body: "",
    });
  }
  return docs;
}

export function buildSearchDocs(
  messages: Drop,
  contents: readonly AttachmentContent[],
): SearchDoc[] {
  const bodies = new Map(contents.map((c) => [c.attachmentId, c.contentMd]));
  const docs: SearchDoc[] = [];
  for (const message of messages) {
    docs.push(messageDoc(message));
    docs.push(...attachmentDocs(message, bodies));
    docs.push(...entityDocs(message));
  }
  return docs;
}

export function useTimelineSearch(
  messages: Drop,
  contents: readonly AttachmentContent[],
): TimelineSearchIndex {
  const indexRef = useRef<TimelineSearchIndex | null>(null);
  indexRef.current ??= new TimelineSearchIndex();

  useEffect(() => {
    indexRef.current!.sync(buildSearchDocs(messages, contents));
  }, [messages, contents]);

  return indexRef.current;
}

/** The groups results are shown under, in the order they are shown. */
export const RESULT_GROUPS = ["messages", "images", "files", "things"] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];

export type Result = {
  group: ResultGroup;
  message: Message;
  /** Which hit put it here: the message itself, or something inside it. */
  hit: SearchHit;
  /** Set for an attachment hit: which file matched. */
  attachmentId?: string;
  /** Set for an entity hit: which thing matched. */
  entityId?: string;
};

/**
 * Hits joined back to their live messages, grouped, and collapsed.
 *
 * Collapsing is the point: an attachment or entity hit whose message also hit
 * folds into the message row rather than appearing twice. Without it, one
 * screenshot of a shipping email answers a query three times over.
 */
export function useSearchResults(
  index: TimelineSearchIndex,
  messages: Drop,
  query: string,
): Result[] {
  return useMemo(() => {
    const hits = index.search(query);
    if (hits.length === 0) return [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    const matchedMessages = new Set(
      hits.filter((h) => h.type === "message").map((h) => h.messageId),
    );

    const results: Result[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const message = byId.get(hit.messageId);
      if (!message) continue; // deleted since it was indexed
      // Fold into the message row when that row is already a result.
      if (hit.type !== "message" && matchedMessages.has(hit.messageId)) continue;
      const key = `${hit.type}:${hit.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (hit.type === "message") {
        results.push({ group: "messages", message, hit });
      } else if (hit.type === "entity") {
        results.push({ group: "things", message, hit, entityId: hit.targetId });
      } else {
        const attachment = message.attachments.find((a) => a.id === hit.targetId);
        results.push({
          group: faceForMime(attachment?.mime ?? "") === "image" ? "images" : "files",
          message,
          hit,
          attachmentId: hit.targetId,
        });
      }
    }
    return results;
  }, [index, messages, query]);
}
