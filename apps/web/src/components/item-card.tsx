import { mutators } from "@ragbag/contracts";
import { addressQuery, mapsSearchUrl } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DeleteItemDialog } from "@/components/delete-item-dialog";
import { Icon, KIND_ICON } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  mediaBox,
  rememberBlobAspect,
  useBlobQueue,
  useBlobQueueState,
  useBlobUploadState,
  useBlobUrl,
} from "@/lib/blobs";
import { hostOf, timeLabel } from "@/lib/format";
import { isTouch } from "@/lib/touch";
import type { TimelineItem } from "@/lib/types";

// One timeline entry. Chat-style: the card is the "message"; a comment the
// user attached to a dump renders above the kind-specific body.

/**
 * Opening an item draws an overlay *above* the timeline: it is not a new
 * screen, and the archive underneath has to stay exactly where the reader left
 * it. The router scrolls the window to the top on every navigation unless told
 * otherwise, which was invisible while the timeline had its own scroll box and
 * very much is not now that the document is the scroller.
 */
const openItem = (id: string) => ({ to: "/item/$id", params: { id }, resetScroll: false }) as const;

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
            className="break-all text-kind-link underline decoration-kind-link decoration-1 underline-offset-2"
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
    // A soft chip rather than a solid red badge: the inline retry button needs
    // a surface of its own, and lightening a solid fill would mean an alpha.
    return (
      <Badge className="gap-1.5 bg-destructive-soft px-2 text-[11px] text-destructive">
        <span title={item.content?.error ?? undefined}>failed</span>
        <button
          className="inline-flex items-center gap-0.5 rounded-full bg-card px-1.5 py-px hover:bg-panel"
          title={item.content?.error ?? "Retry ingestion"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void zero.mutate(mutators.item.retryIngest({ id: item.id }));
          }}
        >
          <Icon name="retry" className="size-3" /> retry
        </button>
      </Badge>
    );
  }
  return (
    // Optical, not arithmetic: the two sides are not carrying the same thing.
    // The right ends on a letter, which needs room; the left starts on a
    // 0.75rem glyph, which is already a square with air in it. Giving that
    // side the same 0.25rem the glyph has above and below sets it in its
    // corner evenly, instead of leaving it adrift in a wider margin.
    <Badge className="gap-1 bg-warning pr-2 pl-1 text-[11px] text-warning-foreground">
      <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
      {status === "processing" ? "processing" : "queued"}
    </Badge>
  );
}

// Only the user's own tags appear in the timeline. AI tags are generous by
// design (§7) (a dozen per item would drown the cards), so they stay behind
// the item detail view while still powering search and filtering.
export function TagChips({ item, limit = 8 }: { item: TimelineItem; limit?: number }) {
  const userTags = item.itemTags.filter((it) => it.tag && it.source === "user");
  if (userTags.length === 0) return null;
  const shown = userTags.slice(0, limit);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((it) => (
        <Badge key={it.tagId} variant="secondary" className="px-2 text-[11px] font-normal">
          {it.tag!.name}
        </Badge>
      ))}
      {userTags.length > shown.length && (
        <span className="text-[11px] text-muted-foreground">+{userTags.length - shown.length}</span>
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
      {/* Not the shadcn Checkbox: this one is tinted with the todo kind colour
          and needs a larger tap target than the default. */}
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        title={done ? "Mark as not done" : "Mark as done"}
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring ${
          done
            ? "border-kind-todo bg-kind-todo text-background"
            : "border-input text-transparent hover:border-kind-todo hover:text-kind-todo"
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
        } ${done ? "text-muted-foreground line-through" : "text-foreground"}`}
      >
        <Linkified text={item.text ?? ""} />
      </p>
    </div>
  );
}

/**
 * Addresses stay as typed (plan §4); the actions are what make them useful:
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

  return (
    <div className="flex items-center gap-1.5">
      {mapsUrl && (
        <Button
          variant="outline"
          size="xs"
          nativeButton={false}
          render={
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <Icon name="external" className="size-3" /> Open in Maps
        </Button>
      )}
      <Button
        variant="outline"
        size="xs"
        onClick={(e) => {
          e.stopPropagation();
          copy();
        }}
      >
        <Icon name={copied ? "check" : "copy"} className="size-3" />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function AddressBody({ item }: { item: TimelineItem }) {
  const address = item.text ?? "";
  return (
    <div className="mt-0.5 flex gap-3 rounded-lg border bg-panel p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-kind-address-soft text-kind-address">
        <Icon name="address" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        {item.content?.title && <p className="truncate font-medium">{item.content.title}</p>}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-muted-foreground">
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
      className="group/link mt-0.5 flex gap-3 rounded-lg border bg-panel p-3 transition hover:bg-accent"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {c?.faviconUrl && (
            <img src={c.faviconUrl} alt="" className="size-3.5 rounded-xs" loading="lazy" />
          )}
          <span className="truncate">{c?.siteName ?? host ?? item.url}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block font-medium group-hover/link:underline">
          {c?.title ?? item.url}
        </span>
        {c?.description && (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">
            {c.description}
          </span>
        )}
      </span>
      {c?.imageUrl && (
        <img
          src={c.imageUrl}
          alt=""
          loading="lazy"
          className="hidden size-20 shrink-0 rounded-md object-cover sm:block"
        />
      )}
    </a>
  );
}

/**
 * "This item's file hasn't reached the server yet", pinned over the media of
 * a freshly-dumped card. The bytes render locally either way (that's the
 * local-first deal); this badge is the difference between "uploading",
 * "waiting", and "failing, here's why": states that used to be invisible
 * until another device quietly couldn't load the image.
 */
function UploadBadge({
  blobId,
  side = "left",
}: {
  blobId: string | null;
  /** Which top corner to pin to: right for file rows, left over images. */
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
        // Inside ImageBody the parent img navigates; inside FileBody the
        // parent is a Link. The badge is its own control either way.
        e.preventDefault();
        e.stopPropagation();
        if (failing) void queue.retryBlob(blobId);
      }}
      className={`absolute top-1.5 flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
        side === "left" ? "left-1.5" : "right-1.5"
      } ${
        failing ? "border-destructive bg-card text-destructive" : "bg-card text-muted-foreground"
      }`}
    >
      {failing ? (
        <Icon name="alert" className="size-3" />
      ) : blocked === "auth" ? (
        <Icon name="pause" className="size-3" />
      ) : (
        <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
      )}
      {failing
        ? "upload failed"
        : upload.stage === "inflight" && upload.progress !== null
          ? `${Math.round(upload.progress * 100)}%`
          : "uploading"}
    </button>
  );
}

/** Keep in step with `max-h-80` on the image below. */
const IMAGE_MAX_H = "20rem";

function ImageBody({ item }: { item: TimelineItem }) {
  const url = useBlobUrl(item.blobId);
  const navigate = useNavigate();
  // The box this picture will occupy, known from the last time this device
  // displayed it. Placeholder and image share it exactly, so the swap moves
  // nothing: neither the rest of this card nor the rows below it.
  const box = mediaBox(item.blobId, IMAGE_MAX_H);

  return url ? (
    // The box goes on the wrapper, not on the image, and the wrapper is a
    // block. On an `inline-block` span the `min(100%, …)` width resolves
    // against a shrink-to-fit container whose own width depends on the image
    // inside it: so until the bytes decode, the picture is 7×2px and the
    // archive briefly loses 800px of height (measured). A block wrapper
    // resolves the percentage against the card, before anything has loaded.
    <span style={box} className={`relative mt-0.5 ${box ? "block" : "inline-block max-w-full"}`}>
      <img
        src={url}
        alt={item.content?.title ?? "dumped image"}
        className={`cursor-zoom-in rounded-lg border object-contain ${
          box ? "h-full w-full" : "max-h-80 max-w-full"
        }`}
        onClick={() => void navigate(openItem(item.id))}
        onLoad={(e) => rememberBlobAspect(item.blobId, e.currentTarget)}
      />
      <UploadBadge blobId={item.blobId} />
    </span>
  ) : (
    <div
      style={box}
      // No pulse: for anything this device has already read, the bytes arrive
      // within a frame or two, and a placeholder that animates on its way past
      // is just another thing flashing.
      className={`mt-0.5 flex max-w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground ${
        box ? "" : "h-40 w-64"
      }`}
    >
      <Icon name="image" className="size-6" />
    </div>
  );
}

function FileBody({ item }: { item: TimelineItem }) {
  const icon = item.kind === "pdf" ? "pdf" : "file";
  return (
    // `openItem`, not a hand-written target: this is a link rather than a
    // `navigate` call, but it opens the same overlay over the same archive and
    // owes it the same `resetScroll: false`. Spelling the route out here is how
    // it came to be the one way into the drawer that threw the reader back to
    // the top of the timeline.
    <Link
      {...openItem(item.id)}
      className="relative mt-0.5 flex items-center gap-3 rounded-lg border bg-panel p-3 transition hover:bg-accent"
    >
      <span
        className={`flex size-10 items-center justify-center rounded-md ${
          item.kind === "pdf"
            ? "bg-kind-pdf-soft text-kind-pdf"
            : "bg-kind-file-soft text-kind-file"
        }`}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {item.content?.title ?? (item.kind === "pdf" ? "PDF document" : "File")}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {item.kind}
        </span>
      </span>
      <UploadBadge blobId={item.blobId} side="right" />
    </Link>
  );
}

export function ItemCard({ item }: { item: TimelineItem }) {
  const zero = useZero();
  const navigate = useNavigate();

  return (
    // Not <Card>: it has no asChild and this needs to stay an <article>, so it
    // borrows the card tokens directly.
    <article
      className="group relative rounded-2xl bg-card p-3.5 text-card-foreground"
      // Touch has no hover actions, so tapping the card body opens the detail
      // view instead; links and buttons inside keep their own behavior.
      onClick={(e) => {
        if (!isTouch) return;
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        void navigate(openItem(item.id));
      }}
    >
      {/* hover actions. A Tooltip supplies the description, not the name: these
          are icon-only, so each still needs its own aria-label. z-10 because the
          media bodies below are `relative` (they pin an upload badge) and so
          paint over an auto-z-index sibling that precedes them in the DOM. */}
      <div className="absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-full border bg-card p-1 group-hover:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"}
                className={`rounded-full ${item.favorite ? "text-kind-note" : "text-muted-foreground"}`}
                onClick={() =>
                  void zero.mutate(
                    mutators.item.setFavorite({ id: item.id, favorite: !item.favorite }),
                  )
                }
              />
            }
          >
            <Icon name="star" className="size-4" filled={item.favorite} />
          </TooltipTrigger>
          <TooltipContent>
            {item.favorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Details and tags"
                className="rounded-full text-muted-foreground"
                onClick={() => void navigate(openItem(item.id))}
              />
            }
          >
            <Icon name="tag" className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Details &amp; tags</TooltipContent>
        </Tooltip>
        <DeleteItemDialog onConfirm={() => void zero.mutate(mutators.item.delete({ id: item.id }))}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
            aria-label="Delete"
            title="Delete"
          >
            <Icon name="trash" className="size-4" />
          </Button>
        </DeleteItemDialog>
      </div>

      {/* the user's message text: note body, or comment on a dump. Todos and
            addresses own their text, so their bodies render it instead. */}
      {item.text && item.kind !== "todo" && item.kind !== "address" && (
        <p className="whitespace-pre-wrap break-words leading-relaxed">
          <Linkified text={item.text} />
        </p>
      )}

      {item.kind === "todo" && <TodoBody item={item} />}
      {item.kind === "address" && <AddressBody item={item} />}
      {item.kind === "link" && <LinkBody item={item} />}
      {item.kind === "image" && <ImageBody item={item} />}
      {(item.kind === "pdf" || item.kind === "file") && <FileBody item={item} />}

      {/* The footer stands a chip tall whether or not there is a chip in it.
          Ingestion is the one thing on a card that changes on its own, with no
          one touching it: a badge appears the moment a dump lands, swaps
          queued for processing, then leaves. Each of those is a row 3px taller
          than the bare timestamp, so every card below jumped 3px, twice, per
          dump. `min-h-5` is the badge's own height held open permanently, and
          `items-end` keeps the timestamp on the same baseline either way. */}
      <div className="mt-2 flex min-h-5 items-end justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* hover actions are unreachable on touch, so favorites need a mark
                that is always visible */}
          {item.favorite && <Icon name="star" className="size-3.5 text-kind-note" filled />}
          <StatusChip item={item} />
          <TagChips item={item} />
        </span>
        <time
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          title={new Date(item.createdAt).toLocaleString()}
        >
          {timeLabel(item.createdAt)}
        </time>
      </div>
    </article>
  );
}

const KIND_TONE: Record<TimelineItem["kind"], string> = {
  note: "text-kind-note bg-kind-note-soft",
  todo: "text-kind-todo bg-kind-todo-soft",
  address: "text-kind-address bg-kind-address-soft",
  link: "text-kind-link bg-kind-link-soft",
  image: "text-kind-image bg-kind-image-soft",
  pdf: "text-kind-pdf bg-kind-pdf-soft",
  file: "text-kind-file bg-kind-file-soft",
};

export function KindDot({ kind }: { kind: TimelineItem["kind"] }) {
  return (
    <span className={`flex size-6 items-center justify-center rounded-md ${KIND_TONE[kind]}`}>
      {/* text-current is load-bearing: CommandItem paints bare `svg` children
          muted-foreground, and the kind tint lives on the span. */}
      <Icon name={KIND_ICON[kind]} className="size-3.5 text-current" />
    </span>
  );
}
