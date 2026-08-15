import { RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "@/app";
import { ItemDetail } from "@/components/item-detail";

// Two routes: the timeline, and an item-detail overlay drawn above it. The
// App shell owns the Outlet so the timeline stays mounted (and scrolled)
// while the overlay opens and closes. Staying *scrolled* also takes
// `resetScroll: false` on every navigate call now that the document is the
// scroller — see the note in components/item-card.tsx.

const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/item/$id",
  component: ItemDetail,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, itemRoute]),
  defaultNotFoundComponent: () => null,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The document is the app's scroller now (see components/timeline.tsx), and the
// timeline always opens at the newest item — so an offset restored from the
// last visit is never where we want to be. It would also be restored against a
// page whose height Zero has not filled in yet.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
