import { mutators } from "@ragbag/contracts";
import { addressQuery, mapsSearchUrl } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

/**
 * A todo is a note you can tick off: the checkbox writes `completedAt`, which
 * syncs like everything else, so checking it here checks it on every device.
 */
export function TodoBody({ item, size = "sm" }: { item: TimelineItem; size?: "sm" | "lg" }) {
  const zero = useZero();
  const done = Boolean(item.completedAt);
  return (
    <div className="flex items-start gap-2.5">
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        title={done ? "Mark as not done" : "Mark as done"}
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition ${
          done
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-neutral-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          void zero.mutate(mutators.item.setDone({ id: item.id, done: !done }));
        }}
      >
        <Icon name="check" className="size-3.5" />
      </button>
      <p
        className={`whitespace-pre-wrap break-words leading-relaxed ${
          size === "lg" ? "text-[17px]" : ""
        } ${done ? "text-neutral-400 line-through" : "text-neutral-900"}`}
      >
        <Linkified text={item.text ?? ""} />
      </p>
    </div>
  );
}

/**
 * Addresses stay as typed (plan §4) — the actions are what make them useful:
 * open in maps, or copy for the taxi app. `content.title` is the place name
 * ingestion recognised, when it did.
 */
export function AddressActions({ address }: { address: string }) {
  const mapsUrl = mapsSearchUrl(address);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(addressQuery(address)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  };

  const button =
    "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50";

  return (
    <div className="flex items-center gap-1.5">
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className={button}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="external" className="size-3" /> Open in Maps
        </a>
      )}
      <button
        className={button}
        onClick={(e) => {
          e.stopPropagation();
          copy();
        }}
      >
        <Icon name={copied ? "check" : "copy"} className="size-3" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function AddressBody({ item }: { item: TimelineItem }) {
  const address = item.text ?? "";
  return (
    <div className="mt-0.5 flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
        <Icon name="address" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        {item.content?.title && (
          <p className="truncate font-medium text-neutral-900">{item.content.title}</p>
        )}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-neutral-600">
          {address}
        </p>
        <div className="mt-2">
          <AddressActions address={address} />
        </div>
      </div>
    </div>
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
      className="group relative rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition hover:shadow-[0_2px_8px_rgb(0_0_0/0.06)]"
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
          className={`rounded-full p-1.5 hover:bg-neutral-100 ${item.favorite ? "text-amber-500" : "text-neutral-400 hover:text-neutral-700"}`}
          title={item.favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() =>
            void zero.mutate(mutators.item.setFavorite({ id: item.id, favorite: !item.favorite }))
          }
        >
          <Icon name="star" className="size-4" filled={item.favorite} />
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

      {/* the user's message text: note body, or comment on a dump. Todos and
          addresses own their text, so their bodies render it instead. */}
      {item.text && item.kind !== "todo" && item.kind !== "address" && (
        <p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-900">
          <Linkified text={item.text} />
        </p>
      )}

      {item.kind === "todo" && <TodoBody item={item} />}
      {item.kind === "address" && <AddressBody item={item} />}
      {item.kind === "link" && <LinkBody item={item} />}
      {item.kind === "image" && <ImageBody item={item} />}
      {(item.kind === "pdf" || item.kind === "file") && <FileBody item={item} />}

      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* hover actions are unreachable on touch, so favorites need a mark
              that is always visible */}
          {item.favorite && <Icon name="star" className="size-3.5 text-amber-500" filled />}
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
    todo: "text-emerald-600 bg-emerald-50",
    address: "text-rose-600 bg-rose-50",
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
