import { faceForMime } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { Button } from "@/components/ui/button";
import {
  mediaBox,
  useBlobQueue,
  useBlobQueueState,
  useBlobUploadState,
  useBlobUrl,
} from "@/lib/blobs";
import { mediaUrl } from "@/lib/media";
import { formatBytes } from "@/lib/format";
import { messageLink, useFilter } from "@/lib/routes";
import type { Attachment } from "@/lib/types";

// The attachments of one message, laid out the way a messaging app lays them
// out: an album of pictures, a bubble per voice note, a row per file.
//
// Order is `position`, and it is preserved exactly (plan §2.2: "exactly as it
// was sent"). That is why consecutive pictures are what get batched into a
// grid rather than every picture in the message: a photo, a PDF and another
// photo stays in that order instead of being reshuffled into "images first".

/** Keep in step with `max-h-80` on the single-image case below. */
const SINGLE_MAX_H = "20rem";

/** Past this many tiles the grid stops growing and the last one counts. */
const GRID_CAP = 6;

type Block =
  { type: "album"; items: Attachment[] } | { type: "one"; item: Attachment; face: AttachmentFace };

/** Batch consecutive images; everything else stands on its own, in order. */
export function toBlocks(items: readonly Attachment[]): Block[] {
  const blocks: Block[] = [];
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

export function AttachmentAlbum({ attachments }: { attachments: readonly Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-col gap-1.5">
      {toBlocks(attachments).map((block) =>
        block.type === "album" ? (
          <ImageAlbum key={block.items[0]!.id} items={block.items} />
        ) : block.face === "audio" ? (
          <AudioBubble key={block.item.id} attachment={block.item} />
        ) : (
          <FileRow key={block.item.id} attachment={block.item} face={block.face} />
        ),
      )}
    </div>
  );
}

function ImageAlbum({ items }: { items: Attachment[] }) {
  const filter = useFilter();
  const messageId = items[0]!.messageId;

  // One picture is a picture, at its own shape. More than one is a grid, and a
  // grid of squares is what makes rows of different photos line up at all.
  if (items.length === 1) {
    const only = items[0]!;
    const box = mediaBox(only.width, only.height, SINGLE_MAX_H);
    return (
      <Link
        {...messageLink(messageId, filter)}
        style={box}
        // The box goes on the wrapper, not on the image, and the wrapper is a
        // block. On an inline box the `min(100%, …)` width resolves against a
        // shrink-to-fit container whose own width depends on the image inside
        // it, so until the bytes decode the picture is a few pixels wide and
        // the archive loses hundreds of pixels of height.
        className={`relative block overflow-hidden rounded-lg border ${box ? "" : "h-52 max-w-full"}`}
      >
        <Tile attachment={only} variant="display" fit="contain" />
      </Link>
    );
  }

  const shown = items.slice(0, GRID_CAP);
  const overflow = items.length - shown.length;
  return (
    <div className={`grid gap-1 ${items.length <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
      {shown.map((item, i) => (
        <Link
          key={item.id}
          {...messageLink(messageId, filter)}
          className="relative aspect-square overflow-hidden rounded-lg border"
        >
          <Tile attachment={item} variant="thumb" fit="cover" />
          {/* A chip rather than a scrim over the picture: the palette has no
              ink that reads on `--overlay` in both themes, and a corner badge
              on the card surface says the same thing while leaving the last
              photo visible. Same surface as the upload badge above it. */}
          {overflow > 0 && i === shown.length - 1 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[11px] font-medium">
              +{overflow}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

/**
 * One picture, plus whatever this device knows about its upload. The geometry
 * is the wrapper's (from the synced dimensions), so the placeholder and the
 * picture occupy the same box and the swap moves nothing: neither the rest of
 * this card nor the rows below it.
 */
function Tile({
  attachment,
  variant,
  fit,
}: {
  attachment: Attachment;
  variant: "thumb" | "display";
  fit: "cover" | "contain";
}) {
  return (
    <>
      <MediaImage
        blobId={attachment.blobId}
        variant={variant}
        placeholder={attachment.placeholder}
        alt={attachment.generatedTitle ?? attachment.filename}
        fit={fit}
      />
      <UploadBadge blobId={attachment.blobId} />
    </>
  );
}

/**
 * A voice note. Playable from the local bytes; the waveform and duration were
 * measured on the capturing device, so every device draws it without
 * downloading the audio at all (plan §8.5).
 */
function AudioBubble({ attachment }: { attachment: Attachment }) {
  // Local bytes first, so a voice note this device recorded plays before it
  // has finished uploading and while it is offline; the media URL is the
  // fallback for every other device.
  const local = useBlobUrl(attachment.blobId);
  const url = local ?? mediaUrl(attachment.blobId, "original");
  return (
    <div className="relative flex items-center gap-3 rounded-lg border bg-panel p-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon name="audio" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <Waveform peaks={attachment.waveform} />
        {/* The browser's own controls: a transport this app would only be
            reimplementing, badly, and one that already knows how to scrub. */}
        <audio src={url} controls preload="metadata" className="mt-1 h-8 w-full" />
      </div>
      {attachment.durationMs != null && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatDuration(attachment.durationMs)}
        </span>
      )}
      <UploadBadge blobId={attachment.blobId} side="right" />
    </div>
  );
}

/**
 * The peaks, drawn as bars. A synced column, so this needs no audio and no
 * decoding: on a device that has never downloaded the recording it still
 * shows what the recording looks like.
 */
export function Waveform({ peaks }: { peaks: readonly number[] | null | undefined }) {
  if (!peaks || peaks.length === 0) return null;
  return (
    <span className="flex h-6 items-center gap-px" aria-hidden>
      {peaks.map((peak, i) => (
        <span
          key={i}
          className="min-h-px flex-1 rounded-full bg-primary/50"
          // A floor on the height so silence is still a line rather than a
          // gap: a bar chart with holes in it reads as a broken render.
          style={{ height: `${Math.max(6, Math.min(1, peak) * 100)}%` }}
        />
      ))}
    </span>
  );
}

function FileRow({ attachment, face }: { attachment: Attachment; face: AttachmentFace }) {
  const filter = useFilter();
  return (
    <Link
      {...messageLink(attachment.messageId, filter)}
      className="relative flex items-center gap-3 rounded-lg border bg-panel p-3 transition hover:bg-accent"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon name={FACE_ICON[face]} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {attachment.generatedTitle ?? attachment.filename}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {/* The size is a reading and sets its own face; the filename beside
              it is a name and keeps the document's. */}
          <span className="font-mono">{formatBytes(attachment.size)}</span>
          {attachment.generatedTitle && attachment.generatedTitle !== attachment.filename
            ? ` · ${attachment.filename}`
            : ""}
        </span>
      </span>
      <UploadBadge blobId={attachment.blobId} side="right" />
    </Link>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * "This file hasn't reached the server yet", pinned over a freshly-dumped
 * attachment. The bytes render locally either way (that's the local-first
 * deal); this badge is the difference between "uploading", "waiting", and
 * "failing, here's why": states that used to be invisible until another
 * device quietly couldn't load the image.
 */
export function UploadBadge({
  blobId,
  side = "left",
}: {
  blobId: string | null;
  /** Which top corner to pin to: right for rows, left over pictures. */
  side?: "left" | "right";
}) {
  const queue = useBlobQueue();
  const { blocked } = useBlobQueueState();
  const upload = useBlobUploadState(blobId);
  if (!blobId || !upload || upload.stage === "done") return null;

  const failing = upload.stage === "waiting" && upload.lastError !== null && blocked !== "auth";
  const label = failing
    ? `Upload failing: ${upload.lastError}. Click to retry now.`
    : blocked === "auth"
      ? "Upload paused, sign in to resume"
      : upload.stage === "inflight" && upload.progress !== null
        ? `Uploading ${Math.round(upload.progress * 100)}%`
        : "Waiting to upload";

  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        // The tile around this is a Link. The badge is its own control.
        e.preventDefault();
        e.stopPropagation();
        if (failing) void queue.retryBlob(blobId);
      }}
      className={`absolute top-1.5 flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium ${
        side === "left" ? "left-1.5" : "right-1.5"
      } ${failing ? "border-destructive bg-card text-destructive" : "bg-card text-muted-foreground"}`}
    >
      {failing ? (
        <Icon name="alert" className="size-3" />
      ) : blocked === "auth" ? (
        <Icon name="pause" className="size-3" />
      ) : (
        <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
      )}
      {failing ? (
        "upload failed"
      ) : upload.stage === "inflight" && upload.progress !== null ? (
        // The mono makes every digit the same width; this makes every *count*
        // of digits the same width, which is the rest of the jitter. A
        // progress event lands dozens of times per upload and two of those
        // ticks cross a digit boundary, so without a floor the chip is a
        // different size for 9% than for 10%. Three characters is 0-99, where
        // all the counting happens; the frame that reads 100% overflows it and
        // is the last one anyway. The other two states are words, and a word
        // is not something a width in characters can help with.
        <span className="inline-block min-w-[3ch] text-right">
          {Math.round(upload.progress * 100)}%
        </span>
      ) : (
        "uploading"
      )}
    </button>
  );
}

/** Retry one attachment's extraction, offered wherever a part failed. */
export function AttachmentRetry({ onRetry }: { onRetry: () => void }) {
  const [clicked, setClicked] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={clicked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setClicked(true);
        onRetry();
      }}
    >
      <Icon name="retry" className="size-3" /> {clicked ? "Queued" : "Retry"}
    </Button>
  );
}
