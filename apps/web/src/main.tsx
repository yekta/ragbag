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
import { ItemDetail } from "@/components/item-detail";
import { isViewSlug } from "@/lib/routes";

// The screens, and how they nest:
//
//   /{-$view}                       /  ·  /notes  ·  /favorites
//   /{-$view}/tags/$tagId           /tags/<id>  ·  /notes/tags/<id>
//   …/item/$id                      the detail overlay, over either of those
//
// The rail's filters are the path (lib/routes.ts), and the item detail is an
// overlay drawn above whichever filter is behind it, so the routes nest the way
// the screens stack: the drawer is a *child* of the view it opened from, which
// is what keeps that view in the URL while it is open and what closing it
// returns to.
//
// `{-$view}` is one optional path param, so "everything" and "one kind" are the
// same route with and without a leading segment. That is what holds this to
// four routes rather than a pair per view, and gives every link builder in
// lib/routes.ts a single `to` instead of a union of them.
//
// The App shell owns the Outlet so the timeline stays mounted (and scrolled)
// while the overlay opens and closes. Staying *scrolled* also takes
// `resetScroll: false` on every navigate call now that the document is the
// scroller; see the note in components/item-card.tsx.
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
  // A slug this build doesn't know (a typo, a hand-edited URL, a view that has
  // since been renamed) is not a screen. There is only one screen here, so land
  // on it rather than invent a 404 with nothing to say, and `replace` so the
  // back button doesn't bounce off the bad URL on the way out.
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

// No component on the two filter routes: a route without one renders its
// Outlet, which is exactly what they are for. The screen itself is the shell.
const tagRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "tags/$tagId",
});

const itemRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "item/$id",
  component: ItemDetail,
});

const tagItemRoute = createRoute({
  getParentRoute: () => tagRoute,
  path: "item/$id",
  component: ItemDetail,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    viewRoute.addChildren([itemRoute, tagRoute.addChildren([tagItemRoute])]),
  ]),
  defaultNotFoundComponent: () => null,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The document is the app's scroller now (see components/timeline.tsx), and the
// timeline always opens at the newest item, so an offset restored from the
// last visit is never where we want to be. It would also be restored against a
// page whose height Zero has not filled in yet.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
