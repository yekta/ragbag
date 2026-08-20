import type { CapturedBlob } from "@ragbag/client-runtime";
import { MAX_ATTACHMENTS, MAX_BLOB_BYTES, mutators } from "@ragbag/contracts";
import { faceForMime, newId } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AudioRecorder } from "@/components/audio-recorder";
import { FACE_ICON, Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { measureImage, useBlobQueue, useBlobQueueState, useBlobUploadState } from "@/lib/blobs";
import { formatBytes } from "@/lib/format";
import { seedMediaCache } from "@/lib/media";
import { isTouch } from "@/lib/touch";

// The message box. One send is one message: free text plus up to ten ordered
// attachments, exactly like a chat composer. There is no type picker and no
// kind guessing, because a message has no kind: a bare URL is just text that
// will produce a link entity, and that entity is what draws the preview card.
//
// Attachments behave like a chat composer's: a fixed square tile (with its
// image preview) appears the instant a file is picked; hashing, local
// persistence and the upload all happen behind it, each stage visible ON the
// tile (reading spinner → upload progress ring → done, or a red state with the
// classified reason and a retry). Nothing here waits silently: every async
// stage has a deadline, and a failure is a state on the tile, not a mystery.
// That machinery exists because uploads once died silently in production.

const PLACEHOLDER = "Send anything: a thought, a link, a file…";

type Attachment = {
  /** Chip identity from the moment of pick, before any blobId exists. */
  localId: string;
  file: File;
  name: string;
  size: number;
  face: AttachmentFace;
  /** Object URL for image previews, created synchronously on pick. */
  previewUrl: string | null;
  /** Measured on this device, so the bubble has its geometry before the send. */
  width?: number;
  height?: number;
  /** Recordings only, measured here so no device decodes audio to draw one. */
  durationMs?: number;
  waveform?: number[];
  /** The local stage: hashing+persisting ("reading") until a blobId exists. */
  status: "reading" | "ready" | "error";
  error?: string;
  /** False for validation failures (too large, empty); retrying can't help. */
  retryable?: boolean;
  captured?: CapturedBlob;
};

/** How long the local hash+persist may take before the chip goes red. */
const CAPTURE_TIMEOUT_MS = 12_000;

/** The write is optimistic; only the server's verdict can still surprise us. */
function watchServer(write: { server: Promise<{ type: string }> }) {
  void write.server.then((r) => {
    if (r.type === "error") toast.error("The server rejected a message. Check the console.");
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function Composer({ canAttach }: { canAttach: boolean }) {
  const zero = useZero();
  const queue = useBlobQueue();
  const [draft, setDraft] = useState("");
  // Attachments also live in a ref so async completions (capture resolving
  // after the chip was removed, dedupe checks) can read the current list
  // without smuggling side effects into React state updaters.
  const [attachments, setAttachmentsState] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const setAttachments = useCallback((update: (prev: Attachment[]) => Attachment[]) => {
    attachmentsRef.current = update(attachmentsRef.current);
    setAttachmentsState(attachmentsRef.current);
  }, []);
  // Where the dragged files currently hover: over the composer (it highlights
  // itself, as before) or anywhere else (the whole viewport reports it).
  const [dragZone, setDragZone] = useState<"composer" | "window" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  // The canvas strip behind the card is drawn to the card's own midpoint, so
  // it has to follow a card that grows with every attachment row and every
  // typed line.
  const [cardHeight, setCardHeight] = useState(0);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCardHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Hash + persist one picked file, then settle its chip. */
  const captureOne = useCallback(
    (localId: string, file: File) => {
      void withTimeout(
        queue.capture(file, file.name),
        CAPTURE_TIMEOUT_MS,
        "Timed out saving the file on this device",
      )
        .then((captured) => {
          const current = attachmentsRef.current;
          const me = current.find((a) => a.localId === localId);
          if (!me) {
            // Chip removed while reading: don't leave an orphan upload.
            if (!captured.reused) void queue.cancel(captured.blobId);
            return;
          }
          const dupe = current.find(
            (a) => a.localId !== localId && a.captured?.blobId === captured.blobId,
          );
          if (dupe) {
            toast.info(`${me.name} is already attached`);
            if (me.previewUrl) URL.revokeObjectURL(me.previewUrl);
            setAttachments((prev) => prev.filter((a) => a.localId !== localId));
            return;
          }
          setAttachments((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, status: "ready", captured } : a)),
          );
        })
        .catch((err: unknown) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId
                ? {
                    ...a,
                    status: "error",
                    error: err instanceof Error ? err.message : "Couldn't read this file",
                  }
                : a,
            ),
          );
        });
    },
    [queue, setAttachments],
  );

  /**
   * A finished recording joins the attachments like any other file, carrying
   * the duration and waveform this device measured (plan §8.5).
   */
  const addRecording = useCallback(
    (recording: { file: File; durationMs: number; waveform: number[] }) => {
      const localId = newId();
      setAttachments((prev) => [
        ...prev,
        {
          localId,
          file: recording.file,
          name: recording.file.name,
          size: recording.file.size,
          face: "audio",
          previewUrl: null,
          durationMs: recording.durationMs,
          waveform: recording.waveform,
          status: "reading",
        },
      ]);
      captureOne(localId, recording.file);
    },
    [captureOne, setAttachments],
  );

  const addFiles = useCallback(
    (picked: Iterable<File>) => {
      const files = [...picked];
      // Never a silent truncation (plan §8.5): dropping fifteen files attaches
      // the first ten and says what happened to the other five.
      const room = MAX_ATTACHMENTS - attachmentsRef.current.length;
      if (room <= 0) {
        toast.error(`${MAX_ATTACHMENTS} files max`, {
          description: "Send this message first, then attach the rest.",
        });
        return;
      }
      const accepted = files.slice(0, room);
      if (files.length > accepted.length) {
        const dropped = files.length - accepted.length;
        toast.warning(`${MAX_ATTACHMENTS} files max`, {
          description: `${dropped} file${dropped === 1 ? " wasn't" : "s weren't"} added.`,
        });
      }

      for (const file of accepted) {
        const localId = newId();
        const face = faceForMime(file.type || "application/octet-stream");
        // The preview exists before any async work: the whole point.
        const previewUrl = face === "image" ? URL.createObjectURL(file) : null;
        const base: Attachment = {
          localId,
          file,
          name: file.name || face,
          size: file.size,
          face,
          previewUrl,
          status: "reading",
        };

        // Hopeless files fail on the chip immediately, not minutes later.
        if (file.size === 0) {
          setAttachments((prev) => [
            ...prev,
            { ...base, status: "error", error: "This file is empty", retryable: false },
          ]);
          continue;
        }
        if (file.size > MAX_BLOB_BYTES) {
          setAttachments((prev) => [
            ...prev,
            {
              ...base,
              status: "error",
              error: `Larger than the ${formatBytes(MAX_BLOB_BYTES)} limit`,
              retryable: false,
            },
          ]);
          continue;
        }

        setAttachments((prev) => [...prev, base]);
        captureOne(localId, file);
        // Dimensions are a column now (plan §8.3), and the capturing device
        // is the first place that can know them, so the bubble is laid out
        // correctly on this device before the server has even seen the bytes.
        // The derivatives pass confirms them later with EXIF baked in.
        if (face === "image") {
          void measureImage(file).then((size) => {
            if (!size) return;
            setAttachments((prev) =>
              prev.map((a) => (a.localId === localId ? { ...a, ...size } : a)),
            );
          });
        }
      }
    },
    [captureOne, setAttachments],
  );

  // Window-level paste (screenshots!) and drag-drop land in the composer.
  // Anywhere in the window is a drop target, so the whole viewport reports it.
  useEffect(() => {
    if (!canAttach) return;
    const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    const zoneOf = (e: DragEvent): "composer" | "window" =>
      e.target instanceof Node && cardRef.current?.contains(e.target) ? "composer" : "window";

    // dragenter/dragleave fire for every element crossed, so count depth
    // rather than trusting a single leave; otherwise the indicator flickers
    // off the moment the pointer passes over a card.
    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepth.current += 1;
      setDragZone(zoneOf(e));
    };
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault(); // required, or the browser refuses the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      // Tracked on every move: crossing into the composer swaps the
      // full-screen prompt for the composer's own highlight.
      setDragZone(zoneOf(e));
    };
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragZone(null);
    };
    const endDrag = () => {
      dragDepth.current = 0;
      setDragZone(null);
    };
    const onDrop = (e: DragEvent) => {
      endDrag();
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    // Dropping outside the window, or hitting Esc, never fires drop/dragleave.
    window.addEventListener("dragend", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [addFiles, canAttach]);

  // Autosize the textarea to its content (chat-style).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const removeAttachment = (localId: string) => {
    const gone = attachmentsRef.current.find((a) => a.localId === localId);
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    if (!gone) return;
    if (gone.previewUrl) URL.revokeObjectURL(gone.previewUrl);
    // A fresh capture with no message yet is ours to abort; a reused blobId
    // may belong to an already-sent message, so its upload must keep running.
    if (gone.captured && !gone.captured.reused) void queue.cancel(gone.captured.blobId);
  };

  const retryCapture = (a: Attachment) => {
    setAttachments((prev) =>
      prev.map((x) =>
        x.localId === a.localId ? { ...x, status: "reading", error: undefined } : x,
      ),
    );
    captureOne(a.localId, a.file);
  };

  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const reading = attachments.some((a) => a.status === "reading");
  const failed = attachments.some((a) => a.status === "error");
  const canSend = hasContent && !reading && !failed;
  const full = attachments.length >= MAX_ATTACHMENTS;

  const send = () => {
    const text = draft.trim();
    if (!canSend) return;

    // One message, one mutation: the attachments go with the text rather than
    // the text riding on the first of N separate items, which is what v1 did.
    const messageId = newId();
    const parts = attachments.map((a) => ({
      id: newId(),
      blobId: a.captured!.blobId,
      filename: a.name,
      mime: a.file.type || "application/octet-stream",
      size: a.size,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      waveform: a.waveform,
    }));

    watchServer(
      zero.mutate(
        mutators.message.create({
          id: messageId,
          text: text || undefined,
          attachments: parts,
        }),
      ),
    );
    for (const [i, part] of parts.entries()) {
      void queue.linkAttachment(part.blobId, messageId, part.id);
      // The capturing device already holds the bytes, so it writes its own
      // copies into the media caches under the very keys it is about to ask
      // for (plan §6.4). Its own photos never round-trip.
      void seedMediaCache(part.blobId, attachments[i]!.file);
    }

    for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    setAttachments(() => []);
    setDraft("");
    textareaRef.current?.focus();
  };

  return (
    <>
      {dragZone === "window" && <DropOverlay />}
      {/* Sticky, not fixed: the card keeps its place in the column, so it
          inherits the width the sidebar leaves it with no offset arithmetic,
          and its slot at the end of the flow means the last card can never come
          to rest under it. */}
      <div className="pointer-events-none sticky bottom-0 z-20 px-3 pb-(--composer-inset) md:px-4">
        {/* Canvas strip scoped to this container, not the shell column. It
            covers the gap between the card and the bottom of the column: the
            only strip where a scrolling card would otherwise be cut off by the
            viewport edge, plus the card's own bottom half, which it tucks
            behind. Half the card and no more: it is the tallest the strip can
            be while its top edge stays below the corner radius, so a timeline
            card passing under the composer is hidden everywhere the composer
            is opaque, and the rounded corners still have canvas behind them
            rather than a square of it. Solid `--background`, not a gradient:
            nothing translucent, and its top edge is invisible anyway. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-background"
          style={{ height: `calc(var(--composer-inset) + ${cardHeight / 2}px)` }}
        />
        <div className="pointer-events-auto relative mx-auto w-full max-w-3xl">
          <div
            ref={cardRef}
            className={`rounded-3xl border bg-card transition ${
              dragZone === "composer" ? "border-primary ring-4 ring-accent" : ""
            }`}
          >
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.localId}
                    attachment={a}
                    onRemove={() => removeAttachment(a.localId)}
                    onRetryCapture={() => retryCapture(a)}
                  />
                ))}
              </div>
            )}

            <Textarea
              ref={textareaRef}
              rows={1}
              // Autofocus on touch would pop the keyboard the moment the app
              // opens.
              autoFocus={!isTouch}
              className="max-h-52 resize-none rounded-none border-0 bg-transparent px-5 pb-1 pt-4 text-base leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0"
              placeholder={PLACEHOLDER}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />

            {/* Top padding, not just the textarea's own: once the text scrolls,
                its content runs to the very bottom edge of the box, and without
                a gap here the last line touches the buttons. */}
            <div className="flex items-center justify-between p-2">
              <span className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full text-muted-foreground"
                  title={
                    !canAttach
                      ? "Blob storage is not configured on the server"
                      : full
                        ? `${MAX_ATTACHMENTS} files max in one message`
                        : "Attach files"
                  }
                  disabled={!canAttach || full}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="plus" className="size-5" />
                </Button>
                {/* The limit, said out loud, from the first file on. A cap
                    nobody can see is a cap that surprises you at ten. */}
                {attachments.length > 0 && (
                  <span
                    className={`font-mono text-xs ${full ? "text-warning-foreground" : "text-muted-foreground"}`}
                  >
                    {attachments.length}/{MAX_ATTACHMENTS}
                  </span>
                )}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {/* The mic is the right-hand control while there is nothing to
                  send, and send takes over the moment there is: the same swap
                  v1 made for dictation, except what it produces is a file. */}
              {hasContent ? (
                <Button
                  size="icon"
                  className="rounded-full"
                  title={
                    failed
                      ? "Remove or retry the failed attachment first"
                      : reading
                        ? "Still reading an attachment…"
                        : "Send (Enter)"
                  }
                  disabled={!canSend}
                  onClick={send}
                >
                  <Icon name="send" className="size-5" />
                </Button>
              ) : (
                <AudioRecorder onRecorded={addRecording} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The tile's edge, fixed for every attachment in every state. Progress used to
 * be a caption ("Uploading 7%" → "Uploading 100%"), which re-measured the chip
 * on each XHR progress event and walked the composer (and the timeline above
 * it) sideways a dozen times per upload. Nothing inside a tile may size it:
 * state shows as a ring on a veil over a square that never moves.
 */
const TILE = "size-28";

/**
 * One attachment tile: the picture (instant, from an object URL) or a file
 * face, with the live stage of this file painted over it: reading, uploading,
 * done, or a red state with the classified reason. The veil doubles as the
 * retry button when a retry makes sense.
 */
function AttachmentChip({
  attachment: a,
  onRemove,
  onRetryCapture,
}: {
  attachment: Attachment;
  onRemove: () => void;
  onRetryCapture: () => void;
}) {
  const queue = useBlobQueue();
  const queueState = useBlobQueueState();
  const upload = useBlobUploadState(a.captured?.blobId);
  // An `image/*` type the decoder then refuses (a .ico is the usual one):
  // fall back to the file face rather than leave a broken-image glyph.
  const [undecodable, setUndecodable] = useState(false);

  // Collapse the two lifecycles (local capture, then upload) into one overlay.
  let overlay: ReactNode = null;
  let stage: string | null = null;
  let failedReason: string | null = null;

  if (a.status === "reading") {
    overlay = <ProgressRing />;
    stage = "Reading…";
  } else if (a.status === "error") {
    failedReason = a.error ?? "Couldn't read this file";
  } else if (queueState.blocked === "auth" && upload && upload.stage !== "done") {
    overlay = <Icon name="pause" className="size-6" />;
    stage = "Waiting for sign-in";
  } else if (upload?.stage === "inflight") {
    overlay = <ProgressRing value={upload.progress ?? undefined} />;
    stage = "Uploading…";
  } else if (upload?.stage === "waiting") {
    if (upload.lastError) {
      failedReason = upload.lastError;
    } else {
      overlay = <ProgressRing />;
      stage = "Queued";
    }
  }
  // upload absent or done → bare tile; the timeline shows the message next.

  const retry =
    a.status === "error" && a.retryable !== false
      ? onRetryCapture
      : upload?.stage === "waiting" && upload.lastError && a.captured
        ? () => void queue.retryBlob(a.captured!.blobId)
        : null;

  // The name is gone from the face of a picture (you can see which file it is),
  // so the hover text carries it, along with the size and whatever this file
  // is doing right now.
  const title = failedReason
    ? `${a.name}: ${failedReason}${retry ? " (click to retry)" : ""}`
    : `${a.name} · ${formatBytes(a.size)}${stage ? ` · ${stage}` : ""}`;

  // What this file is doing is painted *over* it, not instead of it. This was
  // an opaque `--card` fill, which made every dropped photo a blank square
  // with a spinner on it for as long as the upload took: the one stretch of
  // time you most want to see which picture you dropped. The veil mutes the
  // tile toward the surface it already sits on (washed out in light, darkened
  // in dark, one class name either way) and the mark that says what is
  // happening sits on an opaque chip over it.
  //
  // The chip is not decoration. No ink in this palette reads over content it
  // cannot predict, which is why the album puts its upload and "+N" badges on
  // chips rather than scrims (attachment-album.tsx); a progress arc drawn
  // straight on the veil needs it at ~70% to clear 3:1 against a black photo
  // in light (or a white one in dark), by which point the photo is a ghost. On
  // `--card` the arc keeps the palette's measured ratio whatever the picture
  // is, so the veil is free to be as light as it reads best.
  const veil = `absolute inset-0 flex items-center justify-center ${
    failedReason ? "bg-destructive-soft/veil" : "bg-card/veil"
  }`;
  const chip = `flex size-10 items-center justify-center rounded-full border bg-card ${
    failedReason ? "border-destructive text-destructive" : "text-foreground"
  }`;
  // Retry-icon-or-alert is the failed pair; every other state supplies its own
  // overlay above. `retry` outlives `failedReason` by one case (an upload
  // parked for sign-in can still be poked), so the icon switches on the mark,
  // not on the state.
  const mark = failedReason ? (
    <Icon name={retry ? "retry" : "alert"} className="size-6" />
  ) : (
    overlay
  );

  /** Showing a picture, rather than the file face or a red tile. */
  const framed = Boolean(a.previewUrl) && !undecodable;

  return (
    // Overflow is clipped one level in, so the remove button can still hang off
    // the corner.
    <span className={`group/att relative shrink-0 ${TILE}`}>
      <span
        // `relative` is what makes the clip mean anything: the veil below is
        // `inset-0`, and without a containing block here it resolves against
        // the outer span instead, escaping the rounding and painting over the
        // failed tile's red border.
        //
        // A picture also gets an inner edge. The 1px border is `--border`,
        // which is a *lighter* line than the canvas: it reads against a dark
        // photo and against a dark theme, and disappears against the white
        // screenshot that is half of what gets sent here. So a preview adds a
        // second hairline inside it, drawn from the shadow family (the
        // palette's one sanctioned translucent set) rather than a flat colour,
        // because only a tinted line reads over content it cannot predict.
        className={`relative block size-full overflow-hidden rounded-xs border bg-muted ${
          failedReason
            ? "border-destructive"
            : framed
              ? "shadow-[inset_0_0_0_1px_rgb(var(--shadow-tint)/var(--shadow-a3))]"
              : ""
        }`}
        title={title}
      >
        {a.previewUrl && !undecodable ? (
          <>
            {/* No alt text: a fallback string would spill out of a tile this
                size when the bytes fail to decode, and the picture is only half
                the story anyway: the sr-only line below carries the rest. */}
            <img
              src={a.previewUrl}
              alt=""
              className="size-full object-cover"
              onError={() => setUndecodable(true)}
            />
            <span className="sr-only">{title}</span>
          </>
        ) : (
          <FileFace attachment={a} />
        )}
        {(overlay || failedReason) &&
          (retry ? (
            // The whole tile stays the target, the chip is only what you read.
            <button type="button" className={veil} title={title} onClick={retry}>
              <span className={chip}>{mark}</span>
            </button>
          ) : (
            <span className={veil}>
              <span className={chip}>{mark}</span>
            </span>
          ))}
      </span>
      {/* Keeps the base's full 44px: at 24px on a corner this is the fiddliest
          target on a phone, and it has room: the bleed to the right lands on
          the next tile, which is inert and paints over this anyway. */}
      <Button
        variant="outline"
        size="icon-xs"
        className="absolute -right-1.5 -top-1.5 hidden rounded-full text-muted-foreground hover:text-destructive active:text-destructive group-hover/att:flex max-md:flex"
        title="Remove"
        onClick={onRemove}
      >
        <Icon name="x" className="size-3" />
      </Button>
    </span>
  );
}

/**
 * The face of a file with nothing to show: name and type, laid out inside the
 * tile. Two PDFs are otherwise the same grey square, and text in here is free,
 * since the box it sits in is a fixed size no matter what it says.
 */
function FileFace({ attachment: a }: { attachment: Attachment }) {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(a.name)?.[1];
  return (
    <span className="flex size-full flex-col justify-between bg-card p-2.5 text-left">
      <span className="line-clamp-2 break-all text-[11px] font-medium leading-tight">{a.name}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Icon name={FACE_ICON[a.face]} className="size-3.5 shrink-0" />
        {ext && <span className="truncate text-[10px] font-medium uppercase">{ext}</span>}
      </span>
    </span>
  );
}

/**
 * The whole of the progress feedback on a tile: an arc that fills with `value`,
 * or spins when there is no number yet (reading, queued, a server that sends no
 * upload progress). No percentage: the arc says as much, and a caption would
 * be one more thing changing shape on a file that hasn't finished arriving.
 */
function ProgressRing({ value }: { value?: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const arc = value === undefined ? 0.25 : Math.min(1, Math.max(0, value));
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-7 -rotate-90 ${value === undefined ? "animate-spin [animation-duration:1.2s]" : ""}`}
    >
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - arc)}
        className={`stroke-primary ${value === undefined ? "" : "transition-[stroke-dashoffset] duration-200"}`}
      />
    </svg>
  );
}

/**
 * Full-viewport drop state, shown while files hover anywhere but the composer.
 * pointer-events-none throughout: the window-level handlers own the drop, and
 * a scrim that swallowed events would break it, so this stays a plain div
 * rather than a Radix dialog.
 */
function DropOverlay() {
  return (
    // The scrim is the surface: it fades the whole page out toward the canvas,
    // and the icon and label sit straight on it, no card.
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/scrim p-6 text-center text-foreground">
      <Icon name="filePlus" className="size-12" />
      <p className="text-lg font-medium">Drop the files to add to your message</p>
    </div>
  );
}
