import { mutators } from "@ragbag/contracts";
import { useZero } from "@rocicorp/zero/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AttachmentAlbum } from "@/components/attachment-album";
import { DeleteMessageDialog } from "@/components/delete-message-dialog";
import { EntityCard } from "@/components/entities";
import { Icon } from "@/components/icon";
import { GroupLabel } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { timeLabel } from "@/lib/format";
import { entityLink, messageLink } from "@/lib/routes";
import type { TEntityFields, TMessage } from "@/lib/types";

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
// *filtered*, which is why the panel opens at `/links?message=<id>` when links
// is what you are looking at: the path is left exactly as it was and the
// message rides beside it.

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
export function StatusChip({ message }: { message: TMessage }) {
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
          className="inline-flex items-center gap-0.5 rounded-full bg-card px-1.5 py-px text-foreground hover:bg-hover active:bg-hover"
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
export function TagChips({ message, limit = 8 }: { message: TMessage; limit?: number }) {
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
  mentions: readonly { readonly entity?: TEntityFields | null }[],
): TEntityFields[] {
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
function EntityStrip({ message }: { message: TMessage }) {
  const navigate = useNavigate();
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
          Things TFound
        </GroupLabel>
        <div className="flex flex-col gap-1.5">
          {entities.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              onOpen={() => void navigate(entityLink(entity.id))}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The way into the message's own page, at the head of the footer row.
 *
 * It leads the row rather than standing with the icon buttons opposite,
 * because it is the one control on the card that is a place to go rather than
 * something done to the message, and a worded button wedged between a star and
 * a menu reads as a third icon that happens to have letters in it. On the left
 * it opens the row the way the message's own text opens the card, and the
 * cluster it left behind is icons only, which is what that cluster's 2px gap
 * was measured for.
 *
 * The vertical margin is what lets a 32px control live in a 20px row, the same
 * trick the cluster opposite plays: six of the button's pixels go back to the
 * row top and bottom, so the footer stands exactly as tall as it did when this
 * row held nothing but a timestamp and a chip.
 *
 * The horizontal one is what makes it look like the first thing in the row.
 * A ghost button at rest is only its glyph, but it is measured from the edge of
 * a fill nobody can see, so 10px of button padding stood between the card's
 * inset and the first mark on the line while everything above started at the
 * inset itself. The pull takes those back and then some, and what it is aiming
 * at is not this row at all: it is the paragraph, which sets its own text 2px
 * in from the card on a phone and 6px in on a wider one, for the reasons
 * written where it does it. The fill that carries the glyph ends up out in the
 * card's own gutter, which is where a ghost button has to start if its mark is
 * to sit under type that has no padding at all.
 *
 * Two pulls, because both of the things it is measured against move at that
 * breakpoint and they do not move together: the row's padding doubles while the
 * paragraph's inset gains 4px. Both land a pixel past what that arithmetic asks
 * for, because a glyph is not its box. The icon draws its square inset from the
 * edge of the 16px it is handed, the way a letter carries a side bearing, so
 * the two boxes agreeing is not the two marks agreeing. It is the same pixel at
 * both widths, which is what says it belongs to the icon and not to either
 * layout. These are the numbers that looked right, which is the only test a
 * leading edge has.
 */
function DetailsLink({ message }: { message: TMessage }) {
  return (
    // A Link, not a click handler: the panel is a URL (lib/routes.ts), so this
    // is something to open in a new tab or copy the address of, and
    // `nativeButton={false}` tells Base UI the button is an anchor now.
    <Button
      variant="ghost"
      size="sm"
      className="-my-1.5 -ml-2.75 text-muted-foreground md:-ml-2.25"
      nativeButton={false}
      render={<Link {...messageLink(message.id)} />}
    >
      <Icon name="details" className="size-4" />
      Show Details
    </Button>
  );
}

/**
 * What you can do to a message, on the card, at any width.
 *
 * These were a pill that appeared over the card's top edge on hover, which
 * meant a phone could not reach a single one of them. Hover is not something a
 * design can be built on when half the devices have no pointer, so the actions
 * are simply here, in the one row of the card that was already mostly empty.
 * One set of controls, one behaviour, both form factors.
 *
 * Both verbs live under the menu, and only one of them also stands outside it.
 * A card carrying a control for every verb is a card you read past, and an
 * empty star on every message in the archive is a column of identical widgets
 * saying nothing: what the star does out here is report, not offer. So it is
 * drawn only when it is filled, which makes it the message saying something
 * about itself rather than the app repeating furniture. And because the only
 * message that can show one is a message you already favorited, the one thing
 * it can do is take that back, which is exactly what the row it came from says
 * while it is showing.
 *
 * The negative margin is what lets a 32px control live in a 20px row. A ghost
 * button is mostly the fill it paints when pointed at: 16px of glyph inside 8px
 * of padding on each side. Six of those pixels go back to the row top and
 * bottom, so the footer stands exactly as tall as it did when it held a
 * timestamp and a chip, and no card in the timeline grew by a pixel.
 *
 * `gap-0.5` is not free spacing either: every button here carries the 44px
 * touch strip described in ui/button.tsx, and at 32px with a 2px gap it bleeds
 * 4px sideways, which stays inside the 8px of padding around its neighbour's
 * icon. That is the rule that keeps this cluster at 32px rather than the 24px
 * an 11px timestamp would otherwise ask for.
 */
function MessageActions({ message }: { message: TMessage }) {
  const zero = useZero();
  // The menu unmounts its items the moment one is clicked, so the confirmation
  // cannot hang off a trigger inside it: this holds the state and the dialog
  // sits outside the menu (components/delete-message-dialog.tsx).
  const [confirming, setConfirming] = useState(false);
  // One write for both ways in, so the star and the row it shadows cannot come
  // to disagree about what favoriting is.
  const setFavorite = (favorite: boolean) =>
    void zero.mutate(mutators.message.setFavorite({ id: message.id, favorite }));

  return (
    <span className="-my-1.5 flex items-center gap-0.5">
      {/* Only ever drawn in its on state, so there is nothing here to swap a
          colour or a fill for: the button either is the filled star or is not
          in the row. `aria-pressed` because a filled star is not a state a
          screen reader can see. */}
      {message.favorite && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed
          aria-label="Remove from favorites"
          className="text-kind-note"
          onClick={() => setFavorite(false)}
        >
          <Icon name="star" className="size-4" filled />
        </Button>
      )}
      <DropdownMenu>
        {/* The glyph takes a quarter turn while the menu is out, so the dots
            stand in a column under a menu that is itself a column, and the
            trigger reads as the thing the panel came out of rather than as a
            button that happens to be lit. It rides on the expanded state Base
            UI already puts on the trigger for the ghost variant's open fill
            (ui/button.tsx), so there is no second source of truth for "open",
            and the group is on the button because the glyph is its child.
            Three round dots turning about their own centre have no orientation
            to lose, which is the whole reason this can be a rotation and not a
            swap to a different mark. */}
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              className="group text-muted-foreground"
            />
          }
        >
          <Icon name="more" className="size-4 transition-transform group-aria-expanded:rotate-90" />
        </DropdownMenuTrigger>
        {/* Anchored at its right edge, because the trigger is at the card's.
            `w-auto` undoes the component's default of matching the anchor's
            width, which is meant for a select-shaped trigger and here would be
            a menu the width of one icon. */}
        <DropdownMenuContent align="end" className="w-auto min-w-36">
          {/* The label carries the state, not the glyph: a row that always
              said "Favorite" would be a switch you have to look at the card to
              read. The star is filled to match the one in the row when there
              is one, and takes the menu's own ink either way, because a menu
              is a column of equals and tinting one of them is how a list turns
              into a ransom note. */}
          <DropdownMenuItem onClick={() => setFavorite(!message.favorite)}>
            <Icon name="star" className="size-4" filled={message.favorite} />
            {message.favorite ? "Unfavorite" : "Favorite"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Icon name="trash" className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteMessageDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void zero.mutate(mutators.message.delete({ id: message.id }))}
      />
    </span>
  );
}

export function MessageCard({
  message,
  highlight = false,
}: {
  message: TMessage;
  /** Arrived here from "Show in Messages": point at this one. */
  highlight?: boolean;
}) {
  return (
    // Not <Card>: it has no asChild and this needs to stay an <article>, so it
    // draws its own surface. That surface is the page's own fill: a message is
    // an outlined region of the canvas rather than a sheet raised off it,
    // which is what leaves the cards and attachments inside it a shade to rise
    // by.
    <article
      // A pass of brand colour inside this card's edge, held for three seconds
      // and then dropped by the timeline, rather than a ring that stays on:
      // `highlight-pass` in index.css is the shadow and its timing. An
      // attribute rather than a class swap because the state is the card's own
      // and reads as one in the DOM; `|| undefined` keeps `data-highlight="false"`
      // out, which would be present and therefore true to the variant.
      data-highlight={highlight || undefined}
      className="relative rounded-2xl border bg-background data-highlight:highlight-pass"
    >
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
            no one touching it: a badge appears the moment a message lands, counts
            up through the parts, then leaves. Each of those is a row 3px
            taller than the bare timestamp, so every card below jumped 3px,
            twice, per message. `min-h-5` is the badge's own height held open
            permanently, and the controls hold themselves to it (`MessageActions`
            above), so what a reader sees appear and disappear in this row never
            moves the row.

            It closes the message rather than the card: a timestamp under the
            findings would date the reading, and it is the writing that has a
            time worth knowing.

            12px of air above rather than 8: the buttons paint 6px past the row
            they measure, and a hover fill landing 2px off the edge of a photo
            reads as a mistake. The padding on each side is that argument
            sideways: a photo runs to the card's inset and a stamp set flush
            with it reads as having fallen off the picture, so the row holds
            itself in a little from what it closes. Half as much on a phone,
            where the card is narrow enough that 4px off both ends is a
            visible bite out of the line the chips have to wrap inside of. The
            way in is exempt from all of it: it carries a pull measured
            against the paragraph above rather than against this row
            (`DetailsLink` above), so the row can step in without taking the
            first mark on the line in with it. It wraps because on a phone the way in, the
            icons and the stamp are most of the width: with tags and a status
            badge among them there is no line that fits everything, and the
            chips drop under the button that leads them rather than being
            squeezed into a column. */}
        <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-2 px-0.5 md:px-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <DetailsLink message={message} />
            <StatusChip message={message} />
            <TagChips message={message} />
          </span>
          {/* `ml-auto`, not just `justify-between`: once the left span wraps,
              what is left on this line is one flex item and there is nothing
              to be between. */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <MessageActions message={message} />
            <time
              className="shrink-0 font-mono text-[11px] text-muted-foreground"
              title={new Date(message.createdAt).toLocaleString()}
            >
              {timeLabel(message.createdAt)}
            </time>
          </span>
        </div>
      </div>

      <EntityStrip message={message} />
    </article>
  );
}
