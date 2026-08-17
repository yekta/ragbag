import type { SearchHit } from "./search-index.js";

// Turning one ranked list of hits into the two sections search shows.
//
// **Messages** answers "which of my dumps was this in", so a message and the
// files inside it are one row: without collapsing, one screenshot of a shipping
// email answers a query three times over (the message, the image, the text read
// out of it). The row remembers which file won, because "matched in scan.pdf" is
// the useful half of that.
//
// **Things** answers "what is this thing", and a thing is canonical across every
// message that mentions it, so it is never folded into a message: it is its own
// row, opening its own page. That is the whole reason entities exist as rows
// rather than as annotations, and search used to hide exactly the hits that
// proved it, by folding a thing into any message that also matched.
//
// Pure, and here rather than in the web app, because this is the part worth
// testing and apps/web has no test runner.

export const RESULT_GROUPS = ["messages", "things"] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];

export type ResultRow = {
  group: ResultGroup;
  /** The hit that put this row here: the best-ranked one for its target. */
  hit: SearchHit;
  /** Set on a Messages row: which message it is. */
  messageId?: string;
  /** Set on a Messages row whose best hit came from a file inside it. */
  attachmentId?: string;
  /** Set on a Things row: which entity it is. */
  entityId?: string;
};

/** How many rows one section shows before the rest are left to a narrower query. */
const SECTION_LIMIT = 40;

/**
 * Group and collapse hits, in rank order, dropping anything the live archive no
 * longer has (deleted since it was indexed).
 *
 * The two predicates are how the caller keeps the index honest without the index
 * knowing anything about Zero.
 */
export function groupHits(
  hits: readonly SearchHit[],
  opts: {
    hasMessage: (id: string) => boolean;
    hasEntity: (id: string) => boolean;
    limit?: number;
  },
): ResultRow[] {
  const limit = opts.limit ?? SECTION_LIMIT;
  const rows: ResultRow[] = [];
  const messages = new Set<string>();
  const entities = new Set<string>();

  for (const hit of hits) {
    if (hit.type === "entity") {
      if (entities.size >= limit) continue;
      if (entities.has(hit.targetId) || !opts.hasEntity(hit.targetId)) continue;
      entities.add(hit.targetId);
      rows.push({ group: "things", hit, entityId: hit.targetId });
      continue;
    }

    const messageId = hit.messageId;
    if (!messageId || messages.size >= limit) continue;
    if (messages.has(messageId) || !opts.hasMessage(messageId)) continue;
    messages.add(messageId);
    rows.push({
      group: "messages",
      hit,
      messageId,
      // Hits arrive best-first, so the first one to claim a message is its best,
      // and an attachment winning is what makes the row say which file matched.
      attachmentId: hit.type === "attachment" ? hit.targetId : undefined,
    });
  }

  // Messages first, then Things; each already in rank order.
  return [
    ...rows.filter((row) => row.group === "messages"),
    ...rows.filter((row) => row.group === "things"),
  ];
}
