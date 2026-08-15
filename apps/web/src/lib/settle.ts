import { useEffect, useRef, useState, type RefObject } from "react";

// Timing discipline for everything that arrives asynchronously.
//
// The rule: a screen may not show a state it is about to take back. Every
// transition here is caused by an *event*: data arriving, the layout coming to
// rest, the connection changing. The three numbers below are budgets for when
// an expected event never arrives, never the mechanism by which the UI decides
// what is true.

export const BUDGET = {
  /**
   * Rows this device was told to expect (archive-hint.ts) that never came.
   * Stop waiting and tell the truth instead.
   */
  archive: 2_000,
  /**
   * The one legitimate spinner *delay*: the boot screen waits on an unbounded
   * network round trip (/api/meta) with nothing else to show, so a fast answer
   * shows no spinner at all and a slow one says something is happening.
   */
  bootLoader: 350,
  /** A loader that does appear stays long enough to be read rather than blink. */
  loaderMin: 400,
  /**
   * How long the boot canvas may stand in for the sign-in screen before an
   * unreachable server stops being a wait and becomes something to say.
   */
  unreachable: 6_000,
} as const;

/** How long a "worse" status must hold before it is worth reporting. */
export const STATUS_HOLD_MS = 800;

/** True once `active` has held continuously for `ms`. Good news can be instant; bad news waits. */
export function useHeld(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);

  return held;
}

/**
 * `active`, but once true it stays true for at least `ms`: a loader that
 * appears for one frame is worse than no loader at all.
 */
export function usePatient(active: boolean, ms: number): boolean {
  const [patient, setPatient] = useState(active);
  const since = useRef(0);

  useEffect(() => {
    if (active) {
      since.current = Date.now();
      setPatient(true);
      return;
    }
    const remaining = since.current + ms - Date.now();
    if (remaining <= 0) {
      setPatient(false);
      return;
    }
    const timer = setTimeout(() => setPatient(false), remaining);
    return () => clearTimeout(timer);
  }, [active, ms]);

  return patient;
}

/** True once `value` has been true at least once. */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value);
  if (value && !latched) setLatched(true);
  return latched;
}

/** Frames the layout may keep moving before we stop watching and reveal anyway. */
const MAX_SETTLE_FRAMES = 120;

/**
 * True once the page has come to rest: two consecutive animation frames in
 * which the document's height *and* the anchor element's viewport box are both
 * unchanged.
 *
 * This exists because "the rows are here" is not the same as "the list is
 * anchored". A virtualized list lays out at estimated positions, corrects the
 * scroll offset to re-pin the newest item, then corrects again as real
 * measurements land, and in the frame between the first two, the reader is
 * looking at empty space where the archive should be.
 * Waiting for a fixed number of milliseconds would be a guess about a machine
 * we cannot see; this measures the actual quantity, so a fast device reveals in
 * ~2 frames and a slow one takes what it needs.
 *
 * Deliberately not a ResizeObserver: the scroll *offset* moves without any box
 * resizing, and it is the offset that puts the anchor off screen.
 */
export function useLayoutSettled(watch: boolean, anchor: RefObject<HTMLElement | null>): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!watch || settled) return;

    let frame = 0;
    let previous: string | null = null;
    let stable = 0;
    let frames = 0;

    const tick = () => {
      const box = anchor.current?.getBoundingClientRect();
      const fingerprint = `${document.documentElement.scrollHeight}:${box ? Math.round(box.bottom) : "-"}`;
      stable = fingerprint === previous ? stable + 1 : 0;
      previous = fingerprint;
      if (stable >= 2 || ++frames >= MAX_SETTLE_FRAMES) {
        setSettled(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [watch, settled, anchor]);

  return settled;
}
