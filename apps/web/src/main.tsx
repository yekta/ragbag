import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/app";
import { EntityDetail } from "@/components/entity-detail";
import { MessageDetail } from "@/components/message-detail";
import { Settings } from "@/components/settings/settings";
import { isViewSlug } from "@/lib/routes";

// The screens, and how they nest:
//
//   /{-$view}                       /  ·  /favorites  ·  /images  ·  /links
//   /{-$view}/tags/$tagId           /tags/<id>  ·  /links/tags/<id>
//   …/m/$id                         the message overlay, over either of those
//   …/e/$id                         the entity overlay, same
//   /settings                       what to look for, storage, appearance, account
//
// The sidebar's filters are the path (lib/routes.ts), and a detail view is an
// overlay drawn above whichever filter is behind it, so the routes nest the way
// the screens stack: the overlay is a *child* of the view it opened from, which
// is what keeps that view in the URL while it is open and what closing it
// returns to.
//
// `{-$view}` is one optional path param, so "the chat" and "one kind of thing"
// are the same route with and without a leading segment. That is what holds
// this to a handful of routes rather than a pair per view, and gives every link
// builder in lib/routes.ts a single `to` instead of a union of them.
//
// The App shell owns the Outlet so the timeline stays mounted (and scrolled)
// while an overlay opens and closes. Staying *scrolled* also takes
// `resetScroll: false` on every navigate call now that the document is the
// scroller; see the note in components/message-card.tsx.
//
// This ships as a static site, so no server ever sees these paths: the host
// serves index.html for all of them and the matching happens here, in the
// browser (apps/web/public/_redirects, and the `-s` in the `start` script).
//
// A screen that is not a view of the archive (a settings page, say) goes
// *beside* `viewRoute`, not inside it: a static segment outranks a param, so
// `/settings` would match its own route rather than be read as a filter slug.

const rootRoute = createRootRoute({
  component: App,
});

const viewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/{-$view}",
  // A slug this build doesn't know (a typo, a hand-edited URL, an entity kind
  // that has since been renamed) is not a screen. There is only one home here,
  // so land on it rather than invent a 404 with nothing to say, and `replace`
  // so the back button doesn't bounce off the bad URL on the way out.
  beforeLoad: ({ params }) => {
    if (params.view !== undefined && !isViewSlug(params.view)) {
      // `view: undefined`, not `{}`: a navigation to the route it is already on
      // inherits that route's params, so an empty object leaves the bad slug in
      // place and redirects to itself until the router gives up ("Too many
      // redirects"). Naming the param is what drops the segment.
      throw redirect({ to: "/{-$view}", params: { view: undefined }, replace: true });
    }
  },
});

// No component on the tag route: a route without one renders its Outlet, which
// is exactly what it is for. The screen itself is the shell.
const tagRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "tags/$tagId",
});

const messageRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "m/$id",
  component: MessageDetail,
});

const tagMessageRoute = createRoute({
  getParentRoute: () => tagRoute,
  path: "m/$id",
  component: MessageDetail,
});

// The entity overlay is the same pattern one letter apart in the path, and it
// nests under the tag route for the same reason the message one does: closing
// it has to land back on the view it was opened from, tag and all.
const entityRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "e/$id",
  component: EntityDetail,
});

const tagEntityRoute = createRoute({
  getParentRoute: () => tagRoute,
  path: "e/$id",
  component: EntityDetail,
});

// Settings is not a view of the archive, so it sits *beside* `viewRoute` rather
// than inside it: a static segment outranks the optional param, which is what
// keeps `/settings` from being read as a filter slug and bounced home.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: Settings,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    viewRoute.addChildren([
      messageRoute,
      entityRoute,
      tagRoute.addChildren([tagMessageRoute, tagEntityRoute]),
    ]),
    settingsRoute,
  ]),
  defaultNotFoundComponent: () => null,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The document is the app's scroller now (see components/timeline.tsx), and the
// timeline always opens at the newest message, so an offset restored from the
// last visit is never where we want to be. It would also be restored against a
// page whose height Zero has not filled in yet.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
