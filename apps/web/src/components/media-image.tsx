import type { BlobVariant } from "@ragbag/contracts";
import { useCallback, useEffect, useState } from "react";
import { thumbHashToDataURL } from "thumbhash";
import { Icon } from "@/components/icon";
import { useBlobUrlState } from "@/lib/blobs";
import { mediaUrl } from "@/lib/media";

// Every picture in the app goes through here, so there is one place that knows
// how a picture is fetched, how it is laid out before it arrives, and what to
// do when it does not (plan §6.3-§6.5).
//
// The `src` is the stable media URL, never a presigned one and never an object
// URL, which is what hands lazy loading, off-main-thread decode and memory
// eviction back to the browser. A grid of several hundred tiles is then the
// browser's problem rather than a few hundred Blobs held in JS.

/** Decoded placeholders, bounded: a screenful of tiles decodes once. */
const placeholderCache = new Map<string, string>();
const PLACEHOLDER_MAX = 500;

/**
 * The blurred stand-in, from the `placeholder` column on the synced row.
 *
 * It lives in the row rather than in any cache, which is what makes the
 * worker's eviction invisible: an evicted thumb still paints at the correct
 * geometry, blurred, and quietly refetches 30 KB. There is no broken state, no
 * grey box and no reflow.
 */
function placeholderUrl(hash: string | null | undefined): string | undefined {
  if (!hash) return undefined;
  const cached = placeholderCache.get(hash);
  if (cached) return cached;
  try {
    const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
    const url = thumbHashToDataURL(bytes);
    if (placeholderCache.size >= PLACEHOLDER_MAX) {
      placeholderCache.delete(placeholderCache.keys().next().value!);
    }
    placeholderCache.set(hash, url);
    return url;
  } catch {
    return undefined;
  }
}

// --- the retry clock ---
//
// A tile that has run out of sources must not stay a blurred square for the
// rest of the session, and every way it gets there is transient in principle:
// a connection that dropped mid-scroll, an API restart, a photo whose
// derivatives were still being made when the grid asked for them. Nothing here
// retries by itself otherwise. A failed `<img>` never reloads, and the object
// URL below is resolved once per blob, so without this a single bad moment
// meant a permanently blurred picture and no way back but a reload: waiting,
// which is the natural thing to try, did nothing at all.
//
// One clock for every tile rather than a timer each, because a grid holds
// several hundred. It runs only while something is actually broken, gives up
// after the last step, and starts over whenever the browser comes back online
// or the tab is looked at again: those are the two moments a retry has a
// genuinely new answer to get.
const RETRY_STEPS_MS = [4_000, 15_000, 60_000];

const stranded = new Set<() => void>();
let step = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function arm(): void {
  if (timer !== undefined || stranded.size === 0 || step >= RETRY_STEPS_MS.length) return;
  timer = setTimeout(() => {
    timer = undefined;
    step += 1;
    retryAll();
  }, RETRY_STEPS_MS[step]);
}

/**
 * Every stranded tile back to the top of its ladder. A tile that recovers
 * unsubscribes on the next commit rather than mid-loop, and a Set tolerates
 * that anyway.
 */
function retryAll(): void {
  for (const retry of stranded) retry();
  arm();
}

function watch(retry: () => void): () => void {
  // A fresh problem gets a fresh ladder. The previous one may have run itself
  // out hours ago, and this tile has not been tried once.
  if (stranded.size === 0) step = 0;
  stranded.add(retry);
  arm();
  return () => {
    stranded.delete(retry);
  };
}

if (typeof window !== "undefined") {
  const now = () => {
    step = 0;
    clearTimeout(timer);
    timer = undefined;
    retryAll();
  };
  window.addEventListener("online", now);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") now();
  });
}

/** Run `retry` on the shared clock for as long as this tile is `stranded`. */
function useRetry(isStranded: boolean, retry: () => void): void {
  useEffect(() => (isStranded ? watch(retry) : undefined), [isStranded, retry]);
}

export function MediaImage({
  blobId,
  variant,
  placeholder,
  alt,
  className,
  fit = "cover",
}: {
  blobId: string;
  variant: Extract<BlobVariant, "thumb" | "display">;
  placeholder: string | null | undefined;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
}) {
  // Three sources, tried in order, each one demoted by its own load error.
  //
  //   media  the stable URL: lazy, cached, decoded off the main thread.
  //   local  this device's own bytes, for the one case the media URL cannot
  //          answer: a picture still in the upload queue, so the server has no
  //          blob row to presign. Asked for only after a real failure, which
  //          keeps the common path free of JS-held object URLs entirely.
  //   gone   both refused to decode. The placeholder IS the picture then: a
  //          blurred tile at the right geometry, which is the whole point of
  //          keeping the hash on the row (§6.5). Without this state the last
  //          error just re-set the previous one, so a picture the browser
  //          cannot read (an original HEIC reaching a fallback that only ever
  //          serves originals) sat under a broken-image glyph forever.
  //
  // The bottom of the ladder is not the end of the story: the clock above puts
  // a tile that reaches it back on `media` a few seconds later.
  const [source, setSource] = useState<"media" | "local" | "gone">("media");
  const local = useBlobUrlState(source === "local" ? blobId : null);
  const blur = placeholderUrl(placeholder);
  const src =
    source === "media" ? mediaUrl(blobId, variant) : source === "local" ? local.url : null;

  // Out of sources: the ladder is spent, or the local bytes came back with
  // nothing. Deliberately not the wait in between, which is a download in
  // progress and the one thing a retry would be wrong to interrupt.
  const spent = source === "gone" || (source === "local" && local.settled && !local.url);
  const fromTheTop = useCallback(() => setSource("media"), []);
  useRetry(spent, fromTheTop);

  if (!src) {
    return (
      <span
        className={`flex size-full items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}
        style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : undefined}
      >
        {!blur && <Icon name="image" className="size-6" />}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      // Native lazy loading, which is the whole reason the URL is stable.
      loading="lazy"
      decoding="async"
      onError={() => setSource((s) => (s === "media" ? "local" : "gone"))}
      // Spelled out rather than interpolated: Tailwind scans source text for
      // whole class names, so `object-${fit}` would generate neither.
      className={`size-full ${fit === "cover" ? "object-cover" : "object-contain"} ${className ?? ""}`}
      // The placeholder is the element's own background rather than a second
      // element, so nothing is added to or removed from the DOM when the
      // picture lands: the image simply paints over it.
      style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : undefined}
    />
  );
}
