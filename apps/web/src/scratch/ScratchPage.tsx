import { mutators, queries } from "@ragbag/contracts";
import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { isBareUrl, newId, normalizeUrl } from "@ragbag/shared";
import { useConnectionState, useQuery, useZero, ZeroProvider } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { authClient } from "../lib/auth-client.js";
import { useMeta } from "../lib/use-meta.js";

// M1 scratch page: prove the whole pipeline — better-auth session → Zero over
// zero-cache → /api/zero/query|mutate → Postgres → replication back to every
// client. Open two browsers, dump items, watch them appear in both.
// This is throwaway UI; the real timeline arrives in M2.

export function ScratchPage() {
  const session = authClient.useSession();

  if (session.isPending) {
    return <Shell>Checking session…</Shell>;
  }
  if (!session.data) {
    return <SignIn />;
  }
  return <Synced userID={session.data.user.id} name={session.data.user.name || "anonymous"} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl p-6 font-sans">
      <h1 className="mb-4 text-2xl font-bold">
        ragbag <span className="text-sm font-normal text-neutral-400">M1 sync scratch</span>
      </h1>
      {children}
    </main>
  );
}

function SignIn() {
  const meta = useMeta();
  return (
    <Shell>
      <div className="flex flex-col items-start gap-3">
        {meta?.googleAuth && (
          <button
            className="rounded-lg bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700"
            onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: "/" })}
          >
            Continue with Google
          </button>
        )}
        {meta?.devLogin && (
          <button
            className="rounded-lg border border-neutral-300 px-4 py-2 hover:bg-neutral-100"
            onClick={() => void authClient.signIn.anonymous()}
          >
            Dev sign-in (anonymous)
          </button>
        )}
        {meta && !meta.googleAuth && !meta.devLogin && (
          <p className="text-red-600">
            Server has neither Google OAuth nor DEV_LOGIN configured — nothing to sign in with.
          </p>
        )}
        {!meta && <p className="text-neutral-500">Loading…</p>}
      </div>
    </Shell>
  );
}

function Synced({ userID, name }: { userID: string; name: string }) {
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
        // Preload the whole timeline so the full archive is available offline.
        zero.preload(queries.timeline(), { ttl: "10m" });
      }}
    >
      <Timeline name={name} />
    </ZeroProvider>
  );
}

function ConnectionBadge() {
  const state = useConnectionState();
  const color =
    state.name === "connected"
      ? "bg-green-100 text-green-800"
      : state.name === "needs-auth"
        ? "bg-red-100 text-red-800"
        : "bg-yellow-100 text-yellow-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{state.name}</span>;
}

function Timeline({ name }: { name: string }) {
  const zero = useZero();
  const [items, itemsResult] = useQuery(queries.timeline());
  const [draft, setDraft] = useState("");

  const dump = () => {
    const text = draft.trim();
    if (!text) return;
    const link = isBareUrl(text);
    const write = zero.mutate(
      mutators.item.create(
        link
          ? { id: newId(), kind: "link", url: normalizeUrl(text)! }
          : { id: newId(), kind: "note", text },
      ),
    );
    void write.server.then((r) => {
      if (r.type === "error") console.error("server rejected mutation", r);
    });
    setDraft("");
  };

  const editTags = (itemId: string, current: readonly string[]) => {
    const answer = window.prompt("Tags (comma-separated):", current.join(", "));
    if (answer === null) return;
    const names = answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    void zero.mutate(mutators.tag.setForItem({ itemId, names }));
  };

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
        <ConnectionBadge />
        <span>
          signed in as <b>{name}</b>
        </span>
        <button
          className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
          onClick={() => void authClient.signOut()}
        >
          Sign out
        </button>
      </div>

      <div className="mb-6 flex gap-2">
        <textarea
          className="min-h-[44px] flex-1 resize-y rounded-lg border border-neutral-300 p-2"
          placeholder="Dump anything — a note or a URL — and press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              dump();
            }
          }}
        />
        <button
          className="rounded-lg bg-neutral-900 px-4 text-white hover:bg-neutral-700"
          onClick={dump}
        >
          Dump
        </button>
      </div>

      {itemsResult.type !== "complete" && items.length === 0 && (
        <p className="text-neutral-400">Syncing…</p>
      )}
      {itemsResult.type === "complete" && items.length === 0 && (
        <p className="text-neutral-400">Nothing here yet. Dump something above.</p>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-neutral-200 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">{item.kind}</span>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
              {item.content && item.content.status !== "done" && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                  {item.content.status}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button
                  className="hover:text-neutral-900"
                  title={item.pinned ? "Unpin" : "Pin"}
                  onClick={() =>
                    void zero.mutate(mutators.item.setPinned({ id: item.id, pinned: !item.pinned }))
                  }
                >
                  {item.pinned ? "★" : "☆"}
                </button>
                <button
                  className="hover:text-red-600"
                  title="Delete"
                  onClick={() => void zero.mutate(mutators.item.delete({ id: item.id }))}
                >
                  ✕
                </button>
              </span>
            </div>

            {item.kind === "link" ? (
              <a
                className="break-all text-blue-700 underline"
                href={item.url ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                {item.content?.title ?? item.url}
              </a>
            ) : (
              <p className="whitespace-pre-wrap">{item.text}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              {item.tags.map((tag) => (
                <span key={tag.id} className="rounded-full bg-neutral-100 px-2 py-0.5">
                  {tag.name}
                </span>
              ))}
              <button
                className="text-neutral-400 hover:text-neutral-900"
                onClick={() =>
                  editTags(
                    item.id,
                    item.tags.map((t) => t.name),
                  )
                }
              >
                + tags
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
