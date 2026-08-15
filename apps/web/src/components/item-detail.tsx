import { mutators, queries } from "@ragbag/contracts";
import { TEXT_ITEM_KINDS, isTextKind } from "@ragbag/shared";
import type { ItemKind, TextItemKind } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DeleteItemDialog } from "@/components/delete-item-dialog";
import { Icon } from "@/components/icon";
import { AddressActions, KindDot } from "@/components/item-card";
import { TagEditor } from "@/components/tag-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mediaBox, rememberBlobAspect, useBlobUrl } from "@/lib/blobs";
import { hostOf, timeLabel } from "@/lib/format";
import { useHeld } from "@/lib/settle";
import { useMeta } from "@/lib/use-meta";

// Route overlay (/item/$id): reader view for links, PDF viewer, image
// lightbox (plan §10), plus the tag editor and favorite/delete/retry actions.
// Rendered above the timeline so scroll position survives.
//
// A Sheet rather than a hand-rolled overlay: focus trap, scroll lock, Esc and
// the slide animation all come from Radix. The route decides whether this
// screen exists; local `open` state decides whether the panel is on screen, so
// that closing can animate before the route change tears the component down.

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
  const [editing, setEditing] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [open, setOpen] = useState(true);

  // Closing has to outlive the route change. Navigating to "/" unmounts this
  // component on the spot, which meant the panel disappeared in a single frame
  // while its overlay was still there — no exit animation at all, unlike the
  // mobile drawer (which is state-driven and slides out properly). So flip
  // `open` first, and let <ExitToTimeline> below leave the route once Radix has
  // taken the panel off screen.
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
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-2xl"
      >
        <ExitToTimeline armed={!open} go={() => void navigate({ to: "/", resetScroll: false })} />

        {/* The visible header below carries the heading; Radix still needs an
            accessible name and description for the dialog itself. */}
        <SheetTitle className="sr-only">{c?.title ?? item?.text ?? "Item"}</SheetTitle>
        <SheetDescription className="sr-only">
          Details, tags and actions for this item.
        </SheetDescription>

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
            {/* header */}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-5 py-3">
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
                  <Button variant="outline" size="sm" asChild>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <Icon name="external" className="size-3.5" /> Open original
                    </a>
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

            <div className="space-y-5 px-5 py-5">
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
                    <Button variant="outline" size="sm" asChild>
                      <a href={blobUrl} download={c?.title ?? "file"}>
                        Download
                      </a>
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
                    type="single"
                    variant="outline"
                    size="sm"
                    value={item.kind}
                    onValueChange={(kind) => {
                      // Radix emits "" when the active item is clicked again;
                      // an item always has a kind, so ignore it.
                      if (kind && kind !== item.kind) {
                        void zero.mutate(
                          mutators.item.setKind({ id: item.id, kind: kind as TextItemKind }),
                        );
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
      </SheetContent>
    </Sheet>
  );
}

/**
 * Leaves the route once the panel is actually gone.
 *
 * Radix holds the sheet mounted through its exit animation and drops it on
 * `animationend`, so this — rendered *inside* the panel — unmounts at exactly
 * that moment. A timer here would be a second copy of the exit duration, kept
 * in step with the CSS by hand and silently wrong the next time the sheet is
 * retimed; that is what it was before.
 *
 * `armed` covers the unmounts that are not a close: StrictMode's double mount
 * in dev, and the panel going away while still open (sign-out, or Back taking
 * the route out from under it).
 */
function ExitToTimeline({ armed, go }: { armed: boolean; go: () => void }) {
  const latest = useRef({ armed, go });
  latest.current = { armed, go };
  useEffect(
    () => () => {
      if (latest.current.armed) latest.current.go();
    },
    [],
  );
  return null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}
