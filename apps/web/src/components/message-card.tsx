import { mutators } from "@ragbag/contracts";
import { useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { AttachmentAlbum } from "@/components/attachment-album";
import { DeleteMessageDialog } from "@/components/delete-message-dialog";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { GroupLabel } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeLabel } from "@/lib/format";
import { entityLink, messageLink, useFilter } from "@/lib/routes";
import { isTouch } from "@/lib/touch";
import type { Message } from "@/lib/types";

// One timeline entry: the user's text, the attachments they sent with it, and
// whatever the pipeline found in the whole thing.
//
// Two cards in one silhouette, parted by a tear line: what the person sent,
// ending in its own timestamp, and below the perforation the stub holding
// what was read out of it. The message has to be legible as the thing they
// actually wrote, so the machine's findings hang off the bottom as an extra
// rather than sharing a box with it.
//
// A message that is one photo and nothing else renders as one photo and
// nothing else, because each part of the card only appears when there is
// something in it. That property falls out of the design rather than being
// special-cased anywhere.
//
// Every way into the detail view goes through `messageLink` (lib/routes.ts)
// rather than a route spelled out here, because opening a message draws an
// overlay *above* the timeline: it is not a new screen. So the archive
// underneath has to stay exactly where the reader left it, which takes
// `resetScroll: false` (the router scrolls the window to the top on every
// navigation otherwise: invisible while the timeline had its own scroll box,
// very much not now that the document is the scroller), and it has to stay
// *filtered*, which is why the overlay opens at `/links/m/<id>` when links is
// what you are looking at.

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

export function Linkified({ text }: { text: string }) {
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

/**
 * What ingestion is doing to this message, and how far along.
 *
 * "Reading 2 of 3" comes from the attachment rows rather than from a
 * counter on the message, because those are synced and the count is therefore
 * live on every device without a second column to keep in step.
 */
export function StatusChip({ message }: { message: Message }) {
  const zero = useZero();
  const { status } = message;
  if (status === "done") return null;

  if (status === "failed" || status === "partial") {
    const failed = status === "failed";
    return (
      // A soft chip rather than a solid red badge: the inline retry button
      // needs a surface of its own, and lightening a solid fill would mean an
      // alpha.
      <Badge
        className={`gap-1.5 px-2 text-[11px] ${
          failed ? "bg-destructive-soft text-destructive" : "bg-warning text-warning-foreground"
        }`}
      >
        <span title={message.error ?? undefined}>{failed ? "Failed" : "Partly read"}</span>
        <button
          className="inline-flex items-center gap-0.5 rounded-full bg-card px-1.5 py-px text-foreground hover:bg-panel"
          title={message.error ?? "Retry ingestion"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void zero.mutate(mutators.message.retryIngest({ id: message.id }));
          }}
        >
          <Icon name="retry" className="size-3" /> Retry
        </button>
      </Badge>
    );
  }

  const parts = message.attachments.length;
  const done = message.attachments.filter((a) => a.status === "done").length;
  return (
    // Optical, not arithmetic: the two sides are not carrying the same thing.
    // The right ends on a letter, which needs room; the left starts on a
    // 0.75rem glyph, which is already a square with air in it.
    <Badge className="gap-1 bg-warning pr-2 pl-1 text-[11px] text-warning-foreground">
      <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
      {status === "processing"
        ? parts > 0
          ? `Reading ${Math.min(done + 1, parts)} of ${parts}`
          : "Reading"
        : "Queued"}
    </Badge>
  );
}

// Only the user's own tags appear in the timeline. AI tags are generous by
// design (a dozen per message would drown the cards), so they stay behind the
// detail view while still powering search and filtering.
export function TagChips({ message, limit = 8 }: { message: Message; limit?: number }) {
  const userTags = message.tags.filter((t) => t.tag && t.source === "user");
  if (userTags.length === 0) return null;
  const shown = userTags.slice(0, limit);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <Badge key={t.tagId} variant="secondary" className="px-2 text-[11px] font-normal">
          {t.tag!.name}
        </Badge>
      ))}
      {userTags.length > shown.length && (
        <span className="text-[11px] text-muted-foreground">+{userTags.length - shown.length}</span>
      )}
    </span>
  );
}

/**
 * What the pipeline found in this message: the stub, and the tear it hangs
 * from.
 *
 * It only appears when there is something in it, which is why a message that
 * is one photo and nothing else renders as one photo and nothing else, and
 * why the perforation belongs to the stub rather than to the card: no
 * findings, no seam, and the card is a plain rounded rectangle again. That
 * property falls out of the design rather than being special-cased.
 *
 * Deduped by entity: the same link found in the text and again inside a
 * screenshot is one card, not two, because the card describes the *thing*.
 * Which occurrences it came from is the entity page's business.
 */
function EntityStrip({ message }: { message: Message }) {
  const navigate = useNavigate();
  const filter = useFilter();
  const seen = new Set<string>();
  const entities = message.mentions.flatMap((m) => {
    const entity = m.entity;
    if (!entity || seen.has(entity.id)) return [];
    seen.add(entity.id);
    return [entity];
  });
  if (entities.length === 0) return null;

  return (
    // The notches are the whole trick: two page-coloured discs centred on the
    // card's own edges, so the silhouette pinches at the seam and the halves
    // read as two rounded rectangles that meet, rather than as one card with a
    // line ruled across it. `-left-4` is the dashes' own 8px inset plus half a
    // disc, which puts the centre back on the card's edge; `-top-[7px]` is
    // half a disc less half the dashes' 2px, which puts it on their line.
    //
    // The dashes are that same page colour rather than a border colour, so the
    // whole seam is one idea: the page showing through, punched out of the
    // card in discs at the edges and in perforations across the middle. A
    // ruled line would have been a line drawn *on* the card, which is the
    // thing this is not.
    //
    // They are a gradient rather than `border-t-2 border-dashed` because Chrome
    // scales its dashes with the border's width: 3px on and 2px off at 1px,
    // but 6px on and 4.8px off at 2px, both measured. Thickening a border
    // would have stretched every dash with it. A box takes its height and its
    // rhythm separately, so only the thickness changed.
    //
    // Both halves keep the card fill, and so do the entity cards in the stub:
    // their border is the whole separation, and a second one made of fill
    // stacked shades inside a shade for no gain.
    <>
      <div className="relative mx-2 h-[2px] bg-[repeating-linear-gradient(to_right,var(--background)_0_3px,transparent_3px_5px)]">
        <span className="absolute -top-[7px] -left-4 size-4 rounded-full bg-background" />
        <span className="absolute -top-[7px] -right-4 size-4 rounded-full bg-background" />
      </div>
      {/* Tighter above than below: the tear is not a thing to crowd. */}
      <div className="p-3.5 pt-3">
        <GroupLabel className="mb-2.5">Things found in the message</GroupLabel>
        <div className="flex flex-col gap-1.5">
          {entities.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              onOpen={() => void navigate(entityLink(entity.id, filter))}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function MessageCard({
  message,
  highlight = false,
}: {
  message: Message;
  /** Arrived here from "show in chat": say which one. */
  highlight?: boolean;
}) {
  const zero = useZero();
  const navigate = useNavigate();
  const filter = useFilter();

  return (
    // Not <Card>: it has no asChild and this needs to stay an <article>, so it
    // borrows the card tokens directly.
    <article
      className={`group relative rounded-2xl bg-card text-card-foreground ${
        highlight ? "ring-2 ring-ring" : ""
      }`}
      // Touch has no hover actions, so tapping the card body opens the detail
      // view instead; links and buttons inside keep their own behavior.
      onClick={(e) => {
        if (!isTouch) return;
        if (e.target instanceof Element && e.target.closest("a,button")) return;
        void navigate(messageLink(message.id, filter));
      }}
    >
      {/* hover actions. A Tooltip supplies the description, not the name: these
          are icon-only, so each still needs its own aria-label. z-10 because
          the album below is `relative` (it pins upload badges) and so paints
          over an auto-z-index sibling that precedes it in the DOM. */}
      <div className="absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-full border bg-card p-1 group-hover:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={message.favorite ? "Remove from favorites" : "Add to favorites"}
                className={`rounded-full ${message.favorite ? "text-kind-note" : "text-muted-foreground"}`}
                onClick={() =>
                  void zero.mutate(
                    mutators.message.setFavorite({ id: message.id, favorite: !message.favorite }),
                  )
                }
              />
            }
          >
            <Icon name="star" className="size-4" filled={message.favorite} />
          </TooltipTrigger>
          <TooltipContent>
            {message.favorite ? "Remove from favorites" : "Add to favorites"}
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
                onClick={() => void navigate(messageLink(message.id, filter))}
              />
            }
          >
            <Icon name="tag" className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Details &amp; tags</TooltipContent>
        </Tooltip>
        <DeleteMessageDialog
          onConfirm={() => void zero.mutate(mutators.message.delete({ id: message.id }))}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
            aria-label="Delete"
            title="Delete"
          >
            <Icon name="trash" className="size-4" />
          </Button>
        </DeleteMessageDialog>
      </div>

      {/* What the person sent. The padding is here rather than on the article
          so the tear below can run the full width. */}
      <div className="p-3.5">
        {message.text && (
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            <Linkified text={message.text} />
          </p>
        )}

        <AttachmentAlbum attachments={message.attachments} />

        {/* The footer stands a chip tall whether or not there is a chip in it.
            Ingestion is the one thing on a card that changes on its own, with
            no one touching it: a badge appears the moment a dump lands, counts
            up through the parts, then leaves. Each of those is a row 3px
            taller than the bare timestamp, so every card below jumped 3px,
            twice, per dump. `min-h-5` is the badge's own height held open
            permanently, and `items-end` keeps the timestamp on the same
            baseline either way.

            It closes the message rather than the card: a timestamp under the
            findings would date the reading, and it is the writing that has a
            time worth knowing. */}
        <div className="mt-2 flex min-h-5 items-end justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {/* hover actions are unreachable on touch, so favorites need a
                mark that is always visible */}
            {message.favorite && <Icon name="star" className="size-3.5 text-kind-note" filled />}
            <StatusChip message={message} />
            <TagChips message={message} />
          </span>
          <time
            className="shrink-0 font-mono text-[11px] text-muted-foreground"
            title={new Date(message.createdAt).toLocaleString()}
          >
            {timeLabel(message.createdAt)}
          </time>
        </div>
      </div>

      <EntityStrip message={message} />
    </article>
  );
}
