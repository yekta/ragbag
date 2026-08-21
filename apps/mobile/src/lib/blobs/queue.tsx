import { BlobQueue, type TBlobQueueState, type TBlobUploadState } from "@ragbag/client-runtime";
import { createContext, use, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/auth";
import { expoDigest } from "@/lib/blobs/digest";
import { ExpoBlobStore } from "@/lib/blobs/store";
import { expoUploader } from "@/lib/blobs/upload";
import { isOnline, onReconnect } from "@/lib/network";

// One BlobQueue per signed-in user, like Zero's per-user store.
//
// The queue's state machine is @ragbag/client-runtime's and is shared with the
// web app; this file is the Expo wiring for it plus the React glue. The three
// seams are SQLite-and-the-filesystem, expo-file-system's UploadTask, and
// expo-crypto.
//
// The bearer token is a function rather than a value because it is not
// reactive: `authClient.getCookie()` reads the keychain cache, and the queue
// asks for headers per request, so a session that lands mid-backoff is used by
// the next attempt without anything having to rebuild the queue.

const queues = new Map<string, BlobQueue>();

export function blobQueueFor(userID: string): BlobQueue {
  let queue = queues.get(userID);
  if (!queue) {
    queue = new BlobQueue({
      userID,
      apiBase: API_BASE,
      authHeaders,
      store: new ExpoBlobStore(userID),
      upload: expoUploader(),
      digest: expoDigest,
      isOnline,
      watchWake: (retry) => {
        const network = onReconnect(retry);
        // Coming back to the foreground is the other signal that matters, and
        // it matters more here than the tab-visibility equivalent does on web:
        // a phone spends most of its life with the app suspended, so this is
        // usually the moment a backoff earned an hour ago should be abandoned.
        const app = AppState.addEventListener("change", (state) => {
          if (state === "active") retry();
        });
        return () => {
          network();
          app.remove();
        };
      },
    });
    queues.set(userID, queue);
  }
  return queue;
}

/** Drop every queue's local data: an explicit sign-out on a shared device. */
export async function clearBlobQueues(): Promise<void> {
  for (const queue of queues.values()) {
    await queue.clear().catch(() => {});
    queue.dispose();
  }
  queues.clear();
}

const BlobQueueContext = createContext<BlobQueue | null>(null);

export function BlobQueueProvider({ queue, children }: { queue: BlobQueue; children: ReactNode }) {
  return <BlobQueueContext value={queue}>{children}</BlobQueueContext>;
}

export function useBlobQueue(): BlobQueue {
  const queue = use(BlobQueueContext);
  if (!queue) throw new Error("useBlobQueue outside BlobQueueProvider");
  return queue;
}

export function useBlobQueueState(): TBlobQueueState {
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
export function useBlobUploadState(blobId: string | null | undefined): TBlobUploadState | null {
  const queue = useBlobQueue();
  return useSyncExternalStore(
    (cb) => queue.subscribe(cb),
    () => (blobId ? (queue.state.blobs[blobId] ?? null) : null),
  );
}
