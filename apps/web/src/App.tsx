import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { mutators, queries } from "@ragbag/contracts";
import { useQuery, useZero, ZeroProvider } from "@rocicorp/zero/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Composer } from "./components/Composer.js";
import { Icon } from "./components/Icon.js";
import { Sidebar } from "./components/Sidebar.js";
import { SignIn } from "./components/SignIn.js";
import { Timeline } from "./components/Timeline.js";
import { authClient } from "./lib/auth-client.js";
import { BlobQueueProvider, blobQueueFor, useBlobQueue } from "./lib/blobs.js";
import { useMeta } from "./lib/use-meta.js";

// App shell: session gate → Zero (local-first store + sync) → the workspace.
// All data state lives in Zero; auth gates *syncing*, never *using* (plan §9).

export function App() {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <main className="flex h-dvh items-center justify-center bg-neutral-50 text-neutral-400">
        <Icon name="spinner" className="size-6 animate-spin [animation-duration:2s]" />
      </main>
    );
  }
  if (!session.data) {
    return <SignIn />;
  }
  return <Workspace userID={session.data.user.id} name={session.data.user.name || "you"} />;
}

function Workspace({ userID, name }: { userID: string; name: string }) {
  const meta = useMeta();
  const queue = blobQueueFor(userID);
  const opts = useMemo(
    () =>
      ragbagZeroOptions({
        cacheURL: import.meta.env.VITE_ZERO_CACHE_URL ?? "http://localhost:4848",
        userID,
        kvStore: "idb",
      }),
    [userID],
  );

  return (
    <ZeroProvider
      {...opts}
      init={(zero) => {
        // Preload the whole archive (plan §6): every device holds the full
        // timeline, so reads and search work fully offline.
        zero.preload(queries.timeline(), { ttl: "forever" });
        zero.preload(queries.tags(), { ttl: "forever" });
      }}
    >
      <BlobQueueProvider value={queue}>
        <QueueWiring />
        <Shell name={name} canAttach={meta?.blobs ?? false} />
      </BlobQueueProvider>
    </ZeroProvider>
  );
}

/** Connects the blob queue's callbacks to Zero + the fresh session. */
function QueueWiring() {
  const zero = useZero();
  const queue = useBlobQueue();
  useEffect(() => {
    queue.onRelink = (itemId, blobId) =>
      void zero.mutate(mutators.item.relinkBlob({ id: itemId, blobId }));
    // We just (re)authenticated — unpark any uploads waiting on a session.
    queue.notifyAuthChanged();
    return () => {
      queue.onRelink = undefined;
    };
  }, [zero, queue]);
  return null;
}

function Shell({ name, canAttach }: { name: string; canAttach: boolean }) {
  const [items, itemsResult] = useQuery(queries.timeline());
  const [tags] = useQuery(queries.tags());

  return (
    <div className="flex h-dvh bg-neutral-50 text-neutral-900">
      <Sidebar items={items} tags={tags} name={name} onSignOut={() => void authClient.signOut()} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Timeline items={items} synced={itemsResult.type === "complete"} />
        <Composer canAttach={canAttach} />
      </main>
      <Outlet />
    </div>
  );
}
