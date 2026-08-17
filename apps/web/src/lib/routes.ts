import { ENTITY_DEFINITIONS, RAIL_ENTITY_KINDS } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

// The rail's filters *are* the URL.
//
// They were view state in lib/store.ts, which meant the one thing in this app
// worth linking to (a view of the archive) could not be linked to, reloaded,
// bookmarked, opened in a second tab or reached with the back button: the
// sidebar's rows were buttons that changed a variable. They are `<Link>`s to
// these paths now, and this module is the one place that knows the vocabulary:
//
//   /                    the chat: everything, live at the bottom
//   /favorites           messages you starred
//   /images , /files     the things inside messages
//   /links , /addresses  the things the pipeline found in them
//   /tags/<id>           one of the user's own tags
//   /links/tags/<id>     both, because the two filters have always combined
//   …/m/<id>             the message overlay, over whichever view is behind it
//   …/e/<id>             the entity overlay, same
//
// The route tree that serves these is in main.tsx, and it is deliberately small
// enough that each builder below has one `to` rather than a union of them.

/**
 * The two rows that filter the chat itself.
 *
 * The split is the whole design of the rail (plan §8.2): a tag is a property
 * of a whole message and a favorite is something you did to one, so those want
 * the chat back. An image *is* the content, so filtering the chat down to
 * "messages containing an image" would lose the density a grid has and gain
 * nothing.
 */
const CHAT_VIEWS = { favorites: "favorites" } as const;

/** Rows backed by attachments rather than by entities. */
const ATTACHMENT_VIEWS = { images: "image", files: "file" } as const satisfies Record<
  string,
  AttachmentFace
>;

/**
 * Rows backed by the entity registry, so a new kind gets a URL for free
 * (plan §8.1). Only the kinds that claim a rail row appear here.
 */
const ENTITY_VIEWS: Record<string, string> = Object.fromEntries(
  RAIL_ENTITY_KINDS.map((d) => [d.slug, d.kind]),
);

/** Every path segment this build recognises as a view, in rail order. */
export const VIEW_SLUGS = [
  ...Object.keys(CHAT_VIEWS),
  ...Object.keys(ATTACHMENT_VIEWS),
  ...Object.keys(ENTITY_VIEWS),
] as const;

/** A view is named by its slug: the URL vocabulary is the only vocabulary. */
export type ViewFilter = string | null;

/** What the rail is narrowing to: at most one view, at most one tag. */
export type Filter = { view: ViewFilter; tagId: string | null };

/** No filter at all: the whole archive. */
export const EVERYTHING: Filter = { view: null, tagId: null };

const KNOWN = new Set<string>(VIEW_SLUGS);

/** Does this path segment name a view this build knows? (main.tsx rejects the rest.) */
export const isViewSlug = (slug: string): boolean => KNOWN.has(slug);

/** True when this view filters the chat rather than replacing it (plan §8.2). */
export function isChatView(view: ViewFilter): boolean {
  return view === null || view in CHAT_VIEWS;
}

/** Which attachment face this view shows, if it shows one. */
export function attachmentFaceOf(view: ViewFilter): AttachmentFace | null {
  return view && view in ATTACHMENT_VIEWS
    ? ATTACHMENT_VIEWS[view as keyof typeof ATTACHMENT_VIEWS]
    : null;
}

/** Which entity kind this view shows, if it shows one. */
export function entityKindOf(view: ViewFilter): string | null {
  return (view && ENTITY_VIEWS[view]) ?? null;
}

/** Where an entity kind's own view lives, for a chip that links to its row. */
export function slugForEntityKind(kind: string): string | undefined {
  return ENTITY_DEFINITIONS.find((d) => d.kind === kind && d.railRow)?.slug;
}

/**
 * What the URL is asking for. One hook for the sidebar (which row is lit), the
 * timeline (which rows exist) and the overlays (where closing goes back to), so
 * there is no second copy of this state to fall out of step with the address
 * bar.
 *
 * `strict: false` because the shell renders above every one of these routes and
 * has no single one to read params from; the router merges the matched chain's
 * params, so a missing segment is simply `undefined` here.
 */
export function useFilter(): Filter {
  const { view, tagId } = useParams({ strict: false });
  return useMemo(
    // An unknown slug can't reach this point (main.tsx redirects), so `?? null`
    // is only ever the no-segment case.
    () => ({ view: view && isViewSlug(view) ? view : null, tagId: tagId ?? null }),
    [view, tagId],
  );
}

/**
 * Where a sidebar row points.
 *
 * `resetScroll: false` on all of these, as on every other navigation in the
 * app: the timeline owns the scroll offset and re-anchors to the newest message
 * itself whenever the row set changes (components/timeline.tsx). The router's
 * default jump to the top would be a frame of the wrong position before that
 * runs.
 */
export function filterLink(filter: Filter) {
  const view = filter.view ?? undefined;
  return filter.tagId
    ? ({
        to: "/{-$view}/tags/$tagId",
        params: { view, tagId: filter.tagId },
        resetScroll: false,
      } as const)
    : ({ to: "/{-$view}", params: { view }, resetScroll: false } as const);
}

/**
 * The message overlay, over whatever the rail is showing.
 *
 * Opening a message is not leaving the timeline: the overlay is drawn above it,
 * so the filter it was opened from stays in the path and closing the overlay
 * lands exactly where it opened from.
 */
export function messageLink(id: string, filter: Filter) {
  const view = filter.view ?? undefined;
  return filter.tagId
    ? ({
        to: "/{-$view}/tags/$tagId/m/$id",
        params: { view, tagId: filter.tagId, id },
        resetScroll: false,
      } as const)
    : ({ to: "/{-$view}/m/$id", params: { view, id }, resetScroll: false } as const);
}

/** The entity overlay: the same pattern, one letter apart in the path. */
export function entityLink(id: string, filter: Filter) {
  const view = filter.view ?? undefined;
  return filter.tagId
    ? ({
        to: "/{-$view}/tags/$tagId/e/$id",
        params: { view, tagId: filter.tagId, id },
        resetScroll: false,
      } as const)
    : ({ to: "/{-$view}/e/$id", params: { view, id }, resetScroll: false } as const);
}
