import type { BlobQueueState } from "@ragbag/client-runtime";
import { mutators } from "@ragbag/contracts";
import type { MetaResponse } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, iconNamed } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useBlobQueue, useBlobQueueState } from "@/lib/blobs";
import { useEntityTypes } from "@/lib/entity-types";
import { EVERYTHING, filterLink, useFilter, type Filter } from "@/lib/routes";
import { useViewStore } from "@/lib/store";
import type { SyncStatus } from "@/lib/sync-status";
import type { Drop, EntityRows, TagRow } from "@/lib/types";

// The left panel: the chat and the things in it, over the locally-synced archive,
// plus sync state and the account.
//
// Every filter row is a `<Link>` to the path that view lives at (lib/routes.ts),
// not a button that sets a variable: which means a middle click opens it in a
// tab, a right click can copy it, the back button walks back through them, and
// what is on screen is always what the address bar says.
//
// Placement is the shadcn Sidebar's job: a floating card at md+, a flush
// full-height Sheet below it. This file only fills the slots.

const SYNC_DOT: Record<SyncStatus["name"], [tone: string, label: string]> = {
  synced: ["bg-success-foreground", "Synced"],
  syncing: ["bg-warning-foreground", "Connecting…"],
  offline: ["bg-warning-foreground", "Offline"],
  // A 401 with a live session is the server's problem, not the user's, so it
  // does not tell them to sign in; that is what `expired` is for.
  refused: ["bg-destructive", "Sync refused"],
  expired: ["bg-destructive", "Sign in to sync"],
};

/**
 * `null` is a verdict that hasn't held long enough to be worth showing
 * (lib/sync-status.ts): the row keeps its height and says nothing, rather than
 * claiming "Connecting…" on every load for the third of a second before the
 * socket opens.
 */
function SyncDot({ sync }: { sync: SyncStatus | null }) {
  const [tone, label] = SYNC_DOT[sync?.name ?? "syncing"];
  return (
    <span
      className={`flex items-center gap-1.5 text-xs text-muted-foreground ${sync ? "" : "invisible"}`}
      title={sync?.name ?? ""}
    >
      <span className={`size-2 rounded-full ${tone}`} />
      {label}
    </span>
  );
}

/**
 * How many messages a filter would show, inside the row rather than over it.
 *
 * `SidebarMenuBadge` (what this replaces) is absolutely positioned, so a long
 * name truncated at the row's edge and the count sat on top of it. Reserving a
 * fixed strip of right padding is the stock answer and it only defers the
 * collision: this archive's counts are whatever the archive holds, and four
 * digits are wider than any strip worth reserving. In the flow the number
 * measures itself, and `shrink-0` against a truncating name settles which of
 * the two gives way.
 */
function MenuCount({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto shrink-0 pl-1 text-xs tabular-nums">{children}</span>;
}

export function Sidebar({
  messages,
  entities,
  tags,
  email,
  meta,
  sync,
}: {
  messages: Drop;
  entities: EntityRows;
  tags: readonly TagRow[];
  email: string;
  meta: MetaResponse | undefined;
  sync: SyncStatus | null;
}) {
  const { setSearchOpen } = useViewStore();
  const filter = useFilter();
  const types = useEntityTypes();
  // On a phone the drawer exists to pick one thing and get back to the
  // timeline, so every pick closes it. (No-op on desktop.)
  const { setOpenMobile } = useSidebar();
  const closeDrawer = () => setOpenMobile(false);
  const queue = useBlobQueue();
  const queueState = useBlobQueueState();

  const favoriteCount = useMemo(() => messages.filter((m) => m.favorite).length, [messages]);

  // The two attachment-shaped rows count files, not the messages holding them:
  // the file IS the content, which is the whole reason these rows replace the
  // chat rather than filtering it.
  const attachmentCounts = useMemo(() => {
    let images = 0;
    let files = 0;
    for (const message of messages) {
      for (const attachment of message.attachments) {
        if (faceForMime(attachment.mime) === "image") images += 1;
        else files += 1;
      }
    }
    return { images, files };
  }, [messages]);

  // Counts come from LIVE mentions (the query already excludes dismissed ones
  // and mentions to deleted messages), so a deleted message cannot leave a
  // ghost address in the sidebar.
  const entityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of entities) {
      if (entity.mentions.length === 0) continue;
      counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
    }
    return counts;
  }, [entities]);

  // Every row hides at count zero, which is also the growth path: declaring a
  // kind in Postgres makes its row appear here the moment its first thing
  // exists, with no code change at all.
  const thingRows = [
    { view: "images", label: "Images", icon: "image" as const, count: attachmentCounts.images },
    { view: "files", label: "Files", icon: "file" as const, count: attachmentCounts.files },
    ...types.sidebar.map((type) => ({
      view: type.slug,
      label: type.sidebarTitle,
      icon: iconNamed(type.icon),
      count: entityCounts.get(type.kind) ?? 0,
    })),
  ].filter((row) => row.count > 0);

  // The sidebar lists the user's own tags only: AI tags are deliberately numerous
  // and would bury them. They still drive search, they just aren't browsable
  // here.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      for (const link of message.tags) {
        if (link.source === "user") counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
      }
    }
    return counts;
  }, [messages]);

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

  // Where each row points, and whether it is the row you are already on: one
  // helper, because those two are the same question. Picking the row you are on
  // clears that one filter, which is what a second click on it always did, and
  // the other filter rides along, because a view and a tag have always narrowed
  // together. `aria-current` because these are links now: the highlight says
  // "this is the view you are in" to everyone else.
  const rowProps = (target: Filter, active: boolean) => ({
    isActive: active,
    render: (
      <Link
        {...filterLink(target)}
        aria-current={active ? "page" : undefined}
        onClick={closeDrawer}
      />
    ),
  });

  const viewRow = (view: string) => {
    const active = filter.view === view;
    return rowProps({ view: active ? null : view, tagId: filter.tagId }, active);
  };

  const tagRow = (tagId: string) => {
    const active = filter.tagId === tagId;
    return rowProps({ view: filter.view, tagId: active ? null : tagId }, active);
  };

  return (
    <SidebarRoot variant="floating" collapsible="offcanvas">
      {/* No top override: the header's own 0.5rem on all three sides, so the
          masthead sits the same distance from the top as from either edge. */}
      <SidebarHeader className="gap-0">
        {/* The masthead rides the same rail as the search field below and the
            row pills under that, no inset of its own, because unlike those
            rows it is not a control and has no box of its own to pad.
            Geometrically the logo is already flush with the field at that rail;
            the 2px is optical. */}
        <div className="flex items-center gap-2 pb-2 pl-0.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Icon name="inbox" className="size-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">ragbag</span>
          <SidebarTrigger className="ml-auto text-muted-foreground" title="Hide sidebar (⌘\)" />
        </div>

        {/* Flush with the menu rows below, outside and in: no margin of its
            own, so its box matches theirs (both sit on their parent's 0.5rem
            inset), and the same inner padding a menu button has, so the
            magnifier lands on the column the row icons are in and the shortcut
            ends where the counts do. */}
        <Button
          variant="outline"
          className="cursor-text justify-start gap-2 px-2 font-normal text-muted-foreground"
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

      {/* This is the scroller. Its last row otherwise comes to rest hard
          against the footer's rule, which reads as the list being cut off
          rather than ended. */}
      <SidebarContent className="pb-4">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  {...rowProps(EVERYTHING, filter.view === null && filter.tagId === null)}
                >
                  <Icon name="inbox" className="size-4" />
                  <span className="truncate">Drop</span>
                  <MenuCount>{messages.length}</MenuCount>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton {...viewRow("favorites")}>
                  <Icon name="star" className="size-4" />
                  <span className="truncate">Favorites</span>
                  <MenuCount>{favoriteCount}</MenuCount>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {thingRows.length > 0 && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider">
              Things
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {thingRows.map((row) => (
                  <SidebarMenuItem key={row.view}>
                    <SidebarMenuButton {...viewRow(row.view)} title={row.label}>
                      <Icon name={row.icon} className="size-4" />
                      <span className="truncate">{row.label}</span>
                      <MenuCount>{row.count}</MenuCount>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[11px] uppercase tracking-wider">
            Tags
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {rankedTags.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Your tags show up here as you add them. Auto-tags stay out of the way but still
                power search.
              </p>
            ) : (
              <SidebarMenu>
                {rankedTags.map((tag) => (
                  <SidebarMenuItem key={tag.id}>
                    <SidebarMenuButton {...tagRow(tag.id)} title={`${tag.kind} tag`}>
                      <Icon name="tag" className="size-4" />
                      <span className="truncate">{tag.name}</span>
                      <MenuCount>{tagCounts.get(tag.id)}</MenuCount>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-0 border-t px-4 py-3">
        <EnrichBackfill messages={messages} meta={meta} />
        <QueueStatus state={queueState} onRetry={() => void queue.retryNow()} />
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={email}>
              {email}
            </p>
            <SyncDot sync={sync} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="Settings"
            nativeButton={false}
            render={<Link to="/settings" onClick={closeDrawer} />}
          >
            <Icon name="settings" className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </SidebarRoot>
  );
}

/** Ceiling on one backfill click: enough for a personal archive, bounded. */
const BACKFILL_LIMIT = 250;

/**
 * Re-run ingestion over messages that finished without a summary.
 *
 * The client already syncs everything it needs to know which those are: no new
 * server API, just the existing per-message retryIngest mutator in a loop,
 * bounded by BACKFILL_LIMIT per click. This exists because a server that ran
 * for a day without an OpenAI key leaves a pile of permanently-empty messages
 * that nothing would otherwise revisit: they're "done", so no retry ever fires
 * for them.
 */
function EnrichBackfill({ messages, meta }: { messages: Drop; meta: MetaResponse | undefined }) {
  const zero = useZero();
  const [running, setRunning] = useState(0);

  const pending = useMemo(
    () =>
      messages.filter(
        (m) => (m.status === "done" || m.status === "partial") && !m.generatedSummary,
      ),
    [messages],
  );

  // Only offer this when the server can actually deliver: `undefined` meta
  // (offline/unknown) hides it rather than promising something we can't do.
  if (!meta?.ai || pending.length === 0) return null;

  const batch = pending.slice(0, BACKFILL_LIMIT);

  const run = async () => {
    setRunning(batch.length);
    let failed = 0;
    // Sequential on purpose: this is a background chore, not a race, and it
    // keeps the mutation log (and the ingest queue) from being flooded.
    for (const message of batch) {
      try {
        await zero.mutate(mutators.message.retryIngest({ id: message.id })).client;
      } catch {
        failed += 1;
      }
      setRunning((n) => n - 1);
    }
    toast.success(
      `Queued ${batch.length - failed} message${batch.length - failed === 1 ? "" : "s"} for enrichment`,
      {
        description:
          pending.length > batch.length
            ? `${pending.length - batch.length} more remain. Run it again when these finish.`
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
      title={`${pending.length} message${pending.length === 1 ? "" : "s"} finished without a summary`}
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
          Enrich {pending.length} message{pending.length === 1 ? "" : "s"}
        </>
      )}
    </Button>
  );
}

/**
 * The upload queue's live state, in words: how many are moving, how many are
 * failing and why, or why the whole queue is parked. A queue that only said
 * "N pending" while every attempt was quietly dying looked exactly like a
 * healthy one: the reason is the point.
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
        {state.pending} upload{plural} paused, sign in to resume
      </p>
    );
  }

  if (state.blocked === "storage") {
    return (
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-destructive">
        <Icon name="alert" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">Uploads paused: the server has no blob storage</span>
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
