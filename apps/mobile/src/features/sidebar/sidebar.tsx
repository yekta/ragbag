import type { TBlobQueueState } from "@ragbag/client-runtime";
import type { TMessages, TEntityRows, TTagRow } from "@ragbag/client-runtime/rows";
import { mutators, queries } from "@ragbag/contracts";
import type { TMetaResponse } from "@ragbag/contracts";
import { faceForMime } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, usePathname } from "expo-router";
import type { Href } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, iconNamed, type TIconName } from "@/components/icon";
import { Logo } from "@/components/logo";
import { Text } from "@/components/text";
import { useEntityTypes } from "@/features/session/entity-types";
import { useIdentity } from "@/features/session/identity-provider";
import { useBlobQueue, useBlobQueueState } from "@/lib/blobs/queue";
import { useMeta } from "@/lib/meta";
import { runMutation } from "@/lib/mutate";
import { EVERYTHING, filterHref, settingsHref, useFilter, type TFilter } from "@/lib/routes";
import { useSyncStatus, type TSyncStatus } from "@/lib/sync-status";
import { toast } from "@/lib/toast";
import { WHOLE_ARCHIVE } from "@/features/workspace/workspace-provider";

// What the sidebar holds: the chat and the things in it, over the
// locally-synced archive, plus sync state and the account.
//
// This file is shared by both platforms. Where it is *hosted* is not: iOS puts
// it in a UISplitViewController column and Android in a drawer
// (./workspace-shell.ios.tsx and .android.tsx), which is the whole reason the
// contents are separate from the container. Nothing below knows which one it
// is inside.
//
// Every filter row is a `<Link>` to the path that view lives at
// (lib/routes.ts), not a button that sets a variable. Which row is lit is
// answered by comparing the row's own target against the current path, so a
// row cannot be highlighted as a view it does not point at, and there is no
// second copy of "where am I" to drift out of step with the route.

const SYNC_DOT: Record<TSyncStatus["name"], [tone: string, label: string]> = {
  synced: ["bg-success-foreground", "Synced"],
  syncing: ["bg-warning-foreground", "Connecting…"],
  offline: ["bg-warning-foreground", "Offline"],
  // A 401 with a live session is the server's problem, not the user's, so it
  // does not tell them to sign in; that is what `expired` is for.
  refused: ["bg-destructive", "Sync refused"],
  expired: ["bg-destructive", "Sign in to sync"],
};

/**
 * `null` is a verdict that has not held long enough to be worth showing
 * (lib/sync-status.ts): the row keeps its height and says nothing, rather than
 * claiming "Connecting…" for a third of a second on every launch.
 */
function SyncDot({ sync }: { sync: TSyncStatus | null }) {
  const [tone, label] = SYNC_DOT[sync?.name ?? "syncing"];
  return (
    <View className={`flex-row items-center gap-1.5 ${sync ? "" : "opacity-0"}`}>
      <View className={`size-2 rounded-full ${tone}`} />
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

/**
 * How many messages a filter would show, inside the row rather than over it.
 *
 * Set in the mono face, and that is not decoration: these counts move as
 * messages land, and in a proportional face a count going from 9 to 10 is also
 * a count that changes width, which drags the truncation point of the name
 * beside it around with it.
 */
function MenuCount({ children }: { children: ReactNode }) {
  return <Text className="ml-auto shrink-0 pl-1 font-mono text-xs">{children}</Text>;
}

export function Sidebar() {
  const [messages] = useQuery(queries.messages(WHOLE_ARCHIVE));
  const [entities] = useQuery(queries.entities());
  const [tags] = useQuery(queries.tags());
  const { identity, status } = useIdentity();
  const meta = useMeta();
  const sync = useSyncStatus(status === "expired");
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-sidebar" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        <Logo size={20} />
        <Text className="text-lg font-bold">Ragbag</Text>
      </View>

      <SearchRow />

      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-4"
        showsVerticalScrollIndicator={false}
      >
        <Filters messages={messages} entities={entities} tags={tags} />
      </ScrollView>

      <View
        className="gap-0 border-t border-sidebar-border px-4 py-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <EnrichBackfill messages={messages} meta={meta} />
        <QueueStatus />
        <View className="flex-row items-center justify-between gap-1">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium" numberOfLines={1}>
              {identity?.email ?? "you"}
            </Text>
            <SyncDot sync={sync} />
          </View>
          <Link href={settingsHref} asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={8}
              className="size-11 items-center justify-center rounded-full active:bg-sidebar-accent"
            >
              <Icon name="settings" size={20} />
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

/**
 * The search field, which is a button.
 *
 * On iOS the sidebar column would ordinarily get a real UISearchController in
 * its navigation bar. It does not have one, because search in this app is not
 * a filter over the list beside it: it answers in two sections over the whole
 * archive, messages and things, and lands you on a result. That is a screen,
 * so this opens one.
 */
function SearchRow() {
  return (
    <Link href={"/search" as Href} asChild>
      <Pressable
        accessibilityRole="search"
        className="mx-4 mb-2 h-11 flex-row items-center gap-2 rounded-lg border border-sidebar-border bg-background px-3 active:bg-background-hover"
      >
        <Icon name="search" size={16} />
        <Text className="text-muted-foreground">Search…</Text>
      </Pressable>
    </Link>
  );
}

function Filters({
  messages,
  entities,
  tags,
}: {
  messages: TMessages;
  entities: TEntityRows;
  tags: readonly TTagRow[];
}) {
  const filter = useFilter();
  const types = useEntityTypes();

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
  // kind makes its row appear here the moment its first thing exists, with no
  // code change at all.
  const thingRows = [
    { view: "images", label: "Images", icon: "image" as TIconName, count: attachmentCounts.images },
    { view: "files", label: "Files", icon: "file" as TIconName, count: attachmentCounts.files },
    ...types.sidebar.map((type) => ({
      view: type.slug,
      label: type.sidebarTitle,
      icon: iconNamed(type.icon),
      count: entityCounts.get(type.kind) ?? 0,
    })),
  ].filter((row) => row.count > 0);

  // The sidebar lists the user's own tags only: AI tags are deliberately
  // numerous and would bury them. They still drive search, they just are not
  // browsable here.
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
        .sort(
          (a, b) =>
            (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
        )
        .slice(0, 40),
    [tags, tagCounts],
  );

  return (
    <>
      <View className="px-2 py-1">
        <FilterRow
          target={EVERYTHING}
          exact
          icon="inbox"
          label="Messages"
          count={messages.length}
        />
        <FilterRow
          target={{ view: "favorites", tagId: filter.tagId }}
          icon="star"
          label="Favorites"
          count={favoriteCount}
        />
      </View>

      {thingRows.length > 0 ? (
        <Group title="Things">
          {thingRows.map((row) => (
            <FilterRow
              key={row.view}
              target={{ view: row.view, tagId: filter.tagId }}
              icon={row.icon}
              label={row.label}
              count={row.count}
            />
          ))}
        </Group>
      ) : null}

      <Group title="Tags">
        {rankedTags.length === 0 ? (
          <Text className="px-2 text-xs text-muted-foreground">
            Tags created by you show up here as you add them.
          </Text>
        ) : (
          rankedTags.map((tag) => (
            <FilterRow
              key={tag.id}
              target={{ view: filter.view, tagId: tag.id }}
              icon="tag"
              label={tag.name}
              count={tagCounts.get(tag.id) ?? 0}
            />
          ))
        )}
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-2 px-2">
      <Text className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{title}</Text>
      {children}
    </View>
  );
}

/**
 * One filter row.
 *
 * Lit by comparing this row's own destination against the path, which is the
 * same rule the web app gets from `<Link>`'s active state: the row that points
 * where you are is the row that is lit. `exact` for the archive itself,
 * because "/" is a prefix of every route in the app and a prefix test would
 * light Messages on every screen.
 */
function FilterRow({
  target,
  icon,
  label,
  count,
  exact = false,
}: {
  target: TFilter;
  icon: TIconName;
  label: string;
  count: number;
  exact?: boolean;
}) {
  const href = filterHref(target);
  const pathname = usePathname();
  const path = String(href);
  const active = exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);

  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        className={`h-11 flex-row items-center gap-2 rounded-lg px-2 ${
          active ? "bg-sidebar-accent active:bg-sidebar-accent-hover" : "active:bg-hover"
        }`}
      >
        <Icon name={icon} size={16} />
        <Text className="shrink text-sm" numberOfLines={1}>
          {label}
        </Text>
        <MenuCount>{count}</MenuCount>
      </Pressable>
    </Link>
  );
}

/** Ceiling on one backfill run: enough for a personal archive, bounded. */
const BACKFILL_LIMIT = 250;

/**
 * Re-run ingestion over messages that finished without a summary.
 *
 * The client already syncs everything it needs to know which those are: no new
 * server API, just the existing per-message retryIngest mutator in a loop,
 * bounded per run. This exists because a server that ran for a day without an
 * OpenAI key leaves a pile of permanently-empty messages that nothing would
 * otherwise revisit: they are "done", so no retry ever fires for them.
 */
function EnrichBackfill({
  messages,
  meta,
}: {
  messages: TMessages;
  meta: TMetaResponse | undefined;
}) {
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
  // (offline or unknown) hides it rather than promising something we cannot do.
  if (!meta?.ai || pending.length === 0) return null;

  const batch = pending.slice(0, BACKFILL_LIMIT);

  const run = async () => {
    setRunning(batch.length);
    let failed = 0;
    // Sequential on purpose: this is a background chore, not a race, and it
    // keeps the mutation log (and the ingest queue) from being flooded.
    for (const message of batch) {
      try {
        // Through runMutation, because Zero resolves a failed mutation rather
        // than rejecting it: a bare await counts every failure as a success.
        await runMutation(zero.mutate(mutators.message.retryIngest({ id: message.id })));
      } catch {
        failed += 1;
      }
      setRunning((n) => n - 1);
    }
    const queued = batch.length - failed;
    toast.info(`Queued ${queued} message${queued === 1 ? "" : "s"} for enrichment`, {
      description:
        pending.length > batch.length
          ? `${pending.length - batch.length} more remain. Run it again when these finish.`
          : "Summaries and tags appear as each one finishes.",
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={running > 0}
      onPress={() => void run()}
      className="mb-1.5 h-8 flex-row items-center gap-1.5 rounded-md active:bg-hover"
    >
      <Icon name={running > 0 ? "spinner" : "sparkles"} size={12} />
      <Text className="text-xs text-muted-foreground">
        {running > 0
          ? `Queueing… ${running} left`
          : `Enrich ${pending.length} message${pending.length === 1 ? "" : "s"}`}
      </Text>
    </Pressable>
  );
}

/**
 * The upload queue's live state, in words: how many are moving, how many are
 * failing and why, or why the whole queue is parked. A queue that only said
 * "N pending" while every attempt was quietly dying looked exactly like a
 * healthy one: the reason is the point.
 */
function QueueStatus() {
  const queue = useBlobQueue();
  const state: TBlobQueueState = useBlobQueueState();
  if (state.pending === 0) return null;

  const entries = Object.values(state.blobs);
  const failing = entries.filter((b) => b.stage === "waiting" && b.lastError);
  const plural = state.pending > 1 ? "s" : "";
  const retry = () => void queue.retryNow();

  if (state.blocked === "auth") {
    return (
      <StatusLine icon="pause">
        {state.pending} upload{plural} paused, sign in to resume
      </StatusLine>
    );
  }

  if (state.blocked === "storage") {
    return (
      <StatusLine icon="alert" tone="text-destructive" onRetry={retry}>
        Uploads paused: the server has no blob storage
      </StatusLine>
    );
  }

  if (failing.length > 0) {
    return (
      <View className="mb-1.5">
        <StatusLine icon="alert" tone="text-destructive" onRetry={retry}>
          {failing.length} upload{failing.length > 1 ? "s" : ""} failing
        </StatusLine>
        <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
          {failing[0]!.lastError}
        </Text>
      </View>
    );
  }

  return (
    <StatusLine icon="spinner" onRetry={retry}>
      {state.pending} upload{plural} in progress
    </StatusLine>
  );
}

function StatusLine({
  icon,
  tone = "text-muted-foreground",
  onRetry,
  children,
}: {
  icon: TIconName;
  tone?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  return (
    <View className="mb-1.5 flex-row items-center gap-1.5">
      <Icon name={icon} size={12} />
      <Text className={`shrink text-xs ${tone}`} numberOfLines={1}>
        {children}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry these uploads now"
          hitSlop={8}
          onPress={onRetry}
          className="ml-auto h-8 flex-row items-center gap-1 rounded-md px-2 active:bg-hover"
        >
          <Icon name="retry" size={12} />
          <Text className="text-xs text-muted-foreground">retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
