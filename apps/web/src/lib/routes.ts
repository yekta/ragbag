import type { AttachmentFace, EntityTypes } from "@ragbag/shared";
import { useParams, useSearch } from "@tanstack/react-router";
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
//
// and, over any of them, the surfaces that are not places (`AppSearch` below):
//
//   ?message=<id>        one message, in the panel
//   ?entity=<id>         one thing, in the panel
//   ?attachment=<id>     one file, which is a thing too, in the panel
//   ?photo=<id>          one photo of whatever the panel is showing, full screen
//   ?settings=true       the settings drawer
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
 * The query string: every surface that opens *over* a view.
 *
 * The path says which view is on screen. Nothing else does, because nothing
 * else is a view: a message, a thing, a file, a photo of one and the settings
 * drawer are all surfaces stacked on top of whatever the path is showing, and the
 * shape that says so is a flag beside the path rather than a segment appended
 * to it.
 *
 * They were segments (`…/m/<id>`, `…/e/<id>`, `/settings`), and the cost was
 * paid twice. In the route tree, because an overlay drawn over any view has to
 * be declared under every one of them: two panels times "with a tag" and
 * "without" was four routes saying the same thing, and a third panel would
 * have been six. And in `/settings`, which had no view under it at all, so
 * opening it from `/images` replaced the grid behind the drawer with the chat
 * and closing it had nowhere to land but `/`.
 *
 * As params they are orthogonal to the path, which is what they always were.
 * The route tree is down to the two routes that describe an actual place (a
 * view, and a tag narrowing it), opening a panel cannot disturb what is behind
 * it, and closing one is a key going away.
 *
 * All five are declared on the root route (main.tsx), so every screen carries
 * them and the shell can read them from above all of them. In the URL rather
 * than in a piece of state, for the same reason the filters are: these are
 * things you look at, so they survive a reload, they can be sent to someone,
 * and each one is its own entry to go back through. That last part is felt
 * daily: a photo opened over a message is two surfaces, and with state there
 * would be one back gesture for both. You would tap a photo, tap back, and the
 * message you were reading would be gone too.
 */
export type AppSearch = {
  /** The message panel. */
  message?: string;
  /** The thing panel. The same slot: at most one of the three is ever open. */
  entity?: string;
  /**
   * The file panel. The same slot again: a file is a thing this app keeps
   * (the rail lists it, search gives it its own row), so it opens the way the
   * other things do rather than opening the message it arrived in.
   */
  attachment?: string;
  /** Which photo of the open panel is full screen (components/photo-viewer.tsx). */
  photo?: string;
  /** The settings drawer. */
  settings?: true;
};

/** An id-shaped param, or nothing. */
const idParam = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/**
 * Every key is optional and absent when unset, never `false` or `""`: a flag
 * nobody set is not in the URL, and a key with a falsy value would be written
 * into every address the app builds.
 *
 * An id we do not recognise is not rejected here, because this cannot know: it
 * resolves to nothing when the panel looks it up, which the panel already
 * draws as "this is gone".
 */
export function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const message = idParam(search.message);
  const entity = idParam(search.entity);
  const attachment = idParam(search.attachment);
  const photo = idParam(search.photo);
  return {
    ...(message ? { message } : {}),
    ...(entity ? { entity } : {}),
    ...(attachment ? { attachment } : {}),
    ...(photo ? { photo } : {}),
    ...(search.settings === true ? { settings: true as const } : {}),
  };
}

/** What is open over the view, if anything. */
export type Panel = { kind: "message" | "entity" | "attachment"; id: string };

/**
 * One slot, so one hook: the panels are three shapes of the same surface, and a
 * hand-edited URL naming more than one gets the first of them rather than a
 * stack of drawers on each other.
 *
 * Read `strict: false` from the nearest match, the way `useFilter` reads
 * params: the shell renders above every route in the tree and has no single one
 * to ask.
 */
export function usePanel(): Panel | null {
  const { message, entity, attachment } = useSearch({ strict: false });
  return useMemo(
    () =>
      message
        ? { kind: "message" as const, id: message }
        : entity
          ? { kind: "entity" as const, id: entity }
          : attachment
            ? { kind: "attachment" as const, id: attachment }
            : null,
    [message, entity, attachment],
  );
}

/** Is the settings drawer open? */
export function useSettingsOpen(): boolean {
  return useSearch({ strict: false, select: (search) => search.settings === true });
}

/**
 * Opening and closing the surfaces: the path is not touched, only the keys.
 *
 * `to: "."` is the route you are already on, params and all, so one builder
 * serves every screen and a `<Link>` using it is a real link to the address the
 * reader would land on: middle-clickable, copyable, and correct from the chat,
 * from a tag and from a things view alike. Nothing has to pass the current
 * filter in to be told where it is.
 *
 * Each one starts from `validateAppSearch(prev)` rather than from `prev`
 * itself, so what rides along is the vocabulary above and only that. A param
 * this app never wrote (a `utm_` on a link someone shared, the `?error=` an
 * OAuth redirect lands on and `lib/auth-client.ts` has already read) would
 * otherwise be copied into every address built from then on and follow the
 * reader from screen to screen for the rest of the session.
 *
 * The keys each builder does name are named on purpose: opening either panel
 * closes the other and drops any photo, because that photo belonged to the
 * message being replaced.
 */
export function messageLink(id: string) {
  return {
    to: ".",
    search: (prev: AppSearch) => ({
      ...validateAppSearch(prev),
      message: id,
      entity: undefined,
      attachment: undefined,
      photo: undefined,
    }),
    resetScroll: false,
  } as const;
}

export function entityLink(id: string) {
  return {
    to: ".",
    search: (prev: AppSearch) => ({
      ...validateAppSearch(prev),
      entity: id,
      message: undefined,
      attachment: undefined,
      photo: undefined,
    }),
    resetScroll: false,
  } as const;
}

export function attachmentLink(id: string) {
  return {
    to: ".",
    search: (prev: AppSearch) => ({
      ...validateAppSearch(prev),
      attachment: id,
      message: undefined,
      entity: undefined,
      photo: undefined,
    }),
    resetScroll: false,
  } as const;
}

/** Closing whichever panel is open, and the photo it may have had open. */
export const closePanelLink = {
  to: ".",
  search: (prev: AppSearch) => ({
    ...validateAppSearch(prev),
    message: undefined,
    entity: undefined,
    attachment: undefined,
    photo: undefined,
  }),
  resetScroll: false,
} as const;

/** One photo of the open panel, full screen; `undefined` closes it. */
export function photoLink(id: string | undefined) {
  return {
    to: ".",
    search: (prev: AppSearch) => ({ ...validateAppSearch(prev), photo: id }),
    resetScroll: false,
  } as const;
}

export const openSettingsLink = {
  to: ".",
  search: (prev: AppSearch) => ({ ...validateAppSearch(prev), settings: true as const }),
  resetScroll: false,
} as const;

export const closeSettingsLink = {
  to: ".",
  search: (prev: AppSearch) => ({ ...validateAppSearch(prev), settings: undefined }),
  resetScroll: false,
} as const;

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
 * The one builder that names a path rather than staying put, and the only one
 * that passes no `search` at all. That is not an omission: a navigation
 * without one clears the whole query string, so picking a view puts away every
 * surface stacked over the last one. Changing the room is not the moment to
 * keep a drawer open.
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
