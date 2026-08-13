import type { CapturedBlob } from "@ragbag/client-runtime";
import { mutators } from "@ragbag/contracts";
import { newId, normalizeUrl, parseTextCapture } from "@ragbag/shared";
import type { TextItemKind } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import type { IconName } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useBlobQueue } from "@/lib/blobs";
import { useDictation } from "@/lib/dictation";
import { formatBytes } from "@/lib/format";
import { isTouch } from "@/lib/touch";

// The dump box (plan §1: zero friction). Text → note; a bare URL → link;
// a "todo:"/"[ ]" marker → todo; attached files → one item per file through
// the persistent blob queue — capture is local-only, so dumping works offline
// and uploads follow later.
//
// Floats over the timeline: "+" bottom-left opens the file picker, the type
// button next to it forces a kind when the guess would be wrong, and the
// bottom-right control is a mic while the box is empty, becoming send as soon
// as there is something to dump.

type CaptureType = "auto" | TextItemKind;

const CAPTURE_TYPES: { value: CaptureType; label: string; icon: IconName; placeholder: string }[] =
  [
    {
      value: "auto",
      label: "Auto",
      icon: "sparkles",
      placeholder: "Dump anything — a thought, a link, a file…",
    },
    { value: "note", label: "Note", icon: "note", placeholder: "Write a note…" },
    { value: "todo", label: "Todo", icon: "todo", placeholder: "What needs doing?" },
    { value: "address", label: "Address", icon: "address", placeholder: "Street, city…" },
  ];

type Attachment = {
  captured: CapturedBlob;
  previewUrl: string | null;
};

export function Composer({ canAttach }: { canAttach: boolean }) {
  const zero = useZero();
  const queue = useBlobQueue();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [capturing, setCapturing] = useState(0);
  // Sticky within the session: someone adding five todos shouldn't re-pick the
  // type five times. "auto" is the default and the common case.
  const [captureType, setCaptureType] = useState<CaptureType>("auto");
  // Where the dragged files currently hover: over the composer (it highlights
  // itself, as before) or anywhere else (the whole viewport reports it).
  const [dragZone, setDragZone] = useState<"composer" | "window" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation(setDraft);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        setCapturing((n) => n + 1);
        void queue
          .capture(file, file.name)
          .then((captured) => {
            const previewUrl = captured.kind === "image" ? URL.createObjectURL(file) : null;
            setAttachments((prev) =>
              prev.some((a) => a.captured.blobId === captured.blobId)
                ? prev
                : [...prev, { captured, previewUrl }],
            );
          })
          .catch(() => toast.error(`Could not read ${file.name}`))
          .finally(() => setCapturing((n) => n - 1));
      }
    },
    [queue],
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

  const removeAttachment = (blobId: string) => {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.captured.blobId === blobId);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.captured.blobId !== blobId);
    });
  };

  const hasContent = draft.trim().length > 0 || attachments.length > 0;

  const send = () => {
    const text = draft.trim();
    if (capturing > 0 || !hasContent) return;
    dictation.stop();

    const watchServer = (write: { server: Promise<{ type: string }> }) => {
      void write.server.then((r) => {
        if (r.type === "error") toast.error("The server rejected a dump — check the console.");
      });
    };

    if (attachments.length > 0) {
      attachments.forEach(({ captured }, i) => {
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
    } else if (captureType !== "auto") {
      // An explicit pick wins over every guess — including "this looks like a
      // URL": someone typing an address into the Address box means it.
      watchServer(zero.mutate(mutators.item.create({ id: newId(), kind: captureType, text })));
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
    setAttachments([]);
    setDraft("");
    textareaRef.current?.focus();
  };

  const showSend = hasContent || !dictation.supported;
  const selected = CAPTURE_TYPES.find((t) => t.value === captureType)!;

  return (
    <>
      {dragZone === "window" && <DropOverlay />}
      {/* The canvas fade that softens this card's edge lives in timeline.tsx —
          it belongs to the scroll canvas, not to the shell column. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-4">
        <div className="pointer-events-auto mx-auto w-full max-w-3xl">
          <div
            ref={cardRef}
            className={`rounded-3xl border bg-card shadow-float transition ${
              dragZone === "composer" ? "border-primary ring-4 ring-accent" : ""
            }`}
          >
            {(attachments.length > 0 || capturing > 0) && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {attachments.map(({ captured, previewUrl }) => (
                  <span
                    key={captured.blobId}
                    className="group/att relative flex items-center gap-2 rounded-xl border bg-muted p-1.5 pr-2.5"
                  >
                    {previewUrl ? (
                      <img src={previewUrl} alt="" className="size-10 rounded-lg object-cover" />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-lg bg-card text-muted-foreground">
                        <Icon name={captured.kind === "pdf" ? "pdf" : "file"} className="size-5" />
                      </span>
                    )}
                    <span className="max-w-40">
                      <span className="block truncate text-xs font-medium">
                        {captured.originalName ?? captured.kind}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatBytes(captured.size)}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full text-muted-foreground shadow-sm hover:text-destructive group-hover/att:flex max-md:flex"
                      title="Remove"
                      onClick={() => removeAttachment(captured.blobId)}
                    >
                      <Icon name="x" className="size-3" />
                    </Button>
                  </span>
                ))}
                {capturing > 0 && (
                  <span className="flex items-center gap-2 rounded-xl border border-dashed px-3 text-xs text-muted-foreground">
                    <Icon
                      name="spinner"
                      className="size-3.5 animate-spin [animation-duration:2s]"
                    />
                    adding…
                  </span>
                )}
              </div>
            )}

            <Textarea
              ref={textareaRef}
              rows={1}
              // Autofocus on touch would pop the keyboard the moment the app
              // opens.
              autoFocus={!isTouch}
              className="max-h-52 resize-none rounded-none border-0 bg-transparent px-5 pb-1 pt-4 text-base leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
              placeholder={dictation.listening ? "Listening…" : selected.placeholder}
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
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full text-muted-foreground"
                  title={
                    canAttach ? "Attach files" : "Blob storage is not configured on the server"
                  }
                  disabled={!canAttach}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="plus" className="size-5" />
                </Button>

                {/* Type override. Auto is the default — this is for the dumps
                    the guess would get wrong (an address, a task without a
                    marker), not the everyday path. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className={`h-9 gap-1.5 rounded-full px-2.5 ${
                        captureType === "auto"
                          ? "text-muted-foreground"
                          : "border-primary text-primary"
                      }`}
                      title={`Dump as: ${selected.label}`}
                    >
                      <Icon name={selected.icon} className="size-4" />
                      {captureType !== "auto" && (
                        <span className="text-xs font-medium">{selected.label}</span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="w-44">
                    <DropdownMenuRadioGroup
                      value={captureType}
                      onValueChange={(value) => {
                        setCaptureType(value as CaptureType);
                        textareaRef.current?.focus();
                      }}
                    >
                      {CAPTURE_TYPES.map((type) => (
                        <DropdownMenuRadioItem key={type.value} value={type.value}>
                          <Icon name={type.icon} className="size-4" />
                          {type.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
                  title="Dump (Enter)"
                  disabled={capturing > 0 || !hasContent}
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
 * Full-viewport drop state, shown while files hover anywhere but the composer.
 * pointer-events-none throughout: the window-level handlers own the drop, and
 * an overlay that swallowed events would break it — so this stays a plain div
 * rather than a Radix dialog.
 */
function DropOverlay() {
  return (
    // The scrim is dark in both themes, so its ink is too — `text-background`
    // would be invisible here in dark mode.
    <div className="pointer-events-none fixed inset-0 z-50 bg-scrim-strong backdrop-blur-sm">
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-scrim-foreground">
          <Icon name="plus" className="size-10" />
          <p className="text-xl font-semibold">Drop to add to your ragbag</p>
          <p className="text-sm text-scrim-foreground-muted">
            Images, PDFs, anything — release anywhere on this page
          </p>
        </div>
      </div>
    </div>
  );
}
