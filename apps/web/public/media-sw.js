/* eslint-env serviceworker */

// The media service worker (plan §6.4).
//
// It intercepts exactly one path shape, `/api/media/<blobId>/<variant>`, and
// nothing else. It must never cache app assets: that is a separate and much
// worse problem with Vite builds and update lifecycles. Kept this narrow it is
// about fifty lines of real logic.
//
// Those URLs point at the API's own origin, which is not this script's: a
// worker sees every request its clients make, whatever the origin, and having
// the app address the API directly is what removes the web host from the media
// path entirely (src/lib/media.ts says what that cost when it was in it).
//
// On a hit it answers from Cache Storage. On a miss it does the presign itself
// (batched, see below) and fetches the bytes, then stores the response and
// returns it. Without this worker registered every one of these requests goes
// to the server route instead, which 302s to a presigned GET: the same markup
// works either way, you just get online-only images.
//
// Cache Storage keys on the request URL, so variants are naturally separate
// entries and there is no cache-key scheme to invent.

// Everything deployment-specific arrives in this script's own URL, because a
// static file cannot be built with any of it (see `registerMediaWorker`): the
// API's base, and the cache generation the app considers current. Defaults
// cover a registration made by an older build, which passed neither.
const PARAMS = new URL(self.location.href).searchParams;
/** Base of the API. "" when it is same-origin, which is dev behind the proxy. */
const API_BASE = PARAMS.get("api") ?? "";
const API_ORIGIN = API_BASE ? new URL(API_BASE).origin : self.location.origin;
const VERSION = PARAMS.get("v") || "v2";
const MEDIA_PREFIX = "/api/media/";

/**
 * Tiering by variant, not one flat budget (plan §6.5). v1 kept a flat 512 MB
 * of *originals*, which buys about 150 phone photos. The same ~500 MB spent
 * here is roughly 6,000 thumbnails plus 750 recently-viewed full images.
 *
 * Originals are deliberately absent: several megabytes each, wanted only for
 * download and deep zoom, and fetched on demand when they are.
 */
const TIERS = {
  thumb: { cache: `ragbag-media-thumb-${VERSION}`, max: 6000, lru: false },
  display: { cache: `ragbag-media-display-${VERSION}`, max: 750, lru: true },
};

/** How long misses are collected before one batched presign goes out. */
const BATCH_WINDOW_MS = 40;
/** The server's own ceiling on one batch (contracts/payloads.ts). */
const BATCH_MAX = 100;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an older VERSION; leave everything else alone,
      // including whatever else on this origin owns a cache.
      const keep = new Set(Object.values(TIERS).map((t) => t.cache));
      for (const name of await caches.keys()) {
        if (name.startsWith("ragbag-media-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** `/api/media/<blobId>/<variant>` → its parts, or null for anything else. */
function parseMediaUrl(url) {
  // The API's origin, where every `src` points, plus this one: a deployment
  // whose API is same-origin (dev) or fronted by the app's host still works.
  if (url.origin !== API_ORIGIN && url.origin !== self.location.origin) return null;
  if (!url.pathname.startsWith(MEDIA_PREFIX)) return null;
  const [blobId, variant] = url.pathname.slice(MEDIA_PREFIX.length).split("/");
  return blobId && variant ? { blobId, variant } : null;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const target = parseMediaUrl(new URL(event.request.url));
  // Originals are not cached and do not need to be: they go straight through
  // to the server route, which redirects to the bucket.
  if (!target || !(target.variant in TIERS)) return;
  event.respondWith(serve(event.request, target));
});

async function serve(request, { blobId, variant }) {
  const tier = TIERS[variant];
  const cache = await caches.open(tier.cache);
  const hit = await cache.match(request);
  if (hit) {
    // Cache Storage returns keys in insertion order, so re-inserting on a hit
    // is what turns FIFO eviction into LRU. Only the display tier pays for it:
    // thumbnails are kept aggressively rather than by recency, and refreshing
    // one on every scroll would be a write per tile per pass.
    if (tier.lru) {
      await cache.delete(request);
      await cache.put(request, hit.clone());
    }
    return hit;
  }

  try {
    const { url, cacheable } = await presign(blobId, variant);
    if (url) {
      const response = await fetch(url);
      // A presign the bucket refused is not an answer. Handing the tile a 403
      // or a 404 body puts it in the one state it cannot leave on its own, and
      // the server route below mints a fresh URL for a second opinion.
      if (response.ok) {
        // Only a real derivative is worth keeping. For one ingestion has not
        // built yet the server hands back the original instead, which is the
        // right picture to show and the wrong one to remember: it is the file
        // exactly as sent, and a hit here is never revalidated, so caching it
        // would pin a HEIC under the thumb key long after the webp existed.
        if (cacheable && response.type !== "opaque") {
          await cache.put(request, response.clone());
          await evict(cache, tier.max);
        }
        return response;
      }
    }
  } catch {
    // Offline, a refused presign, a bucket without a CORS rule: fall through
    // to the plain request, which is what the app does with no worker at all.
  }
  return fetch(request);
}

/**
 * Evict oldest-first down to the entry cap. Counting entries rather than bytes
 * because Cache Storage exposes no size: the caps come from the typical size
 * of each variant, and `navigator.storage.estimate()` is what the app shows
 * the user, so the numbers here are ceilings rather than assumptions.
 *
 * Eviction is invisible either way: the `placeholder` on the synced row means
 * an evicted thumb still paints at the correct geometry, blurred, and quietly
 * refetches 30 KB. No broken state, no grey box, no reflow.
 */
async function evict(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
}

// --- batched presign ---
//
// Presigning is a local HMAC on the server with no round trip to the bucket,
// so a hundred is nearly free. A grid scroll misses on forty tiles inside a
// few frames; collecting them for one tick turns that into one request.

let pending = null;

/** → `{ url, cacheable }`; a null url means "ask the server route instead". */
function presign(blobId, variant) {
  if (!pending || pending.variant !== variant || pending.ids.size >= BATCH_MAX) {
    pending = { variant, ids: new Set(), promise: null };
    const batch = pending;
    batch.promise = new Promise((resolve) => {
      setTimeout(async () => {
        if (pending === batch) pending = null;
        try {
          const res = await fetch(`${API_BASE}/api/blobs/download-urls`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ blobIds: [...batch.ids], variant: batch.variant }),
          });
          resolve(res.ok ? await res.json() : {});
        } catch {
          resolve({});
        }
      }, BATCH_WINDOW_MS);
    });
  }
  const batch = pending;
  batch.ids.add(blobId);
  return batch.promise.then((data) => ({
    url: data.urls?.[blobId] ?? null,
    // No `fallback` key at all means a server older than it, which cannot say
    // whether these bytes are the derivative or the original standing in for
    // it. Don't keep what you cannot identify: the cost is a refetch, and the
    // cost of guessing wrong is permanent.
    cacheable: Array.isArray(data.fallback) && !data.fallback.includes(blobId),
  }));
}
