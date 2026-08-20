import { mutators, queries } from "@ragbag/contracts";
import { faceForMime, type TAudioSegment } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AttachmentAlbum,
  AttachmentRetry,
  AudioPlayerScope,
  formatDuration,
  useAudioScope,
} from "@/components/attachment-album";
import { EntityCard } from "@/components/entities";
import { FACE_ICON, FACE_LABEL, Icon } from "@/components/icon";
import { messageEntities } from "@/components/message-card";
import { PhotoViewerScope } from "@/components/photo-viewer";
import { TagEditor } from "@/components/tag-editor";
import { SectionHeading } from "@/components/typography";
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
import { closePanelLink, entityLink, messageLink } from "@/lib/routes";
import { useHeld } from "@/lib/settle";

// The file panel (`?attachment=<id>`): everything about one file, over
// whichever view it was opened from (lib/routes.ts).
//
// It exists because this app already treats a file as one of the things it
// keeps and then had nowhere to put one. The rail lists Images and Files
// beside Links and IBANs (components/sidebar.tsx), search gives a file its own
// row under Things (lib/search.ts), and the pipeline writes a title, a
// summary, tags and mentions against the file itself. Every one of those rows
// used to open the *message* the file arrived in, which is the one thing a
// reader who clicked a photo was not asking for, and the file's own tags had
// no surface at all: the ingest worker has always written `attachment_tags`
// and nothing has ever read them.
//
// The same drawer as the other two panels, and deliberately the same shape
// down the page: what the thing is, then what was written about it, then what
// was found in it, then its tags. A reader who knows one of these panels knows
// all three.
//
// What it does not have is a delete. A file is part of the message it was sent
// in ("exactly as it was sent"), so there is no mutator to remove one, and the
// way to get rid of a photo is to delete the message that carried it.

export function AttachmentDetail({ id }: { id: string }) {
  const zero = useZero();
  const navigate = useNavigate();
  const [liveAttachment] = useQuery(queries.attachment({ id }));
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

  const lastAttachment = useRef(liveAttachment);
  if (liveAttachment) lastAttachment.current = liveAttachment;
  const attachment = liveAttachment ?? (open ? undefined : lastAttachment.current);
  const stillLoading = useHeld(!attachment, 250);

  const face = attachment ? faceForMime(attachment.mime) : "file";
  const entities = messageEntities(attachment?.mentions ?? []);
  const segments = face === "audio" ? attachment?.content?.segments : null;

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
        {/* The face names the surface, not the filename: "Image", "PDF",
            "Audio", "File". The name of this particular file is data, and it
            is a row down in Details with the rest of what the file is; a
            header carrying it would also be the one part of the panel that
            reads as a title while being whatever a camera happened to call a
            photo.

            Drawn whether or not the row has landed, so the drawer has a name
            in the frame the store is still answering in. */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <DrawerTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
            <Icon name={FACE_ICON[face]} className="size-4.5 shrink-0" />
            <span className="truncate">{FACE_LABEL[face]}</span>
          </DrawerTitle>
          {attachment?.message && (
            <span className="truncate text-xs text-muted-foreground">
              Sent {dayLabel(attachment.message.createdAt)}
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
          This file, what was read out of it, and the message it was sent in.
        </DrawerDescription>

        {!attachment ? (
          stillLoading && (
            <div
              role="status"
              className="flex h-40 items-center justify-center text-muted-foreground"
            >
              <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
            </div>
          )
        ) : (
          <AudioPlayerScope>
            {/* The scope is this one file, which is the whole of what this
                panel is about: a picture here opens full screen and has
                nowhere to step to, where the same picture in the message panel
                steps through the message's others. Each surface's viewer
                covers that surface's pictures. */}
            <PhotoViewerScope attachments={[attachment]}>
              <DrawerBody className="space-y-8">
                {/* The file itself, first and at the top, drawn by the album
                    the timeline and the message panel both use: a message has
                    to read as the same message everywhere, and a file as the
                    same file. `detail` is the variant that opens a picture
                    full screen instead of in a browser tab. */}
                <div className="space-y-2">
                  <AttachmentAlbum attachments={[attachment]} variant="detail" />
                  {attachment.status === "failed" && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
                      <Icon name="alert" className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        {attachment.error ?? "This file couldn't be read"}
                      </span>
                      <AttachmentRetry
                        onRetry={() =>
                          void zero.mutate(mutators.attachment.retry({ id: attachment.id }))
                        }
                      />
                    </div>
                  )}
                  {attachment.status === "done" && attachment.error && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Icon name="sparkles" className="mt-0.5 size-3 shrink-0" />
                      {attachment.error}
                    </p>
                  )}
                </div>

                <hr className="border-dashed" />

                {(attachment.generatedTitle || attachment.generatedSummary) && (
                  <section className="rounded-xl bg-ai-soft p-3.5">
                    <SectionHeading className="text-ai">
                      <span className="flex items-center gap-1">
                        <Icon name="sparkles" className="size-3.5" /> Summary
                      </span>
                    </SectionHeading>
                    {attachment.generatedTitle && (
                      <p className="font-semibold leading-snug">{attachment.generatedTitle}</p>
                    )}
                    {attachment.generatedSummary && (
                      <p
                        className={`text-sm leading-relaxed ${attachment.generatedTitle ? "mt-1" : ""}`}
                      >
                        {attachment.generatedSummary}
                      </p>
                    )}
                  </section>
                )}

                {/* The same section the message panel has, narrowed to what
                    came out of *this* file: on a message these arrive mixed in
                    with whatever its text and its other files said. */}
                {entities.length > 0 && (
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
                )}

                {/* A transcript is the one `content_md` worth rendering as
                    something other than text: every line knows when it was
                    said, so clicking one seeks there. The player it seeks is
                    the voice note at the top of this panel, found through the
                    scope both sides share. */}
                {segments && segments.length > 0 && (
                  <section>
                    <SectionHeading>Transcript</SectionHeading>
                    <ol className="max-h-96 space-y-0.5 overflow-y-auto rounded-xl border bg-panel p-3 text-[13px] leading-relaxed">
                      {segments.map((segment, i) => (
                        <li key={i}>
                          <TranscriptLine attachmentId={attachment.id} segment={segment} />
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {attachment.content?.contentMd && (
                  <section>
                    <SectionHeading>
                      Content
                      {attachment.content.truncated ? " (truncated)" : ""}
                    </SectionHeading>
                    {/* The extracted text, as text. `content_md` is markdown by
                        convention so a human can read it and the next model can
                        too, but this view deliberately does not render it: an
                        OCR pass that hallucinates a heading should look like a
                        hallucinated line, not like a heading. */}
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border bg-panel px-4 py-3 text-[13px] leading-relaxed">
                      {attachment.content.contentMd}
                    </pre>
                  </section>
                )}

                <section>
                  <SectionHeading>Details</SectionHeading>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <Detail label="Filename">
                      <span className="break-all">{attachment.filename}</span>
                    </Detail>
                    <Detail label="Size">
                      <span className="font-mono">{formatBytes(attachment.size)}</span>
                    </Detail>
                    <Detail label="Type">
                      <span className="break-all font-mono">{attachment.mime}</span>
                    </Detail>
                    {attachment.width != null && attachment.height != null && (
                      <Detail label="Dimensions">
                        <span className="font-mono">
                          {attachment.width} × {attachment.height}
                        </span>
                      </Detail>
                    )}
                    {attachment.durationMs != null && (
                      <Detail label="Length">
                        <span className="font-mono">{formatDuration(attachment.durationMs)}</span>
                      </Detail>
                    )}
                    {attachment.message && (
                      <Detail label="Sent">
                        {dayLabel(attachment.message.createdAt)} ·{" "}
                        {timeLabel(attachment.message.createdAt)}
                      </Detail>
                    )}
                  </dl>
                </section>

                {/* Tags of the file's own, which is what `attachment_tags` has
                    always held and what nothing in the app has ever shown. */}
                <section>
                  <SectionHeading>Tags</SectionHeading>
                  <TagEditor
                    userTagNames={attachment.tags
                      .filter((t) => t.source === "user" && t.tag)
                      .map((t) => t.tag!.name)}
                    suggestions={allTags.filter((t) => t.kind === "topic").map((t) => t.name)}
                    onSave={(names) =>
                      void zero.mutate(
                        mutators.tag.setForAttachment({ attachmentId: attachment.id, names }),
                      )
                    }
                  />
                  {attachment.tags.some((t) => t.source === "ai" && t.tag) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {attachment.tags
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

                {/* The thing panel's last section, in the same place, drawn the
                    same way and worded the same way, because this is the same
                    question: which messages is this thing in. It said "sent in"
                    while the panel next door said "seen in", which made two
                    phrasings for one relation and put the emphasis on what
                    happened to the file rather than on where it is. The count
                    is the literal 1 rather than a pluralised length: a file
                    belongs to exactly one message (schema.ts), where a thing
                    the pipeline found can be in any number of them. Either way
                    the row is the way back to the message, and it carries what
                    the message is rather than being a button that only says
                    where it goes. */}
                {attachment.message && (
                  <section>
                    <SectionHeading>Seen in 1 message</SectionHeading>
                    <Link
                      {...messageLink(attachment.messageId)}
                      className="block rounded-lg border bg-panel p-3 transition hover:bg-panel-hover"
                      onClick={close}
                    >
                      <span className="block truncate text-sm font-medium">
                        {attachment.message.generatedTitle ??
                          attachment.message.text?.split("\n")[0] ??
                          "(no text)"}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {dayLabel(attachment.message.createdAt)} ·{" "}
                        {timeLabel(attachment.message.createdAt)}
                      </span>
                    </Link>
                  </section>
                )}
              </DrawerBody>
            </PhotoViewerScope>
          </AudioPlayerScope>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** One row of the Details list, in the two-column grid its `dl` sets up. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * One line of a transcript, which is a seek: the timecode is not decoration.
 *
 * A component rather than a closure in the list because it needs the audio
 * scope, and a hook cannot be called from inside a `map`.
 */
function TranscriptLine({
  attachmentId,
  segment,
}: {
  attachmentId: string;
  segment: TAudioSegment;
}) {
  const scope = useAudioScope();
  return (
    <button
      type="button"
      className="flex w-full gap-2 rounded px-1 text-left hover:bg-panel-hover active:bg-panel-hover"
      onClick={() => {
        const audio = scope?.players.get(attachmentId);
        if (!audio) return;
        audio.currentTime = segment.start;
        void audio.play();
      }}
    >
      {/* A column of timecodes down the left, so the text beside them does not
          ragged-edge its way down the list. */}
      <span className="shrink-0 font-mono text-muted-foreground">
        {formatDuration(segment.start * 1000)}
      </span>
      {/* Only there when the model heard more than one voice, so a label always
          means something rather than repeating. */}
      {segment.speaker && (
        <span className="shrink-0 font-medium text-muted-foreground">{segment.speaker}</span>
      )}
      <span className="min-w-0">{segment.text}</span>
    </button>
  );
}
