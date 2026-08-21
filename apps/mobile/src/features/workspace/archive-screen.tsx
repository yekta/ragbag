import { queries } from "@ragbag/contracts";
import { useQuery } from "@rocicorp/zero/react";
import { Stack, useNavigation, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { Platform, Pressable, View } from "react-native";
import { Icon } from "@/components/icon";
import { useEntityTypes } from "@/features/session/entity-types";
import { Composer } from "@/features/composer/composer";
import { ThingsView } from "@/features/things/things-view";
import { Timeline } from "@/features/timeline/timeline";
import { SyncBanner } from "@/features/workspace/sync-banner";
import { WHOLE_ARCHIVE } from "@/features/workspace/workspace-provider";
import { useMeta } from "@/lib/meta";
import { attachmentFaceOf, entityKindOf, isChatView, useFilter } from "@/lib/routes";

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

export function ArchiveScreen() {
  const [messages] = useQuery(queries.messages(WHOLE_ARCHIVE));
  const [entities] = useQuery(queries.entities());
  const [tags] = useQuery(queries.tags());
  const meta = useMeta();
  const types = useEntityTypes();
  const filter = useFilter();

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
          // iOS puts UIKit's own sidebar toggle here, from the split view.
          // Android has no such thing, so the drawer gets a button.
          headerLeft: Platform.OS === "android" ? DrawerButton : undefined,
          headerRight: SearchButton,
        }}
      />
      <SyncBanner />
      {isChatView(filter.view) ? (
        <Timeline messages={messages} />
      ) : (
        <ThingsView messages={messages} entities={entities} />
      )}
      <Composer canAttach={meta?.blobs ?? true} />
    </View>
  );
}

function DrawerButton() {
  // Typed loosely on purpose: `openDrawer` exists on the drawer navigation
  // object, and this button only renders on the platform where the drawer is
  // the host (features/sidebar/workspace-shell.android.tsx).
  const navigation = useNavigation() as unknown as { openDrawer?: () => void };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open sidebar"
      hitSlop={8}
      onPress={() => navigation.openDrawer?.()}
      className="size-11 items-center justify-center rounded-full active:bg-hover"
    >
      <Icon name="menu" size={22} />
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
      onPress={() => router.push("/search" as Href)}
      className="size-11 items-center justify-center rounded-full active:bg-hover"
    >
      <Icon name="search" size={22} />
    </Pressable>
  );
}
