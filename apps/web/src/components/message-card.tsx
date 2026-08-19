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
import type { EntityFields, Message } from "@/lib/types";

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
          className="inline-flex items-center gap-0.5 rounded-full bg-card px-1.5 py-px text-foreground hover:bg-hover"
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
 * The distinct things a message mentions, in the order they were found.
 *
 * Deduped by entity: the same link found in the text and again inside a
 * screenshot is one card, not two, because a card describes the *thing*.
 * Which occurrences it came from is the entity page's business.
 *
 * A function rather than a line inside the strip below, because the detail
 * panel lists the same set from the same relation, and two spellings of "what
 * this message mentions" is how a card and its own detail view come to
 * disagree about how many things are in a message.
 */
export function messageEntities(
  mentions: readonly { readonly entity?: EntityFields | null }[],
): EntityFields[] {
  const seen = new Set<string>();
  return mentions.flatMap((mention) => {
    const entity = mention.entity;
    if (!entity || seen.has(entity.id)) return [];
    seen.add(entity.id);
    return [entity];
  });
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
 */
function EntityStrip({ message }: { message: Message }) {
  const navigate = useNavigate();
  const filter = useFilter();
  const entities = messageEntities(message.mentions);
  if (entities.length === 0) return null;

  return (
    // The seam runs the full width, border to border, so the card's own edge
    // closes both ends of it and the perforation reads as one line crossing
    // the shape rather than as a rule someone inset inside it. The colour and
    // the 1px are the border's own: it is the same line, continued.
    //
    // It is a gradient rather than `border-t border-dashed` because the dash
    // pattern is otherwise the engine's to pick, and Chrome's scales with the
    // border's width: 3px on and 2px off at 1px, but 6px on and 4.8px off at
    // 2px, both measured. A gradient states the rhythm instead of inheriting
    // it, so the seam is the same seam wherever it is drawn.
    <>
      <div className="h-px bg-[repeating-linear-gradient(to_right,var(--border)_0_3px,transparent_3px_5px)]" />
      {/* Tighter above than below: the tear is not a thing to crowd. */}
      <div className="p-3.5 pt-3">
        {/* The sparkles mark: everything under this label was found by the
            pipeline rather than written by the person, and the label is the
            one place on the card that can say so once for all of them. */}
        <GroupLabel className="mb-2.5 flex items-center gap-1 font-medium">
          <Icon name="sparkles" className="size-3.5 shrink-0" />
          Things found
        </GroupLabel>
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
  /** Arrived here from "Show in Messages": point at this one. */
  highlight?: boolean;
}) {
  const zero = useZero();
  const navigate = useNavigate();
  const filter = useFilter();

  return (
    // Not <Card>: it has no asChild and this needs to stay an <article>, so it
    // draws its own surface. That surface is the page's own fill: a message is
    // an outlined region of the canvas rather than a sheet raised off it,
    // which is what leaves the cards and attachments inside it a shade to rise
    // by.
    <article
      className={`group relative rounded-2xl border bg-background ${
        // A pass over this card's border, held for three seconds and then
        // dropped by the timeline, rather than a ring that stays on: see
        // `highlight-pass` in index.css.
        highlight ? "highlight-pass" : ""
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
          so the tear below can run the full width. It is the album's inset:
          the text takes its own, below. */}
      <div className="p-3.5">
        {/* The air between what someone wrote and what they sent with it
            belongs to the pair rather than to either half, so it is a gap
            between the two and not padding on one of them: a flex gap only
            exists when there are two children for it to sit between, so a
            message that is only text and a message that is only pictures each
            sit on the card's own inset with nothing added. */}
        <div className="flex flex-col gap-1">
          {message.text && (
            // Both of these are optical, and both are about text sharing a box
            // with pictures. `leading-relaxed` hangs ~5px of half-leading above
            // the first line, so an equal padding on four sides lands the glyphs
            // visibly lower than they sit in from the left: the negative margin
            // takes that back, and only here, because text is the first thing in
            // a message whenever there is any. And a picture fills its box to the
            // pixel while a letter carries its own side bearing, so the text sits
            // further in than the album does: a hair of it on a phone, where the
            // gutter costs line length, and on a wider card the 20px the composer
            // sets the same words in while they are being typed.
            <p className="-mt-0.5 px-0.5 whitespace-pre-wrap break-words leading-relaxed md:px-1.5">
              <Linkified text={message.text} />
            </p>
          )}

          <AttachmentAlbum attachments={message.attachments} />
        </div>

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
