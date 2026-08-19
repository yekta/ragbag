import type { SearchHit } from "./search-index.js";

// Turning one ranked list of hits into the two sections search shows.
//
// **Messages** answers "which of my dumps was this in", one row per message:
// the message doc already carries its own text, its summary, its tags and the
// names of the files inside it.
//
// **Things** answers "what is this thing", and the sidebar has already settled
// what a thing is: the pictures and files inside messages, listed under the
// same heading as what the pipeline found in them. So a file is its own row
// here exactly as an entity is. It used to be folded into the message carrying
// it, which meant a picture could never be a result at all: it could only make
// its message one, in a section called Messages, while the sidebar listed
// Images under a heading called Things.
//
// Nothing in Things is ever folded into a message. An entity is canonical
// across every message that mentions it, so it belongs to none of them; a file
// belongs to exactly one message and still is not that message, because a dump
// and the picture inside it are two different answers to "what did I find".
// Both open the message, because that is where a file lives.
//
// The price is that one dump can put two rows on screen when the query matches
// the message and the picture in it. That is the deal entities have always
// had, and each row says something the other cannot: one names the dump, the
// other shows the picture.
//
// Pure, and here rather than in the web app, because this is the part worth
// testing and apps/web has no test runner.

export const RESULT_GROUPS = ["messages", "things"] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];

export type ResultRow = {
  group: ResultGroup;
  /** The hit that put this row here: the best-ranked one for its target. */
  hit: SearchHit;
  /**
   * The message this row opens: the Messages row's own, or the one a file came
   * in. Absent on an entity row, which opens the thing's own page instead.
   */
  messageId?: string;
  /** Set on a Things row that is a file. */
  attachmentId?: string;
  /** Set on a Things row that is an entity. */
  entityId?: string;
};

/** How many rows one section shows before the rest are left to a narrower query. */
const SECTION_LIMIT = 40;

/**
 * Group and collapse hits, in rank order, dropping anything the live archive no
 * longer has (deleted since it was indexed).
 *
 * The three predicates are how the caller keeps the index honest without the
 * index knowing anything about Zero.
 */
export function groupHits(
  hits: readonly SearchHit[],
  opts: {
    hasMessage: (id: string) => boolean;
    hasAttachment: (id: string) => boolean;
    hasEntity: (id: string) => boolean;
    limit?: number;
  },
): ResultRow[] {
  const limit = opts.limit ?? SECTION_LIMIT;
  const rows: ResultRow[] = [];
  const messages = new Set<string>();
  // One set for both kinds of thing, because the section is capped as a whole
  // and no file shares an id with an entity.
  const things = new Set<string>();

  for (const hit of hits) {
    if (hit.type === "message") {
      if (messages.size >= limit) continue;
      if (messages.has(hit.targetId) || !opts.hasMessage(hit.targetId)) continue;
      messages.add(hit.targetId);
      rows.push({ group: "messages", hit, messageId: hit.targetId });
      continue;
    }

    if (things.size >= limit || things.has(hit.targetId)) continue;

    if (hit.type === "attachment") {
      // A file the archive cannot place in a message is a file nothing can
      // open, so it is not a row: `hasAttachment` is the live answer, and the
      // missing `messageId` is the indexed one.
      if (!hit.messageId || !opts.hasAttachment(hit.targetId)) continue;
      things.add(hit.targetId);
      rows.push({ group: "things", hit, messageId: hit.messageId, attachmentId: hit.targetId });
      continue;
    }

    if (!opts.hasEntity(hit.targetId)) continue;
    things.add(hit.targetId);
    rows.push({ group: "things", hit, entityId: hit.targetId });
  }

  // Messages first, then Things; each already in rank order.
  return [
    ...rows.filter((row) => row.group === "messages"),
    ...rows.filter((row) => row.group === "things"),
  ];
}
