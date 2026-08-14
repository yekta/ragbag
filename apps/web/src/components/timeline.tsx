import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { Icon } from "@/components/icon";
import { ItemCard } from "@/components/item-card";
import { Badge } from "@/components/ui/badge";
import { dayKey, dayLabel } from "@/lib/format";
import { useViewStore } from "@/lib/store";
import type { Timeline as TimelineRows, TimelineItem } from "@/lib/types";

// The chat-style timeline: whole archive, oldest at the top, anchored to the
// bottom like a messenger. Virtualized (plan §10) — the full personal archive
// is in memory via Zero, only visible cards are in the DOM.
//
// The scroll container below is a plain div on purpose: @tanstack/react-virtual
// measures whatever `getScrollElement` returns, and shadcn's ScrollArea puts a
// Radix viewport in between, which breaks the measurements. Don't swap it.

type Row = { type: "day"; key: string; label: string } | { type: "item"; item: TimelineItem };

function useRows(items: TimelineRows): Row[] {
  const { viewFilter, tagFilter } = useViewStore();
  return useMemo(() => {
    // Items arrive newest-first from the shared query; the chat renders
    // oldest-first.
    let filtered = items.toReversed();
    if (viewFilter === "favorites") filtered = filtered.filter((i) => i.favorite);
    else if (viewFilter) filtered = filtered.filter((i) => i.kind === viewFilter);
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
  }, [items, viewFilter, tagFilter]);
}

// Favorites are reachable from the rail as their own view — deliberately not
// hoisted above the timeline: the archive stays one chronological stream.
// No "filtered view" banner: the sidebar already highlights the active
// view/tag, so a floating chip over the stream is pure redundancy.

export function Timeline({
  items,
  synced,
  syncPaused,
}: {
  items: TimelineRows;
  synced: boolean;
  /** Sync can't run (refused or offline), so waiting on it would never end. */
  syncPaused: boolean;
}) {
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
      <div
        ref={scrollRef}
        // Both ends are inset for the chrome that floats over them: the menu
        // and search controls at the top, the composer at the bottom. Content
        // may pass behind them while scrolling; it may never come to rest
        // under them.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--timeline-inset-top) pb-36"
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            {synced || syncPaused ? (
              <>
                <Icon name="inbox" className="size-10" />
                <p className="text-sm">
                  {items.length > 0
                    ? "Nothing matches this filter."
                    : syncPaused
                      ? // The spinner here used to run forever while sync was
                        // refused or offline, implying work was in progress
                        // that had in fact stopped. The banner above says why.
                        "Nothing on this device yet. Dump anything below — it syncs once the connection is back."
                      : "Your ragbag is empty. Dump anything below — it syncs everywhere."}
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
                      <Badge variant="secondary" className="px-3 text-[11px] text-muted-foreground">
                        {row.label}
                      </Badge>
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
