import { mutators, queries } from "@ragbag/contracts";
import { TEXT_ITEM_KINDS, isTextKind } from "@ragbag/shared";
import type { ItemKind, TextItemKind } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { DeleteItemDialog } from "@/components/delete-item-dialog";
import { Icon } from "@/components/icon";
import { AddressActions, KindDot } from "@/components/item-card";
import { TagEditor } from "@/components/tag-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { mediaBox, rememberBlobAspect, useBlobUrl } from "@/lib/blobs";
import { hostOf, timeLabel } from "@/lib/format";
import { useHeld } from "@/lib/settle";
import { useMeta } from "@/lib/use-meta";

// Route overlay (/item/$id): reader view for links, PDF viewer, image
// lightbox (plan §10), plus the tag editor and favorite/delete/retry actions.
// Rendered above the timeline so scroll position survives.
//
// A Drawer rather than a hand-rolled overlay: focus trap, scroll lock, Esc,
// swipe-to-dismiss and the slide animation all come from Base UI. One
// component covers both form factors — it opens from the bottom on a phone
// (with a swipe handle) and from the right as an inset floating card at `md`+,
// which is the same floating-card language the sidebar uses at that
// breakpoint.
//
// The route decides whether this screen exists; local `open` state decides
// whether the panel is on screen, so that closing can animate before the route
// change tears the component down.

const TEXT_SECTION_LABEL: Partial<Record<ItemKind, string>> = {
  note: "Note",
  todo: "Todo",
  address: "Address",
};

export function ItemDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const zero = useZero();
  const navigate = useNavigate();
  const [liveItem] = useQuery(queries.item({ id }));
  const [allTags] = useQuery(queries.tags());
  const meta = useMeta();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  // Opens closed, one frame. Base UI decides whether to play an entrance from
  // `mounted` being seeded with `open` (internals/useTransitionStatus.mjs):
  //
  //   const [mounted, setMounted] = useState(open);
  //   if (open && !mounted) { setMounted(true); setTransitionStatus('starting'); }
  //
  // Mount with `open` already true and `mounted` is true on the same render, so
  // that branch never runs, `data-starting-style` is never applied, and the
  // popup is inserted straight at its resting transform — no entrance at all.
  // Closing still animates, because `open` genuinely changes there. That is the
  // whole of "opens abruptly but closes with an animation": the route mounts
  // this component with the drawer already open, which is the one case Base UI
  // reads as "was always there".
  //
  // So hand it a real false → true. `useLayoutEffect`, not `useEffect`: the
  // flip is flushed before paint, so the closed frame is never drawn — the
  // entrance starts from the first frame anyone sees.
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => setOpen(true), []);

  // Closing has to outlive the route change. Navigating to "/" unmounts this
  // component on the spot, which meant the panel disappeared in a single frame
  // while its overlay was still there — no exit animation at all. So flip
  // `open` first and leave the route once the panel is actually gone.
  //
  // "Actually gone" is `onOpenChangeComplete`, not a timer. This used to be a
  // setTimeout hand-synced to the Sheet's exit duration; under Base UI there is
  // no constant to sync to, because a flicked drawer exits in
  // `calc(var(--drawer-swipe-strength) * 400ms)` — the harder the swipe, the
  // faster it leaves.
  //
  // `opened` gates it: the drawer now starts closed, and a `false` completion
  // that arrives before it has ever been open would navigate away from the
  // screen we are in the middle of opening.
  const opened = useRef(false);
  const close = () => setOpen(false);

  // Deleting from here drops the row from the local store immediately, so
  // while the panel slides out there is nothing left to render. Keep painting
  // the last copy rather than flashing the loading state on the way out.
  const lastItem = useRef(liveItem);
  if (liveItem) lastItem.current = liveItem;
  const item = liveItem ?? (open ? undefined : lastItem.current);
  const blobUrl = useBlobUrl(item?.blobId);
  // The item is in the local store, so it is normally here before the sheet has
  // finished sliding in. A spinner for that frame is noise; one only appears if
  // the wait turns out to be real.
  const stillLoading = useHeld(!item, 250);

  const c = item?.content;
  const host = hostOf(item?.url);
  const done = Boolean(item?.completedAt);

  const saveText = () => {
    if (!item) return;
    setEditing(false);
    if (textDraft.trim() !== (item.text ?? "")) {
      void zero.mutate(mutators.item.edit({ id: item.id, text: textDraft.trim() }));
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && close()}
      onOpenChangeComplete={(nowOpen) => {
        if (nowOpen) {
          opened.current = true;
        } else if (opened.current) {
          void navigate({ to: "/", resetScroll: false });
        }
      }}
      // Bottom sheet on a phone, right-hand panel on a desktop — and the handle
      // only where there is a thumb to drag it with.
      showSwipeHandle={isMobile}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerContent
        className={
          // Desktop: an inset floating card rather than a panel welded to the
          // edge. `--drawer-inset` becomes the popup's margin and is already
          // folded into its closed transform, so it still slides fully
          // off-screen. 42rem is the reading column this view has always had.
          //
          // The compound `data-[swipe-axis=x]:md:` shape matches the width rule
          // it overrides — the vendored component sets 24rem at `sm:`, and a
          // bare `md:` would be racing it on source order rather than beating
          // it. Rounding is additive: the popup rounds only its leading edge
          // for a flush panel, `md:rounded-xl md:border` closes the other three.
          //
          // The bleed has to go with the inset. It is the popup's `::after`: a
          // `--bleed`-wide (3rem) band of `--popover` parked at `left-full`, so
          // that dragging the drawer back from its resting place does not open
          // a gap onto the page. Welded to the edge it is off-screen and never
          // seen. Inset, `left-full` is 0.5rem short of the edge — so it fills
          // the margin instead, and the floating card grows a full-height strip
          // of its own background down its right side, which is what the drawer
          // looked wrong for. An inset card has no gap to hide: the page is
          // *meant* to show in that margin, so there is nothing for the bleed
          // to do but be visible.
          "data-[swipe-axis=x]:md:[--drawer-content-width:min(42rem,calc(100vw-1rem))] " +
          "md:[--drawer-inset:0.5rem] md:[--drawer-bleed-background:transparent] " +
          "md:rounded-xl md:border"
        }
      >
        {/* The visible header below carries the heading; the dialog still needs
            an accessible name and description of its own. */}
        <DrawerTitle className="sr-only">{c?.title ?? item?.text ?? "Item"}</DrawerTitle>
        <DrawerDescription className="sr-only">
          Details, tags and actions for this item.
        </DrawerDescription>

        {!item ? (
          stillLoading && (
            <div
              role="status"
              className="flex h-40 items-center justify-center text-muted-foreground"
            >
              <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
            </div>
          )
        ) : (
          <>
            {/* Header. Was `sticky top-0` when the whole panel was one scroll
                box; the drawer is a flex column with its own scrolling body
                below, so the header simply doesn't scroll. */}
            <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
              <KindDot kind={item.kind} />
              <span className="text-sm font-medium capitalize">{item.kind}</span>
              {item.kind === "todo" && (
                <Button
                  role="checkbox"
                  aria-checked={done}
                  size="xs"
                  variant={done ? "default" : "outline"}
                  className={done ? "bg-kind-todo text-background hover:bg-kind-todo-hover" : ""}
                  onClick={() =>
                    void zero.mutate(mutators.item.setDone({ id: item.id, done: !done }))
                  }
                >
                  <Icon name="check" className="size-3.5" />
                  {done ? "Done" : "Mark done"}
                </Button>
              )}
              <time className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleDateString()} · {timeLabel(item.createdAt)}
              </time>
              <span className="ml-auto flex items-center gap-1">
                {item.url && (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<a href={item.url} target="_blank" rel="noreferrer" />}
                  >
                    <Icon name="external" className="size-3.5" /> Open original
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={item.favorite ? "Remove from favorites" : "Add to favorites"}
                  className={item.favorite ? "text-kind-note" : "text-muted-foreground"}
                  onClick={() =>
                    void zero.mutate(
                      mutators.item.setFavorite({ id: item.id, favorite: !item.favorite }),
                    )
                  }
                >
                  <Icon name="star" className="size-4" filled={item.favorite} />
                </Button>
                <DeleteItemDialog
                  onConfirm={() => {
                    void zero.mutate(mutators.item.delete({ id: item.id }));
                    close();
                  }}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete"
                    className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                  >
                    <Icon name="trash" className="size-4" />
                  </Button>
                </DeleteItemDialog>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Close (Esc)"
                  className="text-muted-foreground"
                  onClick={close}
                >
                  <Icon name="x" className="size-4" />
                </Button>
              </span>
            </div>

            {/* The scroller. DrawerContent is `overflow-hidden` by
                construction, so this is what actually scrolls. `scroll-fade`
                (a mask, not a wrapper — safe here) softens both edges.
                `overflow-x-hidden` is not redundant: asking for `overflow-y`
                alone computes the other axis from `visible` to `auto`, so this
                was a sideways scroller too, and anything that outgrew the
                column — a filename with no spaces in it, before `body` learned
                to break words — could drag the whole panel off its own edge. */}
            <div className="min-h-0 flex-1 space-y-5 scroll-fade overflow-x-hidden overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {/* hero */}
              {item.kind === "image" &&
                (blobUrl ? (
                  <img
                    src={blobUrl}
                    alt={c?.title ?? "image"}
                    style={mediaBox(item.blobId, "70vh")}
                    className="max-h-[70vh] w-full rounded-xl border object-contain"
                    onLoad={(e) => rememberBlobAspect(item.blobId, e.currentTarget)}
                  />
                ) : (
                  // Same box as the image that replaces it, whenever this
                  // device has seen it before — so nothing below it moves.
                  <Skeleton
                    style={mediaBox(item.blobId, "70vh")}
                    className={`flex items-center justify-center rounded-xl text-muted-foreground ${
                      mediaBox(item.blobId, "70vh") ? "" : "h-64"
                    }`}
                  >
                    <Icon name="image" className="size-8" />
                  </Skeleton>
                ))}
              {item.kind === "pdf" &&
                (blobUrl ? (
                  <iframe
                    src={blobUrl}
                    title={c?.title ?? "PDF"}
                    className="h-[70vh] w-full rounded-xl border"
                  />
                ) : (
                  <Skeleton className="flex h-40 items-center justify-center rounded-xl text-muted-foreground">
                    <Icon name="pdf" className="size-8" />
                  </Skeleton>
                ))}
              {item.kind === "file" && (
                <div className="flex items-center gap-3 rounded-xl border bg-panel p-4">
                  <Icon name="file" className="size-8 text-kind-file" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c?.title ?? "File"}</p>
                    <p className="text-xs text-muted-foreground">Stored in your ragbag</p>
                  </div>
                  {blobUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<a href={blobUrl} download={c?.title ?? "file"} />}
                    >
                      Download
                    </Button>
                  )}
                </div>
              )}
              {item.kind === "link" && c?.imageUrl && (
                <img
                  src={c.imageUrl}
                  alt=""
                  className="max-h-72 w-full rounded-xl border object-cover"
                />
              )}

              {/* title + site */}
              {(c?.title || item.url) && (
                <div>
                  <h1 className="text-xl font-semibold leading-snug">{c?.title ?? item.url}</h1>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {c?.faviconUrl && (
                        <img src={c.faviconUrl} alt="" className="size-4 rounded-sm" />
                      )}
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
                    <Textarea
                      className="min-h-28 leading-relaxed"
                      value={textDraft}
                      autoFocus
                      onChange={(e) => setTextDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveText();
                      }}
                    />
                    <div className="mt-1 flex gap-2">
                      <Button size="sm" onClick={saveText}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="-m-1 cursor-text rounded-xl border border-transparent p-1 hover:border-border"
                    onClick={() => {
                      setTextDraft(item.text ?? "");
                      setEditing(true);
                    }}
                    title="Click to edit"
                  >
                    {item.text ? (
                      <p
                        className={`whitespace-pre-wrap leading-relaxed ${
                          done ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        {item.text}
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        Click to add a comment…
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Reclassify: a dumped thought that turned out to be a todo, or an
                  address ingestion guessed wrong about. Text kinds only. */}
              {isTextKind(item.kind) && (
                <section>
                  <SectionLabel>Type</SectionLabel>
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    value={[item.kind]}
                    onValueChange={(kinds) => {
                      // Base UI has no `type="single"`: the value is always an
                      // array, and clicking the active item empties it. An item
                      // always has a kind, so ignore that.
                      const kind = kinds[0] as TextItemKind | undefined;
                      if (kind && kind !== item.kind) {
                        void zero.mutate(mutators.item.setKind({ id: item.id, kind }));
                      }
                    }}
                  >
                    {TEXT_ITEM_KINDS.map((kind) => (
                      <ToggleGroupItem key={kind} value={kind} className="px-3 capitalize">
                        {kind}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </section>
              )}

              {/* AI summary */}
              {c?.aiSummary && (
                <section className="rounded-xl bg-ai-soft p-3.5">
                  <SectionLabel>
                    <span className="flex items-center gap-1 text-ai">
                      <Icon name="sparkles" className="size-3.5" /> Summary
                    </span>
                  </SectionLabel>
                  <p className="text-sm leading-relaxed">{c.aiSummary}</p>
                </section>
              )}

              {/* tags */}
              <section>
                <SectionLabel>Tags</SectionLabel>
                <TagEditor
                  itemId={item.id}
                  userTagNames={item.itemTags
                    .filter((t) => t.source === "user" && t.tag)
                    .map((t) => t.tag!.name)}
                  suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
                />
                {item.itemTags.some((t) => t.source === "ai" && t.tag) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {item.itemTags
                      .filter((t) => t.source === "ai" && t.tag)
                      .map((t) => (
                        <Badge
                          key={t.tagId}
                          className="bg-ai-soft font-normal text-ai"
                          title={`AI ${t.tag!.kind} tag`}
                        >
                          <Icon name="sparkles" className="size-3" />
                          {t.tag!.name}
                        </Badge>
                      ))}
                  </div>
                )}
              </section>

              {/* ingestion state */}
              {c?.status === "failed" && (
                <Alert variant="destructive">
                  <AlertTitle>Ingestion failed</AlertTitle>
                  <AlertDescription>
                    {c.error && <p>{c.error}</p>}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void zero.mutate(mutators.item.retryIngest({ id: item.id }))}
                    >
                      <Icon name="retry" className="size-3.5" /> Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {(c?.status === "pending" || c?.status === "processing") && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon name="spinner" className="size-3.5 animate-spin [animation-duration:2s]" />
                  {c.status === "processing"
                    ? "Reading and enriching this item…"
                    : "Queued for ingestion…"}
                </p>
              )}
              {/* Enrichment that finished with nothing to show. Silence here
                  read as a broken app for a full day (the server had no
                  OpenAI key), so absence now explains itself and offers the
                  re-run that already existed for outright failures. */}
              {c?.status === "done" && !c.aiSummary && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Icon name="sparkles" className="size-3.5 shrink-0" />
                  <span>
                    {c.error ??
                      (meta && !meta.ai
                        ? "AI enrichment is off on this server — no summary or tags."
                        : "No AI summary for this item yet.")}
                  </span>
                  {meta?.ai !== false && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void zero.mutate(mutators.item.retryIngest({ id: item.id }))}
                    >
                      <Icon name="retry" className="size-3" /> Run enrichment
                    </Button>
                  )}
                </div>
              )}

              {/* reader view */}
              {c?.extractedText && (
                <section>
                  <SectionLabel>Extracted content</SectionLabel>
                  <div className="space-y-3 rounded-xl border bg-panel p-4 text-[15px] leading-relaxed">
                    {c.extractedText.split(/\n{2,}/).map((para, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {para}
                      </p>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}
