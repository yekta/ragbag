import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/icon";
import { ItemCard } from "@/components/item-card";
import { Badge } from "@/components/ui/badge";
import type { ArchiveState } from "@/lib/archive-state";
import { blobAspect } from "@/lib/blobs";
import { dayKey, dayLabel } from "@/lib/format";
import { BUDGET, usePatient } from "@/lib/settle";
import { useViewStore } from "@/lib/store";
import { isSyncPaused, type SyncStatus } from "@/lib/sync-status";
import type { Timeline as TimelineRows, TimelineItem } from "@/lib/types";

// The chat-style timeline: whole archive, oldest at the top, anchored to the
// bottom like a messenger. Virtualized (plan §10): the full personal archive
// is in memory via Zero, only visible cards are in the DOM.
//
// The *window* is the scroller. The list is ordinary
// flow content, so the browser sees a real document scroll and every native
// affordance that hangs off one, Safari collapsing its URL bar first among
// them. Two rules come with that: nothing between <body> and this list may set
// `overflow` (it would capture the sticky chrome above and below), and the
// virtualizer needs `scrollMargin` to know where in the document the list
// starts.
//
// What to show when there is no stream is decided upstream, in one place
// (lib/archive-state.ts): nothing here infers "the archive is empty" from an
// empty query result, which is what used to make it flash a sync spinner at a
// device that had every row on disk.

type Row = { type: "day"; key: string; label: string } | { type: "item"; item: TimelineItem };

/** How close to the newest item still counts as being at the newest item. */
const AT_END_PX = 120;

/** Keys that move the page. Any other keystroke is someone typing a dump. */
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

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

// Row geometry, estimated from what is known before layout.
//
// This used to be a flat 140px for every item, which is wrong in both
// directions at once (a one-line todo against an image card) and the
// virtualizer pays for the error by resizing the document under the reader as
// real measurements land, dragging the scroll offset with it. None of this has
// to be exact. It has to be close enough that the corrections are gossip rather
// than news.

const DAY_ROW = 46;
/** Card chrome: vertical padding, the footer row, and the gap below the card. */
const CARD_CHROME = 68;
/** `leading-relaxed` at the timeline's font size. */
const LINE = 26;
/** Average glyph advance, for turning a character count into lines. */
const CHAR_PX = 7.4;
const MEDIA_MAX_H = 320;
const LINK_PREVIEW = 96;
const FILE_ROW = 66;
const ADDRESS_BOX = 116;
/** The todo checkbox and its gap, which the text wraps beside. */
const CHECKBOX = 30;

function textHeight(text: string | null | undefined, width: number): number {
  if (!text) return 0;
  const perLine = Math.max(20, Math.floor(width / CHAR_PX));
  // Hard newlines break early; everything else wraps.
  return (
    text
      .split("\n")
      .reduce((lines, para) => lines + Math.max(1, Math.ceil(para.length / perLine)), 0) * LINE
  );
}

function estimateItem(item: TimelineItem, width: number): number {
  // Todos and addresses own their text; for every other kind it is a comment
  // above the body.
  const comment =
    item.kind === "todo" || item.kind === "address" ? 0 : textHeight(item.text, width);
  switch (item.kind) {
    case "todo":
      return CARD_CHROME + textHeight(item.text, width - CHECKBOX);
    case "address":
      return CARD_CHROME + ADDRESS_BOX;
    case "link":
      return CARD_CHROME + comment + LINK_PREVIEW;
    case "image": {
      // Exact for any image this device has already displayed (lib/blobs.tsx
      // remembers the ratio); otherwise assume something roughly landscape.
      const aspect = blobAspect(item.blobId) ?? 4 / 3;
      return CARD_CHROME + comment + Math.min(MEDIA_MAX_H, width / aspect);
    }
    case "pdf":
    case "file":
      return CARD_CHROME + comment + FILE_ROW;
    default:
      return CARD_CHROME + comment;
  }
}

export function Timeline({
  items,
  state,
  sync,
  listRef,
}: {
  items: TimelineRows;
  /** What the workspace is doing. Nothing here second-guesses it. */
  state: ArchiveState;
  sync: SyncStatus | null;
  /** Owned by the shell, which watches it to know when the page has settled. */
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useRows(items);
  // The list element only exists when there is something to draw; effects that
  // observe it have to re-run when it appears.
  const hasRows = rows.length > 0;
  const { viewFilter, tagFilter } = useViewStore();
  const [scrollMargin, setScrollMargin] = useState(0);
  const [width, setWidth] = useState(700);

  // Where the list starts in the document, and how wide its text column is. The
  // window virtualizer maps `window.scrollY` straight onto row positions, so it
  // has to know how much document sits above the list: the sync banner, plus
  // the top inset the floating controls are paid with. Two deviations from the
  // documented recipe, both because of that banner: it is measured against the
  // document rather than read off `offsetTop` (the nearest positioned ancestor
  // is this component's own wrapper, which starts *below* the banner), and it is
  // re-measured whenever the document resizes rather than once, because a
  // banner appearing moves the whole list down. Measuring to the same number
  // doesn't re-render.
  useLayoutEffect(() => {
    const measure = () => {
      const box = listRef.current?.getBoundingClientRect();
      setScrollMargin(box ? box.top + window.scrollY : 0);
      // Minus the card's own horizontal padding: this is the text column, which
      // is what the row estimates wrap against.
      if (box && box.width > 0) setWidth(box.width - 60);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [listRef]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => {
      const row = rows[i];
      if (!row) return DAY_ROW;
      return row.type === "day" ? DAY_ROW : estimateItem(row.item, width);
    },
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
    // bar is expanded, and new dumps would quietly stop following.
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: AT_END_PX,
    // The end-anchoring above corrects the scroll offset from inside the ref
    // callback that measures a freshly mounted row, and asks React to flush the
    // resulting render synchronously, from inside a commit, which React
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
  //
  // Pinning the *scroll* is not the whole job, and measurement showed why:
  // when the archive lands, the offset is already right and the rows are not:
  // they are laid out at estimated positions, so the newest card can be
  // 60 000px from where it belongs until the measurement pass corrects it
  // (~500ms for 400 rows on a dev box). That correction is the reason the shell
  // is revealed on a settled layout rather than on the arrival of data
  // (lib/settle.ts).
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

  // Has the reader taken the scroll for themselves yet? Until they do, the
  // newest item is where the view belongs, full stop.
  //
  // Each of these is narrowed to the gesture that actually means "I'll take it
  // from here", because a false positive costs the load: it hands the scroll
  // back while images are still growing, which is the failure this whole block
  // exists to prevent. Not `scroll` itself: the virtualizer scrolls the window
  // while it corrects, and that is not the reader deciding anything.
  const readerScrolled = useRef(false);
  useEffect(() => {
    const takeOver = () => {
      readerScrolled.current = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Space in the composer is a space, not a page down.
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (SCROLL_KEYS.has(e.key)) takeOver();
    };
    const onMouseDown = (e: MouseEvent) => {
      // A scrollbar drag lands on the document itself. A click on a card, a
      // button or the composer does not, and must not be mistaken for one.
      if (e.target === document.documentElement || e.target === document.body) takeOver();
    };
    window.addEventListener("wheel", takeOver, { passive: true });
    window.addEventListener("touchmove", takeOver, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("keydown", onKeyDown, { passive: true });
    return () => {
      window.removeEventListener("wheel", takeOver);
      window.removeEventListener("touchmove", takeOver);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Keep the newest item in view while the archive changes shape underneath it.
  //
  // Rows grow after they first lay out (an image's bytes arrive and a 160px
  // placeholder becomes a 320px picture, an item finishes ingesting and drops a
  // chip) and each growth below the fold pushes the end of the document further
  // away. The virtualizer's own end-anchoring gives up once the gap exceeds
  // `scrollEndThreshold`, so a handful of images was enough to ratchet the view
  // hundreds of pixels short of the newest card and leave it there: a fresh load
  // that opens in the middle of the archive (measured: 484–671px short, varying
  // per load, on an archive with three images). Stability is not the same as
  // correctness: the layout had stopped moving, it had just stopped in the
  // wrong place.
  //
  // So: re-pin on every height change until the reader takes over, and after
  // that only while they are still at the end, which is exactly how a chat
  // behaves when a photo finishes loading.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (readerScrolled.current && !virtualizer.isAtEnd(AT_END_PX)) return;
      virtualizer.scrollToEnd();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [virtualizer, listRef, hasRows]);

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
  // over: on iOS the URL bar sliding away *is* a resize, and that gesture is
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

  return (
    // The top inset is the band the floating controls occupy: content may pass
    // behind them while scrolling, it may never come to rest under them. The
    // bottom is not an inset (the composer sits in the flow below this column
    // and takes real space) but coming to rest one row gap from it read as
    // cramped. This padding lands on top of the last row's own `pb-3`, so the
    // newest card settles 3.75rem clear of the composer: the breathing room a
    // chat UI leaves between what was said and what you are typing.
    // The gutter is the composer's, and it is out here for the same reason it
    // is out there: it has to sit *outside* the column cap, or the cards come
    // out narrower than the card you type into by exactly this padding: 1rem a
    // side on a wide screen, where both are pinned at the cap and only the
    // cards pay for it.
    <div className="relative flex flex-1 flex-col px-3 pt-(--timeline-inset-top) pb-12 md:px-4">
      {rows.length > 0 ? (
        <div
          ref={listRef}
          // The browser's own scroll anchoring would correct on top of the
          // virtualizer's measurement corrections; one of the two has to go.
          className="relative mx-auto w-full max-w-3xl [overflow-anchor:none]"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]!;
            return (
              <div
                key={v.key}
                ref={virtualizer.measureElement}
                data-index={v.index}
                className="absolute inset-x-0 top-0"
                // Row positions are document coordinates; this box starts
                // `scrollMargin` into the document.
                style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
              >
                {row.type === "day" ? (
                  <div className="flex justify-center py-3">
                    {/* The card surface, like the rows it separates: one fill
                        for everything sitting on the canvas. The variant stays
                        for its ink; its own fill is overridden, and its hover
                        is anchor-only, so nothing here reacts to a pointer
                        passing over. */}
                    <Badge
                      variant="secondary"
                      className="bg-card px-3 text-[11px] text-muted-foreground"
                    >
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
      ) : (
        <Placeholder filtered={items.length > 0} state={state} sync={sync} />
      )}
    </div>
  );
}

/**
 * What stands in for the stream when there is nothing to draw. Every branch is
 * a settled truth, and `opening` draws nothing at all, because the only honest
 * thing to say about an archive that is still on its way is nothing.
 */
function Placeholder({
  filtered,
  state,
  sync,
}: {
  /** There are items; this filter just doesn't match any of them. */
  filtered: boolean;
  state: ArchiveState;
  sync: SyncStatus | null;
}) {
  // A loader that does appear stays long enough to be read.
  const syncing = usePatient(state === "syncing", BUDGET.loaderMin);

  if (filtered) {
    return (
      <Centred>
        <Icon name="inbox" className="size-10" />
        <p className="text-sm">Nothing matches this filter.</p>
      </Centred>
    );
  }

  if (syncing) {
    return (
      <Centred role="status">
        <Icon name="spinner" className="size-8 animate-spin [animation-duration:2s]" />
        <p className="text-sm">Syncing your archive…</p>
      </Centred>
    );
  }

  if (state === "empty") {
    return (
      <Centred>
        <Icon name="inbox" className="size-10" />
        <p className="text-sm">
          {isSyncPaused(sync)
            ? // No spinner: sync is refused or offline, so nothing is in fact in
              // progress. The banner above says why.
              "Nothing on this device yet. Dump anything below. It syncs once the connection is back."
            : "Your ragbag is empty. Dump anything below. It syncs everywhere."}
        </p>
      </Centred>
    );
  }

  return null;
}

function Centred({ children, role }: { children: React.ReactNode; role?: "status" }) {
  return (
    <div
      role={role}
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground"
    >
      {children}
    </div>
  );
}
