import type { CapturedBlob } from "@ragbag/client-runtime";
import { MAX_BLOB_BYTES, mutators } from "@ragbag/contracts";
import { kindForMime, newId, normalizeUrl, parseTextCapture } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBlobQueue, useBlobQueueState, useBlobUploadState } from "@/lib/blobs";
import { useDictation } from "@/lib/dictation";
import { formatBytes } from "@/lib/format";
import { isTouch } from "@/lib/touch";

// The dump box (plan §1: zero friction). Text → note; a bare URL → link;
// a "todo:"/"[ ]" marker → todo; attached files → one item per file through
// the persistent blob queue — capture is local-only, so dumping works offline
// and uploads follow later.
//
// Attachments behave like a chat composer's: a fixed square tile (with its
// image preview) appears the instant a file is picked — hashing, local
// persistence and the upload all happen behind it, each stage visible ON the
// tile (reading spinner → upload progress ring → done, or a red state with the
// classified reason and a retry). Nothing here waits silently: every async
// stage has a deadline, and a failure is a state on the tile, not a mystery.
//
// Floats over the timeline: "+" bottom-left opens the file picker, and the
// bottom-right control is a mic while the box is empty, becoming send as soon
// as there is something to dump. The kind is always guessed — there is no
// type picker to get in the way.

const PLACEHOLDER = "Dump anything — a thought, a link, a file…";

type Attachment = {
  /** Chip identity from the moment of pick — before any blobId exists. */
  localId: string;
  file: File;
  name: string;
  size: number;
  kind: "image" | "pdf" | "file";
  /** Object URL for image previews — created synchronously on pick. */
  previewUrl: string | null;
  /** The local stage: hashing+persisting ("reading") until a blobId exists. */
  status: "reading" | "ready" | "error";
  error?: string;
  /** False for validation failures (too large, empty) — retrying can't help. */
  retryable?: boolean;
  captured?: CapturedBlob;
};

/** How long the local hash+persist may take before the chip goes red. */
const CAPTURE_TIMEOUT_MS = 12_000;

/** The write is optimistic; only the server's verdict can still surprise us. */
function watchServer(write: { server: Promise<{ type: string }> }) {
  void write.server.then((r) => {
    if (r.type === "error") toast.error("The server rejected a dump — check the console.");
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
  const dictation = useDictation(setDraft);

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
            // Chip removed while reading — don't leave an orphan upload.
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

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const localId = newId();
        const kind = kindForMime(file.type || "application/octet-stream");
        // The preview exists before any async work — the whole point.
        const previewUrl = kind === "image" ? URL.createObjectURL(file) : null;
        const base: Attachment = {
          localId,
          file,
          name: file.name || kind,
          size: file.size,
          kind,
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
    // rather than trusting a single leave — otherwise the indicator flickers
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
    // A fresh capture with no item yet is ours to abort; a reused blobId may
    // belong to an already-sent item, so its upload must keep running.
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

  const send = () => {
    const text = draft.trim();
    if (!canSend) return;
    dictation.stop();

    if (attachments.length > 0) {
      attachments.forEach(({ captured }, i) => {
        if (!captured) return; // unreachable: send is gated on every chip being ready
        const id = newId();
        watchServer(
          zero.mutate(
            mutators.item.create({
              id,
              kind: captured.kind,
              blobId: captured.blobId,
              // The typed text rides along as the comment on the first file.
              text: i === 0 && text ? text : undefined,
            }),
          ),
        );
        void queue.linkItem(captured.blobId, id);
      });
    } else {
      const parsed = parseTextCapture(text);
      watchServer(
        zero.mutate(
          mutators.item.create({
            id: newId(),
            kind: parsed.kind,
            text: parsed.text,
            url: parsed.url ? normalizeUrl(parsed.url)! : undefined,
          }),
        ),
      );
    }

    for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    setAttachments(() => []);
    setDraft("");
    textareaRef.current?.focus();
  };

  const showSend = hasContent || !dictation.supported;

  return (
    <>
      {dragZone === "window" && <DropOverlay />}
      {/* Sticky, not fixed: the card keeps its place in the column, so it
          inherits the width the sidebar leaves it with no offset arithmetic —
          and its slot at the end of the flow means the last card can never come
          to rest under it (WINDOW_SCROLL_PLAN.md §3.3). */}
      <div className="pointer-events-none sticky bottom-0 z-20 px-3 pb-(--composer-inset) md:px-4">
        {/* Canvas strip scoped to this container, not the shell column. It
            covers the gap between the card and the bottom of the column — the
            only strip where a scrolling card would otherwise be cut off by the
            viewport edge — plus 1rem that tucks behind the card. Solid
            `--background`, not a gradient: nothing translucent, and its top
            edge is invisible anyway (behind the card in the middle, background
            over background either side, since the timeline column is inset
            further than this card). Sized off the gap rather than the card
            because the card grows with its content while the gap is constant.
            `relative` on the card below keeps it painting on top. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(var(--composer-inset)_+_1rem)] bg-background" />
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
              className="max-h-52 resize-none rounded-none border-0 bg-transparent px-5 pb-1 pt-4 text-base leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
              placeholder={dictation.listening ? "Listening…" : PLACEHOLDER}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />

            <div className="flex items-center justify-between px-2.5 pb-2.5">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full text-muted-foreground"
                title={canAttach ? "Attach files" : "Blob storage is not configured on the server"}
                disabled={!canAttach}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="plus" className="size-5" />
              </Button>
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

              {showSend ? (
                <Button
                  size="icon"
                  className="rounded-full"
                  title={
                    failed
                      ? "Remove or retry the failed attachment first"
                      : reading
                        ? "Still reading an attachment…"
                        : "Dump (Enter)"
                  }
                  disabled={!canSend}
                  onClick={send}
                >
                  <Icon name="send" className="size-5" />
                </Button>
              ) : (
                <Button
                  variant={dictation.listening ? "destructive" : "outline"}
                  size="icon"
                  className={`rounded-full ${
                    dictation.listening ? "animate-pulse" : "text-muted-foreground"
                  }`}
                  title={dictation.listening ? "Stop dictation" : "Dictate a note"}
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start(draft))}
                >
                  <Icon name="mic" className="size-5" />
                </Button>
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
 * on each XHR progress event and walked the composer — and the timeline above
 * it — sideways a dozen times per upload. Nothing inside a tile may size it:
 * state shows as a ring and a scrim over a square that never moves.
 */
const TILE = "size-28";

/**
 * One attachment tile: the picture (instant, from an object URL) or a file
 * face, with the live stage of this file painted over it — reading, uploading,
 * done, or a red state with the classified reason. The scrim doubles as the
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
  // An `image/*` type the decoder then refuses (a .ico is the usual one) —
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
  // upload absent or done → bare tile; the timeline shows the item next.

  const retry =
    a.status === "error" && a.retryable !== false
      ? onRetryCapture
      : upload?.stage === "waiting" && upload.lastError && a.captured
        ? () => void queue.retryBlob(a.captured!.blobId)
        : null;

  // The name is gone from the face of a picture (you can see which file it is),
  // so the hover text carries it — along with the size and whatever this file
  // is doing right now.
  const title = failedReason
    ? `${a.name} — ${failedReason}${retry ? " (click to retry)" : ""}`
    : `${a.name} · ${formatBytes(a.size)}${stage ? ` · ${stage}` : ""}`;

  const scrim = `absolute inset-0 flex items-center justify-center ${
    failedReason ? "bg-destructive/15 text-destructive" : "bg-card/70 text-foreground"
  }`;

  return (
    // Overflow is clipped one level in, so the remove button can still hang off
    // the corner.
    <span className={`group/att relative shrink-0 ${TILE}`}>
      <span
        className={`block size-full overflow-hidden rounded-xl border bg-muted ${
          failedReason ? "border-destructive/60" : ""
        }`}
        title={title}
      >
        {a.previewUrl && !undecodable ? (
          <>
            {/* No alt text: a fallback string would spill out of a tile this
                size when the bytes fail to decode, and the picture is only half
                the story anyway — the sr-only line below carries the rest. */}
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
            <button type="button" className={scrim} title={title} onClick={retry}>
              {failedReason ? <Icon name="retry" className="size-6" /> : overlay}
            </button>
          ) : (
            <span className={scrim}>
              {failedReason ? <Icon name="alert" className="size-6" /> : overlay}
            </span>
          ))}
      </span>
      {/* Keeps the base's full 44px: at 24px on a corner this is the fiddliest
          target on a phone, and it has room — the bleed to the right lands on
          the next tile, which is inert and paints over this anyway. The one
          consequence is on a failed tile, where the retry scrim below loses its
          top-right corner to this. That is the right winner: the ✕ is sitting
          on it. */}
      <Button
        variant="outline"
        size="icon-xs"
        className="absolute -right-1.5 -top-1.5 hidden rounded-full text-muted-foreground hover:text-destructive group-hover/att:flex max-md:flex"
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
 * tile. Two PDFs are otherwise the same grey square — and text in here is free,
 * since the box it sits in is a fixed size no matter what it says.
 */
function FileFace({ attachment: a }: { attachment: Attachment }) {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(a.name)?.[1];
  return (
    <span className="flex size-full flex-col justify-between bg-card p-2.5 text-left">
      <span className="line-clamp-2 break-all text-[11px] font-medium leading-tight">{a.name}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Icon name={a.kind === "pdf" ? "pdf" : "file"} className="size-3.5 shrink-0" />
        {ext && <span className="truncate text-[10px] font-medium uppercase">{ext}</span>}
      </span>
    </span>
  );
}

/**
 * The whole of the progress feedback on a tile: an arc that fills with `value`,
 * or spins when there is no number yet (reading, queued, a server that sends no
 * upload progress). No percentage — the arc says as much, and a caption would
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
 * a scrim that swallowed events would break it — so this stays a plain div
 * rather than a Radix dialog.
 */
function DropOverlay() {
  return (
    // The scrim is the surface: it fades the whole page out toward the canvas,
    // and the icon and label sit straight on it — no card. `bg-background`
    // rather than `bg-overlay` because this state replaces the page rather
    // than dimming something you still read through, which also means ordinary
    // `text-foreground` ink under both themes — it's the canvas underneath.
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/scrim p-6 text-center text-foreground">
      <Icon name="filePlus" className="size-12" />
      <p className="text-lg font-medium">Drop the files to add to your message</p>
    </div>
  );
}
