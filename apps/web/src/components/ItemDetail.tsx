import { mutators, queries } from "@ragbag/contracts";
import { TEXT_ITEM_KINDS, isTextKind } from "@ragbag/shared";
import type { ItemKind } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useBlobUrl } from "../lib/blobs.js";
import { hostOf, timeLabel } from "../lib/format.js";
import { Icon } from "./Icon.js";
import { AddressActions, KindDot } from "./ItemCard.js";
import { TagEditor } from "./TagEditor.js";

// Route overlay (/item/$id): reader view for links, PDF viewer, image
// lightbox (plan §10), plus the tag editor and favorite/delete/retry actions.
// Rendered above the timeline so scroll position survives.

const TEXT_SECTION_LABEL: Partial<Record<ItemKind, string>> = {
  note: "Note",
  todo: "Todo",
  address: "Address",
};

export function ItemDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const zero = useZero();
  const navigate = useNavigate();
  const [item] = useQuery(queries.item({ id }));
  const [allTags] = useQuery(queries.tags());
  const blobUrl = useBlobUrl(item?.blobId);
  const [editing, setEditing] = useState(false);
  const [textDraft, setTextDraft] = useState("");

  const close = () => void navigate({ to: "/" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!item) {
    return (
      <Overlay onClose={close}>
        <div className="flex h-40 items-center justify-center text-neutral-400">
          <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
        </div>
      </Overlay>
    );
  }

  const c = item.content;
  const host = hostOf(item.url);
  const done = Boolean(item.completedAt);
  const userTagNames = item.itemTags
    .filter((t) => t.source === "user" && t.tag)
    .map((t) => t.tag!.name);
  const aiTags = item.itemTags.filter((t) => t.source === "ai" && t.tag);
  const suggestions = allTags.filter((t) => t.kind === "topic").map((t) => t.name);

  const saveText = () => {
    setEditing(false);
    if (textDraft.trim() !== (item.text ?? "")) {
      void zero.mutate(mutators.item.edit({ id: item.id, text: textDraft.trim() }));
    }
  };

  const remove = () => {
    if (!window.confirm("Delete this item? It disappears from all your devices.")) return;
    void zero.mutate(mutators.item.delete({ id: item.id }));
    close();
  };

  return (
    <Overlay onClose={close}>
      {/* header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/95 px-5 py-3 backdrop-blur">
        <KindDot kind={item.kind} />
        <span className="text-sm font-medium capitalize text-neutral-700">{item.kind}</span>
        {item.kind === "todo" && (
          <button
            role="checkbox"
            aria-checked={done}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              done
                ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                : "border-neutral-200 text-neutral-600 hover:border-emerald-500 hover:text-emerald-600"
            }`}
            onClick={() => void zero.mutate(mutators.item.setDone({ id: item.id, done: !done }))}
          >
            <Icon name="check" className="size-3.5" />
            {done ? "Done" : "Mark done"}
          </button>
        )}
        <time className="text-xs text-neutral-400">
          {new Date(item.createdAt).toLocaleDateString()} · {timeLabel(item.createdAt)}
        </time>
        <span className="ml-auto flex items-center gap-1">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <Icon name="external" className="size-3.5" /> Open original
            </a>
          )}
          <button
            className={`rounded-lg p-2 hover:bg-neutral-100 ${item.favorite ? "text-amber-500" : "text-neutral-400"}`}
            title={item.favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() =>
              void zero.mutate(mutators.item.setFavorite({ id: item.id, favorite: !item.favorite }))
            }
          >
            <Icon name="star" className="size-4" filled={item.favorite} />
          </button>
          <button
            className="rounded-lg p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
            title="Delete"
            onClick={remove}
          >
            <Icon name="trash" className="size-4" />
          </button>
          <button
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100"
            title="Close (Esc)"
            onClick={close}
          >
            <Icon name="x" className="size-4" />
          </button>
        </span>
      </div>

      <div className="space-y-5 px-5 py-5">
        {/* hero */}
        {item.kind === "image" &&
          (blobUrl ? (
            <img
              src={blobUrl}
              alt={c?.title ?? "image"}
              className="max-h-[70vh] w-full rounded-xl border border-neutral-200 object-contain"
            />
          ) : (
            <div className="flex h-64 animate-pulse items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Icon name="image" className="size-8" />
            </div>
          ))}
        {item.kind === "pdf" &&
          (blobUrl ? (
            <iframe
              src={blobUrl}
              title={c?.title ?? "PDF"}
              className="h-[70vh] w-full rounded-xl border border-neutral-200"
            />
          ) : (
            <div className="flex h-40 animate-pulse items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Icon name="pdf" className="size-8" />
            </div>
          ))}
        {item.kind === "file" && (
          <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <Icon name="file" className="size-8 text-slate-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c?.title ?? "File"}</p>
              <p className="text-xs text-neutral-400">Stored in your ragbag</p>
            </div>
            {blobUrl && (
              <a
                href={blobUrl}
                download={c?.title ?? "file"}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
              >
                Download
              </a>
            )}
          </div>
        )}
        {item.kind === "link" && c?.imageUrl && (
          <img
            src={c.imageUrl}
            alt=""
            className="max-h-72 w-full rounded-xl border border-neutral-200 object-cover"
          />
        )}

        {/* title + site */}
        {(c?.title || item.url) && (
          <div>
            <h1 className="text-xl font-semibold leading-snug text-neutral-900">
              {c?.title ?? item.url}
            </h1>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800"
              >
                {c?.faviconUrl && <img src={c.faviconUrl} alt="" className="size-4 rounded-sm" />}
                {c?.siteName ? `${c.siteName} · ${host}` : host}
              </a>
            )}
          </div>
        )}

        {/* the user's text (note/todo/address body, or a comment on a dump) */}
        <section>
          <SectionLabel>{TEXT_SECTION_LABEL[item.kind] ?? "Your comment"}</SectionLabel>
          {item.kind === "address" && item.text && (
            <div className="mb-2">
              <AddressActions address={item.text} />
            </div>
          )}
          {editing ? (
            <div>
              <textarea
                className="min-h-28 w-full rounded-xl border border-neutral-300 p-3 leading-relaxed outline-none focus:border-neutral-400"
                value={textDraft}
                autoFocus
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveText();
                }}
              />
              <div className="mt-1 flex gap-2">
                <button
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                  onClick={saveText}
                >
                  Save
                </button>
                <button
                  className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="group/text cursor-text rounded-xl border border-transparent p-1 -m-1 hover:border-neutral-200"
              onClick={() => {
                setTextDraft(item.text ?? "");
                setEditing(true);
              }}
              title="Click to edit"
            >
              {item.text ? (
                <p
                  className={`whitespace-pre-wrap leading-relaxed ${
                    done ? "text-neutral-400 line-through" : "text-neutral-900"
                  }`}
                >
                  {item.text}
                </p>
              ) : (
                <p className="text-sm italic text-neutral-400">Click to add a comment…</p>
              )}
            </div>
          )}
        </section>

        {/* Reclassify: a dumped thought that turned out to be a todo, or an
            address ingestion guessed wrong about. Text kinds only. */}
        {isTextKind(item.kind) && (
          <section>
            <SectionLabel>Type</SectionLabel>
            <div className="inline-flex rounded-lg border border-neutral-200 p-0.5">
              {TEXT_ITEM_KINDS.map((kind) => (
                <button
                  key={kind}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                    item.kind === kind
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                  onClick={() => {
                    if (item.kind !== kind) {
                      void zero.mutate(mutators.item.setKind({ id: item.id, kind }));
                    }
                  }}
                >
                  {kind}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* AI summary */}
        {c?.aiSummary && (
          <section className="rounded-xl bg-violet-50/70 p-3.5">
            <SectionLabel>
              <span className="flex items-center gap-1 text-violet-600">
                <Icon name="sparkles" className="size-3.5" /> Summary
              </span>
            </SectionLabel>
            <p className="text-sm leading-relaxed text-neutral-800">{c.aiSummary}</p>
          </section>
        )}

        {/* tags */}
        <section>
          <SectionLabel>Tags</SectionLabel>
          <TagEditor itemId={item.id} userTagNames={userTagNames} suggestions={suggestions} />
          {aiTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {aiTags.map((t) => (
                <span
                  key={t.tagId}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs text-violet-700"
                  title={`AI ${t.tag!.kind} tag`}
                >
                  <Icon name="sparkles" className="size-3" />
                  {t.tag!.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ingestion state */}
        {c?.status === "failed" && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
            <p className="font-medium">Ingestion failed</p>
            {c.error && <p className="mt-0.5 text-red-700/80">{c.error}</p>}
            <button
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-100"
              onClick={() => void zero.mutate(mutators.item.retryIngest({ id: item.id }))}
            >
              <Icon name="retry" className="size-3.5" /> Retry
            </button>
          </section>
        )}
        {(c?.status === "pending" || c?.status === "processing") && (
          <p className="flex items-center gap-2 text-xs text-neutral-400">
            <Icon name="spinner" className="size-3.5 animate-spin [animation-duration:2s]" />
            {c.status === "processing"
              ? "Reading and enriching this item…"
              : "Queued for ingestion…"}
          </p>
        )}

        {/* reader view */}
        {c?.extractedText && (
          <section>
            <SectionLabel>Extracted content</SectionLabel>
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 text-[15px] leading-relaxed text-neutral-800">
              {c.extractedText.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {para}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>
    </Overlay>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
      {children}
    </h2>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-neutral-900/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
        {children}
      </div>
    </div>
  );
}
