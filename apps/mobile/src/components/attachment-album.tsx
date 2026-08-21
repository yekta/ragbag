import type { TAttachment } from "@ragbag/client-runtime/rows";
import { faceForMime, type TAttachmentFace } from "@ragbag/shared";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage, aspectOf } from "@/components/media-image";
import { Text } from "@/components/text";
import { UploadBadge } from "@/components/upload-badge";
import { formatBytes } from "@/lib/format";
import { attachmentHref, photoHref } from "@/lib/routes";

// The attachments on a message, laid out the way a chat lays them out:
// consecutive pictures batch into a grid, everything else stands on its own,
// in the order it was sent.
//
// Consecutive rather than all-the-images, deliberately: a photo, a PDF and
// another photo stays in that order instead of being reshuffled into "images
// first". The order is what the person chose.
//
// Two call sites, one layout: the timeline card and the top of the detail
// sheet. A message has to read as the same message in both, so the sheet does
// not lay its attachments out a second way. `variant` is the whole of what
// they disagree about, and it is the same difference twice: the timeline is a
// preview of a message, and the sheet is the message open. In the timeline a
// tile opens the file's own page, because a file is one of the things this app
// keeps; in the sheet the message is already open, so a picture opens full
// screen and everything else opens itself.

/** Tallest a lone picture may stand in a card, in points. */
const SINGLE_MAX_H = 320;

/** Past this many tiles the grid stops growing and the last one counts. */
const GRID_CAP = 6;

type TBlock =
  | { type: "album"; items: TAttachment[] }
  | { type: "one"; item: TAttachment; face: TAttachmentFace };

/** Batch consecutive images; everything else stands on its own, in order. */
export function toBlocks(items: readonly TAttachment[]): TBlock[] {
  const blocks: TBlock[] = [];
  for (const item of items) {
    const face = faceForMime(item.mime);
    const last = blocks.at(-1);
    if (face === "image") {
      if (last?.type === "album") last.items.push(item);
      else blocks.push({ type: "album", items: [item] });
    } else {
      blocks.push({ type: "one", item, face });
    }
  }
  return blocks;
}

export type TAlbumVariant = "timeline" | "detail";

export function AttachmentAlbum({
  attachments,
  variant = "timeline",
}: {
  attachments: readonly TAttachment[];
  variant?: TAlbumVariant;
}) {
  const blocks = useMemo(() => toBlocks(attachments), [attachments]);
  if (attachments.length === 0) return null;
  return (
    // No inset of its own: a tile fills its box to the pixel, so whatever
    // padding the surface holds is already the album's margin on all four
    // sides. The one place an album wants air above it is under a paragraph,
    // and that gap belongs to the pair of them (message-card.tsx).
    <View className="gap-1.5">
      {blocks.map((block) =>
        block.type === "album" ? (
          <ImageAlbum key={block.items[0]!.id} items={block.items} variant={variant} />
        ) : block.face === "audio" ? (
          <AudioBubble key={block.item.id} attachment={block.item} variant={variant} />
        ) : (
          <FileRow
            key={block.item.id}
            attachment={block.item}
            face={block.face}
            variant={variant}
          />
        ),
      )}
    </View>
  );
}

/**
 * What a tile does when it is tapped, which is the one thing the two surfaces
 * disagree about.
 *
 * A press dims the tile rather than filling behind it: a picture covers every
 * pixel of its box, so there is no surface underneath for a fill to show on,
 * and the photo itself is what answers. That is the app's press rule said in
 * the one language a picture has.
 */
function useOpenAttachment(attachment: TAttachment, variant: TAlbumVariant) {
  const router = useRouter();
  return () => {
    if (variant === "timeline") {
      router.push(attachmentHref(attachment.id));
      return;
    }
    router.push(
      faceForMime(attachment.mime) === "image"
        ? photoHref(attachment.id)
        : attachmentHref(attachment.id),
    );
  };
}

function ImageAlbum({ items, variant }: { items: TAttachment[]; variant: TAlbumVariant }) {
  // One picture is a picture, at its own shape. More than one is a grid, and a
  // grid of squares is what makes rows of different photos line up at all.
  if (items.length === 1) {
    return <SinglePicture attachment={items[0]!} variant={variant} />;
  }

  const shown = items.slice(0, GRID_CAP);
  const overflow = items.length - shown.length;
  const columns = items.length <= 4 ? 2 : 3;

  return (
    <View className="flex-row flex-wrap gap-1">
      {shown.map((item, i) => (
        <View key={item.id} style={{ width: `${100 / columns}%` }} className="p-0.5">
          <GridTile
            attachment={item}
            variant={variant}
            overflow={overflow > 0 && i === shown.length - 1 ? overflow : 0}
          />
        </View>
      ))}
    </View>
  );
}

function SinglePicture({
  attachment,
  variant,
}: {
  attachment: TAttachment;
  variant: TAlbumVariant;
}) {
  const open = useOpenAttachment(attachment, variant);
  const aspect = aspectOf(attachment.width, attachment.height);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={attachment.generatedTitle ?? attachment.filename}
      onPress={open}
      className="overflow-hidden rounded-md border border-border active:opacity-80"
      // The geometry comes off the synced row, so the placeholder and the
      // picture occupy the same box and the swap moves nothing: not this card,
      // not the cards below it. A picture whose dimensions have not synced yet
      // gets a fixed height rather than a guessed ratio, because a wrong ratio
      // is a card that resizes once the real one lands.
      style={aspect ? { aspectRatio: aspect, maxHeight: SINGLE_MAX_H } : { height: 208 }}
    >
      <MediaImage
        attachment={attachment}
        variant="display"
        contentFit="contain"
        style={{ flex: 1 }}
      />
      <UploadBadge blobId={attachment.blobId} />
    </Pressable>
  );
}

function GridTile({
  attachment,
  variant,
  overflow,
}: {
  attachment: TAttachment;
  variant: TAlbumVariant;
  overflow: number;
}) {
  const open = useOpenAttachment(attachment, variant);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={attachment.generatedTitle ?? attachment.filename}
      onPress={open}
      className="aspect-square overflow-hidden rounded-md border border-border active:opacity-80"
    >
      <MediaImage attachment={attachment} variant="thumb" style={{ flex: 1 }} />
      <UploadBadge blobId={attachment.blobId} />
      {/* A chip rather than a scrim over the picture: the palette has no ink
          that reads on the overlay token in both themes, and a corner badge
          says the same thing while leaving the last photo visible. */}
      {overflow > 0 ? (
        <View className="absolute bottom-1.5 right-1.5 rounded-full border border-border bg-panel px-2 py-0.5">
          <Text className="font-mono text-[11px] font-medium">+{overflow}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The peaks, drawn as bars.
 *
 * A synced column, so this needs no audio and no decoding: on a device that
 * has never downloaded the recording it still shows what the recording looks
 * like. The floor on the height is so silence is still a line rather than a
 * gap; a bar chart with holes in it reads as a broken render.
 */
export function Waveform({ peaks }: { peaks: readonly number[] | null | undefined }) {
  if (!peaks || peaks.length === 0) return null;
  return (
    <View className="h-6 flex-1 flex-row items-center gap-px" accessible={false}>
      {peaks.map((peak, i) => (
        <View
          key={i}
          className="flex-1 rounded-full bg-primary/50"
          style={{ height: `${Math.max(6, Math.min(1, peak) * 100)}%` }}
        />
      ))}
    </View>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A voice note in the timeline: what it looks like and how long it is.
 *
 * Playback lives on the file's own page rather than here. That is a change
 * from the web, and it is the platform's: a card in a scrolling list is not a
 * transport, tapping a 3px-wide play button while the list is moving is not a
 * gesture anyone lands, and the page it opens is where the transcript is
 * anyway. The tap target is the whole bubble.
 */
function AudioBubble({ attachment, variant }: { attachment: TAttachment; variant: TAlbumVariant }) {
  const open = useOpenAttachment(attachment, variant);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Voice note, ${attachment.durationMs ? formatDuration(attachment.durationMs) : "unknown length"}`}
      onPress={open}
      className="flex-row items-center gap-3 rounded-md border border-border bg-card p-3 active:bg-background-hover"
    >
      <View className="size-9 items-center justify-center rounded-sm bg-muted">
        <Icon name="play" size={16} />
      </View>
      <Waveform peaks={attachment.waveform} />
      <Text className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {attachment.durationMs ? formatDuration(attachment.durationMs) : ""}
      </Text>
      <UploadBadge blobId={attachment.blobId} side="right" />
    </Pressable>
  );
}

function FileRow({
  attachment,
  face,
  variant,
}: {
  attachment: TAttachment;
  face: TAttachmentFace;
  variant: TAlbumVariant;
}) {
  const open = useOpenAttachment(attachment, variant);
  const title = attachment.generatedTitle ?? attachment.filename;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      className="flex-row items-center gap-3 rounded-md border border-border bg-card p-3 active:bg-background-hover"
    >
      <View className="size-9 items-center justify-center rounded-sm bg-muted">
        <Icon name={FACE_ICON[face]} size={16} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-medium" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
          {/* The size is a reading and sets its own face; the filename beside
              it is a name and keeps the document's. */}
          <Text className="font-mono text-[11px] text-muted-foreground">
            {formatBytes(attachment.size)}
          </Text>
          {title !== attachment.filename ? ` · ${attachment.filename}` : ""}
        </Text>
      </View>
      <UploadBadge blobId={attachment.blobId} side="right" />
    </Pressable>
  );
}

/**
 * The face an attachment shows beside its name in a list: its own picture when
 * the pipeline made one, the icon for its kind when it did not.
 *
 * "0.jpg, 395 KB" is not a description of anything, and photos off a phone are
 * named by a counter. Which attachments have a picture is asked of `variants`,
 * the synced record of which derivatives exist, and not of the mime: the media
 * route answers a missing derivative with the original bytes, so guessing from
 * the face would put a thumbnail request on a text file and land on the blurred
 * stand-in for a file that never had a picture to blur.
 */
export function AttachmentThumb({ attachment }: { attachment: TAttachment }) {
  return (
    <View className="size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted">
      {attachment.variants.thumb ? (
        <MediaImage attachment={attachment} variant="thumb" style={{ width: 32, height: 32 }} />
      ) : (
        <Icon name={FACE_ICON[faceForMime(attachment.mime)]} size={16} />
      )}
    </View>
  );
}
