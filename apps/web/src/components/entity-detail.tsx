import { mutators, queries } from "@ragbag/contracts";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EntityCard } from "@/components/entities";
import { Icon, iconNamed } from "@/components/icon";
import { TagEditor } from "@/components/tag-editor";
import { SectionHeading } from "@/components/typography";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEntityTypes } from "@/lib/entity-types";
import { dayLabel, timeLabel } from "@/lib/format";
import { runMutation } from "@/lib/mutate";
import { closePanelLink, messageLink } from "@/lib/routes";
import { useHeld } from "@/lib/settle";

// The thing panel (`?entity=<id>`): everything about one thing the pipeline
// found, over whichever view it was opened from (lib/routes.ts).
//
// This is the page that only exists because entities are canonical: without
// the entity/mention split there would be nothing that could answer
// "everything about this parcel", only N copies of it on N messages.

export function EntityDetail({ id }: { id: string }) {
  const zero = useZero();
  const navigate = useNavigate();
  const types = useEntityTypes();
  const [liveEntity] = useQuery(queries.entity({ id }));
  const [allTags] = useQuery(queries.tags());
  const isMobile = useIsMobile();

  // Opens closed, one frame, for the reason spelled out in message-detail.tsx:
  // Base UI plays no entrance for a popup that was mounted already open.
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useLayoutEffect(() => {
    opened.current = true;
    setOpen(true);
  }, [id]);
  const close = () => setOpen(false);

  const [confirming, setConfirming] = useState(false);
  // Deleting closes the panel, because what it was showing is gone. The dialog
  // is dismissed first rather than left hanging over a drawer sliding out, and
  // a refusal leaves both the panel and the thing where they were.
  const remove = async (entityId: string) => {
    setConfirming(false);
    try {
      await runMutation(zero.mutate(mutators.entity.remove({ id: entityId })));
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this");
    }
  };

  const lastEntity = useRef(liveEntity);
  if (liveEntity) lastEntity.current = liveEntity;
  const entity = liveEntity ?? (open ? undefined : lastEntity.current);
  const stillLoading = useHeld(!entity, 250);

  const data = (entity?.data ?? {}) as Record<string, unknown>;
  // The type's own fields, in the order it declares them, under the labels it
  // gives them: "Postal Code", not `postalCode` in whatever order the jsonb
  // happened to hold. A key the type no longer declares still shows, humanized,
  // at the end, so editing a type never blanks data that is already stored.
  const structured = entity ? types.fieldEntries(entity.kind, data) : [];

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && close()}
      onOpenChangeComplete={(nowOpen) => {
        if (!nowOpen && opened.current) void navigate(closePanelLink);
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
        {/* The header names the surface: the kind's own icon and the kind's own
            label, the pair the sidebar's row for it already uses. Not the
            thing's title, which is the first line of the card below and would
            otherwise be said twice.

            Drawn whether or not the row has landed, so the drawer has a name
            in the frame the store is still answering in. Until it does there
            is no kind to name, and the fallback is the one every unknown kind
            already gets: the generic sparkle (components/icon.tsx). */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <DrawerTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
            <Icon
              name={entity ? iconNamed(types.icon(entity.kind)) : "sparkles"}
              className="size-4.5 shrink-0"
            />
            <span className="truncate">{entity ? types.label(entity.kind) : "Thing"}</span>
          </DrawerTitle>
          {entity && (
            <span className="truncate text-xs text-muted-foreground">
              First seen {dayLabel(entity.firstSeenAt)}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
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
          <DrawerBody className="space-y-8">
            {/* The same card the chat draws, at the top of its own page. */}
            <EntityCard entity={entity} />

            {entity.generatedSummary && (
              <section className="rounded-xl bg-ai-soft p-3.5">
                <SectionHeading className="text-ai">
                  <span className="flex items-center gap-1">
                    <Icon name="sparkles" className="size-3.5" /> Summary
                  </span>
                </SectionHeading>
                <p className="text-sm leading-relaxed">{entity.generatedSummary}</p>
              </section>
            )}

            {structured.length > 0 && (
              <section>
                <SectionHeading>Details</SectionHeading>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {structured.map((entry) => (
                    <div key={entry.name} className="contents">
                      <dt className="text-muted-foreground">{entry.label}</dt>
                      <dd className="min-w-0 break-words">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section>
              <SectionHeading>Tags</SectionHeading>
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
              <SectionHeading>
                Seen in {entity.mentions.length} message{entity.mentions.length === 1 ? "" : "s"}
              </SectionHeading>
              <ul className="flex flex-col gap-1.5">
                {entity.mentions.map((mention) => (
                  <li key={mention.id}>
                    {/* The whole row goes to the message. It used to share the
                          row with an eye that deleted the thing, which read as
                          an action on the message it sat on. */}
                    <Link
                      {...messageLink(mention.messageId)}
                      className="block rounded-lg border bg-panel p-3 transition hover:bg-panel-hover"
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
                  </li>
                ))}
              </ul>
            </section>

            {/* Its own section, because deleting the thing is about the thing.
                  The confirmation says what survives it: the messages. */}
            <section>
              <SectionHeading>Delete</SectionHeading>
              <p className="text-[13px] text-muted-foreground">
                {/* The kind wears the card's own border and fill, because
                      "Deletes this Email" reads as a message otherwise: the
                      chip is what says it is a kind of thing. */}
                Deletes this{" "}
                <span className="rounded-md border bg-panel px-1.5 py-0.5 text-foreground">
                  {types.label(entity.kind)}
                </span>{" "}
                everywhere.{" "}
                {entity.mentions.length === 1
                  ? "The message it was found in stays."
                  : "The messages it was found in stay."}
              </p>
              <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger
                  render={
                    <Button variant="destructive" size="sm" className="mt-2">
                      <Icon name="trash" className="size-3.5" /> Delete
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this {types.label(entity.kind)}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It disappears from all your devices, with its tags and everything found about
                      it. The messages it was found in stay, and reading them again won&rsquo;t
                      bring it back. This can&rsquo;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => void remove(entity.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          </DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  );
}
