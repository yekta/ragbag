import { BlobQueue } from "@ragbag/client-runtime";
import type { BlobQueueState } from "@ragbag/client-runtime";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

// One BlobQueue per signed-in user (like Zero's per-user store). The queue
// itself lives in client-runtime; this file is the React glue.

const queues = new Map<string, BlobQueue>();

export function blobQueueFor(userID: string): BlobQueue {
  let queue = queues.get(userID);
  if (!queue) {
    queue = new BlobQueue({ userID });
    queues.set(userID, queue);
  }
  return queue;
}

const BlobQueueContext = createContext<BlobQueue | null>(null);
export const BlobQueueProvider = BlobQueueContext.Provider;

export function useBlobQueue(): BlobQueue {
  const queue = useContext(BlobQueueContext);
  if (!queue) throw new Error("useBlobQueue outside BlobQueueProvider");
  return queue;
}

export function useBlobQueueState(): BlobQueueState {
  const queue = useBlobQueue();
  return useSyncExternalStore(
    (cb) => queue.subscribe(cb),
    () => queue.state,
  );
}

// Object URLs live for the whole session (personal-archive scale); one
// resolution per blobId, shared across cards/detail views.
const urlCache = new Map<string, Promise<string | null>>();

function resolveUrl(queue: BlobQueue, blobId: string): Promise<string | null> {
  const key = blobId;
  let promise = urlCache.get(key);
  if (!promise) {
    promise = queue.fetchBytes(blobId).then((res) => (res ? URL.createObjectURL(res.bytes) : null));
    urlCache.set(key, promise);
    // Let a later retry re-attempt what failed (offline, not yet uploaded).
    void promise.then((url) => {
      if (url === null) urlCache.delete(key);
    });
  }
  return promise;
}

/**
 * Object URL for a blob's bytes: instantly from the local store when this
 * device captured (or previously viewed) it, else lazily downloaded and
 * cached. Null while loading or when unavailable offline.
 */
export function useBlobUrl(blobId: string | null | undefined): string | null {
  const queue = useBlobQueue();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blobId) return;
    let cancelled = false;
    void resolveUrl(queue, blobId).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [queue, blobId]);

  return blobId ? url : null;
}
