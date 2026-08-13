import { BlobQueue } from "@ragbag/client-runtime";
import type { BlobQueueState, BlobUploadState } from "@ragbag/client-runtime";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/api";

// One BlobQueue per signed-in user (like Zero's per-user store). The queue
// itself lives in client-runtime; this file is the React glue.

const queues = new Map<string, BlobQueue>();

export function blobQueueFor(userID: string): BlobQueue {
  let queue = queues.get(userID);
  if (!queue) {
    queue = new BlobQueue({ userID, apiBase: API_BASE });
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

/**
 * One blob's upload lifecycle, or null when the queue no longer tracks it —
 * which for anything this device captured means "uploaded". Entry identity is
 * stable between queue notifications, so this is safe for useSyncExternalStore.
 */
export function useBlobUploadState(blobId: string | null | undefined): BlobUploadState | null {
  const queue = useBlobQueue();
  return useSyncExternalStore(
    (cb) => queue.subscribe(cb),
    () => (blobId ? (queue.state.blobs[blobId] ?? null) : null),
  );
}

/**
 * Turns queue state transitions into toasts: one per blob per distinct
 * failure (a retry loop must not re-toast every attempt), plus a one-time
 * warning when local persistence is unavailable. Mounted once, in QueueWiring.
 */
export function useBlobQueueToasts(): void {
  const queue = useBlobQueue();
  const state = useBlobQueueState();
  const toasted = useRef(new Map<string, string>());
  const warnedEphemeral = useRef(false);

  useEffect(() => {
    if (state.ephemeral && !warnedEphemeral.current) {
      warnedEphemeral.current = true;
      toast.warning("This browser's local storage is unavailable", {
        description: "Attachments still upload, but won't survive a reload until they finish.",
      });
    }

    // While parked for sign-in or fully offline, the banners already explain
    // the situation — per-blob toasts would just pile on.
    if (state.blocked === "auth" || !navigator.onLine) return;

    for (const [blobId, entry] of Object.entries(state.blobs)) {
      if (entry.stage !== "waiting" || !entry.lastError) continue;
      if (toasted.current.get(blobId) === entry.lastError) continue;
      toasted.current.set(blobId, entry.lastError);
      toast.error("Upload failed — retrying automatically", {
        description: entry.lastError,
        action: { label: "Retry now", onClick: () => void queue.retryBlob(blobId) },
      });
    }
    // Forget completed/removed blobs so the map can't grow unbounded.
    for (const blobId of toasted.current.keys()) {
      if (!state.blobs[blobId] || state.blobs[blobId].stage === "done") {
        toasted.current.delete(blobId);
      }
    }
  }, [state, queue]);
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
