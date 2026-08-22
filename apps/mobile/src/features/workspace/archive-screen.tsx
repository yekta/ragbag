import { queries } from "@ragbag/contracts";
import { useQuery } from "@rocicorp/zero/react";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/icon";
import { useEntityTypes } from "@/features/session/entity-types";
import { useSidebar } from "@/features/sidebar/workspace-shell";
import { Composer } from "@/features/composer/composer";
import { ThingsView } from "@/features/things/things-view";
import { Timeline } from "@/features/timeline/timeline";
import { SyncBanner } from "@/features/workspace/sync-banner";
import { WHOLE_ARCHIVE } from "@/features/workspace/workspace-provider";
import { useMeta } from "@/lib/meta";
import { attachmentFaceOf, entityKindOf, isChatView, searchHref, useFilter } from "@/lib/routes";

// One screen for every view of the archive.
//
// `/`, `/favorites`, `/images`, `/links`, `/tags/<id>` and every combination
// of a view and a tag are the same screen with a different filter, exactly as
// on the web: the route says which, and this reads it. Four route files point
// here, which is what keeps them to four lines each.
//
// Chat-shaped views filter the chat; thing-shaped views replace it with a grid
// or a list, because the thing IS the content (plan §8.2). The composer is
// under all of them: whatever you are looking at, sending is the thing this
// app is for.
//
// "Under" is now literal. The composer floats over the list rather than sitting
// in a row beneath it, so the list has to be told how much of its own bottom is
// covered: that is what `inset` carries. Measured rather than assumed, because
// the bar grows with attachments and with however many lines have been typed,
// and a constant would be wrong in exactly the states where being wrong hides a
// message.

export function ArchiveScreen() {
  const [messages] = useQuery(queries.messages(WHOLE_ARCHIVE));
  const [entities] = useQuery(queries.entities());
  const [tags] = useQuery(queries.tags());
  const meta = useMeta();
  const types = useEntityTypes();
  const filter = useFilter();
  const [composerHeight, setComposerHeight] = useState(0);

  const title = (() => {
    if (filter.view === "favorites") return "Favorites";
    const face = attachmentFaceOf(filter.view);
    if (face) return filter.view === "images" ? "Images" : "Files";
    const kind = entityKindOf(filter.view, types);
    if (kind) return types.sidebarTitle(kind);
    // The chat itself is the app, so it says the app's name rather than
    // "Messages": that word is the sidebar's row for it, and a screen title
    // that repeats the row you tapped tells you nothing you did not just do.
    const tag = filter.tagId ? tags.find((t) => t.id === filter.tagId) : undefined;
    return tag ? tag.name : "Ragbag";
  })();

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerLeft: SidebarButton,
          headerRight: SearchButton,
        }}
      />
      <SyncBanner />
      {isChatView(filter.view) ? (
        <Timeline messages={messages} inset={composerHeight} />
      ) : (
        <ThingsView messages={messages} entities={entities} inset={composerHeight} />
      )}
      <Composer canAttach={meta?.blobs ?? true} onHeight={setComposerHeight} />
    </View>
  );
}

/**
 * The control that reveals the sidebar.
 *
 * On both platforms now, and that is the change: iOS used to get UIKit's own
 * display-mode button out of the split view it no longer has
 * (features/sidebar/workspace-shell.tsx). The swipe from the left edge does the
 * same thing, but a gesture with nothing on screen to suggest it is a feature
 * only the person who wrote it knows about.
 */
function SidebarButton() {
  const { setOpen } = useSidebar();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open sidebar"
      hitSlop={8}
      onPress={() => setOpen(true)}
      className="size-11 items-center justify-center rounded-full active:bg-hover"
    >
      <Icon name="sidebar" size={22} />
    </Pressable>
  );
}

function SearchButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      hitSlop={8}
      onPress={() => router.push(searchHref)}
      className="size-11 items-center justify-center rounded-full active:bg-hover"
    >
      <Icon name="search" size={22} />
    </Pressable>
  );
}
