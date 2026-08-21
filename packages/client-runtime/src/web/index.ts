import { BlobQueue, type TBlobQueueOptions } from "../blob-queue.js";
import { IdbBlobStore } from "./idb-store.js";
import { subtleDigest } from "./digest.js";
import { xhrUploader } from "./xhr-upload.js";

export * from "./idb.js";
export { IdbBlobStore } from "./idb-store.js";
export { subtleDigest } from "./digest.js";
export { xhrUploader } from "./xhr-upload.js";

/**
 * A blob queue wired for a browser: IndexedDB for storage, XMLHttpRequest for
 * progress, Web Crypto for the hash, and the two events that mean the world
 * changed (the network coming back, and the tab becoming visible again, which
 * is when someone is actually looking at the chip that is stuck).
 */
export function webBlobQueue(
  opts: Omit<TBlobQueueOptions, "store" | "upload" | "digest" | "isOnline" | "watchWake">,
): BlobQueue {
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  return new BlobQueue({
    ...opts,
    store: new IdbBlobStore(opts.userID),
    upload: xhrUploader(fetchImpl),
    digest: subtleDigest,
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    watchWake: (retry) => {
      const onOnline = () => retry();
      const onVisible = () => {
        if (!document.hidden) retry();
      };
      addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
  });
}
