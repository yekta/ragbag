import { mutators, queries } from "@ragbag/contracts";
import { entityLabel } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { TagEditor } from "@/components/tag-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { dayLabel, timeLabel } from "@/lib/format";
import { filterLink, messageLink, useFilter } from "@/lib/routes";
import { useHeld } from "@/lib/settle";

// Route overlay (…/e/$id): everything about one thing the pipeline found.
//
// This is the page that only exists because entities are canonical: without
// the entity/mention split there would be nothing that could answer
// "everything about this parcel", only N copies of it on N messages.

export function EntityDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const zero = useZero();
  const navigate = useNavigate();
  const filter = useFilter();
  const [liveEntity] = useQuery(queries.entity({ id }));
  const [allTags] = useQuery(queries.tags());
  const isMobile = useIsMobile();

  // Opens closed, one frame, for the reason spelled out in message-detail.tsx:
  // Base UI plays no entrance for a popup that was mounted already open.
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (!id) return;
    opened.current = true;
    setOpen(true);
  }, [id]);
  const close = () => setOpen(false);

  const lastEntity = useRef(liveEntity);
  if (liveEntity) lastEntity.current = liveEntity;
  const entity = liveEntity ?? (open ? undefined : lastEntity.current);
  const stillLoading = useHeld(!entity, 250);

  const data = (entity?.data ?? {}) as Record<string, unknown>;
  const structured = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && close()}
      onOpenChangeComplete={(nowOpen) => {
        if (!nowOpen && opened.current) void navigate(filterLink(filter));
      }}
      showSwipeHandle={isMobile}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerContent
        className={
          "data-[swipe-axis=x]:md:[--drawer-content-width:min(42rem,calc(100vw-1rem))] " +
          "md:[--drawer-inset:0.5rem] md:[--drawer-bleed-background:transparent] " +
          "md:rounded-xl md:border"
        }
      >
        <DrawerTitle className="sr-only">
          {entity?.generatedTitle ?? entity?.value ?? "Entity"}
        </DrawerTitle>
        <DrawerDescription className="sr-only">
          What this is, and every message that mentions it.
        </DrawerDescription>

        {!entity ? (
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
            <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
              <span className="text-sm font-medium">{entityLabel(entity.kind)}</span>
              <span className="text-xs text-muted-foreground">
                first seen {dayLabel(entity.firstSeenAt)}
              </span>
              <span className="ml-auto flex items-center gap-1">
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

            <div className="min-h-0 flex-1 space-y-5 scroll-fade-b overflow-x-hidden overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {/* The same card the chat draws, at the top of its own page. */}
              <EntityCard entity={entity} />

              {entity.generatedSummary && (
                <section className="rounded-xl bg-ai-soft p-3.5">
                  <SectionLabel>
                    <span className="flex items-center gap-1 text-ai">
                      <Icon name="sparkles" className="size-3.5" /> Summary
                    </span>
                  </SectionLabel>
                  <p className="text-sm leading-relaxed">{entity.generatedSummary}</p>
                </section>
              )}

              {structured.length > 0 && (
                <section>
                  <SectionLabel>Details</SectionLabel>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {structured.map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="min-w-0 break-words">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section>
                <SectionLabel>Tags</SectionLabel>
                <TagEditor
                  userTagNames={entity.tags
                    .filter((t) => t.source === "user" && t.tag)
                    .map((t) => t.tag!.name)}
                  suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
                  onSave={(names) =>
                    void zero.mutate(mutators.tag.setForEntity({ entityId: entity.id, names }))
                  }
                />
                {entity.tags.some((t) => t.source === "ai" && t.tag) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {entity.tags
                      .filter((t) => t.source === "ai" && t.tag)
                      .map((t) => (
                        <Badge key={t.tagId} className="bg-ai-soft font-normal text-ai">
                          <Icon name="sparkles" className="size-3" />
                          {t.tag!.name}
                        </Badge>
                      ))}
                  </div>
                )}
              </section>

              <section>
                <SectionLabel>
                  Seen in {entity.mentions.length} message{entity.mentions.length === 1 ? "" : "s"}
                </SectionLabel>
                <ul className="flex flex-col gap-1.5">
                  {entity.mentions.map((mention) => (
                    <li key={mention.id}>
                      <div className="flex items-start gap-2 rounded-lg border bg-panel p-3">
                        <Link
                          {...messageLink(mention.messageId, filter)}
                          className="min-w-0 flex-1"
                          onClick={close}
                        >
                          <span className="block truncate text-sm font-medium">
                            {mention.message?.generatedTitle ??
                              mention.message?.text?.split("\n")[0] ??
                              "(no text)"}
                          </span>
                          {mention.snippet && (
                            <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">
                              {mention.snippet}
                            </span>
                          )}
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {mention.message && dayLabel(mention.message.createdAt)}
                            {mention.message && ` · ${timeLabel(mention.message.createdAt)}`}
                            {mention.attachment && ` · found in ${mention.attachment.filename}`}
                            {mention.source === "regex" && " · pattern match"}
                          </span>
                        </Link>
                        {/* The tombstone that makes re-ingestion safe: dismiss a
                            hallucinated address once and it stays dismissed
                            through every future run (plan §2.3). */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground"
                          title="Not really here: dismiss this mention"
                          onClick={() =>
                            void zero.mutate(
                              mutators.entity.dismiss({
                                messageId: mention.messageId,
                                entityId: entity.id,
                                attachmentId: mention.attachmentId ?? null,
                              }),
                            )
                          }
                        >
                          <Icon name="dismiss" className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
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
