import type { BlobVariant } from "@ragbag/contracts";
import { API_BASE } from "@/lib/api";

// Media delivery, client side (plan §6.3-§6.5).
//
// Every picture in the app has one URL shape that never changes, and that
// string is the only thing that ever goes in a `src`. It resolves through the
// service worker when one is registered (cached, offline) and through the
// server route when one is not (a 302 to a freshly presigned GET). Same
// markup either way.

/**
 * The API's own origin, not this page's.
 *
 * This used to be deliberately origin-relative, which made the web host
 * responsible for routing `/api/media/*` and `/api/blobs/download-urls` to the
 * API, on the theory that a service worker can only intercept same-origin
 * requests cleanly. A worker sees every request its clients make, whatever the
 * origin, so that requirement bought nothing and cost everything: a static
 * host with no proxy (`serve`, which is what `pnpm --filter web start` runs)
 * answers those paths with `index.html` and a 200, and an `<img>` handed HTML
 * fires `error`. Every picture in the app then fell back to fetching its
 * untouched original through JS: megabytes per tile instead of a 30 KB
 * thumbnail, no native lazy loading, and nothing at all to show wherever the
 * browser cannot decode a camera HEIC. Addressing the API directly needs no
 * host configuration, so it cannot silently regress with one.
 *
 * The two hosts are separate origins but the same site (app./api.ragbag.app),
 * so the session cookie rides along on ordinary `SameSite=Lax` rules, exactly
 * as it does for every other API call. `API_BASE` is empty in dev, where the
 * Vite proxy already makes this origin-relative.
 */
export function mediaUrl(blobId: string, variant: BlobVariant): string {
  return `${API_BASE}/api/media/${blobId}/${variant}`;
}

/**
 * Whether an `<img>` can paint this file itself, or has to take the transcode.
 *
 * The full-screen viewer shows the file exactly as it was sent (plan §2.2),
 * because a picture opened full screen is the one place in the app where a
 * 1600px copy of it is not the picture. Everything a camera, a screenshot or a
 * download produces goes straight in.
 *
 * HEIC is the exception, and it is why this is asked at all: it decodes in
 * Safari and nowhere else, which is the entire reason the server transcodes
 * (server/src/ingest/derivatives.ts). Those go on showing the display variant.
 *
 * Decided from the mime rather than by trying the original and demoting it on
 * `error`, because a browser that cannot read a format downloads the whole
 * file before saying so: several megabytes per photo to learn what the mime
 * already said.
 */
const BROWSER_IMAGE =
  /^image\/(jpe?g|png|apng|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

export function rendersInBrowser(mime: string): boolean {
  return BROWSER_IMAGE.test(mime);
}

/**
 * Bump to abandon every cached derivative at once: entries are never
 * revalidated, so the only way to clear a bad one is to leave the cache it
 * lives in.
 *
 * The worker is *told* this, through its registration URL, rather than
 * carrying its own copy. A copy is how the seeding below spent a release
 * writing into `-v1` while the worker read `-v2`: the capturing device's whole
 * point is that it never round-trips, and it round-tripped for every picture.
 */
const CACHE_VERSION = "v3";

/** Cache Storage bucket for one variant; the worker composes the same names. */
function cacheName(variant: "thumb" | "display"): string {
  return `ragbag-media-${variant}-${CACHE_VERSION}`;
}

// Everything deployment-specific reaches the worker through its own URL: it is
// a static file, so it cannot be built with any of it. A change to either
// value is a different script URL, which is exactly what makes the browser
// install a new worker (and, on activation, drop the caches it replaced).
const SW_URL = `/media-sw.js?api=${encodeURIComponent(API_BASE)}&v=${CACHE_VERSION}`;

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
        const cache = await caches.open(cacheName(variant));
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
