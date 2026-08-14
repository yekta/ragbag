import type { BlobQueueState } from "@ragbag/client-runtime";
import { mutators } from "@ragbag/contracts";
import type { MetaResponse } from "@ragbag/contracts";
import { ITEM_KINDS } from "@ragbag/shared";
import type { ItemKind } from "@ragbag/shared";
import { useConnectionState, useZero } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, KIND_ICON } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useBlobQueue, useBlobQueueState } from "@/lib/blobs";
import { useViewStore } from "@/lib/store";
import type { Theme } from "@/lib/theme";
import type { TagRow, Timeline } from "@/lib/types";

// Left rail: kind + tag filters over the locally-synced archive, sync state,
// account. Collections join in v1.5 (plan §4).
//
// Placement is the shadcn Sidebar's job: a floating card at md+, a flush
// full-height Sheet below it. This file only fills the slots.

const KIND_LABEL: Record<ItemKind, string> = {
  note: "Notes",
  todo: "Todos",
  address: "Addresses",
  link: "Links",
  image: "Images",
  pdf: "PDFs",
  file: "Files",
};

const THEME_LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * `needs-auth` means sync got a 401 — which is either "your session expired"
 * or "your session is fine and the sync service still refused it". Only the
 * first is the user's to act on, so only the first says to sign in.
 */
function SyncDot({ sessionExpired }: { sessionExpired: boolean }) {
  const state = useConnectionState();
  const [tone, label] =
    state.name === "connected"
      ? ["bg-success-foreground", "Synced"]
      : state.name === "needs-auth"
        ? ["bg-destructive", sessionExpired ? "Sign in to sync" : "Sync refused"]
        : ["bg-warning-foreground", "Connecting…"];
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={state.name}>
      <span className={`size-2 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useViewStore();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title={`Theme: ${THEME_LABEL[theme]}`}
        >
          <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Icon name="sun" className="size-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Icon name="moon" className="size-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Icon name="monitor" className="size-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar({
  items,
  tags,
  name,
  meta,
  sessionExpired,
  onSignOut,
}: {
  items: Timeline;
  tags: readonly TagRow[];
  name: string;
  meta: MetaResponse | undefined;
  sessionExpired: boolean;
  onSignOut: () => void;
}) {
  const { viewFilter, tagFilter, setViewFilter, setTagFilter, setSearchOpen } = useViewStore();
  // On a phone the drawer exists to pick one thing and get back to the
  // timeline, so every pick closes it. (No-op on desktop.)
  const { setOpenMobile } = useSidebar();
  const queue = useBlobQueue();
  const queueState = useBlobQueueState();

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [items]);

  const favoriteCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);

  // Todos count what's left to do — a list that says "42" when 40 are ticked
  // off is noise. Every other kind counts everything it holds.
  const openTodoCount = useMemo(
    () => items.filter((i) => i.kind === "todo" && !i.completedAt).length,
    [items],
  );

  // The rail lists the user's own tags only — AI tags are deliberately
  // numerous (§7) and would bury them. They still drive search and the
  // filters below, they just aren't browsable here.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const it of item.itemTags) {
        if (it.source === "user") counts.set(it.tagId, (counts.get(it.tagId) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  const rankedTags = useMemo(
    () =>
      tags
        .filter((t) => (tagCounts.get(t.id) ?? 0) > 0)
        .toSorted(
          (a, b) =>
            (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
        )
        .slice(0, 40),
    [tags, tagCounts],
  );

  const pickView = (view: Parameters<typeof setViewFilter>[0]) => {
    setViewFilter(view);
    setOpenMobile(false);
  };

  return (
    <SidebarRoot variant="floating" collapsible="offcanvas">
      <SidebarHeader className="gap-0 pt-4">
        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icon name="inbox" className="size-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">ragbag</span>
          <SidebarTrigger className="ml-auto text-muted-foreground" title="Hide sidebar (⌘\)" />
        </div>

        <Button
          variant="outline"
          className="mx-1 justify-start gap-2 font-normal text-muted-foreground"
          onClick={() => {
            setSearchOpen(true);
            setOpenMobile(false);
          }}
        >
          <Icon name="search" className="size-4" />
          Search…
          <kbd className="ml-auto rounded-xs border bg-muted px-1.5 text-[10px] max-md:hidden">
            ⌘K
          </kbd>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={viewFilter === null && tagFilter === null}
                  onClick={() => {
                    useViewStore.getState().clearFilters();
                    setOpenMobile(false);
                  }}
                >
                  <Icon name="inbox" className="size-4" />
                  <span>Everything</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{items.length}</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={viewFilter === "favorites"}
                  onClick={() => pickView("favorites")}
                >
                  <Icon name="star" className="size-4" />
                  <span>Favorites</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{favoriteCount}</SidebarMenuBadge>
              </SidebarMenuItem>
              {ITEM_KINDS.map((kind) => (
                <SidebarMenuItem key={kind}>
                  <SidebarMenuButton
                    isActive={viewFilter === kind}
                    title={kind === "todo" ? "Todos (open)" : KIND_LABEL[kind]}
                    onClick={() => pickView(kind)}
                  >
                    <Icon name={KIND_ICON[kind]} className="size-4" />
                    <span>{KIND_LABEL[kind]}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>
                    {kind === "todo" ? openTodoCount : (kindCounts.get(kind) ?? 0)}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider">
            Tags
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {rankedTags.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Your tags show up here as you add them. Auto-tags stay out of the way — they still
                power search.
              </p>
            ) : (
              <SidebarMenu className="gap-px">
                {rankedTags.map((tag) => (
                  <SidebarMenuItem key={tag.id}>
                    <SidebarMenuButton
                      size="sm"
                      // Half of this list's `gap-px`, so the rows' hit areas
                      // tile the gap exactly instead of overlapping it.
                      className="after:-inset-y-[0.5px]"
                      isActive={tagFilter === tag.id}
                      title={`${tag.kind} tag`}
                      onClick={() => {
                        setTagFilter(tag.id);
                        setOpenMobile(false);
                      }}
                    >
                      <Icon name="tag" className="size-3.5 opacity-50" />
                      <span>{tag.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="text-[11px]">
                      {tagCounts.get(tag.id)}
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-0 border-t px-4 py-3">
        <EnrichBackfill items={items} meta={meta} />
        <QueueStatus state={queueState} onRetry={() => void queue.retryNow()} />
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <SyncDot sessionExpired={sessionExpired} />
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="Sign out"
            onClick={onSignOut}
          >
            <Icon name="logout" className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

/** Ceiling on one backfill click — enough for a personal archive, bounded. */
const BACKFILL_LIMIT = 250;

/**
 * Re-run enrichment over items that finished ingestion without a summary.
 *
 * The client already syncs `item_content`, so it knows exactly which items
 * these are — no new server API, just the existing per-item retryIngest
 * mutator in a loop, bounded by BACKFILL_LIMIT per click.
 * This exists because a server that ran for a day without an OpenAI key
 * leaves a pile of permanently-empty items that nothing would otherwise
 * revisit: they're "done", so no retry ever fires for them.
 */
function EnrichBackfill({ items, meta }: { items: Timeline; meta: MetaResponse | undefined }) {
  const zero = useZero();
  const [running, setRunning] = useState(0);

  const pending = useMemo(
    () => items.filter((i) => i.content?.status === "done" && !i.content.aiSummary),
    [items],
  );

  // Only offer this when the server can actually deliver: `undefined` meta
  // (offline/unknown) hides it rather than promising something we can't do.
  if (!meta?.ai || pending.length === 0) return null;

  const batch = pending.slice(0, BACKFILL_LIMIT);

  const run = async () => {
    setRunning(batch.length);
    let failed = 0;
    // Sequential on purpose: this is a background chore, not a race — and it
    // keeps the mutation log (and the ingest queue) from being flooded.
    for (const item of batch) {
      try {
        await zero.mutate(mutators.item.retryIngest({ id: item.id })).client;
      } catch {
        failed += 1;
      }
      setRunning((n) => n - 1);
    }
    toast.success(
      `Queued ${batch.length - failed} item${batch.length - failed === 1 ? "" : "s"} for enrichment`,
      {
        description:
          pending.length > batch.length
            ? `${pending.length - batch.length} more remain — run it again when these finish.`
            : "Summaries and tags appear as each one finishes.",
      },
    );
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      className="mb-1.5 justify-start px-0 text-xs font-normal text-muted-foreground hover:text-foreground"
      disabled={running > 0}
      title={`${pending.length} item${pending.length === 1 ? "" : "s"} finished without an AI summary`}
      onClick={() => void run()}
    >
      {running > 0 ? (
        <>
          <Icon name="spinner" className="size-3 animate-spin [animation-duration:2s]" />
          Queueing… {running} left
        </>
      ) : (
        <>
          <Icon name="sparkles" className="size-3" />
          Enrich {pending.length} item{pending.length === 1 ? "" : "s"}
        </>
      )}
    </Button>
  );
}

/**
 * The upload queue's live state, in words: how many are moving, how many are
 * failing and why, or why the whole queue is parked. A queue that only said
 * "N pending" while every attempt was quietly dying looked exactly like a
 * healthy one — the reason is the point.
 */
function QueueStatus({ state, onRetry }: { state: BlobQueueState; onRetry: () => void }) {
  if (state.pending === 0) return null;
  const entries = Object.values(state.blobs);
  const failing = entries.filter((b) => b.stage === "waiting" && b.lastError);
  const plural = state.pending > 1 ? "s" : "";

  if (state.blocked === "auth") {
    return (
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="pause" className="size-3 shrink-0" />
        {state.pending} upload{plural} paused — sign in to resume
      </p>
    );
  }

  if (state.blocked === "storage") {
    return (
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-destructive">
        <Icon name="alert" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">Uploads paused — the server has no blob storage</span>
        <RetryButton onRetry={onRetry} />
      </p>
    );
  }

  if (failing.length > 0) {
    const reason = failing[0]!.lastError!;
    return (
      <div className="mb-1.5 text-xs">
        <p className="flex items-center gap-1.5 text-destructive">
          <Icon name="alert" className="size-3 shrink-0" />
          {failing.length} upload{failing.length > 1 ? "s" : ""} failing
          <RetryButton onRetry={onRetry} />
        </p>
        <p className="mt-0.5 truncate text-muted-foreground" title={reason}>
          {reason}
        </p>
      </div>
    );
  }

  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon name="spinner" className="size-3 shrink-0 animate-spin [animation-duration:2s]" />
      {state.pending} upload{plural} in progress
      <RetryButton onRetry={onRetry} />
    </p>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="ml-auto text-muted-foreground"
      title="Retry these uploads now instead of waiting for the next attempt"
      onClick={onRetry}
    >
      <Icon name="retry" className="size-3" /> retry
    </Button>
  );
}
