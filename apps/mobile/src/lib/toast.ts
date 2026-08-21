import { useSyncExternalStore } from "react";
import { newId } from "@ragbag/shared";

// The transient message, for the handful of things that happen away from the
// surface that caused them: an upload that failed three screens ago, a server
// that refused a mutation the user has already navigated away from.
//
// Deliberately small, and deliberately not a toast library. The web app has
// sonner because a browser has nowhere else to put this; here almost every
// failure already has a home on the tile or row it belongs to, and the ones
// that do not are rare enough that a queue of one at a time is the whole
// requirement.

export type TToastTone = "info" | "error" | "warning";

export type TToast = {
  id: string;
  tone: TToastTone;
  title: string;
  description?: string | undefined;
  /** A single affordance, because two is a dialog and this is not one. */
  action?: { label: string; onPress: () => void } | undefined;
};

const DURATION_MS: Record<TToastTone, number> = {
  // Long enough to read twice: an error is the one a person is asked to act on.
  error: 8_000,
  warning: 6_000,
  info: 4_000,
};

let queue: readonly TToast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = queue.filter((t) => t.id !== id);
  if (next.length === queue.length) return;
  queue = next;
  publish();
}

function show(toast: Omit<TToast, "id">): string {
  const id = newId();
  queue = [...queue, { ...toast, id }];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), DURATION_MS[toast.tone]),
  );
  publish();
  return id;
}

export const toast = {
  info: (title: string, rest?: Omit<TToast, "id" | "tone" | "title">) =>
    show({ ...rest, tone: "info", title }),
  warning: (title: string, rest?: Omit<TToast, "id" | "tone" | "title">) =>
    show({ ...rest, tone: "warning", title }),
  error: (title: string, rest?: Omit<TToast, "id" | "tone" | "title">) =>
    show({ ...rest, tone: "error", title }),
};

export function useToasts(): readonly TToast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => queue,
    () => queue,
  );
}
