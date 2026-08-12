import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { dayKey, dayLabel } from "../lib/format.js";
import { useViewStore } from "../lib/store.js";
import type { Timeline as TimelineRows, TimelineItem } from "../lib/types.js";
import { Icon } from "./Icon.js";
import { ItemCard, KindDot } from "./ItemCard.js";

// The chat-style timeline: whole archive, oldest at the top, anchored to the
// bottom like a messenger. Virtualized (plan §10) — the full personal archive
// is in memory via Zero, only visible cards are in the DOM.

type Row = { type: "day"; key: string; label: string } | { type: "item"; item: TimelineItem };

function useRows(items: TimelineRows): Row[] {
  const { kindFilter, tagFilter } = useViewStore();
  return useMemo(() => {
    // Items arrive newest-first from the shared query; the chat renders
    // oldest-first.
    let filtered = items.toReversed();
    if (kindFilter === "pinned") filtered = filtered.filter((i) => i.pinned);
    else if (kindFilter) filtered = filtered.filter((i) => i.kind === kindFilter);
    if (tagFilter) filtered = filtered.filter((i) => i.itemTags.some((t) => t.tagId === tagFilter));

    const rows: Row[] = [];
    let lastDay = "";
    for (const item of filtered) {
      const key = dayKey(item.createdAt);
      if (key !== lastDay) {
        rows.push({ type: "day", key, label: dayLabel(item.createdAt) });
        lastDay = key;
      }
      rows.push({ type: "item", item });
    }
    return rows;
  }, [items, kindFilter, tagFilter]);
}

function PinnedStrip({ items }: { items: TimelineRows }) {
  const pinned = useMemo(() => items.filter((i) => i.pinned).slice(0, 20), [items]);
  if (pinned.length === 0) return null;
  return (
    // max-md padding clears the floating menu/search buttons in the corners.
    <div className="border-b border-neutral-200 bg-white/70 px-4 py-2 backdrop-blur max-md:px-14">
      <div className="mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto">
        <Icon name="star" className="size-3.5 shrink-0 text-amber-500" filled />
        {pinned.map((item) => (
          <Link
            key={item.id}
            to="/item/$id"
            params={{ id: item.id }}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
          >
            <KindDot kind={item.kind} />
            <span className="max-w-48 truncate">
              {item.content?.title ?? item.text ?? item.url ?? item.kind}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FilterBar() {
  const { kindFilter, tagFilter, clearFilters } = useViewStore();
  if (!kindFilter && !tagFilter) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
      <button
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-md hover:bg-neutral-50"
        onClick={clearFilters}
      >
        filtered view
        <span className="flex items-center gap-1 text-neutral-400">
          <Icon name="x" className="size-3.5" /> clear
        </span>
      </button>
    </div>
  );
}

export function Timeline({ items, synced }: { items: TimelineRows; synced: boolean }) {
  const rows = useRows(items);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.type === "day" ? 46 : 140),
    overscan: 10,
    getItemKey: (i) => {
      const row = rows[i]!;
      return row.type === "day" ? `day-${row.key}` : row.item.id;
    },
  });

  // Chat anchoring: keep the view pinned to the newest item unless the user
  // scrolled up. totalSize changes as lazy measurements land, so this effect
  // re-pins until the layout settles.
  const totalSize = virtualizer.getTotalSize();
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [totalSize, rows.length]);

  const empty = rows.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PinnedStrip items={items} />
      <FilterBar />
      <div
        ref={scrollRef}
        // pb-36 clears the floating composer so the newest card isn't hidden
        // behind it when scrolled to the bottom.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-36"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-neutral-400">
            {synced ? (
              <>
                <Icon name="inbox" className="size-10" />
                <p className="text-sm">
                  {items.length === 0
                    ? "Your ragbag is empty. Dump anything below — it syncs everywhere."
                    : "Nothing matches this filter."}
                </p>
              </>
            ) : (
              <>
                <Icon name="spinner" className="size-8 animate-spin [animation-duration:2s]" />
                <p className="text-sm">Syncing your archive…</p>
              </>
            )}
          </div>
        ) : (
          <div className="relative mx-auto max-w-3xl px-4" style={{ height: totalSize }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!;
              return (
                <div
                  key={v.key}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  className="absolute inset-x-4 top-0"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  {row.type === "day" ? (
                    <div className="flex justify-center py-3">
                      <span className="rounded-full bg-neutral-200/70 px-3 py-0.5 text-[11px] font-medium text-neutral-500">
                        {row.label}
                      </span>
                    </div>
                  ) : (
                    <div className="pb-3">
                      <ItemCard item={row.item} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
