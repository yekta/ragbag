import { useLocation } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { toBlocks } from "@/components/attachment-album";
import { EmptyScreen } from "@/components/empty-screen";
import { Icon } from "@/components/icon";
import { MessageCard } from "@/components/message-card";
import { Badge } from "@/components/ui/badge";
import type { ArchiveState } from "@/lib/archive-state";
import { aspectOf } from "@/lib/blobs";
import { dayKey, dayLabel } from "@/lib/format";
import { useFilter } from "@/lib/routes";
import { BUDGET, usePatient } from "@/lib/settle";
import { isSyncPaused, type SyncStatus } from "@/lib/sync-status";
import type { Drop, Message } from "@/lib/types";

// The chat-style timeline: whole archive, oldest at the top, anchored to the
// bottom like a messenger. Virtualized: the full personal archive is in memory
// via Zero, only visible cards are in the DOM.
//
// The *window* is the scroller. The list is ordinary flow content, so the
// browser sees a real document scroll and every native affordance that hangs
// off one, Safari collapsing its URL bar first among them. Two rules come with
// that: nothing between <body> and this list may set `overflow` (it would
// capture the sticky chrome above and below), and the virtualizer needs
// `scrollMargin` to know where in the document the list starts.
//
// What to show when there is no stream is decided upstream, in one place
// (lib/archive-state.ts): nothing here infers "the archive is empty" from an
// empty query result, which is what used to make it flash a sync spinner at a
// device that had every row on disk.

type Row = { type: "day"; key: string; label: string } | { type: "message"; message: Message };

/** How close to the newest message still counts as being at the newest one. */
const AT_END_PX = 120;

/** Keys that move the page. Any other keystroke is someone typing a dump. */
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

/**
 * How long a jumped-to card is pointed at. Keep in step with `highlight-pass`
 * in index.css: the class runs the animation, this drops it again, and a card
 * still carrying it is a card that would flash a second time the next time it
 * scrolled back into view.
 */
const HIGHLIGHT_MS = 3000;

function useRows(messages: Drop): Row[] {
  // The URL is the filter (lib/routes.ts).
  const { view, tagId } = useFilter();
  return useMemo(() => {
    // Messages arrive newest-first from the shared query; the chat renders
    // oldest-first.
    let filtered = messages.toReversed();
    if (view === "favorites") filtered = filtered.filter((m) => m.favorite);
    if (tagId) filtered = filtered.filter((m) => m.tags.some((t) => t.tagId === tagId));

    const rows: Row[] = [];
    let lastDay = "";
    for (const message of filtered) {
      const key = dayKey(message.createdAt);
      if (key !== lastDay) {
        rows.push({ type: "day", key, label: dayLabel(message.createdAt) });
        lastDay = key;
      }
      rows.push({ type: "message", message });
    }
    return rows;
  }, [messages, view, tagId]);
}

// Row geometry, estimated from what is known before layout.
//
// A message is a sum now, not a switch on a kind: its text, plus every
// attachment's contribution, plus the chrome. None of this has to be exact. It
// has to be close enough that the virtualizer's corrections are gossip rather
// than news, because it pays for the error by resizing the document under the
// reader as real measurements land, dragging the scroll offset with it.

const DAY_ROW = 46;
/** The opening separator, which draws no gap above itself (see the render). */
const FIRST_DAY_ROW = DAY_ROW - 12;
/** Card chrome: vertical padding, the footer row, and the gap below the card. */
const CARD_CHROME = 68;
/** `leading-relaxed` at the timeline's font size. */
const LINE = 26;
/** Average glyph advance, for turning a character count into lines. */
const CHAR_PX = 7.4;
/** Keep in step with SINGLE_MAX_H in attachment-album.tsx. */
const MEDIA_MAX_H = 320;
/** Gap between the album's tiles, and between one block and the next. */
const TILE_GAP = 4;
const BLOCK_GAP = 6;
const AUDIO_BUBBLE = 62;
const FILE_ROW = 66;
/** One entity card in the stub below the tear. */
const ENTITY_CARD = 72;
/** The stub's own chrome: the perforation, its padding, and the heading. */
const ENTITY_CHROME = 50;
/** What we assume of a picture whose dimensions have not synced yet. */
const DEFAULT_ASPECT = 4 / 3;
/** Past this many tiles the album stops growing (attachment-album.tsx). */
const GRID_CAP = 6;

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

export function estimateMessage(message: Message, width: number): number {
  let height = CARD_CHROME + textHeight(message.text, width);

  for (const block of toBlocks(message.attachments)) {
    height += BLOCK_GAP;
    if (block.type === "one") {
      height += block.face === "audio" ? AUDIO_BUBBLE : FILE_ROW;
      continue;
    }
    const items = block.items;
    if (items.length === 1) {
      // Exact for any picture whose dimensions have synced, which is every
      // picture the moment its message arrives (plan §8.3).
      const only = items[0]!;
      const aspect = aspectOf(only.width, only.height) ?? DEFAULT_ASPECT;
      height += Math.min(MEDIA_MAX_H, width / aspect);
    } else {
      // Square tiles in a 2- or 3-column grid.
      const columns = items.length <= 4 ? 2 : 3;
      const tile = (width - TILE_GAP * (columns - 1)) / columns;
      const rows = Math.ceil(Math.min(items.length, GRID_CAP) / columns);
      height += rows * tile + (rows - 1) * TILE_GAP;
    }
  }

  // The strip only exists when something was found, and it is deduped by
  // entity, the same way the card draws it.
  const entities = new Set(message.mentions.map((m) => m.entityId));
  if (entities.size > 0) height += ENTITY_CHROME + entities.size * ENTITY_CARD;

  return height;
}

export function Timeline({
  messages,
  state,
  sync,
  listRef,
}: {
  messages: Drop;
  /** What the workspace is doing. Nothing here second-guesses it. */
  state: ArchiveState;
  sync: SyncStatus | null;
  /** Owned by the shell, which watches it to know when the page has settled. */
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useRows(messages);
  // The list element only exists when there is something to draw; effects that
  // observe it have to re-run when it appears.
  const hasRows = rows.length > 0;
  const { view, tagId } = useFilter();
  // "Show in Messages", from a thing-shaped view or a detail overlay: the
  // message id rides in the hash, which is what makes the jump a real,
  // shareable URL rather than a piece of transient state.
  const { hash } = useLocation();
  // Which card the reader was just taken to, for as long as the pass over its
  // border runs (components/message-card.tsx).
  const [pointedAt, setPointedAt] = useState<string | null>(null);
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
      // Minus the card's own horizontal padding: this is the content column,
      // which is what the row estimates lay out against.
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
      if (row.type !== "day") return estimateMessage(row.message, width);
      return i === 0 ? FIRST_DAY_ROW : DAY_ROW;
    },
    overscan: 10,
    getItemKey: (i) => {
      const row = rows[i]!;
      return row.type === "day" ? `day-${row.key}` : row.message.id;
    },
    scrollMargin,
    // Chat anchoring, from the library rather than by hand: hold the view at
    // the newest message while lazy measurements land, hold the *reader's*
    // message still when older ones sync in above, and follow new dumps when
    // they are already at the end. The threshold is deliberately generous: the
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

  // Open at the newest message, and go back there when a filter swaps the row
  // set out from under the anchor. This covers mount too: Zero can hand over
  // the whole archive on the first render, and `followOnAppend` only fires on
  // a change.
  //
  // Pinning the *scroll* is not the whole job, and measurement showed why:
  // when the archive lands, the offset is already right and the rows are not:
  // they are laid out at estimated positions, so the newest card can be
  // 60 000px from where it belongs until the measurement pass corrects it
  // (~500ms for 400 rows on a dev box). That correction is the reason the shell
  // is revealed on a settled layout rather than on the arrival of data
  // (lib/settle.ts).
  useLayoutEffect(() => {
    // A hash asks for a specific message; the effect below takes it there.
    if (hash) return;
    virtualizer.scrollToEnd();
  }, [view, tagId, virtualizer, hash]);

  // Jump to one message and hold there. Handled once per hash: `rows` changes
  // identity on every sync tick, and re-running would drag the reader back to
  // the jump target every time anything in the archive moved.
  const jumpedTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Opening the overlay drops the hash, so asking for the same message a
    // second time is a second request and not one already served: without
    // this it would neither scroll nor light up again, which was invisible
    // while the highlight stayed on forever and is not now that it fades.
    if (!hash) {
      jumpedTo.current = null;
      return;
    }
    if (jumpedTo.current === hash) return;
    const index = rows.findIndex((r) => r.type === "message" && r.message.id === hash);
    if (index < 0) return;
    jumpedTo.current = hash;
    // The reader asked to be somewhere specific, so the end-anchoring below
    // must stop pulling them back to the newest message.
    readerScrolled.current = true;
    virtualizer.scrollToIndex(index, { align: "center" });
    setPointedAt(hash);
  }, [hash, rows, virtualizer]);

  // And stop pointing when the pass is over. The hash stays in the URL (it is
  // where the reader is, and it is still shareable); what ends is the card
  // saying so.
  useEffect(() => {
    if (!pointedAt) return;
    const timer = setTimeout(() => setPointedAt(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [pointedAt]);

  // Was the reader at the newest message? Sampled while scrolling, because by
  // the time a resize arrives it is too late to ask: the new viewport height
  // has already moved the end of the document out from under them.
  const atEndRef = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      atEndRef.current = virtualizer.isAtEnd(AT_END_PX);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [virtualizer]);

  // Has the reader taken the scroll for themselves yet? Until they do, the
  // newest message is where the view belongs, full stop.
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

  // Keep the newest message in view while the archive changes shape underneath.
  //
  // Rows grow after they first lay out (an image's bytes arrive, a message
  // finishes ingesting and drops a chip) and each growth below the fold pushes
  // the end of the document further away. The virtualizer's own end-anchoring
  // gives up once the gap exceeds `scrollEndThreshold`, so a handful of images
  // was enough to ratchet the view hundreds of pixels short of the newest card
  // and leave it there. Stability is not the same as correctness: the layout
  // had stopped moving, it had just stopped in the wrong place.
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
  // was at the newest message should still be there afterwards, or the newest
  // card ends up behind the composer.
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
    // cramped. The gutter is the composer's, and it is out here for the same
    // reason it is out there: it has to sit *outside* the column cap, or the
    // cards come out narrower than the card you type into.
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
                  // A separator's `py-3` is the gap between the two cards it
                  // parts. The one that opens the list has no card above it,
                  // and the column's top inset has already stood the list off
                  // the floating controls, so its top half would only push the
                  // list further down than the chrome asked for.
                  <div className={`flex justify-center pb-3 ${v.index === 0 ? "" : "pt-3"}`}>
                    {/* Drawn like the rows it separates: one fill and one
                        edge for everything sitting on the canvas. The base
                        badge already reserves a transparent border, so this
                        only has to colour it. */}
                    <Badge
                      variant="secondary"
                      className="border-border bg-background px-3 text-[11px] text-muted-foreground"
                    >
                      {row.label}
                    </Badge>
                  </div>
                ) : (
                  <div className="pb-3">
                    <MessageCard message={row.message} highlight={row.message.id === pointedAt} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Placeholder filtered={messages.length > 0} state={state} sync={sync} />
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
  /** There are messages; this filter just doesn't match any of them. */
  filtered: boolean;
  state: ArchiveState;
  sync: SyncStatus | null;
}) {
  // A loader that does appear stays long enough to be read.
  const syncing = usePatient(state === "syncing", BUDGET.loaderMin);

  // The archive has messages, this view has none of them: a fact about the
  // view, which is why the view says it in its own name and its own icon
  // (components/empty-screen.tsx).
  if (filtered) return <EmptyScreen />;

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
              "Nothing dropped on this device yet. Drop anything below. It syncs once the connection is back."
            : "Your archive is empty. Drop anything below. It syncs everywhere."}
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
