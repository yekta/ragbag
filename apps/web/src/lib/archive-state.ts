import { useEffect, useRef, type RefObject } from "react";
import { loadArchiveHint, saveArchiveHint } from "@/lib/archive-hint";
import { BUDGET, useHeld, useLayoutSettled } from "@/lib/settle";
import { isSyncPaused, type SyncStatus } from "@/lib/sync-status";
import type { Drop } from "@/lib/types";

// What the workspace is doing, in one word, with a reason for each. Readiness
// used to be four booleans spread across the app shell, the timeline and the
// sidebar, each deciding for itself what an empty-and-unknown query result
// meant.

export type ArchiveState =
  /** Rows are expected and not here yet: show nothing at all. */
  | "opening"
  /** Nothing local to expect and sync is live: the one honest loader. */
  | "syncing"
  /** Known empty, or the server confirmed empty, or sync is paused with no rows. */
  | "empty"
  /** Rows are here and the layout has stopped moving. */
  | "ready";

export function useArchiveState({
  count,
  resultType,
  sync,
  anchor,
}: {
  /** Rows the timeline would paint right now. */
  count: number;
  resultType: "unknown" | "complete" | "error";
  sync: SyncStatus | null;
  /** The list element, watched to know when the page has come to rest. */
  anchor: RefObject<HTMLElement | null>;
}): ArchiveState {
  // Read once: this is what the device knew before Zero opened its store, and
  // it must not change under us mid-boot.
  const hint = useRef(loadArchiveHint()).current;
  const settled = useLayoutSettled(count > 0, anchor);
  // The backstop: rows we were told to expect that never arrived.
  const budgetSpent = useHeld(count === 0, BUDGET.archive);

  if (count > 0) return settled ? "ready" : "opening";

  // No rows. Whose truth is that?
  if (resultType !== "unknown") return "empty"; // the server confirmed it
  if (isSyncPaused(sync)) return "empty"; // nothing more is coming
  if (hint && hint.count > 0 && !budgetSpent) return "opening"; // they're on their way
  // Either this device has never held an archive (first run, so the loader is
  // both honest and immediate), or it held an empty one, or we waited and
  // nothing came.
  return hint?.count === 0 ? "empty" : "syncing";
}

/**
 * Records what the timeline settled on, for the next boot to expect. Only ever
 * writes a truth the UI actually painted, never a way-station.
 */
export function useArchiveHintWriter(state: ArchiveState, count: number): void {
  useEffect(() => {
    if (state === "ready" || state === "empty") saveArchiveHint(count);
  }, [state, count]);
}

/**
 * The rows to paint: never fewer than we already painted, unless something
 * authoritative says so.
 *
 * An empty, `unknown` snapshot means "we don't know yet": it is what Zero
 * hands over before its local store answers, and treating it as "the archive is
 * empty" is what let the timeline collapse from thousands of pixels to one
 * screen and back. A `complete` empty result still
 * clears the list, so deleting your last item works.
 */
export function useStableRows(items: Drop, resultType: "unknown" | "complete" | "error") {
  const last = useRef<Drop>(items);
  const warned = useRef(false);
  if (items.length > 0 || resultType !== "unknown") last.current = items;

  // Once per session: the condition holds for every render until the rows come
  // back, and a wall of identical warnings is its own kind of noise.
  if (import.meta.env.DEV && !warned.current && items.length === 0 && last.current.length > 0) {
    warned.current = true;
    console.warn(
      `[settle] the timeline query went from ${last.current.length} rows to 0 while still "unknown", ` +
        `holding the last rows. A rebuilt Zero client is the usual cause.`,
    );
  }

  return last.current;
}
