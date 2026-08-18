import type { BlobVariant } from "@ragbag/contracts";
import { useState } from "react";
import { thumbHashToDataURL } from "thumbhash";
import { Icon } from "@/components/icon";
import { useBlobUrl } from "@/lib/blobs";
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
  const [source, setSource] = useState<"media" | "local" | "gone">("media");
  const localUrl = useBlobUrl(source === "local" ? blobId : null);
  const blur = placeholderUrl(placeholder);
  const src = source === "media" ? mediaUrl(blobId, variant) : source === "local" ? localUrl : null;

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
