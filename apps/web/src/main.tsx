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
import { isViewSlug, validateAppSearch } from "@/lib/routes";

// The screens:
//
//   /{-$view}                       /  ·  /favorites  ·  /images  ·  /links
//   /{-$view}/tags/$tagId           /tags/<id>  ·  /links/tags/<id>
//
// and, over either of them, the surfaces that are not places, which are query
// params rather than routes (lib/routes.ts):
//
//   ?message=<id>  ?entity=<id>  ?photo=<id>  ?settings=true
//
// Two routes, because there are two places: a view of the archive, and a tag
// narrowing it. Everything else in this app is drawn *over* one of those, and
// an overlay that can open over any view is a rotten fit for a path: it has to
// be declared under every view it can open over, which is why the panels used
// to cost four routes (message and thing, each with and without a tag) to say
// one thing. As params they cost none, and the shell mounts them from what the
// query says (app.tsx).
//
// `{-$view}` is one optional path param, so "the chat" and "one kind of thing"
// are the same route with and without a leading segment. That is what holds
// this to a handful of routes rather than a pair per view, and gives every link
// builder in lib/routes.ts a single `to` instead of a union of them.
//
// No route below the root has a component, so nothing renders an Outlet: the
// tree's whole job is to say what the path means (which view, which tag) and to
// turn a slug it doesn't know into a redirect. The screens themselves are the
// shell's, which is what keeps the timeline mounted, and scrolled, while a
// panel opens and closes over it. Staying *scrolled* also takes
// `resetScroll: false` on every navigate call now that the document is the
// scroller; see the note in components/message-card.tsx.
//
// This ships as a static site, so no server ever sees these paths: the host
// serves index.html for all of them and the matching happens here, in the
// browser (apps/web/public/_redirects, and the `-s` in the `start` script).

// The query vocabulary is declared once, here, because every route below
// inherits the root's search params and every one of these surfaces can open
// over every screen.
const rootRoute = createRootRoute({
  component: App,
  validateSearch: validateAppSearch,
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

// A tag narrows whichever view it sits under, so it is a segment on that view
// rather than a route of its own with its own screen.
const tagRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "tags/$tagId",
});

const router = createRouter({
  routeTree: rootRoute.addChildren([viewRoute.addChildren([tagRoute])]),
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
