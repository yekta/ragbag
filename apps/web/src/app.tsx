import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { queries } from "@ragbag/contracts";
import { useConnectionState, useQuery, useZero, ZeroProvider } from "@rocicorp/zero/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Composer } from "@/components/composer";
import { Icon } from "@/components/icon";
import { SearchOverlay } from "@/components/search-overlay";
import { Sidebar } from "@/components/sidebar";
import { SignIn } from "@/components/sign-in";
import { Timeline } from "@/components/timeline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { authClient, signInWithGoogle } from "@/lib/auth-client";
import { BlobQueueProvider, blobQueueFor, useBlobQueue, useBlobQueueToasts } from "@/lib/blobs";
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from "@/lib/identity";
import { useTimelineSearch } from "@/lib/search";
import { useViewStore } from "@/lib/store";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useMeta } from "@/lib/use-meta";
import type { MetaResponse } from "@ragbag/contracts";

// App shell: identity gate → Zero (local-first store + sync) → workspace.
// Auth gates *syncing*, never *using* (plan §9): once a device has an
// identity, the workspace opens instantly from the local store — session
// pending, expired, or fully offline — and a banner nudges when sync needs a
// sign-in. Only an explicit sign-out clears the identity (and local data).

type SessionStatus = "checking" | "ok" | "expired" | "offline";

/**
 * better-auth probes the session once on mount and then leaves `error` set
 * forever. One failed probe is not a verdict, though — it's a flaky network, an
 * API redeploy, or a laptop that just woke up — and treating it as one put the
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
  const [stored, setStored] = useState<Identity | null>(() => loadIdentity());

  useSessionRecovery(session.error, session.refetch);

  // "system" theme follows the OS while the app is open. index.html applied the
  // stored choice before first paint; this only handles later changes.
  useEffect(() => watchSystemTheme(() => applyTheme(useViewStore.getState().theme)), []);

  // Remember the signed-in identity for offline launches.
  useEffect(() => {
    if (session.data) {
      const identity = {
        userID: session.data.user.id,
        name: session.data.user.name || "you",
      };
      saveIdentity(identity);
      setStored(identity);
    }
  }, [session.data]);

  let identity: Identity | null = null;
  let status: SessionStatus;
  if (session.data) {
    identity = { userID: session.data.user.id, name: session.data.user.name || "you" };
    status = "ok";
  } else if (session.isPending) {
    identity = stored;
    status = "checking";
  } else if (session.error || !navigator.onLine) {
    // Couldn't reach the server — offline launch from the local store.
    identity = stored;
    status = "offline";
  } else {
    // Server says: no session. Expired (identity kept, local archive stays
    // usable) — or never signed in on this device.
    identity = stored;
    status = "expired";
  }

  if (!identity) {
    if (session.isPending) {
      return (
        <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
          <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
        </main>
      );
    }
    return <SignIn />;
  }

  return <Workspace key={identity.userID} identity={identity} status={status} />;
}

/**
 * Explicit sign-out: forget the device identity, then reload — the SignIn
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

function Workspace({ identity, status }: { identity: Identity; status: SessionStatus }) {
  const meta = useMeta();
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
    <ZeroProvider
      {...opts}
      init={(zero) => {
        // Preload the whole archive (plan §6): every device holds the full
        // timeline, so reads and search work fully offline. 'forever' keeps
        // the queries registered even when no screen is showing them.
        zero.preload(queries.timeline(), { ttl: "forever" });
        zero.preload(queries.tags(), { ttl: "forever" });
      }}
    >
      <BlobQueueProvider value={queue}>
        <QueueWiring sessionOk={status === "ok"} />
        <Shell name={identity.name} meta={meta} status={status} onSignOut={() => void signOut()} />
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

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Zero reports precisely who refused us and with what — pass it on verbatim. */
type AuthRejection = Extract<
  ReturnType<typeof useConnectionState>,
  { name: "needs-auth" }
>["reason"];

function describeRejection(reason: AuthRejection): string {
  return reason.type === "zero-cache"
    ? `the sync service reported: ${reason.reason}`
    : `its ${reason.type} endpoint answered ${reason.status}`;
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
// swap to a solid fill on hover — no alpha either way.
const BANNER_BUTTON =
  "bg-warning-foreground text-warning hover:bg-warning hover:text-warning-foreground hover:ring-1 hover:ring-warning-foreground";

function SyncBanner({ status, meta }: { status: SessionStatus; meta: MetaResponse | undefined }) {
  const conn = useConnectionState();
  const online = useOnline();
  const zero = useZero();
  const [error, setError] = useState<string>();

  // These two used to share one "Signed out" banner, which made a server-side
  // sync fault look like an expired login: the app said signed out while the
  // session was perfectly valid, and the only offered action — sign in again —
  // could not fix it. They are different situations, so they read differently.
  //
  // `expired`: the API says this session is gone. Signing in is the fix.
  if (status === "expired") {
    return (
      <BannerAlert>
        <AlertDescription className="text-warning-foreground">
          {error ?? "Signed out — your archive is safe on this device and syncing is paused."}
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
  // turned away. That is the server's problem to fix, not the user's — so name
  // what happened and offer a retry rather than a pointless sign-in.
  if (conn.name === "needs-auth") {
    return (
      <BannerAlert>
        <AlertDescription className="text-warning-foreground">
          Signed in, but sync was refused — {describeRejection(conn.reason)}. Your archive is safe
          on this device; new dumps stay local until sync is accepted.
        </AlertDescription>
        <Button size="xs" className={BANNER_BUTTON} onClick={() => void zero.connection.connect()}>
          Retry sync
        </Button>
      </BannerAlert>
    );
  }

  if (!online || status === "offline" || conn.name === "disconnected") {
    return (
      <p className="border-b bg-muted px-4 py-1.5 text-center text-xs text-muted-foreground">
        Offline — dumping and search keep working; sync resumes automatically.
      </p>
    );
  }
  return null;
}

function Shell({
  name,
  meta,
  status,
  onSignOut,
}: {
  name: string;
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
    // the document itself is what scrolls (WINDOW_SCROLL_PLAN.md). `dvh` over
    // shadcn's own `svh` so a short archive still puts the composer at the
    // bottom of what is actually visible.
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => setSidebarCollapsed(!open)}
      className="min-h-dvh"
    >
      <ShellBody name={name} meta={meta} status={status} onSignOut={onSignOut} />
    </SidebarProvider>
  );
}

/** Inside the provider, so the floating controls can reach `useSidebar()`. */
function ShellBody({
  name,
  meta,
  status,
  onSignOut,
}: {
  name: string;
  meta: MetaResponse | undefined;
  status: SessionStatus;
  onSignOut: () => void;
}) {
  const [items, itemsResult] = useQuery(queries.timeline());
  const [tags] = useQuery(queries.tags());
  const conn = useConnectionState();
  // Sync isn't coming back on its own in these states, so nothing downstream
  // should keep presenting itself as "in progress".
  const syncPaused = conn.name === "needs-auth" || conn.name === "disconnected";
  const searchIndex = useTimelineSearch(items);
  const { setSearchOpen } = useViewStore();
  const { isMobile, open, setOpen, setOpenMobile } = useSidebar();

  return (
    <>
      <Sidebar
        items={items}
        tags={tags}
        name={name}
        meta={meta}
        sessionExpired={status === "expired"}
        onSignOut={onSignOut}
      />

      {/* No `overflow` here, ever: it would make this column a scroll container,
          and the sticky chrome inside it would then stick to *that* — which
          never scrolls — instead of to the viewport (WINDOW_SCROLL_PLAN.md
          §2). `overflow-x-clip` is the safe one if clipping is ever needed:
          `clip` is not a scroll container. */}
      <SidebarInset className="relative min-w-0">
        {/* What the column's fixed height used to pin, the viewport pins now.
            Sticky rather than fixed so the banner keeps its slot in the flow:
            the controls stay below it, and the timeline's own offset accounts
            for it without anyone measuring the banner twice. The block is
            zero-height when no banner is showing — and a zero-height sticky box
            still sticks, so the controls float exactly as they did. */}
        <div className="sticky top-0 z-30">
          <SyncBanner status={status} meta={meta} />
          {/* Zero-height anchor: the floating controls land below the sync
              banner without covering it. */}
          <div className="relative">
            {isMobile ? (
              <>
                <FloatingButton
                  className="left-3 top-3"
                  title="Menu"
                  onClick={() => setOpenMobile(true)}
                >
                  <Icon name="menu" className="size-5" />
                </FloatingButton>
                <FloatingButton
                  className="right-3 top-3"
                  title="Search"
                  onClick={() => setSearchOpen(true)}
                >
                  <Icon name="search" className="size-4" />
                </FloatingButton>
              </>
            ) : (
              !open && (
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
        <Timeline items={items} synced={itemsResult.type === "complete"} syncPaused={syncPaused} />
        <Composer canAttach={meta?.blobs ?? true} />
      </SidebarInset>

      <SearchOverlay index={searchIndex} items={items} />
      <Toaster position="top-center" />
      <Outlet />
    </>
  );
}

/** Round button for the controls that sit over the timeline. */
function FloatingButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={`absolute rounded-full bg-card text-muted-foreground shadow-md ${className ?? ""}`}
      {...props}
    />
  );
}
