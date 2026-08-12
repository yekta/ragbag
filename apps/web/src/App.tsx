import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { queries } from "@ragbag/contracts";
import { useConnectionState, useQuery, ZeroProvider } from "@rocicorp/zero/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Composer } from "./components/Composer.js";
import { Icon } from "./components/Icon.js";
import { SearchOverlay } from "./components/SearchOverlay.js";
import { Sidebar } from "./components/Sidebar.js";
import { SignIn } from "./components/SignIn.js";
import { Timeline } from "./components/Timeline.js";
import { authClient } from "./lib/auth-client.js";
import { BlobQueueProvider, blobQueueFor, useBlobQueue } from "./lib/blobs.js";
import { clearIdentity, loadIdentity, saveIdentity, type Identity } from "./lib/identity.js";
import { useTimelineSearch } from "./lib/search.js";
import { useViewStore } from "./lib/store.js";
import { useMeta } from "./lib/use-meta.js";
import type { MetaResponse } from "@ragbag/contracts";

// App shell: identity gate → Zero (local-first store + sync) → workspace.
// Auth gates *syncing*, never *using* (plan §9): once a device has an
// identity, the workspace opens instantly from the local store — session
// pending, expired, or fully offline — and a banner nudges when sync needs a
// sign-in. Only an explicit sign-out clears the identity (and local data).

type SessionStatus = "checking" | "ok" | "expired" | "offline";

export function App() {
  const session = authClient.useSession();
  const [stored, setStored] = useState<Identity | null>(() => loadIdentity());

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
        <main className="flex h-dvh items-center justify-center bg-neutral-50 text-neutral-400">
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

/** Wakes the blob queue whenever a session becomes available again. */
function QueueWiring({ sessionOk }: { sessionOk: boolean }) {
  const queue = useBlobQueue();
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

function SyncBanner({ status, meta }: { status: SessionStatus; meta: MetaResponse | undefined }) {
  const conn = useConnectionState();
  const online = useOnline();

  const needsSignIn = status === "expired" || conn.name === "needs-auth";
  if (needsSignIn) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <span>Signed out — your archive is safe on this device and syncing is paused.</span>
        {meta?.googleAuth && (
          <button
            className="rounded-lg bg-amber-900 px-2.5 py-1 text-xs font-medium text-amber-50 hover:bg-amber-800"
            onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: "/" })}
          >
            Sign in with Google
          </button>
        )}
        {meta?.devLogin && (
          <button
            className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100"
            onClick={() => void authClient.signIn.anonymous()}
          >
            Dev sign-in
          </button>
        )}
      </div>
    );
  }
  if (!online || status === "offline" || conn.name === "disconnected") {
    return (
      <div className="border-b border-neutral-200 bg-neutral-100 px-4 py-1.5 text-center text-xs text-neutral-500">
        Offline — dumping and search keep working; sync resumes automatically.
      </div>
    );
  }
  return null;
}

/** Floating round button for the controls that sit over the timeline. */
const floatingButton =
  "pointer-events-auto flex size-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-md transition hover:bg-neutral-50 hover:text-neutral-800";

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
  const [items, itemsResult] = useQuery(queries.timeline());
  const [tags] = useQuery(queries.tags());
  const searchIndex = useTimelineSearch(items);
  const { sidebarCollapsed, sidebarOpen, toggleSidebar, setSidebarOpen, setSearchOpen } =
    useViewStore();

  // ⌘\ toggles the desktop rail; Esc closes the mobile drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useViewStore.getState().toggleSidebar();
      } else if (e.key === "Escape" && useViewStore.getState().sidebarOpen) {
        useViewStore.getState().setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = <Sidebar items={items} tags={tags} name={name} onSignOut={onSignOut} />;

  return (
    <div className="flex h-dvh bg-neutral-50 text-neutral-900">
      {/* Desktop rail: a floating card that slides off-canvas when collapsed.
          The inner box keeps its width so the content doesn't reflow mid-slide. */}
      <div
        className={`hidden w-72 shrink-0 py-3 pl-3 transition-[margin,opacity] duration-300 md:block ${
          sidebarCollapsed ? "pointer-events-none -ml-72 opacity-0" : ""
        }`}
      >
        {sidebar}
      </div>

      {/* Mobile: the same card as an overlay drawer over a scrim. */}
      <div className={`fixed inset-0 z-40 md:hidden ${sidebarOpen ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-neutral-900/30 transition-opacity duration-300 ${
            sidebarOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] py-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] transition-transform duration-300 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebar}
        </div>
      </div>

      {/* relative: the composer floats over the timeline inside this column */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <SyncBanner status={status} meta={meta} />
        {/* Zero-height anchors: the floating controls land below the sync
            banner without covering it. */}
        {sidebarCollapsed && (
          <div className="relative z-10 hidden md:block">
            <button
              className={`${floatingButton} absolute left-3 top-3`}
              title="Show sidebar (⌘\)"
              onClick={toggleSidebar}
            >
              <Icon name="sidebar" className="size-4" />
            </button>
          </div>
        )}
        <div className="relative z-10 md:hidden">
          <button
            className={`${floatingButton} absolute left-3 top-3`}
            title="Menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" className="size-5" />
          </button>
          <button
            className={`${floatingButton} absolute right-3 top-3`}
            title="Search"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="search" className="size-4" />
          </button>
        </div>
        <Timeline items={items} synced={itemsResult.type === "complete"} />
        <Composer canAttach={meta?.blobs ?? true} />
      </main>
      <SearchOverlay index={searchIndex} items={items} />
      <Outlet />
    </div>
  );
}
