import { mutators } from "@ragbag/contracts";
import { useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useBlobUrl } from "../lib/blobs.js";
import { hostOf, timeLabel } from "../lib/format.js";
import { isTouch } from "../lib/touch.js";
import type { TimelineItem } from "../lib/types.js";
import { Icon, KIND_ICON } from "./Icon.js";

// One timeline entry. Chat-style: the card is the "message"; a comment the
// user attached to a dump renders above the kind-specific body.

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sky-700 underline decoration-sky-300 hover:decoration-sky-600"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function StatusChip({ item }: { item: TimelineItem }) {
  const zero = useZero();
  const status = item.content?.status;
  if (!status || status === "done") return null;
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        <span title={item.content?.error ?? undefined}>failed</span>
        <button
          className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-px hover:bg-red-200"
          title={item.content?.error ?? "Retry ingestion"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void zero.mutate(mutators.item.retryIngest({ id: item.id }));
          }}
        >
          <Icon name="retry" className="size-3" /> retry
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
      {status === "processing" ? "processing" : "queued"}
    </span>
  );
}

// Only the user's own tags appear in the timeline. AI tags are generous by
// design (§7) — a dozen per item would drown the cards — so they stay behind
// the item detail view while still powering search and filtering.
export function TagChips({ item, limit = 8 }: { item: TimelineItem; limit?: number }) {
  const userTags = item.itemTags.filter((it) => it.tag && it.source === "user");
  if (userTags.length === 0) return null;
  const shown = userTags.slice(0, limit);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((it) => (
        <span
          key={it.tagId}
          className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600"
        >
          {it.tag!.name}
        </span>
      ))}
      {userTags.length > shown.length && (
        <span className="text-[11px] text-neutral-400">+{userTags.length - shown.length}</span>
      )}
    </span>
  );
}

function LinkBody({ item }: { item: TimelineItem }) {
  const c = item.content;
  const host = hostOf(item.url);
  return (
    <a
      href={item.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="group/link mt-0.5 flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 transition hover:border-neutral-300 hover:bg-neutral-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          {c?.faviconUrl && (
            <img src={c.faviconUrl} alt="" className="size-3.5 rounded-sm" loading="lazy" />
          )}
          <span className="truncate">{c?.siteName ?? host ?? item.url}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block font-medium text-neutral-900 group-hover/link:underline">
          {c?.title ?? item.url}
        </span>
        {c?.description && (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-neutral-500">
            {c.description}
          </span>
        )}
      </span>
      {c?.imageUrl && (
        <img
          src={c.imageUrl}
          alt=""
          loading="lazy"
          className="hidden size-20 shrink-0 rounded-lg object-cover sm:block"
        />
      )}
    </a>
  );
}

function ImageBody({ item }: { item: TimelineItem }) {
  const url = useBlobUrl(item.blobId);
  const navigate = useNavigate();
  return url ? (
    <img
      src={url}
      alt={item.content?.title ?? "dumped image"}
      className="mt-0.5 max-h-80 max-w-full cursor-zoom-in rounded-xl border border-neutral-200 object-contain"
      onClick={() => void navigate({ to: "/item/$id", params: { id: item.id } })}
    />
  ) : (
    <div className="mt-0.5 flex h-40 w-64 max-w-full animate-pulse items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 text-neutral-400">
      <Icon name="image" className="size-6" />
    </div>
  );
}

function FileBody({ item }: { item: TimelineItem }) {
  const icon = item.kind === "pdf" ? "pdf" : "file";
  return (
    <Link
      to="/item/$id"
      params={{ id: item.id }}
      className="mt-0.5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 transition hover:border-neutral-300"
    >
      <span
        className={`flex size-10 items-center justify-center rounded-lg ${
          item.kind === "pdf" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
        }`}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-neutral-900">
          {item.content?.title ?? (item.kind === "pdf" ? "PDF document" : "File")}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">{item.kind}</span>
      </span>
    </Link>
  );
}

export function ItemCard({ item }: { item: TimelineItem }) {
  const zero = useZero();
  const navigate = useNavigate();

  const remove = () => {
    if (!window.confirm("Delete this item? It disappears from all your devices.")) return;
    void zero.mutate(mutators.item.delete({ id: item.id }));
  };

  return (
    <article
      className={`group relative rounded-2xl border bg-white p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:shadow-[0_2px_8px_rgb(0_0_0/0.06)] ${
        item.pinned ? "border-amber-200" : "border-neutral-200"
      }`}
      // Touch has no hover actions, so tapping the card body opens the detail
      // view instead; links and buttons inside keep their own behavior.
      onClick={(e) => {
        if (!isTouch) return;
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        void navigate({ to: "/item/$id", params: { id: item.id } });
      }}
    >
      {/* hover actions */}
      <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-full border border-neutral-200 bg-white px-1 py-0.5 shadow-sm group-hover:flex">
        <button
          className={`rounded-full p-1.5 hover:bg-neutral-100 ${item.pinned ? "text-amber-500" : "text-neutral-400 hover:text-neutral-700"}`}
          title={item.pinned ? "Unpin" : "Pin"}
          onClick={() =>
            void zero.mutate(mutators.item.setPinned({ id: item.id, pinned: !item.pinned }))
          }
        >
          <Icon name="star" className="size-4" filled={item.pinned} />
        </button>
        <button
          className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          title="Details & tags"
          onClick={() => void navigate({ to: "/item/$id", params: { id: item.id } })}
        >
          <Icon name="tag" className="size-4" />
        </button>
        <button
          className="rounded-full p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          title="Delete"
          onClick={remove}
        >
          <Icon name="trash" className="size-4" />
        </button>
      </div>

      {item.pinned && (
        <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600">
          <Icon name="star" className="size-3" filled /> pinned
        </span>
      )}

      {/* the user's message text: note body, or comment on a dump */}
      {item.text && (
        <p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-900">
          <Linkified text={item.text} />
        </p>
      )}

      {item.kind === "link" && <LinkBody item={item} />}
      {item.kind === "image" && <ImageBody item={item} />}
      {(item.kind === "pdf" || item.kind === "file") && <FileBody item={item} />}

      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusChip item={item} />
          <TagChips item={item} />
        </span>
        <time
          className="shrink-0 text-[11px] tabular-nums text-neutral-400"
          title={new Date(item.createdAt).toLocaleString()}
        >
          {timeLabel(item.createdAt)}
        </time>
      </div>
    </article>
  );
}

export function KindDot({ kind }: { kind: TimelineItem["kind"] }) {
  const tone = {
    note: "text-amber-600 bg-amber-50",
    link: "text-sky-600 bg-sky-50",
    image: "text-violet-600 bg-violet-50",
    pdf: "text-red-600 bg-red-50",
    file: "text-slate-600 bg-slate-100",
  }[kind];
  return (
    <span className={`flex size-6 items-center justify-center rounded-md ${tone}`}>
      <Icon name={KIND_ICON[kind]} className="size-3.5" />
    </span>
  );
}
