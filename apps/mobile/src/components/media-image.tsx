import type { TAttachment } from "@ragbag/client-runtime/rows";
import type { TBlobVariant } from "@ragbag/contracts";
import { Image } from "expo-image";
import type { ImageStyle, StyleProp } from "react-native";
import { mediaSource } from "@/lib/media";

// One picture.
//
// Almost nothing, and that is the point: apps/web/src/components/media-image.tsx
// is 227 lines because a browser needs a service worker, an object-URL cache
// and a retry ladder (media → local bytes → retry on a shared clock) to get
// what expo-image does by itself. It caches by URL on disk, decodes off the JS
// thread, evicts under memory pressure, and knows what a thumbhash is.
//
// The placeholder is the synced `attachments.placeholder` column, which is a
// thumbhash the ingest pass wrote. It paints at the right geometry before any
// bytes arrive and cross-fades into the real picture, so a scroll through a
// grid on a cold device shows the shapes of the photos rather than grey boxes.
//
// `recyclingKey` is what stops a list row from showing the previous row's
// picture for a frame while the new one decodes: LegendList recycles views, so
// without it a fast scroll smears one photo across several rows.

export function MediaImage({
  attachment,
  variant,
  contentFit = "cover",
  style,
}: {
  attachment: TAttachment;
  variant: TBlobVariant;
  contentFit?: "cover" | "contain";
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={mediaSource(attachment.blobId, variant)}
      placeholder={attachment.placeholder ? { thumbhash: attachment.placeholder } : undefined}
      placeholderContentFit={contentFit}
      recyclingKey={attachment.id}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      // Long enough to read as the picture arriving rather than as a cut, short
      // enough that a cache hit does not look like a fade-in.
      transition={120}
      accessibilityLabel={attachment.generatedTitle ?? attachment.filename}
      style={style}
    />
  );
}

/** Width ÷ height for an attachment, when its dimensions are known. */
export function aspectOf(
  width: number | null | undefined,
  height: number | null | undefined,
): number | undefined {
  return width && height && width > 0 && height > 0 ? width / height : undefined;
}
