import { mutators, queries } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import {
  AttachmentAlbum,
  AttachmentRetry,
  AttachmentThumb,
  AudioPlayerScope,
  formatDuration,
  useAudioScope,
} from "@/components/attachment-album";
import { DeleteMessageDialog } from "@/components/delete-message-dialog";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { Linkified, messageEntities } from "@/components/message-card";
import { PhotoViewerScope, usePhotoViewer } from "@/components/photo-viewer";
import { TagEditor } from "@/components/tag-editor";
import { SectionHeading } from "@/components/typography";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatBytes, timeLabel } from "@/lib/format";
import { entityLink, filterLink, useFilter } from "@/lib/routes";
import { useHeld } from "@/lib/settle";
import { useMeta } from "@/lib/use-meta";
import type { DetailAttachment, MessageDetail as MessageDetailRow } from "@/lib/types";

// Route overlay (…/m/$id): everything about one message. Rendered above the
// timeline so scroll position survives.
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
// A *child* of whichever filter is behind it (main.tsx), so the view stays in
// the path while the overlay is open: closing goes back to `/images`, not to
// the whole archive, and a link to `/images/m/<id>` opens it over the images
// view for whoever follows it.
//
// A Drawer rather than a hand-rolled overlay: focus trap, scroll lock, Esc,
// swipe-to-dismiss and the slide animation all come from Base UI. One
// component covers both form factors: it opens from the bottom on a phone
// (with a swipe handle) and from the right as an inset floating card at `md`+,
// which is the same floating-card language the sidebar uses at that
// breakpoint.
//
// The route decides whether this screen exists; local `open` state decides
// whether the panel is on screen, so that closing can animate before the route
// change tears the component down.

export function MessageDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const zero = useZero();
  const navigate = useNavigate();
  // The view this overlay is over, which is where closing it goes back to.
  const filter = useFilter();
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
  // whole of "opens abruptly but closes with an animation": the route mounts
  // this component with the drawer already open, which is the one case Base UI
  // reads as "was always there".
  //
  // So hand it a real false → true. `useLayoutEffect`, not `useEffect`: the
  // flip is flushed before paint, so the closed frame is never drawn.
  //
  // Keyed on `id`, not on mount. The router keeps this component mounted across
  // a param change, so a mount-only effect opens the drawer for whichever
  // message happened to mount it and never again.
  const [open, setOpen] = useState(false);
  // Set when the open is *requested*, which is what makes the exit below safe
  // to act on. It used to be set when the entrance *completed*, and an entrance
  // that never completes is exactly what happens when the drawer is dismissed
  // while it is still sliding in: Base UI drops the pending completion, the
  // exit reports `false` to a gate that was never opened, and the navigation
  // home never runs.
  const opened = useRef(false);
  useLayoutEffect(() => {
    // Undefined while the router transitions off this route; the component is
    // on its way out, not opening.
    if (!id) return;
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
        if (!nowOpen && opened.current) void navigate(filterLink(filter));
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
        {/* The visible header below carries the heading; the dialog still needs
            an accessible name and description of its own. */}
        <DrawerTitle className="sr-only">
          {message?.generatedTitle ?? message?.text ?? "Message"}
        </DrawerTitle>
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
          <>
            {/* Header. The drawer is a flex column with its own scrolling body
                below, so the header simply doesn't scroll.

                Two rows, because the timestamp and the way back are not the
                same kind of thing: the top row is what this message is (when
                it was sent) and what you can do to it, and the button below is
                where it lives. */}
            <div className="flex shrink-0 flex-col gap-2 border-b bg-card px-5 py-3">
              <div className="flex items-center gap-2">
                {/* The card's stamp, to the pixel (components/message-card.tsx):
                    same mono, same size, same grey, and the same full date on
                    hover. A message is dated once, in one voice, wherever it is
                    drawn. It carries the date as well as the time because this
                    panel has no day separators above it to say which day this
                    is.

                    The inbox chip that used to sit beside it is gone: it said
                    "message" over a panel that is nothing but one message, at
                    twice the height of the line it was labelling, and the
                    button below now carries that glyph where it means
                    something. */}
                <time
                  className="font-mono text-[11px] text-muted-foreground"
                  title={new Date(message.createdAt).toLocaleString()}
                >
                  {new Date(message.createdAt).toLocaleDateString()} ·{" "}
                  {timeLabel(message.createdAt)}
                </time>
                <span className="ml-auto flex items-center gap-1">
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
                      className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                    >
                      <Icon name="trash" className="size-4" />
                    </Button>
                  </DeleteMessageDialog>
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

              {/* Every thing-shaped view still gets you home (plan §8.2). The
                  id rides in the hash, so this is a real URL someone can share
                  rather than a piece of transient state, and the timeline
                  scrolls to it and points at it (components/timeline.tsx).

                  Its own row, under the stamp, rather than wedged between the
                  date and three icon buttons: it is the only thing in this
                  header with a word on it, and a labelled button in a row of
                  glyphs reads as the odd one out rather than as the way back.
                  `self-start` so it is as wide as its words. */}
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  void navigate({
                    to: "/{-$view}",
                    params: { view: undefined },
                    hash: message.id,
                    resetScroll: false,
                  })
                }
              >
                <Icon name="inbox" className="size-3.5" /> Show in Messages
              </Button>
            </div>

            {/* The scroller. DrawerContent is `overflow-hidden` by
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
                a panel is read by its gaps before it is read by its type. */}
            <AudioPlayerScope>
              {/* Both scopes wrap the whole body rather than the album alone:
                  a picture is opened from the album at the top and from its
                  own row further down, and those are two subtrees. */}
              <PhotoViewerScope attachments={message.attachments}>
                <div className="min-h-0 flex-1 space-y-8 scroll-fade-b overflow-x-hidden overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                  {/* The message, first, whatever it is made of: a paragraph, a
                    photo, a voice note, all three, or one file and nothing
                    else. No heading over it, because it is not a section of
                    the page: it is the thing the page is about, and the header
                    above already says when it was sent. */}
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
                    filename at the same size as "Things found"
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
                      <div className="flex flex-col gap-4">
                        {message.attachments.map((attachment, i) => (
                          <div key={attachment.id} className={i > 0 ? "border-t pt-4" : undefined}>
                            <AttachmentFindings attachment={attachment} />
                          </div>
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
                        void zero.mutate(
                          mutators.tag.setForMessage({ messageId: message.id, names }),
                        )
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
                </div>
              </PhotoViewerScope>
            </AudioPlayerScope>
          </>
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
  const filter = useFilter();
  const entities = messageEntities(message.mentions);
  if (entities.length === 0) return null;

  return (
    <section>
      <SectionHeading>Things found</SectionHeading>
      <div className="flex flex-col gap-1.5">
        {entities.map((entity) => (
          <EntityCard
            key={entity.id}
            entity={entity}
            onOpen={() => void navigate(entityLink(entity.id, filter))}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One attachment: what it is, and what the pipeline read out of it. Every
 * `content_md` renders the same way whatever produced it, which is the point
 * of there being one representation (plan §5.3).
 *
 * The file itself is not here: it is up in the message, where it was sent.
 * This is only what came out of it. A picture nobody has read yet still gets
 * its row, though, which is a change: the list is named "Attachments" now, so
 * a message with five photos and three summaries has to show five rows or the
 * two that were quietly dropped read as a bug.
 *
 * A row's title is 14/500 (components/typography.tsx), the step the scale
 * gives a row. It is deliberately spelled out here rather than wrapped in a
 * component: one call site, and a component with one user is a name to go and
 * look up rather than a rule anyone can follow.
 */
function AttachmentFindings({ attachment }: { attachment: DetailAttachment }) {
  const zero = useZero();
  const scope = useAudioScope();
  const viewer = usePhotoViewer();
  const face = faceForMime(attachment.mime);
  const segments = face === "audio" ? attachment.content?.segments : null;
  const failed = attachment.status === "failed";
  const thumb = <AttachmentThumb attachment={attachment} />;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {/* The thumbnail is the second way into the viewer, and the one that
            matters when the album above has batched six photos into a grid:
            this is the picture the paragraph underneath is about. */}
        {viewer && face === "image" ? (
          <button
            type="button"
            title="Open full screen"
            className="cursor-zoom-in rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            onClick={() => viewer.open(attachment.id)}
          >
            {thumb}
          </button>
        ) : (
          thumb
        )}
        <span className="min-w-0 truncate text-sm font-medium">{attachment.filename}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {formatBytes(attachment.size)}
        </span>
      </div>

      {attachment.generatedSummary && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {attachment.generatedSummary}
        </p>
      )}

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

      {/* A transcript is the one `content_md` worth rendering as something
          other than text: every line knows when it was said, so clicking one
          seeks there. That is what makes a search hit inside an hour of audio
          worth anything. The player it seeks is the voice note up in the
          message, found through the scope both sides share. */}
      {segments && segments.length > 0 && (
        <ol className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border bg-panel p-3 text-[13px] leading-relaxed">
          {segments.map((segment, i) => (
            <li key={i}>
              <button
                type="button"
                className="flex w-full gap-2 rounded px-1 text-left hover:bg-panel-hover"
                onClick={() => {
                  const audio = scope?.players.get(attachment.id);
                  if (!audio) return;
                  audio.currentTime = segment.start;
                  void audio.play();
                }}
              >
                {/* A column of timecodes down the left of the transcript, so
                    they have to agree on a width or the text beside them
                    ragged-edges its way down the list. */}
                <span className="shrink-0 font-mono text-muted-foreground">
                  {formatDuration(segment.start * 1000)}
                </span>
                {/* Only there when the model heard more than one voice, so a
                    label always means something rather than repeating. */}
                {segment.speaker && (
                  <span className="shrink-0 font-medium text-muted-foreground">
                    {segment.speaker}
                  </span>
                )}
                <span className="min-w-0">{segment.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {attachment.content?.contentMd && (
        <details className="rounded-xl border bg-panel">
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-muted-foreground">
            What we read out of it
            {attachment.content.truncated ? " (truncated)" : ""}
          </summary>
          {/* The extracted text, as text. `content_md` is markdown by
              convention so a human can read it and the next model can too, but
              this view deliberately does not render it: an OCR pass that
              hallucinates a heading should look like a hallucinated line, not
              like a heading. */}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t px-4 py-3 text-[13px] leading-relaxed">
            {attachment.content.contentMd}
          </pre>
        </details>
      )}
    </section>
  );
}
