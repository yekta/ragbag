import type { TAttachmentFace, TEntityTypes } from "@ragbag/shared";
import { useLocalSearchParams } from "expo-router";
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
export const settingsHref = "/settings" as Href;

/**
 * What the route is asking for: one hook for the sidebar (which row is lit),
 * the timeline (which rows exist) and the views themselves.
 *
 * `useLocalSearchParams` rather than `useGlobalSearchParams`: the sidebar and
 * the list are inside the screen that owns these segments, and the global
 * variant keeps reporting the last matched route's params from a screen that
 * has been pushed over, which lights the wrong row behind an open sheet.
 */
export function useFilter(): TFilter {
  const params = useLocalSearchParams<{ view?: string; tagId?: string }>();
  return useMemo(() => {
    const view = params.view;
    return {
      view: view && isViewSlug(view) ? view : null,
      tagId: params.tagId ?? null,
    };
  }, [params.tagId, params.view]);
}
