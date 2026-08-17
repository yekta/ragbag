import type { BlobVariant } from "@ragbag/contracts";

// Media delivery, client side (plan §6.3-§6.5).
//
// Every picture in the app has one URL shape that never changes, and that
// string is the only thing that ever goes in a `src`. It resolves through the
// service worker when one is registered (cached, offline) and through the
// server route when one is not (a 302 to a freshly presigned GET). Same
// markup either way.

/**
 * Deliberately origin-relative, not `API_BASE`-prefixed.
 *
 * The media path has to be same-origin with the page for the service worker to
 * intercept it cleanly. The Vite dev proxy already gives us that, and a
 * production deployment has to preserve it: the web host must route
 * `/api/media/*` (and `/api/blobs/download-urls`, which the worker calls) to
 * the API. See DEPLOY.md.
 */
export function mediaUrl(blobId: string, variant: BlobVariant): string {
  return `/api/media/${blobId}/${variant}`;
}

const SW_URL = "/media-sw.js";

/**
 * Register the media worker. Failure is not an error state: without it,
 * images are online-only, which is exactly how the app behaves on a browser
 * that has no service workers at all.
 */
export function registerMediaWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => {
    // Private mode, an insecure origin, a policy that forbids it. The app
    // works; it just refetches.
  });
}

/**
 * Ask for durable storage after a first successful sync.
 *
 * The archive is the point of this app, and a browser that evicts it under
 * pressure has thrown away the one copy on this device. Chrome grants this
 * silently on an engaged origin; Safari has no such call and its own rule
 * instead (below).
 */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => {});
}

export type StorageUsage = { usage: number; quota: number; persisted: boolean };

/** Real numbers, so the caps in the worker are ceilings, not assumptions. */
export async function storageUsage(): Promise<StorageUsage | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}

/** Everything the media worker holds. Text and the archive are untouched. */
export async function clearMediaCache(): Promise<void> {
  if (!("caches" in globalThis)) return;
  for (const name of await caches.keys()) {
    if (name.startsWith("ragbag-media-")) await caches.delete(name);
  }
}

// --- seeding on send ---
//
// The capturing device never round-trips (plan §6.4). It already holds the
// bytes when it sends, so it writes them into Cache Storage under the same
// `/api/media/...` keys the worker reads, and its own photos are served from
// cache from the very first render. The derivatives it writes are its own
// downscales rather than the server's; they are the same picture, and the
// server's overwrite nothing (Cache Storage is keyed by URL, and a later miss
// simply fetches the real one).

const TIER_CACHE: Partial<Record<BlobVariant, string>> = {
  thumb: "ragbag-media-thumb-v1",
  display: "ragbag-media-display-v1",
};

const SIZES: Partial<Record<BlobVariant, number>> = { thumb: 400, display: 1600 };

/**
 * Write this device's own copy of a picture into the media caches. Best
 * effort throughout: a format the browser cannot decode (a HEIC anywhere but
 * Safari) simply is not seeded, and that device round-trips like any other.
 */
export async function seedMediaCache(blobId: string, file: Blob): Promise<void> {
  if (!("caches" in globalThis) || !file.type.startsWith("image/")) return;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      for (const variant of ["thumb", "display"] as const) {
        const blob = await downscale(bitmap, SIZES[variant]!);
        if (!blob) continue;
        const cache = await caches.open(TIER_CACHE[variant]!);
        await cache.put(
          new Request(mediaUrl(blobId, variant)),
          new Response(blob, { headers: { "content-type": blob.type } }),
        );
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // Not decodable here, no OffscreenCanvas, storage refused: skip.
  }
}

async function downscale(bitmap: ImageBitmap, maxEdge: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
}
