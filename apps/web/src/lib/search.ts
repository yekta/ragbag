import { TimelineSearchIndex } from "@ragbag/client-runtime";
import type { SearchHit } from "@ragbag/client-runtime";
import { useEffect, useMemo, useRef } from "react";
import { hostOf } from "./format.js";
import type { Timeline, TimelineItem } from "./types.js";

// Feeds the Tier-1 index (client-runtime) from Zero's live timeline query:
// every sync update reconciles the index incrementally, so search is always
// current and always local.

function toSearchDoc(item: TimelineItem) {
  const c = item.content;
  return {
    id: item.id,
    kind: item.kind,
    title: c?.title ?? "",
    text: item.text ?? "",
    summary: c?.aiSummary ?? "",
    tags: item.itemTags
      .map((it) => it.tag?.name)
      .filter(Boolean)
      .join(" "),
    site: [c?.siteName, hostOf(item.url)].filter(Boolean).join(" "),
    url: item.url ?? "",
    extracted: c?.extractedText ?? "",
  };
}

export function useTimelineSearch(items: Timeline): TimelineSearchIndex {
  const indexRef = useRef<TimelineSearchIndex | null>(null);
  indexRef.current ??= new TimelineSearchIndex();

  useEffect(() => {
    indexRef.current!.sync(items.map(toSearchDoc));
  }, [items]);

  return indexRef.current;
}

/** Hits joined back to their live items (deleted ones drop out naturally). */
export function resolveHits(hits: SearchHit[], items: Timeline): TimelineItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return hits.map((h) => byId.get(h.id)).filter((i): i is TimelineItem => Boolean(i));
}

export function useSearchResults(
  index: TimelineSearchIndex,
  items: Timeline,
  query: string,
): TimelineItem[] {
  return useMemo(() => resolveHits(index.search(query), items), [index, items, query]);
}
