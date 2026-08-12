import type { CapturedBlob } from "@ragbag/client-runtime";
import { mutators } from "@ragbag/contracts";
import { isBareUrl, newId, normalizeUrl } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlobQueue } from "../lib/blobs.js";
import { formatBytes } from "../lib/format.js";
import { Icon } from "./Icon.js";

// The dump box (plan §1: zero friction). Text → note; a bare URL → link;
// attached files → one item per file through the persistent blob queue —
// capture is local-only, so dumping works offline and uploads follow later.

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
  const [rejected, setRejected] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          .catch(() => setRejected(`Could not read ${file.name}`))
          .finally(() => setCapturing((n) => n - 1));
      }
    },
    [queue],
  );

  // Window-level paste (screenshots!) and drag-drop land in the composer.
  useEffect(() => {
    if (!canAttach) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
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

  const send = () => {
    const text = draft.trim();
    if (capturing > 0) return;
    if (!text && attachments.length === 0) return;

    const watchServer = (write: { server: Promise<{ type: string }> }) => {
      void write.server.then((r) => {
        if (r.type === "error") setRejected("The server rejected a dump — check the console.");
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
    } else if (isBareUrl(text)) {
      watchServer(
        zero.mutate(mutators.item.create({ id: newId(), kind: "link", url: normalizeUrl(text)! })),
      );
    } else {
      watchServer(zero.mutate(mutators.item.create({ id: newId(), kind: "note", text })));
    }

    for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    setAttachments([]);
    setDraft("");
    setRejected(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-neutral-200 bg-white/90 px-4 pb-4 pt-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {rejected && (
          <p className="mb-2 flex items-center gap-2 text-xs text-red-600">
            {rejected}
            <button className="underline" onClick={() => setRejected(null)}>
              dismiss
            </button>
          </p>
        )}

        {(attachments.length > 0 || capturing > 0) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map(({ captured, previewUrl }) => (
              <span
                key={captured.blobId}
                className="group/att relative flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 pr-2.5"
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="" className="size-10 rounded-lg object-cover" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-lg bg-white text-neutral-500">
                    <Icon name={captured.kind === "pdf" ? "pdf" : "file"} className="size-5" />
                  </span>
                )}
                <span className="max-w-40">
                  <span className="block truncate text-xs font-medium text-neutral-800">
                    {captured.originalName ?? captured.kind}
                  </span>
                  <span className="text-[11px] text-neutral-400">{formatBytes(captured.size)}</span>
                </span>
                <button
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-neutral-200 bg-white p-0.5 text-neutral-500 shadow-sm hover:text-red-600 group-hover/att:block"
                  title="Remove"
                  onClick={() => removeAttachment(captured.blobId)}
                >
                  <Icon name="x" className="size-3" />
                </button>
              </span>
            ))}
            {capturing > 0 && (
              <span className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 text-xs text-neutral-400">
                <Icon name="spinner" className="size-3.5 animate-spin [animation-duration:2s]" />
                adding…
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white p-2 shadow-sm focus-within:border-neutral-400">
          <button
            className="rounded-xl p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={canAttach ? "Attach files" : "Blob storage is not configured on the server"}
            disabled={!canAttach}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="paperclip" className="size-5" />
          </button>
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
          <textarea
            ref={textareaRef}
            rows={1}
            autoFocus
            className="max-h-52 flex-1 resize-none bg-transparent py-2 leading-relaxed text-neutral-900 placeholder-neutral-400 outline-none"
            placeholder="Dump anything — a thought, a link, or drop files…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="rounded-xl bg-neutral-900 p-2 text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="Dump (Enter)"
            disabled={capturing > 0 || (!draft.trim() && attachments.length === 0)}
            onClick={send}
          >
            <Icon name="send" className="size-5" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-neutral-400">
          Enter to dump · Shift+Enter for a new line · paste or drop files anywhere
        </p>
      </div>
    </div>
  );
}
