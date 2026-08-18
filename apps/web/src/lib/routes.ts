import type { AttachmentFace, EntityTypes } from "@ragbag/shared";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { declaredSlugs } from "./thing-slugs.js";

// The sidebar's filters *are* the URL.
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
 * The split is the whole design of the sidebar (plan §8.2): a tag is a property
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
 * Every path segment a build knows without syncing anything.
 *
 * No entity slugs among them: a type belongs to a user now, so `/links` is
 * theirs to rename or delete and this build cannot know it exists. Those come
 * from the synced set (`entityKindOf` below) and, before the store is open,
 * from the device's own cache of what it last saw (lib/thing-slugs.ts).
 */
export const VIEW_SLUGS = [...Object.keys(CHAT_VIEWS), ...Object.keys(ATTACHMENT_VIEWS)] as const;

/** A view is named by its slug: the URL vocabulary is the only vocabulary. */
export type ViewFilter = string | null;

/** What the sidebar is narrowing to: at most one view, at most one tag. */
export type Filter = { view: ViewFilter; tagId: string | null };

/** No filter at all: the whole archive. */
export const EVERYTHING: Filter = { view: null, tagId: null };

const KNOWN = new Set<string>(VIEW_SLUGS);

/**
 * Does this path segment name a view? (main.tsx redirects the rest home.)
 *
 * Asked before the local store is open, so a declared type's slug is answered
 * from what this device last saw synced rather than from the set itself.
 */
export const isViewSlug = (slug: string): boolean =>
  KNOWN.has(slug) || declaredSlugs().includes(slug);

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

/**
 * Which entity kind this view shows, if it shows one.
 *
 * Resolved against the set rather than a module-level map, because a declared
 * type's slug arrives over sync (lib/entity-types.tsx): that is what gives a
 * kind added in Postgres a URL of its own with no code change at all.
 */
export function entityKindOf(view: ViewFilter, types: EntityTypes): string | null {
  return (view && types.bySlug(view)?.kind) ?? null;
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
 * The message overlay, over whatever the sidebar is showing.
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
