import { mutators, queries } from "@ragbag/contracts";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import {
  AttachmentAlbum,
  AttachmentRetry,
  AttachmentThumb,
  AudioPlayerScope,
} from "@/components/attachment-album";
import { DeleteMessageDialog } from "@/components/delete-message-dialog";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { Linkified, messageEntities } from "@/components/message-card";
import { PhotoViewerScope } from "@/components/photo-viewer";
import { TagEditor } from "@/components/tag-editor";
import { SectionHeading } from "@/components/typography";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { dayLabel, formatBytes, timeLabel } from "@/lib/format";
import { attachmentLink, closePanelLink, entityLink } from "@/lib/routes";
import { useHeld } from "@/lib/settle";
import { useMeta } from "@/lib/use-meta";
import type { TDetailAttachment, TMessageDetail as MessageDetailRow } from "@/lib/types";

// The message panel (`?message=<id>`): everything about one message. Rendered
// above the timeline so scroll position survives.
//
// Two parts, in the order the timeline card has them: the message exactly as
// it was sent, then everything that came out of it. The card is the contract,
// so the attachments here go through the same album component rather than a
// second layout of this view's own, and nothing the pipeline wrote appears
// above the words and files a person actually sent.
//
// It used to run title, text, summary, attachments, which put two pieces of
// machine writing above the photo the message *was*, and left no way to tell
// by looking which half of the screen someone had written. The panel's job
// over the card is depth, not a different shape: the transcripts, the
// extracted text, the per-part errors and retries, the tag editor and the AI
// tags a card has no room for.
//
// A key in the query string rather than a segment on the path (lib/routes.ts),
// so the view it was opened from is untouched underneath it: closing goes back
// to `/images`, not to the whole archive, and `/images?message=<id>` opens it
// over the images view for whoever follows the link.
//
// A Drawer rather than a hand-rolled overlay: focus trap, scroll lock, Esc,
// swipe-to-dismiss and the slide animation all come from Base UI. One
// component covers both form factors: it opens from the bottom on a phone
// (with a swipe handle) and from the right as an inset floating card at `md`+,
// which is the same floating-card language the sidebar uses at that
// breakpoint.
//
// The URL decides whether this screen exists (the shell mounts it on the param,
// app.tsx); local `open` state decides whether the panel is on screen, so that
// closing can animate before the navigation tears the component down.

export function MessageDetail({ id }: { id: string }) {
  const zero = useZero();
  const navigate = useNavigate();
  const [liveMessage] = useQuery(queries.message({ id }));
  const [allTags] = useQuery(queries.tags());
  const meta = useMeta();
  const isMobile = useIsMobile();
  // Opens closed, one frame. Base UI decides whether to play an entrance from
  // `mounted` being seeded with `open` (internals/useTransitionStatus.mjs):
  //
  //   const [mounted, setMounted] = useState(open);
  //   if (open && !mounted) { setMounted(true); setTransitionStatus('starting'); }
  //
  // Mount with `open` already true and `mounted` is true on the same render, so
  // that branch never runs, `data-starting-style` is never applied, and the
  // popup is inserted straight at its resting transform, no entrance at all.
  // Closing still animates, because `open` genuinely changes there. That is the
  // whole of "opens abruptly but closes with an animation": the shell mounts
  // this component with the drawer already open, which is the one case Base UI
  // reads as "was always there".
  //
  // So hand it a real false → true. `useLayoutEffect`, not `useEffect`: the
  // flip is flushed before paint, so the closed frame is never drawn.
  //
  // Keyed on `id`, not on mount. Opening another message from this panel swaps
  // the param and keeps the component mounted, so a mount-only effect would
  // open the drawer for whichever message happened to mount it and never again.
  const [open, setOpen] = useState(false);
  // Set when the open is *requested*, which is what makes the exit below safe
  // to act on. It used to be set when the entrance *completed*, and an entrance
  // that never completes is exactly what happens when the drawer is dismissed
  // while it is still sliding in: Base UI drops the pending completion, the
  // exit reports `false` to a gate that was never opened, and the navigation
  // home never runs.
  const opened = useRef(false);
  useLayoutEffect(() => {
    opened.current = true;
    setOpen(true);
  }, [id]);

  const close = () => setOpen(false);

  // Deleting from here drops the row from the local store immediately, so
  // while the panel slides out there is nothing left to render. Keep painting
  // the last copy rather than flashing the loading state on the way out.
  const lastMessage = useRef(liveMessage);
  if (liveMessage) lastMessage.current = liveMessage;
  const message = liveMessage ?? (open ? undefined : lastMessage.current);
  // The message is in the local store, so it is normally here before the
  // drawer has finished sliding in. A spinner for that frame is noise; one
  // only appears if the wait turns out to be real.
  const stillLoading = useHeld(!message, 250);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && close()}
      onOpenChangeComplete={(nowOpen) => {
        if (!nowOpen && opened.current) void navigate(closePanelLink);
      }}
      // Bottom sheet on a phone, right-hand panel on a desktop, and the handle
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
          "data-[swipe-axis=x]:md:[--drawer-content-width:min(42rem,calc(100vw-1rem))] " +
          "md:[--drawer-inset:0.5rem] md:[--drawer-bleed-background:transparent] " +
          "md:rounded-xl md:border"
        }
      >
        {/* The header. The drawer is a flex column with its own scrolling body
            below, so this simply doesn't scroll.

            It names the surface, the way the settings drawer and the thing
            panel next door do: the icon the sidebar's row uses, then the word
            for the one thing on screen. Singular, because that is what this
            is: the sidebar's row is a list and says "Messages", the file panel
            beside this one says "Image" over one image, and a panel holding
            one message that called itself TMessages was naming the list it came
            out of. It is the DrawerTitle itself rather than a span beside a
            screen-reader-only copy of the same words, so there is exactly one
            name in the accessibility tree.

            What it does not say is what this particular message is. The
            model's title for it is a reading of the message and belongs with
            the rest of the reading, down in Summary; when it was sent and
            where it lives are part of the message and are drawn with it. A
            header that took its words from the message would also be the one
            part of the panel that moved when you stepped from one to the next.

            Drawn whether or not the row has landed, so the drawer has a name
            in the frame the store is still answering in. Only the actions
            wait, having nothing to act on until then. */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <DrawerTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Icon name="inbox" className="size-4.5" /> Message
          </DrawerTitle>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {message && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={message.favorite ? "Remove from favorites" : "Add to favorites"}
                  className={message.favorite ? "text-kind-note" : "text-muted-foreground"}
                  onClick={() =>
                    void zero.mutate(
                      mutators.message.setFavorite({
                        id: message.id,
                        favorite: !message.favorite,
                      }),
                    )
                  }
                >
                  <Icon name="star" className="size-4" filled={message.favorite} />
                </Button>
                <DeleteMessageDialog
                  onConfirm={() => {
                    void zero.mutate(mutators.message.delete({ id: message.id }));
                    close();
                  }}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete"
                    className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive active:bg-destructive-soft active:text-destructive"
                  >
                    <Icon name="trash" className="size-4" />
                  </Button>
                </DeleteMessageDialog>
              </>
            )}
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
          Everything in this message, its tags, and what was found in it.
        </DrawerDescription>

        {!message ? (
          stillLoading && (
            <div
              role="status"
              className="flex h-40 items-center justify-center text-muted-foreground"
            >
              <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
            </div>
          )
        ) : (
          /* The scroller. DrawerContent is `overflow-hidden` by
             construction, so this is what actually scrolls. The bottom-only
             fade (a mask, not a wrapper, safe here) says "there is more
             below"; the top edge stays hard, because it butts against the
             header rather than against the panel's own rounding, and fading
             content out into a solid bar reads as a rendering fault.
             `overflow-x-hidden` is not redundant: asking for `overflow-y`
             alone computes the other axis from `visible` to `auto`.

             Section to section is 32px, which is the rhythm settings already
             had (components/settings/settings.tsx) rather than a third
             value invented here. At 20px the summary, the things found and
             the attachments ran together into one column of text, and the
             headings had to carry the whole job of saying where one ended:
             a panel is read by its gaps before it is read by its type. */
          <AudioPlayerScope>
            {/* Both scopes wrap the whole body rather than the album alone:
                a picture is opened from the album at the top and from its
                own row further down, and those are two subtrees. */}
            <PhotoViewerScope attachments={message.attachments}>
              <DrawerBody className="space-y-8">
                {/* The message, first, whatever it is made of: a paragraph, a
                  photo, a voice note, all three, or one file and nothing
                  else. No heading over it, because it is not a section of
                  the page: it is the thing the page is about.

                  Same parts in the same order as the card, ending the same
                  way: words, files, then the time it was sent
                  (components/message-card.tsx). The card is a card and this
                  is not, and the stamp sits left here rather than right,
                  because there is no card edge on this side of the panel for
                  it to hang off. Everything else about it is the card's. */}
                <div className="space-y-2">
                  {message.text && (
                    // The card's correction, for the same reason: half-leading
                    // over the first line would otherwise sit the text lower
                    // than the panel insets it from the left.
                    <p className="-mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                      <Linkified text={message.text} />
                    </p>
                  )}
                  <AttachmentAlbum attachments={message.attachments} variant="detail" />
                  <div className="flex flex-col items-start gap-2">
                    {/* The day the way the timeline says it, then the time the
                        way the card says it: this is the same message, so the
                        stamp under it open should be the words you would have
                        read on it in the chat. It was `toLocaleDateString`,
                        which is the one place in the app that answered
                        "8/19/2026" where every other surface says "Yesterday"
                        (the thing panel and the file panel already pair these
                        two). The exact stamp is still a second away, on hover. */}
                    <time
                      className="font-mono text-[11px] text-muted-foreground"
                      title={new Date(message.createdAt).toLocaleString()}
                    >
                      {dayLabel(message.createdAt)} · {timeLabel(message.createdAt)}
                    </time>
                    {/* Every thing-shaped view still gets you home (plan
                        §8.2). The id rides in the hash, so this is a real URL
                        someone can share rather than a piece of transient
                        state, and the timeline scrolls to it and points at it
                        (components/timeline.tsx).

                        Under the stamp, because it is about *this* message
                        and belongs where the message ends, not in a bar over
                        it. */}
                    <Button
                      variant="outline"
                      size="sm"
                      // A hair further from the stamp than the column's own
                      // gap: a line of 11px text and a 32px control read as
                      // closer than they measure, the text being mostly the
                      // space around it.
                      className="mt-0.5"
                      onClick={() =>
                        void navigate({
                          to: "/{-$view}",
                          params: { view: undefined },
                          hash: message.id,
                          resetScroll: false,
                        })
                      }
                    >
                      <Icon name="inbox" className="size-3.5" /> Show in TMessages
                    </Button>
                  </div>
                </div>

                {/* The seam. Everything below it is *about* the message rather
                  than part of it, which is the job the tear line does on the
                  card (message-card.tsx). Dashed for the same reason it is
                  perforated there; the notches are not reproduced, because
                  they are discs of page colour punched out of a card, and
                  this panel is already the card. */}
                <hr className="border-dashed" />

                {/* What the model wrote. The generated title lives here, with
                  the rest of it, rather than as this panel's h1: it names
                  what the message is about, which is a reading of the
                  message, not the message. */}
                {(message.generatedTitle || message.generatedSummary) && (
                  <section className="rounded-xl bg-ai-soft p-3.5">
                    <SectionHeading className="text-ai">
                      <span className="flex items-center gap-1">
                        <Icon name="sparkles" className="size-3.5" /> Summary
                      </span>
                    </SectionHeading>
                    {message.generatedTitle && (
                      <p className="font-semibold leading-snug">{message.generatedTitle}</p>
                    )}
                    {message.generatedSummary && (
                      <p
                        className={`text-sm leading-relaxed ${message.generatedTitle ? "mt-1" : ""}`}
                      >
                        {message.generatedSummary}
                      </p>
                    )}
                  </section>
                )}

                {/* the same things the card lists under its tear */}
                <ThingsFound message={message} />

                {/* Everything sent with the message, in the order it was
                  sent, under one heading.

                  Each file used to head its own section, which put a
                  filename at the same size as "Things Found"
                  and "Tags" and made a message with five photos in it read
                  as five sections of the page rather than one list of five
                  things. A filename is a row. The heading over the rows is
                  what belongs at that size. */}
                {message.attachments.length > 0 && (
                  <section>
                    {/* Plural at one file too. Every other heading on this
                        page is a fixed label, and a heading that changes its
                        wording with the count reads as a different section
                        rather than the same one holding fewer things. */}
                    <SectionHeading>Attachments</SectionHeading>
                    {/* Rows, so a plain gap and no rules between them. The
                        divider was there when each entry was a block of
                        findings that needed ending; a list of rows that all
                        look alike says where one stops by itself. */}
                    <div className="flex flex-col gap-1.5">
                      {message.attachments.map((attachment) => (
                        <AttachmentFindings key={attachment.id} attachment={attachment} />
                      ))}
                    </div>
                  </section>
                )}

                {/* tags */}
                <section>
                  <SectionHeading>Tags</SectionHeading>
                  <TagEditor
                    userTagNames={message.tags
                      .filter((t) => t.source === "user" && t.tag)
                      .map((t) => t.tag!.name)}
                    suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
                    onSave={(names) =>
                      void zero.mutate(mutators.tag.setForMessage({ messageId: message.id, names }))
                    }
                  />
                  {message.tags.some((t) => t.source === "ai" && t.tag) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {message.tags
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
                {message.status === "failed" && (
                  <Alert variant="destructive">
                    <AlertTitle>Ingestion failed</AlertTitle>
                    <AlertDescription>
                      {message.error && <p>{message.error}</p>}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() =>
                          void zero.mutate(mutators.message.retryIngest({ id: message.id }))
                        }
                      >
                        <Icon name="retry" className="size-3.5" /> Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {(message.status === "pending" || message.status === "processing") && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon
                      name="spinner"
                      className="size-3.5 animate-spin [animation-duration:2s]"
                    />
                    {message.status === "processing"
                      ? "Reading this message…"
                      : "Queued for ingestion…"}
                  </p>
                )}
                {/* Enrichment that finished with nothing to show. Silence here
                read as a broken app for a full day (the server had no
                OpenAI key), so absence now explains itself and offers the
                re-run that already existed for outright failures. */}
                {(message.status === "done" || message.status === "partial") &&
                  !message.generatedSummary && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Icon name="sparkles" className="size-3.5 shrink-0" />
                      <span>
                        {message.error ??
                          (meta && !meta.ai
                            ? "AI is off on this server, so there are no summaries, tags or entities."
                            : "No summary for this message yet.")}
                      </span>
                      {meta?.ai !== false && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() =>
                            void zero.mutate(mutators.message.retryIngest({ id: message.id }))
                          }
                        >
                          <Icon name="retry" className="size-3" /> Run enrichment
                        </Button>
                      )}
                    </div>
                  )}
              </DrawerBody>
            </PhotoViewerScope>
          </AudioPlayerScope>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The things this message mentions, exactly the set the card shows under its
 * tear and drawn with the same cards. The panel had never shown them at all,
 * so an address the timeline listed vanished when you opened the message it
 * was found in.
 */
function ThingsFound({ message }: { message: NonNullable<MessageDetailRow> }) {
  const navigate = useNavigate();
  const entities = messageEntities(message.mentions);
  if (entities.length === 0) return null;

  return (
    <section>
      <SectionHeading>Things TFound</SectionHeading>
      <div className="flex flex-col gap-1.5">
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onOpen={() => void navigate(entityLink(entity.id))}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One attachment, as a row into its own page.
 *
 * The file itself is not here: it is up in the message, where it was sent.
 * Neither is what came out of it, any more. A file is one of the things this
 * app keeps and has a page of its own now (components/attachment-detail.tsx),
 * so the transcript, the extracted text and the file's own tags live there,
 * and this is the row that goes to them.
 *
 * What stays is what a reader of the *message* needs without leaving it: which
 * files came with it, and the sentence the pipeline wrote about each one. A
 * message with an hour of audio in it used to print the whole transcript in
 * the middle of the panel, which buried the tags and the things found under
 * it and put the same text in two places once the file had a page.
 *
 * A picture nobody has read yet still gets its row: the list is named
 * "Attachments", so a message with five photos and three summaries has to show
 * five rows or the two that were quietly dropped read as a bug.
 *
 * A row's title is 14/500 (components/typography.tsx), the step the scale
 * gives a row. It is deliberately spelled out here rather than wrapped in a
 * component: one call site, and a component with one user is a name to go and
 * look up rather than a rule anyone can follow.
 */
function AttachmentFindings({ attachment }: { attachment: TDetailAttachment }) {
  const zero = useZero();
  const failed = attachment.status === "failed";

  return (
    <section className="space-y-2">
      {/* The whole row, summary and all, is the link. It bleeds two pixels
          wider than the column it sits in so the hover rung reads as a row
          being pointed at rather than as a box drawn around the text. */}
      <Link
        {...attachmentLink(attachment.id)}
        className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-panel-hover"
      >
        <span className="flex items-center gap-2">
          <AttachmentThumb attachment={attachment} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.filename}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatBytes(attachment.size)}
          </span>
        </span>
        {attachment.generatedSummary && (
          <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
            {attachment.generatedSummary}
          </span>
        )}
      </Link>

      {/* Outside the link, because both of these end in a button, and because
          a part that failed is a state of this message rather than something
          to go and read on another page. */}
      {failed && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
          <Icon name="alert" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{attachment.error ?? "This file couldn't be read"}</span>
          <AttachmentRetry
            onRetry={() => void zero.mutate(mutators.attachment.retry({ id: attachment.id }))}
          />
        </div>
      )}
      {attachment.status === "done" && attachment.error && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Icon name="sparkles" className="mt-0.5 size-3 shrink-0" />
          {attachment.error}
        </p>
      )}
    </section>
  );
}
