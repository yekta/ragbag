import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { mutators, queries } from "@ragbag/contracts";
import { useConnectionState, useQuery, useZero, ZeroProvider } from "@rocicorp/zero/react";
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

  const signOut = async () => {
    // Explicit sign-out: forget the device identity; the SignIn screen then
    // clears local data (Zero stores + blob caches) once Zero has unmounted.
    clearIdentity();
    await authClient.signOut().catch(() => {
      // Offline sign-out still signs out locally; the cookie dies with the
      // session server-side when it expires.
    });
    location.assign("/");
  };

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

/** Connects the blob queue's callbacks to Zero + the session lifecycle. */
function QueueWiring({ sessionOk }: { sessionOk: boolean }) {
  const zero = useZero();
  const queue = useBlobQueue();
  useEffect(() => {
    queue.onRelink = (itemId, blobId) =>
      void zero.mutate(mutators.item.relinkBlob({ id: itemId, blobId }));
    return () => {
      queue.onRelink = undefined;
    };
  }, [zero, queue]);
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

  return (
    <div className="flex h-dvh bg-neutral-50 text-neutral-900">
      <Sidebar items={items} tags={tags} name={name} onSignOut={onSignOut} />
      <main className="flex min-w-0 flex-1 flex-col">
        <SyncBanner status={status} meta={meta} />
        <Timeline items={items} synced={itemsResult.type === "complete"} />
        <Composer canAttach={meta?.blobs ?? true} />
      </main>
      <SearchOverlay index={searchIndex} items={items} />
      <Outlet />
    </div>
  );
}
