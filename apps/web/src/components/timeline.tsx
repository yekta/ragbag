import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
// The *window* is the scroller (WINDOW_SCROLL_PLAN.md). The list is ordinary
// flow content, so the browser sees a real document scroll and every native
// affordance that hangs off one — Safari collapsing its URL bar first among
// them. Two rules come with that: nothing between <body> and this list may set
// `overflow` (it would capture the sticky chrome above and below), and the
// virtualizer needs `scrollMargin` to know where in the document the list
// starts.

type Row = { type: "day"; key: string; label: string } | { type: "item"; item: TimelineItem };

/** How close to the newest item still counts as being at the newest item. */
const AT_END_PX = 120;

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
  const { viewFilter, tagFilter } = useViewStore();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the list starts in the document. The window virtualizer maps
  // `window.scrollY` straight onto row positions, so it has to know how much
  // document sits above the list: the sync banner, plus the top inset the
  // floating controls are paid with. Two deviations from the documented
  // recipe, both because of that banner: it is measured against the document
  // rather than read off `offsetTop` (the nearest positioned ancestor is this
  // component's own wrapper, which starts *below* the banner), and it is
  // re-measured whenever the document resizes rather than once, because a
  // banner appearing moves the whole list down. Measuring to the same number
  // doesn't re-render.
  useLayoutEffect(() => {
    const measure = () =>
      setScrollMargin(
        listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.type === "day" ? 46 : 140),
    overscan: 10,
    getItemKey: (i) => {
      const row = rows[i]!;
      return row.type === "day" ? `day-${row.key}` : row.item.id;
    },
    scrollMargin,
    // Chat anchoring, from the library rather than by hand: hold the view at
    // the newest item while lazy measurements land, hold the *reader's* item
    // still when older ones sync in above, and follow new dumps when they are
    // already at the end. The threshold is deliberately generous: the
    // end-of-document arithmetic uses `innerHeight`, which on iOS tracks the
    // visual viewport, so a tight one reads as "not at the end" while the URL
    // bar is expanded — and new dumps would quietly stop following.
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: AT_END_PX,
    // The end-anchoring above corrects the scroll offset from inside the ref
    // callback that measures a freshly mounted row, and asks React to flush the
    // resulting render synchronously — from inside a commit, which React
    // refuses with a console error (once per dump, since a dump is what mounts
    // a row while you are at the end). Re-rendering on the next tick instead
    // costs nothing here: `overscan: 10` is ~1000px of rows either side, so
    // nothing can scroll into view within a frame of not being rendered.
    useFlushSync: false,
  });

  // Open at the newest item, and go back there when a filter swaps the row set
  // out from under the anchor. This covers mount too: Zero can hand over the
  // whole archive on the first render, and `followOnAppend` only fires on a
  // change.
  useLayoutEffect(() => {
    virtualizer.scrollToEnd();
  }, [viewFilter, tagFilter, virtualizer]);

  // Was the reader at the newest item? Sampled while scrolling, because by the
  // time a resize arrives it is too late to ask: the new viewport height has
  // already moved the end of the document out from under them.
  const atEndRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      atEndRef.current = virtualizer.isAtEnd(AT_END_PX);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [virtualizer]);

  // Every viewport change moves the end of the document: the keyboard opening,
  // a rotation, a window being dragged, the URL bar sliding away. Someone who
  // was at the newest item should still be there afterwards, or the newest card
  // ends up behind the composer.
  //
  // Three guards, because a resize is not by itself an instruction to scroll.
  // They have to have been at the end when it arrived (`atEndRef`, sampled
  // before the new viewport moved the end). The page has to have gone quiet:
  // re-measuring an archive at a new width takes several frames, and the
  // virtualizer scrolls the window itself while it corrects, so "still
  // scrolling" means wait rather than give up. And they must not have taken
  // over — on iOS the URL bar sliding away *is* a resize, and that gesture is
  // theirs. Tapping the composer is not a takeover, which is what leaves the
  // keyboard case working.
  useEffect(() => {
    let settle: number | undefined;
    let pending = false;
    const cancel = () => {
      pending = false;
      clearTimeout(settle);
    };
    const whenQuiet = () => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (!pending) return;
        if (virtualizer.isScrolling) return whenQuiet();
        pending = false;
        // Last check, for a flick whose momentum outlived the touch that
        // cancels: never drag anyone back more than the screen they left.
        if (virtualizer.isAtEnd(window.innerHeight)) virtualizer.scrollToEnd();
      }, 150);
    };
    const onResize = () => {
      if (!atEndRef.current) return;
      pending = true;
      whenQuiet();
    };
    window.addEventListener("resize", onResize);
    // Not `keydown`: typing in the composer is what *opens* the keyboard.
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchmove", cancel, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      clearTimeout(settle);
    };
  }, [virtualizer]);

  const empty = rows.length === 0;

  return (
    // The top inset is the band the floating controls occupy: content may pass
    // behind them while scrolling, it may never come to rest under them
    // (INSET_PLAN.md). The bottom is not an inset — the composer sits in the
    // flow below this column and takes real space — but coming to rest one row
    // gap from it read as cramped. This padding lands on top of the last row's
    // own `pb-3`, so the newest card settles 4.5rem clear of the composer: the
    // breathing room a chat UI leaves between what was said and what you are
    // typing.
    <div className="relative flex flex-1 flex-col pt-(--timeline-inset-top) pb-15">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
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
        <div
          ref={listRef}
          // The browser's own scroll anchoring would correct on top of the
          // virtualizer's measurement corrections; one of the two has to go.
          className="relative mx-auto w-full max-w-3xl px-4 [overflow-anchor:none]"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]!;
            return (
              <div
                key={v.key}
                ref={virtualizer.measureElement}
                data-index={v.index}
                className="absolute inset-x-4 top-0"
                // Row positions are document coordinates; this box starts
                // `scrollMargin` into the document.
                style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
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
  );
}
