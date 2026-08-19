import { faceForMime } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import { Link } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { usePhotoViewer } from "@/components/photo-viewer";
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
// All three take the nested entity card's chrome from entities/shell.tsx: the
// same fill, corner, padding and icon box. They stack in one column under one
// message, alongside the things the pipeline found in it, so anything they
// disagreed on read as two kinds of card rather than as one message's worth of
// contents. The voice note was the loudest about it, carrying a tinted disc
// and a fill of its own.
//
// Order is `position`, and it is preserved exactly (plan §2.2: "exactly as it
// was sent"). That is why consecutive pictures are what get batched into a
// grid rather than every picture in the message: a photo, a PDF and another
// photo stays in that order instead of being reshuffled into "images first".
//
// Two call sites, one layout: the timeline card and the top of the detail
// panel. A message has to read as the same message in both, so the panel does
// not lay its attachments out a second way. `variant` is the whole of what
// they disagree about, and both differences are the same difference: the
// timeline is a preview of a message, and the panel is the message open.

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

/**
 * Which surface this album is on.
 *
 * `timeline`: a tile opens the message it belongs to, and a voice note gets
 * the compact transport a preview has room for.
 *
 * `detail`: the message is already open, so a tile opens the file itself,
 * which is where "see it at full size" lives now that the panel shows the
 * album rather than every attachment at 70vh. The voice note gets the
 * browser's full transport, because the panel is where you listen to it and
 * where its transcript is.
 */
export type AlbumVariant = "timeline" | "detail";

export function AttachmentAlbum({
  attachments,
  variant = "timeline",
}: {
  attachments: readonly Attachment[];
  variant?: AlbumVariant;
}) {
  if (attachments.length === 0) return null;
  return (
    // No inset of its own: a tile fills its box to the pixel, so whatever
    // padding the surface holds is already the album's margin on all four
    // sides, and a correction like the one the text beside it needs would just
    // sit the pictures off-centre. The one place an album wants air above it is
    // under a paragraph, and that gap belongs to the pair of them
    // (message-card.tsx) rather than to every album everywhere.
    <div className="flex flex-col gap-1.5">
      {toBlocks(attachments).map((block) =>
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
    </div>
  );
}

/**
 * The wrapper a tile, a bubble and a row all share, and the one thing the two
 * call sites disagree about.
 *
 * A picture in the panel opens the viewer over it (components/photo-viewer.tsx)
 * rather than its own bytes in a browser tab. Leaving the app to see your own
 * photo at full size was never the intent of "see it at full size", and a tab
 * cannot step to the next picture in the message.
 *
 * Everything else still opens the file. That is not a compromise: a PDF or a
 * text file wants the browser's own reader, which is a better one than this
 * app is going to write, and the viewer has nothing to show for either.
 *
 * The file link is a plain navigation rather than a `download`: the media
 * route serves each blob under its own mime and answers on the API's origin,
 * where that attribute is ignored anyway, and a browser previewing a PDF or a
 * picture in a tab of its own is the better answer than saving it.
 *
 * It points at the media URL unless this device is still holding the bytes,
 * which is the one case that URL cannot answer: the server has no blob row to
 * presign yet. Deliberately in that order, and not `useBlobUrl` on every tile:
 * resolving an object URL means *fetching the original*, so asking for one per
 * attachment would download the full-size copy of every picture in the
 * archive, which is the cost media-image.tsx is built to avoid.
 */
function AttachmentLink({
  attachment,
  variant,
  className,
  style,
  children,
}: {
  attachment: Attachment;
  variant: AlbumVariant;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const filter = useFilter();
  const viewer = usePhotoViewer();
  const upload = useBlobUploadState(attachment.blobId);
  const pending = upload !== null && upload.stage !== "done";
  const local = useBlobUrl(pending ? attachment.blobId : null);
  if (variant === "detail") {
    if (viewer && faceForMime(attachment.mime) === "image") {
      return (
        // Same box, same rounding, same border as the anchor it replaces: the
        // tile must not move because of what happens when it is clicked.
        <button
          type="button"
          className={`${className} cursor-zoom-in`}
          style={style}
          onClick={() => viewer.open(attachment.id)}
        >
          {children}
        </button>
      );
    }
    return (
      <a
        href={local ?? mediaUrl(attachment.blobId, "original")}
        target="_blank"
        rel="noreferrer"
        className={className}
        style={style}
      >
        {children}
      </a>
    );
  }
  return (
    <Link {...messageLink(attachment.messageId, filter)} className={className} style={style}>
      {children}
    </Link>
  );
}

function ImageAlbum({ items, variant }: { items: Attachment[]; variant: AlbumVariant }) {
  // One picture is a picture, at its own shape. More than one is a grid, and a
  // grid of squares is what makes rows of different photos line up at all.
  if (items.length === 1) {
    const only = items[0]!;
    const box = mediaBox(only.width, only.height, SINGLE_MAX_H);
    return (
      <AttachmentLink
        attachment={only}
        variant={variant}
        style={box}
        // The box goes on the wrapper, not on the image, and the wrapper is a
        // block. On an inline box the `min(100%, …)` width resolves against a
        // shrink-to-fit container whose own width depends on the image inside
        // it, so until the bytes decode the picture is a few pixels wide and
        // the archive loses hundreds of pixels of height.
        className={`relative block overflow-hidden rounded-md border ${box ? "" : "h-52 max-w-full"}`}
      >
        <Tile attachment={only} variant="display" fit="contain" />
      </AttachmentLink>
    );
  }

  const shown = items.slice(0, GRID_CAP);
  const overflow = items.length - shown.length;
  return (
    <div className={`grid gap-1 ${items.length <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
      {shown.map((item, i) => (
        <AttachmentLink
          key={item.id}
          attachment={item}
          variant={variant}
          className="relative aspect-square overflow-hidden rounded-md border"
        >
          <Tile attachment={item} variant="thumb" fit="cover" />
          {/* A chip rather than a scrim over the picture: the palette has no
              ink that reads on `--overlay` in both themes, and a corner badge
              on the panel surface says the same thing while leaving the last
              photo visible. Same surface as the upload badge above it. */}
          {overflow > 0 && i === shown.length - 1 && (
            <span className="absolute bottom-1.5 right-1.5 rounded-full border bg-panel px-2 py-0.5 font-mono text-[11px] font-medium">
              +{overflow}
            </span>
          )}
        </AttachmentLink>
      ))}
    </div>
  );
}

/**
 * The face an attachment shows beside its name in a list: its own picture when
 * the pipeline made one, the icon for its kind when it did not.
 *
 * "0.jpg, 395 KB" is not a description of anything. A message carrying five of
 * them was a list of five filenames and five paragraphs with no way to tell
 * which belonged to which, and photos off a phone are named by a counter.
 *
 * Which attachments have a picture is asked of `variants`, the synced record of
 * which derivatives exist, and not of the mime: the media route answers a
 * missing derivative with the original bytes (apps/server/src/routes/media.ts),
 * so guessing from the face would put a `<img src=…/thumb>` on a text file, get
 * a 200 with something no browser can decode, and land on the blurred stand-in
 * for a file that never had a picture to blur. A PDF's first page is a
 * thumbnail by the same rule, because the pipeline renders one.
 *
 * The icon and the picture share the box exactly, so a list of both stays a
 * column rather than a ragged edge.
 */
export function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-muted text-muted-foreground">
      {attachment.variants.thumb ? (
        <MediaImage
          blobId={attachment.blobId}
          variant="thumb"
          placeholder={attachment.placeholder}
          // Decorative: the filename it sits beside is the name of this thing,
          // and a screen reader reading both says everything twice.
          alt=""
          fit="cover"
        />
      ) : (
        <Icon name={FACE_ICON[faceForMime(attachment.mime)]} className="size-4" />
      )}
    </span>
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
 * Where the voice notes on screen can be found, by attachment id.
 *
 * The detail panel puts a recording in the message at the top and its
 * transcript down in the findings, and clicking a line of that transcript
 * seeks the recording. Those are two subtrees, so they meet here rather than
 * through a ref threaded down a component that has no other reason to know the
 * panel exists, and rather than through a DOM id, which the same voice note
 * open in the panel and sitting in the timeline behind it would both answer to.
 *
 * No provider means no registration and nothing to seek, which is exactly the
 * timeline: a card has no transcript.
 */
type AudioScope = {
  players: Map<string, HTMLAudioElement>;
  /** Whether the surface has had a layout yet; see below for why that matters. */
  settled: boolean;
};

const AudioPlayers = createContext<AudioScope | null>(null);

export function AudioPlayerScope({ children }: { children: ReactNode }) {
  // Lazily, and once: the map is the identity every player registers into.
  const [players] = useState(() => new Map<string, HTMLAudioElement>());
  // The panel this wraps mounts closed for one frame (message-detail.tsx), so
  // a transport rendered in that frame has its first layout inside a popup
  // that is still `display: none`. Chrome decides which parts of a control fit
  // from that first layout, is given no width to fit them into, drops
  // everything down to a clock, and never revisits it: the panel opens and the
  // voice note has no play button for the rest of its life. Measured on
  // headless Chrome 140, where a window resize afterwards puts the transport
  // back, and so does mounting a fresh one into the open panel, which is what
  // this is.
  //
  // One commit late, not one animation late: the entrance is a transform, and
  // a transform does not change the width that pass reads.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  const scope = useMemo(() => ({ players, settled }), [players, settled]);
  return <AudioPlayers.Provider value={scope}>{children}</AudioPlayers.Provider>;
}

/** This surface's players, or null outside a scope, which is the timeline. */
export function useAudioScope(): AudioScope | null {
  return useContext(AudioPlayers);
}

/**
 * A voice note. Playable from the local bytes; the waveform and duration were
 * measured on the capturing device, so every device draws it without
 * downloading the audio at all (plan §8.5).
 */
function AudioBubble({ attachment, variant }: { attachment: Attachment; variant: AlbumVariant }) {
  const scope = useAudioScope();
  // Local bytes first, so a voice note this device recorded plays before it
  // has finished uploading and while it is offline; the media URL is the
  // fallback for every other device.
  const local = useBlobUrl(attachment.blobId);
  const url = local ?? mediaUrl(attachment.blobId, "original");
  const detail = variant === "detail";
  // The browser's own controls: a transport this app would only be
  // reimplementing, badly, and one that already knows how to scrub.
  const transport = (
    <audio
      ref={(element) => {
        if (!scope) return;
        if (element) scope.players.set(attachment.id, element);
        else scope.players.delete(attachment.id);
      }}
      src={url}
      controls
      preload="metadata"
      className={detail ? "mt-2 w-full" : "mt-1 h-8 w-full"}
    />
  );

  return (
    <div className="relative rounded-md border bg-card p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <Icon name="audio" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Waveform peaks={attachment.waveform} />
          {/* Squeezed onto the bubble's one line in a card, where it is a
              preview and Chrome answers with a play button and a clock.
              A row of its own in the panel, where you actually listen and
              where the transcript seeks it, and which is also the one place
              the squeezed one does not survive: the drawer mounts closed, so
              the control's first layout happens inside a flex item with no
              resolved width, Chrome's fitting pass decides nothing fits and
              drops even the play button, and it never runs again when the
              panel opens (measured, headless Chrome 140; a window resize
              afterwards restores it). Out of the flex row it has a width from
              the first frame and the pass has nothing to get wrong. */}
          {!detail && transport}
        </div>
        {attachment.durationMs != null && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatDuration(attachment.durationMs)}
          </span>
        )}
        <UploadBadge blobId={attachment.blobId} side="right" />
      </div>
      {/* Held back one commit inside a scope, for the reason spelled out at
          AudioPlayerScope. */}
      {detail && (!scope || scope.settled) && transport}
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

function FileRow({
  attachment,
  face,
  variant,
}: {
  attachment: Attachment;
  face: AttachmentFace;
  variant: AlbumVariant;
}) {
  return (
    <AttachmentLink
      attachment={attachment}
      variant={variant}
      className="relative flex items-center gap-3 rounded-md border bg-card p-3 transition hover:bg-background-hover"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <Icon name={FACE_ICON[face]} className="size-4" />
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
    </AttachmentLink>
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
      } ${failing ? "border-destructive bg-panel text-destructive" : "bg-panel text-muted-foreground"}`}
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
