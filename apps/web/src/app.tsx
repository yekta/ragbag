import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { queries, type Schema } from "@ragbag/contracts";
import { useQuery, useZero, ZeroProvider } from "@rocicorp/zero/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Composer } from "@/components/composer";
import { Icon } from "@/components/icon";
import { SearchOverlay } from "@/components/search-overlay";
import { SettleCover } from "@/components/settle-cover";
import { Sidebar } from "@/components/sidebar";
import { SignIn } from "@/components/sign-in";
import { Timeline } from "@/components/timeline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { authClient, OAUTH_REDIRECT_ERROR, signInWithGoogle } from "@/lib/auth-client";
import { useArchiveHintWriter, useArchiveState, useStableRows } from "@/lib/archive-state";
import { BlobQueueProvider, blobQueueFor, useBlobQueue, useBlobQueueToasts } from "@/lib/blobs";
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from "@/lib/identity";
import { useTimelineSearch } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import { BUDGET, useHeld, useLatch } from "@/lib/settle";
import { useSyncStatus, type SyncStatus } from "@/lib/sync-status";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useMeta } from "@/lib/use-meta";
import type { MetaResponse } from "@ragbag/contracts";
import type { Zero } from "@rocicorp/zero";

// App shell: identity gate → Zero (local-first store + sync) → workspace.
// Auth gates *syncing*, never *using* (plan §9): once a device has an
// identity, the workspace opens instantly from the local store (session
// pending, expired, or fully offline) and a banner nudges when sync needs a
// sign-in. Only an explicit sign-out clears the identity (and local data).
//
// Nothing here paints a state it is about to take back (lib/settle.ts): the
// boot screen is the bare canvas until it knows which screen it owes you.

type SessionStatus = "checking" | "ok" | "expired" | "offline";

/**
 * better-auth probes the session once on mount and then leaves `error` set
 * forever. One failed probe is not a verdict, though: it's a flaky network, an
 * API redeploy, or a laptop that just woke up, and treating it as one put the
 * app in `offline` until a manual reload, on an app whose whole premise is
 * riding those out. So retry on a backoff, and immediately when the browser
 * says it's back.
 */
function useSessionRecovery(error: unknown, refetch: () => void): void {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!error) {
      setAttempt(0);
      return;
    }
    // 1s, 2s, 4s … capped at 30s. Each failure schedules the next attempt;
    // `attempt` is a dependency so this re-arms even if the error object
    // happens to be identical between tries.
    const timer = setTimeout(
      () => {
        void refetch();
        setAttempt((n) => n + 1);
      },
      Math.min(1_000 * 2 ** attempt, 30_000),
    );
    return () => clearTimeout(timer);
  }, [error, refetch, attempt]);

  useEffect(() => {
    const onOnline = () => {
      setAttempt(0);
      void refetch();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refetch]);
}

export function App() {
  const session = authClient.useSession();
  const meta = useMeta();
  const [stored, setStored] = useState<Identity | null>(() => loadIdentity());
  // The boot screen's budget: how long the canvas may stand in for a sign-in
  // screen before an unreachable server becomes the thing we say out loud.
  const waited = useHeld(!meta, BUDGET.unreachable);

  useSessionRecovery(session.error, session.refetch);

  // "system" theme follows the OS while the app is open. index.html applied the
  // stored choice before first paint; this only handles later changes.
  useEffect(() => watchSystemTheme(() => applyTheme(useViewStore.getState().theme)), []);

  // Remember the signed-in identity for offline launches.
  useEffect(() => {
    if (session.data) {
      const identity = {
        userID: session.data.user.id,
        email: session.data.user.email || "you",
      };
      saveIdentity(identity);
      setStored(identity);
    }
  }, [session.data]);

  let identity: Identity | null = null;
  let status: SessionStatus;
  if (session.data) {
    identity = { userID: session.data.user.id, email: session.data.user.email || "you" };
    status = "ok";
  } else if (session.isPending) {
    identity = stored;
    status = "checking";
  } else if (session.error || !navigator.onLine) {
    // Couldn't reach the server: offline launch from the local store.
    identity = stored;
    status = "offline";
  } else {
    // Server says: no session. Expired (identity kept, local archive stays
    // usable), or never signed in on this device.
    identity = stored;
    status = "expired";
  }

  if (!identity) {
    // No device identity: the sign-in screen is the answer, but only once it
    // can be drawn complete. Capabilities decide which buttons exist, so a card
    // rendered before /api/meta lands is a card that changes shape under the
    // cursor. Until then this is the bare canvas, and, if the server is slow
    // enough that the wait is real, one spinner.
    //
    // Unless the server never answers at all: a spinner with no end is not a
    // screen. Past the budget, the card is drawn anyway and says what is wrong,
    // which is a state in its own right rather than a stand-in for one.
    if ((session.isPending || !meta) && !waited) return <SettleCover show loader />;
    return <SignIn meta={meta ?? null} />;
  }

  return <Workspace key={identity.userID} identity={identity} meta={meta} status={status} />;
}

/**
 * Preload the whole archive (plan §6): every device holds the full timeline, so
 * reads and search work fully offline. 'forever' keeps the queries registered
 * even when no screen is showing them.
 *
 * Module scope, and it must stay there. Every prop of `ZeroProvider` (`init`
 * included) is a dependency of the effect that constructs the client, and that
 * effect's cleanup is `zero.close()`. An inline callback here rebuilt the Zero
 * client on *every render of `Workspace`* (five clients per page load, measured),
 * which reset every query view to empty and made the timeline flash the sync
 * spinner over and over.
 */
const preloadArchive = (zero: Zero<Schema>) => {
  if (import.meta.env.DEV) {
    inits += 1;
    if (inits > 2) {
      console.error(
        `[settle] the Zero client has been built ${inits} times this page load. Something ` +
          `passed ZeroProvider an unstable prop. Two is StrictMode's double mount.`,
      );
    }
  }
  zero.preload(queries.timeline(), { ttl: "forever" });
  zero.preload(queries.tags(), { ttl: "forever" });
};

let inits = 0;

/**
 * Explicit sign-out: forget the device identity, then reload: the SignIn
 * screen clears local data (Zero stores + blob caches) once Zero is unmounted.
 */
async function signOut(): Promise<void> {
  clearIdentity();
  await authClient.signOut().catch(() => {
    // Offline sign-out still signs out locally; the session dies server-side
    // when it expires.
  });
  location.assign("/");
}

function Workspace({
  identity,
  meta,
  status,
}: {
  identity: Identity;
  meta: MetaResponse | undefined;
  status: SessionStatus;
}) {
  const queue = blobQueueFor(identity.userID);
  const opts = useMemo(
    () =>
      ragbagZeroOptions({
        cacheURL: import.meta.env.VITE_ZERO_CACHE_URL ?? "http://localhost:4848",
        userID: identity.userID,
        kvStore: "idb",
      }),
    [identity.userID],
  );

  return (
    <ZeroProvider {...opts} init={preloadArchive}>
      <BlobQueueProvider value={queue}>
        <QueueWiring sessionOk={status === "ok"} />
        <Shell
          email={identity.email}
          meta={meta}
          status={status}
          onSignOut={() => void signOut()}
        />
      </BlobQueueProvider>
    </ZeroProvider>
  );
}

/**
 * Wakes the blob queue whenever a session becomes available again, and turns
 * upload failures into toasts (once per blob, not once per retry).
 */
function QueueWiring({ sessionOk }: { sessionOk: boolean }) {
  const queue = useBlobQueue();
  useBlobQueueToasts();
  useEffect(() => {
    // A fresh session unparks uploads that 401'd while signed out.
    if (sessionOk) queue.notifyAuthChanged();
  }, [sessionOk, queue]);
  return null;
}

/** Shared chrome for the amber banner; the wording is what differs. */
function BannerAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-none border-x-0 border-t-0 bg-warning text-warning-foreground">
      {children}
    </Alert>
  );
}

// Both actions borrow the banner's own amber rather than the mint primary, and
// swap to a solid fill on hover, no alpha either way.
const BANNER_BUTTON =
  "bg-warning-foreground text-warning hover:bg-warning hover:text-warning-foreground hover:ring-1 hover:ring-warning-foreground";

function SyncBanner({ sync, meta }: { sync: SyncStatus | null; meta: MetaResponse | undefined }) {
  const zero = useZero();
  // Seeded so a re-auth that failed mid-round-trip explains itself here rather
  // than silently restoring the generic "Signed out" copy below.
  const [error, setError] = useState<string | undefined>(OAUTH_REDIRECT_ERROR);

  // `sync` is already settled (lib/sync-status.ts): a blip between reconnects
  // never reaches this point, so a banner appearing is always news. That
  // matters more here than anywhere else: this block is in the document flow,
  // so anything it does moves the entire timeline down.
  //
  // These two used to share one "Signed out" banner, which made a server-side
  // sync fault look like an expired login: the app said signed out while the
  // session was perfectly valid, and the only offered action (sign in again)
  // could not fix it. They are different situations, so they read differently.
  //
  // `expired`: the API says this session is gone. Signing in is the fix.
  if (sync?.name === "expired") {
    return (
      <BannerAlert>
        <AlertDescription className="text-warning-foreground">
          {error ?? "Signed out. Your archive is safe on this device and syncing is paused."}
        </AlertDescription>
        {meta?.googleAuth && (
          <Button
            size="xs"
            className={BANNER_BUTTON}
            onClick={() => {
              setError(undefined);
              void signInWithGoogle().then(setError);
            }}
          >
            Sign in with Google
          </Button>
        )}
        {meta?.devLogin && (
          <Button
            size="xs"
            variant="outline"
            className="border-warning-foreground bg-warning text-warning-foreground hover:bg-warning-foreground hover:text-warning"
            onClick={() => {
              setError(undefined);
              void authClient.signIn
                .anonymous()
                .then(({ error: err }) => setError(err?.message ?? undefined));
            }}
          >
            Dev sign-in
          </Button>
        )}
      </BannerAlert>
    );
  }

  // `needs-auth` with a live session: we are signed in and sync still got
  // turned away. That is the server's problem to fix, not the user's, so name
  // what happened and offer a retry rather than a pointless sign-in.
  if (sync?.name === "refused") {
    return (
      <BannerAlert>
        <AlertDescription className="text-warning-foreground">
          Signed in, but sync was refused: {sync.detail}. Your archive is safe on this device; new
          dumps stay local until sync is accepted.
        </AlertDescription>
        <Button size="xs" className={BANNER_BUTTON} onClick={() => void zero.connection.connect()}>
          Retry sync
        </Button>
      </BannerAlert>
    );
  }

  if (sync?.name === "offline") {
    return (
      <p className="border-b bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">
        Offline. Dumping and search keep working; sync resumes automatically.
      </p>
    );
  }
  return null;
}

function Shell({
  email,
  meta,
  status,
  onSignOut,
}: {
  email: string;
  meta: MetaResponse | undefined;
  status: SessionStatus;
  onSignOut: () => void;
}) {
  const { sidebarCollapsed, setSidebarCollapsed } = useViewStore();

  return (
    // Controlled: collapse is a device preference owned by the view store
    // (localStorage), not the cookie the generated provider used to write.
    // ⌘\ lives inside the provider (SIDEBAR_KEYBOARD_SHORTCUT); Esc closes the
    // mobile drawer through the underlying Sheet.
    //
    // A *minimum* height, not a fixed one: the shell grows with the archive so
    // the document itself is what scrolls (components/timeline.tsx). `dvh` over
    // shadcn's own `svh` so a short archive still puts the composer at the
    // bottom of what is actually visible.
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => setSidebarCollapsed(!open)}
      className="min-h-dvh"
    >
      <ShellBody email={email} meta={meta} status={status} onSignOut={onSignOut} />
    </SidebarProvider>
  );
}

/** Inside the provider, so the floating controls can reach `useSidebar()`. */
/**
 * When the sidebar panel has *visually* left, which is not when its transition
 * ends. `--ease-panel` front-loads the distance: solving it for the 450ms in
 * ui/sidebar.tsx gives 97.5% of the travel done by here and 99% by 300ms, so
 * everything past this point is a tail nobody can see. Waiting out the full
 * duration spent that tail on an empty corner, which reads as the button being
 * late rather than as the panel still arriving.
 *
 * Below ~210ms the panel is genuinely still moving (95%) and the button starts
 * arriving into it. Re-derive if the curve or the duration changes.
 */
const SIDEBAR_CLEARED_MS = 250;

function ShellBody({
  email,
  meta,
  status,
  onSignOut,
}: {
  email: string;
  meta: MetaResponse | undefined;
  status: SessionStatus;
  onSignOut: () => void;
}) {
  const [rawItems, itemsResult] = useQuery(queries.timeline());
  const [tags] = useQuery(queries.tags());
  const sync = useSyncStatus(status === "expired");
  // Never fewer rows than we have already painted (lib/archive-state.ts).
  const items = useStableRows(rawItems, itemsResult.type);
  // The list element, watched to know when the page has come to rest: the
  // reveal waits for that, not for a stopwatch.
  const listRef = useRef<HTMLDivElement>(null);
  const state = useArchiveState({
    count: items.length,
    resultType: itemsResult.type,
    sync,
    anchor: listRef,
  });
  useArchiveHintWriter(state, items.length);
  // Has the app ever been on screen this session? Only then is a cover a
  // transition rather than the boot.
  const revealed = useLatch(state !== "opening");
  const searchIndex = useTimelineSearch(items);
  const { setSearchOpen } = useViewStore();
  const { isMobile, open, setOpen, setOpenMobile } = useSidebar();
  // The control that reopens the sidebar belongs to the closed state, and the
  // app is not in the closed state until the panel has finished leaving: the
  // panel slides across exactly where this button sits, so showing it on the
  // click means watching it sit under a moving sheet of sidebar. Opening is the
  // other way round and needs no wait: it goes at once, ahead of the panel that
  // is about to cover it. Booting straight into a closed sidebar is neither:
  // nothing has moved, so there is nothing to wait for.
  const sidebarUsed = useLatch(open);
  const sidebarGone = useHeld(!open, SIDEBAR_CLEARED_MS);
  const showSidebarButton = !open && (!sidebarUsed || sidebarGone);

  return (
    <>
      {/* Over a shell that is already mounted: the timeline lays out, measures
          and anchors itself to the newest item underneath this, so the first
          frame anyone sees is the finished one.
          
          After a first sync it comes back: the archive has to lay itself out
          somewhere unseen, but by then the app is on screen and in use, so it
          arrives as a cross-fade from the sync loader rather than as a cut to
          the canvas. */}
      <SettleCover show={state === "opening"} fadeIn={revealed} />

      <Sidebar
        items={items}
        tags={tags}
        email={email}
        meta={meta}
        sync={sync}
        onSignOut={onSignOut}
      />

      {/* No `overflow` here, ever: it would make this column a scroll container,
          and the sticky chrome inside it would then stick to *that*, which
          never scrolls, instead of to the viewport. `overflow-x-clip` is the
          safe one if clipping is ever needed: `clip` is not a scroll
          container. */}
      {/* `overflow-x-clip`, never `overflow-x-hidden`: `hidden` would make this
          column a scroll container and the sticky chrome inside it would stick
          to *that* instead of to the viewport (see the note below). `clip` is
          not a scroll container, so it draws the line without moving anything:
          the app column cannot be dragged sideways by whatever a row happens to
          contain. */}
      <SidebarInset className="relative min-w-0 overflow-x-clip">
        {/* What the column's fixed height used to pin, the viewport pins now.
            Sticky rather than fixed so the banner keeps its slot in the flow:
            the controls stay below it, and the timeline's own offset accounts
            for it without anyone measuring the banner twice. The block is
            zero-height when no banner is showing, and a zero-height sticky box
            still sticks, so the controls float exactly as they did. */}
        <div className="sticky top-0 z-30">
          <SyncBanner sync={sync} meta={meta} />
          {/* Zero-height anchor: the floating controls land below the sync
              banner without covering it. */}
          <div className="relative">
            {/* The phone's only chrome, so they are sized like chrome rather
                than like a control inside a card: iOS has drawn a navigation
                bar button at 44pt since iOS 7, and iOS 26 still does: the
                Liquid Glass capsule *is* the 44pt target, with an 18–24pt
                glyph inside it. Points are CSS pixels here, so that reads
                `size-11` around `size-6`. The desktop control below is a mouse
                target and stays at the stock 36px; the two branches never
                coexist (`isMobile` is <768px, `md:` is ≥768px), which is also
                why `--timeline-inset-top` can switch on that same breakpoint
                rather than measure anything. */}
            {isMobile ? (
              <>
                <FloatingButton
                  className="left-3 top-3 size-11"
                  title="Menu"
                  onClick={() => setOpenMobile(true)}
                >
                  <Icon name="menu" className="size-6" />
                </FloatingButton>
                <FloatingButton
                  className="right-3 top-3 size-11"
                  title="Search"
                  onClick={() => setSearchOpen(true)}
                >
                  <Icon name="search" className="size-6" />
                </FloatingButton>
              </>
            ) : (
              showSidebarButton && (
                <FloatingButton
                  className="left-3 top-3"
                  title="Show sidebar (⌘\)"
                  onClick={() => setOpen(true)}
                >
                  <Icon name="sidebar" className="size-4" />
                </FloatingButton>
              )
            )}
          </div>
        </div>
        <Timeline items={items} state={state} sync={sync} listRef={listRef} />
        <Composer canAttach={meta?.blobs ?? true} />
      </SidebarInset>

      <SearchOverlay index={searchIndex} items={items} />
      <Toaster position="top-center" />
      <Outlet />
    </>
  );
}

/**
 * Round button for the controls that sit over the timeline.
 *
 * One chrome surface: the composer and the sidebar are both `--card`, and so is
 * this. `--secondary` was here before, on the argument that a card-coloured
 * button dissolves into the card rows passing under it, but the border and
 * `shadow-float` (the token that exists for exactly this lift off the canvas)
 * are what separate it, and a second surface only for these three buttons read
 * as an odd one out.
 *
 * `ghost` rather than a variant that brings its own fill, so the surface set
 * here has no variant background to out-specify. That fight used to be worth
 * avoiding for real: a theme-prefixed background is a different twMerge group
 * from an unprefixed one, so it does not read as a conflict and wins on
 * specificity. Gone from the app now: rule 2 in index.css has the argument.
 */
function FloatingButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`absolute rounded-full border bg-card text-muted-foreground shadow-float hover:bg-panel ${className ?? ""}`}
      {...props}
    />
  );
}
