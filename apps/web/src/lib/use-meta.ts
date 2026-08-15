import { metaResponse, type MetaResponse } from "@ragbag/contracts";
import { useSyncExternalStore } from "react";
import { apiUrl } from "@/lib/api";

/**
 * Server capabilities from /api/meta (google configured? dev login? blobs? ai?).
 * Stays undefined while loading AND when the server is unreachable; callers
 * must not treat "unknown" as "off" (offline capture still works).
 *
 * One request per page load, shared by every caller, started at module import
 * rather than on mount: three components used to ask separately, and none of
 * them started asking until React had mounted: on the sign-in screen, the one
 * path with nothing else to show, that round trip *is* the wait.
 *
 * Retries on failure, because one unreachable moment is not a verdict: without
 * it, a fetch that lost a race with the API's boot left the sign-in screen
 * waiting forever, since nothing ever asked again.
 */

let meta: MetaResponse | undefined;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function load(): void {
  if (meta) return;
  fetch(apiUrl("/api/meta"), { credentials: "include" })
    .then((r) => r.json())
    .then((data) => {
      meta = metaResponse.parse(data);
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // Unreachable: the app runs local-first regardless, so just keep asking
      // on a backoff rather than giving up.
      timer = setTimeout(load, Math.min(1_000 * 2 ** attempt++, 30_000));
    });
}

load();

// Reconnecting is a much better signal than any timer.
window.addEventListener("online", () => {
  attempt = 0;
  clearTimeout(timer);
  load();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMeta(): MetaResponse | undefined {
  return useSyncExternalStore(
    subscribe,
    () => meta,
    () => meta,
  );
}
