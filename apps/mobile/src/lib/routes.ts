import type { TAttachmentFace, TEntityTypes } from "@ragbag/shared";
import { usePathname } from "expo-router";
import type { Href } from "expo-router";
import { useMemo } from "react";
import { declaredSlugs } from "@/lib/thing-slugs";

// The sidebar's filters ARE the route.
//
// The same claim the web app makes, and it holds here for the same reason plus
// one more: a view of the archive is the thing worth linking to, and on a phone
// a link is also what a notification, a widget and a share-sheet return land
// on. So this module is the one place that knows the vocabulary:
//
//   /                    the chat: everything, newest at the bottom
//   /favorites           messages you starred
//   /images , /files     the things inside messages
//   /links , /addresses  the things the pipeline found in them
//   /tags/<id>           one of the user's own tags
//   /links/tags/<id>     both, because the two filters have always combined
//
// and, over any of them, the surfaces that are not places:
//
//   /message/<id>        one message, in a sheet
//   /entity/<id>         one thing, in a sheet
//   /attachment/<id>     one file, which is a thing too, in a sheet
//   /photo/<id>          one photo, full screen
//   /settings            the settings stack, in a sheet
//
// One difference from the web app, and it is the platform's: those last five
// are query parameters there and routes here. On the web a panel had to be a
// param because a param can open over any view without being declared under
// each of them. A native stack has no such problem: a pushed screen sits over
// whatever was below it whichever screen that was, the one below stays mounted
// and scrolled, and the back gesture is the platform's rather than ours. What
// the web bought with `?message=` is what a stack does by construction.

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
  TAttachmentFace
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
export type TViewFilter = string | null;

/** What the sidebar is narrowing to: at most one view, at most one tag. */
export type TFilter = { view: TViewFilter; tagId: string | null };

/** No filter at all: the whole archive. */
export const EVERYTHING: TFilter = { view: null, tagId: null };

const KNOWN = new Set<string>(VIEW_SLUGS);

/**
 * Does this path segment name a view?
 *
 * Asked before the local store is open, so a declared type's slug is answered
 * from what this device last saw synced rather than from the set itself.
 */
export const isViewSlug = (slug: string): boolean =>
  KNOWN.has(slug) || declaredSlugs().includes(slug);

/** True when this view filters the chat rather than replacing it (plan §8.2). */
export function isChatView(view: TViewFilter): boolean {
  return view === null || view in CHAT_VIEWS;
}

/** Which attachment face this view shows, if it shows one. */
export function attachmentFaceOf(view: TViewFilter): TAttachmentFace | null {
  return view && view in ATTACHMENT_VIEWS
    ? ATTACHMENT_VIEWS[view as keyof typeof ATTACHMENT_VIEWS]
    : null;
}

/**
 * Which entity kind this view shows, if it shows one.
 *
 * Resolved against the synced set rather than a module-level map, because a
 * declared type's slug arrives over sync: that is what gives a kind added in
 * Postgres a URL of its own with no code change at all.
 */
export function entityKindOf(view: TViewFilter, types: TEntityTypes): string | null {
  return (view && types.bySlug(view)?.kind) ?? null;
}

/**
 * Where a sidebar row points.
 *
 * Every filter is a path, so picking a view is a navigation and not a variable
 * being set: which row is lit is answered by comparing the row's own target
 * against where the app is, and nowhere is there a second copy of "which view
 * am I on" to drift out of step with the address.
 */
export function filterHref(filter: TFilter): Href {
  const view = filter.view;
  if (filter.tagId) {
    return view ? (`/${view}/tags/${filter.tagId}` as Href) : (`/tags/${filter.tagId}` as Href);
  }
  return view ? (`/${view}` as Href) : ("/" as Href);
}

export const messageHref = (id: string): Href => `/message/${id}` as Href;
export const entityHref = (id: string): Href => `/entity/${id}` as Href;
export const attachmentHref = (id: string): Href => `/attachment/${id}` as Href;
export const photoHref = (id: string): Href => `/photo/${id}` as Href;
export const searchHref = "/search" as Href;
export const settingsHref = "/settings" as Href;

/** Two filters are the same filter when they name the same view and tag. */
export function sameFilter(a: TFilter, b: TFilter): boolean {
  return a.view === b.view && a.tagId === b.tagId;
}

/**
 * The filter a path is asking for, or `null` when the path is not a view of
 * the archive at all.
 *
 * The exact inverse of `filterHref`, so the two cannot disagree about the
 * vocabulary.
 */
export function parseFilter(pathname: string): TFilter | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return EVERYTHING;
  const view = isViewSlug(parts[0]!) ? parts[0]! : null;
  const rest = view ? parts.slice(1) : parts;
  if (rest.length === 0) return { view, tagId: null };
  if (rest.length === 2 && rest[0] === "tags") return { view, tagId: rest[1]! };
  // `/message/<id>`, `/settings`, `/search`: a surface over a view, not a view.
  return null;
}

/** Is this path one of the archive's own views, rather than a surface over one? */
export const isArchivePath = (pathname: string): boolean => parseFilter(pathname) !== null;

/**
 * The last view of the archive the app was on.
 *
 * Module scope rather than a ref per caller, and both halves of that are
 * load-bearing. *Remembered*, because the surfaces that open over a view are
 * routes here (see above) and the sidebar behind an open message sheet must
 * still light the row you came from rather than none. *Shared*, because the
 * sidebar, the screen and the empty state all answer this question and a
 * component that happens to mount while a sheet is open would otherwise start
 * from a different answer than its siblings.
 */
let lastFilter: TFilter = EVERYTHING;

/**
 * What the route is asking for: one hook for the sidebar (which row is lit),
 * the timeline (which rows exist) and the views themselves.
 *
 * Read off the path rather than out of `useLocalSearchParams`, and that is not
 * a preference. The sidebar is the drawer's content: it is mounted beside the
 * navigator rather than under any of its routes, so route params there are
 * empty, and every tag row silently lost the view it was meant to combine with
 * (`/links/tags/<id>` came out as `/tags/<id>`). The path is the one piece of
 * state both sides of the drawer can read, and it is the same string
 * `filterHref` produces.
 */
export function useFilter(): TFilter {
  const pathname = usePathname();
  return useMemo(() => {
    const parsed = parseFilter(pathname);
    // Assigning inside a memo is safe here because it is a cache of a pure
    // function of the path: re-running it with the same path re-derives the
    // same answer.
    if (parsed && !sameFilter(parsed, lastFilter)) lastFilter = parsed;
    return lastFilter;
  }, [pathname]);
}
