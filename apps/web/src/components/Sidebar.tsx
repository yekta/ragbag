import { ITEM_KINDS } from "@ragbag/shared";
import type { ItemKind } from "@ragbag/shared";
import { useConnectionState } from "@rocicorp/zero/react";
import { useMemo } from "react";
import { useBlobQueueState } from "../lib/blobs.js";
import { useViewStore } from "../lib/store.js";
import type { TagRow, Timeline } from "../lib/types.js";
import { Icon, KIND_ICON } from "./Icon.js";

// Left rail: kind + tag filters over the locally-synced archive, sync state,
// account. Collections join in v1.5 (plan §4).

const KIND_LABEL: Record<ItemKind, string> = {
  note: "Notes",
  link: "Links",
  image: "Images",
  pdf: "PDFs",
  file: "Files",
};

function SyncDot() {
  const state = useConnectionState();
  const [tone, label] =
    state.name === "connected"
      ? ["bg-emerald-500", "Synced"]
      : state.name === "needs-auth"
        ? ["bg-red-500", "Sign in to sync"]
        : ["bg-amber-500", "Connecting…"];
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500" title={state.name}>
      <span className={`size-2 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

export function Sidebar({
  items,
  tags,
  name,
  onSignOut,
}: {
  items: Timeline;
  tags: readonly TagRow[];
  name: string;
  onSignOut: () => void;
}) {
  const { kindFilter, tagFilter, setKindFilter, setTagFilter, setSearchOpen } = useViewStore();
  const queueState = useBlobQueueState();

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [items]);

  const pinnedCount = useMemo(() => items.filter((i) => i.pinned).length, [items]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items)
      for (const it of item.itemTags) counts.set(it.tagId, (counts.get(it.tagId) ?? 0) + 1);
    return counts;
  }, [items]);

  const rankedTags = useMemo(
    () =>
      [...tags]
        .filter((t) => (tagCounts.get(t.id) ?? 0) > 0)
        .sort(
          (a, b) =>
            (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
        )
        .slice(0, 40),
    [tags, tagCounts],
  );

  const navButton = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
      active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
    }`;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-neutral-900 text-white">
          <Icon name="inbox" className="size-4" />
        </span>
        <span className="text-lg font-bold tracking-tight">ragbag</span>
      </div>

      <button
        className="mx-3 mb-2 mt-1 flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-400 transition hover:border-neutral-300 hover:text-neutral-600"
        onClick={() => setSearchOpen(true)}
      >
        <Icon name="search" className="size-4" />
        Search…
        <kbd className="ml-auto rounded border border-neutral-200 bg-neutral-50 px-1.5 text-[10px] text-neutral-400">
          ⌘K
        </kbd>
      </button>

      <nav className="space-y-0.5 px-3">
        <button
          className={navButton(kindFilter === null && tagFilter === null)}
          onClick={() => useViewStore.getState().clearFilters()}
        >
          <Icon name="inbox" className="size-4" />
          Everything
          <span className="ml-auto text-xs opacity-60">{items.length}</span>
        </button>
        <button
          className={navButton(kindFilter === "pinned")}
          onClick={() => setKindFilter("pinned")}
        >
          <Icon name="star" className="size-4" />
          Pinned
          <span className="ml-auto text-xs opacity-60">{pinnedCount}</span>
        </button>
        {ITEM_KINDS.map((kind) => (
          <button
            key={kind}
            className={navButton(kindFilter === kind)}
            onClick={() => setKindFilter(kind)}
          >
            <Icon name={KIND_ICON[kind]} className="size-4" />
            {KIND_LABEL[kind]}
            <span className="ml-auto text-xs opacity-60">{kindCounts.get(kind) ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        <h3 className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Tags
        </h3>
        {rankedTags.length === 0 ? (
          <p className="px-2.5 text-xs text-neutral-400">
            Tags show up here as you add them — and as ragbag auto-tags your dumps.
          </p>
        ) : (
          <div className="space-y-px">
            {rankedTags.map((tag) => (
              <button
                key={tag.id}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] transition ${
                  tagFilter === tag.id
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
                onClick={() => setTagFilter(tag.id)}
                title={`${tag.kind} tag`}
              >
                <Icon name="tag" className="size-3.5 opacity-50" />
                <span className="truncate">{tag.name}</span>
                <span className="ml-auto text-[11px] opacity-50">{tagCounts.get(tag.id)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 px-4 py-3">
        {queueState.pending > 0 && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
            <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
            {queueState.pending} upload{queueState.pending > 1 ? "s" : ""} pending
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-800">{name}</p>
            <SyncDot />
          </div>
          <button
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            title="Sign out"
            onClick={onSignOut}
          >
            <Icon name="logout" className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
