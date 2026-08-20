import MiniSearch from "minisearch";

// Local search, and only local search (plan §7). No chunk table, no tsvector,
// no server endpoint. The extracted text still lives in Postgres because
// Postgres is the source of truth and re-ingestion reads it, but nothing
// indexes it there.
//
// The reasoning: v1 truncated synced text at 8,000 chars purely as a
// sync-payload guard, and that truncation was the only thing making local
// search incomplete. Sync the full content and local search covers the entire
// archive, at which point a server tier answers a question nobody asked.
//
// Dropping embeddings is safe because entities recover most of what they were
// for. `1Z999AA10123456784` matches a tracking entity exactly, "amazon"
// matches an invoice's vendor, "the place in Kadıköy" matches an address's
// locality. The semantic work moved from query time to write time, which is
// cheaper, faster and offline.

/** What a hit is about. Three doc types share one index (plan §7). */
export const DOC_TYPES = ["message", "attachment", "entity"] as const;
export type TDocType = (typeof DOC_TYPES)[number];

export type TSearchDoc = {
  /** `${type}:${id}`, because an entity and a message can share neither. */
  id: string;
  type: TDocType;
  /**
   * The message this doc belongs to, so message and attachment hits can collapse
   * into one row.
   *
   * Absent on an entity doc, and that absence is the point: a thing is canonical
   * across every message that mentions it, so it belongs to none of them. It
   * used to be indexed once per mentioning message under the same doc id, which
   * meant the last one written silently decided which message the thing "was
   * in".
   */
  messageId?: string;
  /** The row's own id: the message, the attachment, or the entity. */
  targetId: string;
  title: string;
  /** The user's own words, or a filename, or an entity's value. */
  text: string;
  summary: string;
  tags: string;
  /** Entity values on a message doc; the structured fields on an entity doc. */
  entities: string;
  /** Attachment names and titles on a message doc; `content_md` on its own. */
  body: string;
};

export type TSearchHit = {
  id: string;
  type: TDocType;
  /** Absent on an entity hit; see `TSearchDoc.messageId`. */
  messageId?: string;
  targetId: string;
  score: number;
  /** Query terms that matched, for highlighting. */
  terms: string[];
};

const INDEX_FIELDS = ["title", "tags", "text", "summary", "entities", "body"] as const;

/** Cap what goes into the index per field; keeps memory flat at scale. */
const MAX_FIELD_CHARS = 32_000;

function clamp(value: string): string {
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
}

export class TimelineSearchIndex {
  #mini = new MiniSearch<TSearchDoc>({
    fields: [...INDEX_FIELDS],
    // `type` and `messageId` come back on the hit, so the overlay can group
    // and collapse results without a second lookup per row.
    storeFields: ["type", "messageId", "targetId"],
    searchOptions: {
      boost: { title: 3, tags: 2.5, entities: 2.5, text: 2, summary: 1.5, body: 1 },
      prefix: true,
      fuzzy: 0.15,
      combineWith: "AND",
    },
  });
  /** id → serialized doc, to diff Zero's live results incrementally. */
  #docs = new Map<string, string>();

  get size(): number {
    return this.#docs.size;
  }

  /**
   * Reconcile the index with the current archive. Cheap to call on every Zero
   * update: unchanged docs are skipped, edited ones replaced, deleted ones
   * discarded.
   *
   * Being diff-based is what makes the two-pass build (plan §7) free: the
   * first pass indexes titles, summaries, tags, entity values and filenames,
   * and the second is this same call with the document bodies filled in. Only
   * the docs that actually changed are touched.
   */
  sync(docs: readonly TSearchDoc[]): void {
    const seen = new Set<string>();
    for (const raw of docs) {
      const doc: TSearchDoc = {
        ...raw,
        text: clamp(raw.text),
        entities: clamp(raw.entities),
        body: clamp(raw.body),
      };
      seen.add(doc.id);
      const serialized = JSON.stringify(doc);
      const previous = this.#docs.get(doc.id);
      if (previous === serialized) continue;
      if (previous !== undefined) this.#mini.discard(doc.id);
      this.#mini.add(doc);
      this.#docs.set(doc.id, serialized);
    }
    for (const id of this.#docs.keys()) {
      if (!seen.has(id)) {
        this.#mini.discard(id);
        this.#docs.delete(id);
      }
    }
  }

  search(query: string, limit = 80): TSearchHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.#mini
      .search(q)
      .slice(0, limit)
      .map((r) => ({
        id: String(r.id),
        type: r.type as TDocType,
        // Stored, so absent rather than the string "undefined" on entity docs.
        messageId: typeof r.messageId === "string" ? r.messageId : undefined,
        targetId: String(r.targetId),
        score: r.score,
        terms: r.terms,
      }));
  }
}
