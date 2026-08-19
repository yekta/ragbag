import { mutators, queries } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { AttachmentRetry, Waveform, formatDuration } from "@/components/attachment-album";
import { DeleteMessageDialog } from "@/components/delete-message-dialog";
import { FACE_ICON, Icon } from "@/components/icon";
import { MediaImage } from "@/components/media-image";
import { Linkified } from "@/components/message-card";
import { TagEditor } from "@/components/tag-editor";
import { SectionHeading } from "@/components/typography";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { mediaBox, useBlobUrl } from "@/lib/blobs";
import { mediaUrl } from "@/lib/media";
import { formatBytes, timeLabel } from "@/lib/format";
import { filterLink, useFilter } from "@/lib/routes";
import { useHeld } from "@/lib/settle";
import { useMeta } from "@/lib/use-meta";
import type { DetailAttachment } from "@/lib/types";

// Route overlay (…/m/$id): everything about one message. Every attachment at
// full size with whatever the pipeline read out of it, the tag editor, and the
// favorite/delete/retry actions. Rendered above the timeline so scroll
// position survives.
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

  const saveText = () => {
    if (!message) return;
    setEditing(false);
    if (textDraft.trim() !== (message.text ?? "")) {
      void zero.mutate(mutators.message.edit({ id: message.id, text: textDraft.trim() }));
    }
  };

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
                below, so the header simply doesn't scroll. */}
            <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon name="inbox" className="size-3.5" />
              </span>
              <time className="text-xs text-muted-foreground">
                {new Date(message.createdAt).toLocaleDateString()} · {timeLabel(message.createdAt)}
              </time>
              <span className="ml-auto flex items-center gap-1">
                {/* Every thing-shaped view still gets you home (plan §8.2).
                    The id rides in the hash, so this is a real URL someone can
                    share rather than a piece of transient state, and the
                    timeline scrolls to it and holds there. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigate({
                      to: "/{-$view}",
                      params: { view: undefined },
                      hash: message.id,
                      resetScroll: false,
                    })
                  }
                >
                  <Icon name="inbox" className="size-3.5" /> Show in chat
                </Button>
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

            {/* The scroller. DrawerContent is `overflow-hidden` by
                construction, so this is what actually scrolls. The bottom-only
                fade (a mask, not a wrapper, safe here) says "there is more
                below"; the top edge stays hard, because it butts against the
                header rather than against the panel's own rounding, and fading
                content out into a solid bar reads as a rendering fault.
                `overflow-x-hidden` is not redundant: asking for `overflow-y`
                alone computes the other axis from `visible` to `auto`. */}
            <div className="min-h-0 flex-1 space-y-5 scroll-fade-b overflow-x-hidden overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {message.generatedTitle && (
                <h1 className="text-xl font-semibold leading-snug">{message.generatedTitle}</h1>
              )}

              {/* the user's own words */}
              <section>
                <SectionHeading>Your message</SectionHeading>
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
                      setTextDraft(message.text ?? "");
                      setEditing(true);
                    }}
                    title="Click to edit"
                  >
                    {message.text ? (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        <Linkified text={message.text} />
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        Click to add a comment…
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* AI summary */}
              {message.generatedSummary && (
                <section className="rounded-xl bg-ai-soft p-3.5">
                  <SectionHeading>
                    <span className="flex items-center gap-1 text-ai">
                      <Icon name="sparkles" className="size-3.5" /> Summary
                    </span>
                  </SectionHeading>
                  <p className="text-sm leading-relaxed">{message.generatedSummary}</p>
                </section>
              )}

              {/* every attachment, in the order it was sent */}
              {message.attachments.map((attachment) => (
                <AttachmentSection key={attachment.id} attachment={attachment} />
              ))}

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
                  <Icon name="spinner" className="size-3.5 animate-spin [animation-duration:2s]" />
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
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * One attachment at full size, with what the pipeline read out of it. Every
 * `content_md` renders the same way whatever produced it, which is the point
 * of there being one representation (plan §5.3).
 */
function AttachmentSection({ attachment }: { attachment: DetailAttachment }) {
  const zero = useZero();
  const audioRef = useRef<HTMLAudioElement>(null);
  // Local bytes first for the originals (a file this device captured opens
  // before it has uploaded, and offline); the media URL is what every other
  // device uses, and what a download link points at.
  const local = useBlobUrl(attachment.blobId);
  const url = local ?? mediaUrl(attachment.blobId, "original");
  const face = faceForMime(attachment.mime);
  const box = mediaBox(attachment.width, attachment.height, "70vh");

  return (
    <section className="space-y-2">
      <SectionHeading>
        <span className="flex items-center gap-1.5">
          <Icon name={FACE_ICON[face]} className="size-3.5" />
          <span className="truncate">{attachment.filename}</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {formatBytes(attachment.size)}
            {attachment.durationMs != null ? ` · ${formatDuration(attachment.durationMs)}` : ""}
          </span>
        </span>
      </SectionHeading>

      {face === "image" && (
        // The box is the wrapper's, from the synced dimensions, so the blurred
        // placeholder and the picture occupy exactly the same space.
        <div
          style={box}
          className={`overflow-hidden rounded-xl border ${box ? "" : "h-64 max-h-[70vh]"}`}
        >
          <MediaImage
            blobId={attachment.blobId}
            variant="display"
            placeholder={attachment.placeholder}
            alt={attachment.generatedTitle ?? attachment.filename}
            fit="contain"
          />
        </div>
      )}

      {face === "pdf" && (
        <iframe
          src={url}
          title={attachment.generatedTitle ?? attachment.filename}
          className="h-[70vh] w-full rounded-xl border"
        />
      )}

      {face === "audio" && (
        <>
          <Waveform peaks={attachment.waveform} />
          <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" />
        </>
      )}

      {face === "file" && (
        <div className="flex items-center gap-3 rounded-xl border bg-panel p-4">
          <Icon name="file" className="size-8 text-kind-file" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {attachment.generatedTitle ?? attachment.filename}
            </p>
            <p className="text-xs text-muted-foreground">Stored in your archive</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={url} download={attachment.filename} />}
          >
            Download
          </Button>
        </div>
      )}

      {attachment.generatedSummary && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {attachment.generatedSummary}
        </p>
      )}

      {attachment.status === "failed" && (
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
          worth anything. */}
      {face === "audio" &&
        attachment.content?.segments &&
        attachment.content.segments.length > 0 && (
          <ol className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border bg-panel p-3 text-[13px] leading-relaxed">
            {attachment.content.segments.map((segment, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="flex w-full gap-2 rounded px-1 text-left hover:bg-accent"
                  onClick={() => {
                    const audio = audioRef.current;
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
