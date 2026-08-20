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
 * One blob's upload lifecycle, or null when the queue no longer tracks it:
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
    // the situation; per-blob toasts would just pile on.
    if (state.blocked === "auth" || !navigator.onLine) return;

    for (const [blobId, entry] of Object.entries(state.blobs)) {
      if (entry.stage !== "waiting" || !entry.lastError) continue;
      if (toasted.current.get(blobId) === entry.lastError) continue;
      toasted.current.set(blobId, entry.lastError);
      toast.error("Upload failed, retrying automatically", {
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
// re-mount: going through the promise every time meant a pulsing grey box and
// a height change on every pass.
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

export type BlobUrlState = {
  /** Object URL for the bytes, or null while it resolves and if it cannot. */
  url: string | null;
  /**
   * Whether the lookup has an answer yet. `!url && settled` is the only
   * combination that means "there are no bytes to be had": callers that fall
   * back to something else need to tell it apart from the wait, which for an
   * original off the bucket is a real download.
   */
  settled: boolean;
};

const UNRESOLVED: BlobUrlState = { url: null, settled: false };

/**
 * Object URL for a blob's bytes: instantly from the local store when this
 * device captured (or previously viewed) it, else lazily downloaded and
 * cached. Null while loading or when unavailable offline.
 */
export function useBlobUrlState(blobId: string | null | undefined): BlobUrlState {
  const queue = useBlobQueue();
  // Seeded synchronously: an already-resolved blob never goes through a
  // placeholder state again for the rest of the session.
  const [state, setState] = useState<BlobUrlState>(() => resolved(blobId));

  useEffect(() => {
    // Same object when nothing changed, so a re-render is not a state update.
    const known = resolved(blobId);
    setState((prev) => (prev.url === known.url && prev.settled === known.settled ? prev : known));
    if (!blobId || known.url) return;
    let cancelled = false;
    void resolveUrl(queue, blobId).then((url) => {
      if (!cancelled) setState({ url, settled: true });
    });
    return () => {
      cancelled = true;
    };
  }, [queue, blobId]);

  return state;
}

function resolved(blobId: string | null | undefined): BlobUrlState {
  const url = (blobId && resolvedUrls.get(blobId)) || null;
  return url ? { url, settled: true } : UNRESOLVED;
}

/** `useBlobUrlState` for callers that only care whether there is a URL yet. */
export function useBlobUrl(blobId: string | null | undefined): string | null {
  return useBlobUrlState(blobId).url;
}

// Image geometry comes off the synced row (plan §8.3).
//
// v1 kept the aspect ratio in this device's localStorage, learned from an
// `onLoad`, which meant a new device laid out garbage on its first load and
// every picture grew from a fixed placeholder to its real height as it
// decoded, re-flowing the rows below it. `width`/`height` are columns now:
// the capturing device measures them before it sends, the derivatives pass
// confirms them with EXIF orientation baked in, and every device gets the
// same box before any bytes arrive.

/** Width ÷ height for an attachment, when its dimensions are known. */
export function aspectOf(
  width: number | null | undefined,
  height: number | null | undefined,
): number | undefined {
  return width && height && width > 0 && height > 0 ? width / height : undefined;
}

/**
 * The exact box an image will occupy, for the placeholder that stands in for it
 * and for the image itself, so the swap changes nothing. `min()` rather than
 * arithmetic on a measured width: the browser resolves it against whatever the
 * column happens to be, at any viewport, without React measuring anything.
 *
 * `maxHeight` is a length in whatever unit the caller's ceiling is written in:
 * a fixed one in the album, `100cqh` in the full-screen viewer, where the
 * ceiling is the frame's own height and the frame is a size container. That
 * second case is why this is a width and a ratio rather than a pair of maxes:
 * `max-height` fitting a picture down leaves its width where it was, so a
 * photo shorter than the frame is wide gets an element wider than itself, and
 * whatever is painted on that element (a fill, a border) shows down both
 * sides of it. A width the height cannot contradict has nothing to letterbox.
 */
export function mediaBox(
  width: number | null | undefined,
  height: number | null | undefined,
  maxHeight: string,
): { width: string; aspectRatio: number } | undefined {
  const aspect = aspectOf(width, height);
  return aspect
    ? { width: `min(100%, calc(${maxHeight} * ${aspect}))`, aspectRatio: aspect }
    : undefined;
}

/**
 * The dimensions of a picked image, read on the capturing device before it is
 * sent, so its own chat bubble has the right geometry from the first frame and
 * so does every other device the row syncs to. Null when the browser cannot
 * decode the file (a .ico, a HEIC on a non-Safari browser), in which case the
 * derivatives pass fills them in server-side.
 */
export async function measureImage(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}
