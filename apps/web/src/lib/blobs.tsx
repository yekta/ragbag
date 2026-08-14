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
// resolution per blobId, shared across cards/detail views. Two caches, not one:
// the promise is what de-duplicates concurrent callers, and the *resolved*
// value is what lets a re-mounted card render its image on its first frame.
// The timeline is virtualized, so scrolling an image out of view and back is a
// re-mount — going through the promise every time meant a pulsing grey box and
// a height change on every pass (SETTLE_PLAN.md §1.5).
const urlCache = new Map<string, Promise<string | null>>();
const resolvedUrls = new Map<string, string>();

function resolveUrl(queue: BlobQueue, blobId: string): Promise<string | null> {
  const key = blobId;
  let promise = urlCache.get(key);
  if (!promise) {
    promise = queue.fetchBytes(blobId).then((res) => (res ? URL.createObjectURL(res.bytes) : null));
    urlCache.set(key, promise);
    void promise.then((url) => {
      // Let a later retry re-attempt what failed (offline, not yet uploaded).
      if (url === null) urlCache.delete(key);
      else resolvedUrls.set(key, url);
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
  // Seeded synchronously: an already-resolved blob never goes through a
  // placeholder state again for the rest of the session.
  const [url, setUrl] = useState<string | null>(() => (blobId && resolvedUrls.get(blobId)) || null);

  useEffect(() => {
    if (!blobId) return;
    const known = resolvedUrls.get(blobId);
    if (known) {
      setUrl(known);
      return;
    }
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

// Remembered image shapes, so a picture's box is the right size before the
// picture is there — including on the next visit, before its bytes have been
// read back out of IndexedDB. Without it, every image card grows from a fixed
// placeholder to its real height as it loads, which re-flows the rows below and
// makes the virtualizer re-measure the document under the reader.
const ASPECT_KEY = "ragbag:blob-aspect";
/** Bounded: a personal archive's worth of ratios, oldest evicted first. */
const ASPECT_MAX = 500;

const aspects = new Map<string, number>(loadAspects());

function loadAspects(): [string, number][] {
  try {
    const raw = localStorage.getItem(ASPECT_KEY);
    if (!raw) return [];
    return Object.entries(JSON.parse(raw) as Record<string, number>).filter(
      ([, ratio]) => typeof ratio === "number" && ratio > 0,
    );
  } catch {
    return [];
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistAspects(): void {
  clearTimeout(persistTimer);
  // Debounced: a screenful of images all load within a few frames of each other.
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(ASPECT_KEY, JSON.stringify(Object.fromEntries(aspects)));
    } catch {
      // Quota or private mode — the ratios just don't survive the session.
    }
  }, 1_000);
}

/** Width ÷ height for a blob this device has displayed before, if it has. */
export function blobAspect(blobId: string | null | undefined): number | undefined {
  return blobId ? aspects.get(blobId) : undefined;
}

/** Called from an image's `load`: the only place the true ratio is known. */
export function rememberBlobAspect(blobId: string | null | undefined, img: HTMLImageElement): void {
  if (!blobId || !img.naturalWidth || !img.naturalHeight) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  if (aspects.get(blobId) === ratio) return;
  aspects.delete(blobId);
  aspects.set(blobId, ratio);
  while (aspects.size > ASPECT_MAX) aspects.delete(aspects.keys().next().value!);
  persistAspects();
}

/**
 * The exact box an image will occupy, for the placeholder that stands in for it
 * and for the image itself — so the swap changes nothing. `min()` rather than
 * arithmetic on a measured width: the browser resolves it against whatever the
 * column happens to be, at any viewport, without React measuring anything.
 */
export function mediaBox(
  blobId: string | null | undefined,
  maxHeight: string,
): { width: string; aspectRatio: number } | undefined {
  const aspect = blobAspect(blobId);
  return aspect
    ? { width: `min(100%, calc(${maxHeight} * ${aspect}))`, aspectRatio: aspect }
    : undefined;
}
