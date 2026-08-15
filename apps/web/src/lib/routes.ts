import type { ItemKind } from "@ragbag/shared";
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
//   /                    everything
//   /notes , /todos , …  one kind
//   /favorites           the favorites view
//   /tags/<id>           one of the user's own tags
//   /notes/tags/<id>     both, because the two filters have always combined
//   …/item/<id>          the detail drawer, over whichever view is behind it
//
// The route tree that serves these is in main.tsx, and it is deliberately small
// enough that each builder below has one `to` rather than a union of them.

export type ViewFilter = ItemKind | "favorites" | null;

/** What the rail is narrowing the timeline to: at most one view, at most one tag. */
export type Filter = { view: ViewFilter; tagId: string | null };

/** No filter at all: the whole archive. */
export const EVERYTHING: Filter = { view: null, tagId: null };

/**
 * The URL vocabulary, plural and human.
 *
 * Its own map rather than the sidebar's labels lowercased: those are copy and
 * can be reworded, these are links someone has bookmarked. (They agree today,
 * which is the point: `KIND_LABEL.pdf` is "PDFs" and this is `pdfs`.)
 */
const SLUG_BY_VIEW = {
  favorites: "favorites",
  note: "notes",
  todo: "todos",
  address: "addresses",
  link: "links",
  image: "images",
  pdf: "pdfs",
  file: "files",
} as const satisfies Record<Exclude<ViewFilter, null>, string>;

type ViewSlug = (typeof SLUG_BY_VIEW)[keyof typeof SLUG_BY_VIEW];

const VIEW_BY_SLUG = new Map<string, Exclude<ViewFilter, null>>(
  Object.entries(SLUG_BY_VIEW).map(([view, slug]) => [slug, view as Exclude<ViewFilter, null>]),
);

/** Does this path segment name a view this build knows? (main.tsx rejects the rest.) */
export const isViewSlug = (slug: string): slug is ViewSlug => VIEW_BY_SLUG.has(slug);

const slugOf = (view: ViewFilter): ViewSlug | undefined => (view ? SLUG_BY_VIEW[view] : undefined);

/**
 * What the URL is asking for. One hook for the sidebar (which row is lit), the
 * timeline (which rows exist) and the drawer (where closing goes back to), so
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
    () => ({ view: view ? (VIEW_BY_SLUG.get(view) ?? null) : null, tagId: tagId ?? null }),
    [view, tagId],
  );
}

/**
 * Where a sidebar row points.
 *
 * `resetScroll: false` on all of these, as on every other navigation in the
 * app: the timeline owns the scroll offset and re-anchors to the newest item
 * itself whenever the row set changes (components/timeline.tsx). The router's
 * default jump to the top would be a frame of the wrong position before that
 * runs.
 */
export function filterLink(filter: Filter) {
  const view = slugOf(filter.view);
  return filter.tagId
    ? ({
        to: "/{-$view}/tags/$tagId",
        params: { view, tagId: filter.tagId },
        resetScroll: false,
      } as const)
    : ({ to: "/{-$view}", params: { view }, resetScroll: false } as const);
}

/**
 * The detail drawer, over whatever the rail is showing.
 *
 * Opening an item is not leaving the timeline: the overlay is drawn above it,
 * so the filter it was opened from stays in the path and closing the drawer
 * (components/item-detail.tsx) lands exactly where it opened from.
 */
export function itemLink(id: string, filter: Filter) {
  const view = slugOf(filter.view);
  return filter.tagId
    ? ({
        to: "/{-$view}/tags/$tagId/item/$id",
        params: { view, tagId: filter.tagId, id },
        resetScroll: false,
      } as const)
    : ({ to: "/{-$view}/item/$id", params: { view, id }, resetScroll: false } as const);
}
