import { metaResponse, type TMetaResponse } from "@ragbag/contracts";
import { useSyncExternalStore } from "react";
import { apiUrl } from "@/lib/api";
import { onReconnect } from "@/lib/network";

/**
 * Server capabilities from /api/meta (google configured? dev login? blobs? ai?).
 * Stays undefined while loading AND when the server is unreachable; callers
 * must not treat "unknown" as "off", because offline capture still works.
 *
 * One request per app launch, shared by every caller, started at module import
 * rather than on mount: on the sign-in screen, the one path with nothing else
 * to show, that round trip IS the wait.
 *
 * Retries on a backoff, because one unreachable moment is not a verdict. This
 * is the same module as the web app's lib/use-meta.ts, with the browser's
 * `online` event swapped for the native one.
 */

let meta: TMetaResponse | undefined;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function load(): void {
  if (meta) return;
  fetch(apiUrl("/api/meta"))
    .then((r) => r.json())
    .then((data) => {
      meta = metaResponse.parse(data);
      for (const listener of listeners) listener();
    })
    .catch(() => {
      timer = setTimeout(load, Math.min(1_000 * 2 ** attempt++, 30_000));
    });
}

load();

onReconnect(() => {
  attempt = 0;
  clearTimeout(timer);
  load();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMeta(): TMetaResponse | undefined {
  return useSyncExternalStore(
    subscribe,
    () => meta,
    () => meta,
  );
}
