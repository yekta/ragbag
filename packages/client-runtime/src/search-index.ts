import MiniSearch from "minisearch";

// Tier-1 search (plan §8): keyword/prefix matching over titles, tags, AI
// summaries, the user's text, and truncated extracted text. Runs on-device
// against this in-memory index, kept live from Zero's query results —
// instant, search-as-you-type, fully offline. It punches above its weight
// because ingestion did semantic work at write time: AI tags + summaries are
// part of the corpus, so "sleep caffeine" hits the caffeine article even when
// its title never says either word.

export type SearchDoc = {
  id: string;
  kind: string;
  title: string;
  /** The user's own words: note body or dump comment. */
  text: string;
  summary: string;
  /** All tag names (user + AI), space-joined. */
  tags: string;
  site: string;
  url: string;
  /** Extracted article/PDF/OCR text — already truncated for sync. */
  extracted: string;
};

export type SearchHit = {
  id: string;
  score: number;
  /** Query terms that matched, for highlighting. */
  terms: string[];
};

const INDEX_FIELDS = ["title", "tags", "text", "summary", "site", "extracted", "url"] as const;

/** Cap what goes into the index per field; keeps memory flat at scale. */
const MAX_FIELD_CHARS = 4_000;

function clamp(value: string): string {
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
}

export class TimelineSearchIndex {
  #mini = new MiniSearch<SearchDoc>({
    fields: [...INDEX_FIELDS],
    storeFields: [],
    searchOptions: {
      boost: { title: 3, tags: 2.5, text: 2, summary: 1.5, site: 1.2 },
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
   * Reconcile the index with the current timeline. Cheap to call on every
   * Zero update: unchanged docs are skipped, edited ones replaced, deleted
   * ones discarded.
   */
  sync(docs: readonly SearchDoc[]): void {
    const seen = new Set<string>();
    for (const raw of docs) {
      const doc: SearchDoc = {
        ...raw,
        text: clamp(raw.text),
        extracted: clamp(raw.extracted),
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

  search(query: string, limit = 50): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.#mini
      .search(q)
      .slice(0, limit)
      .map((r) => ({ id: String(r.id), score: r.score, terms: r.terms }));
  }
}
