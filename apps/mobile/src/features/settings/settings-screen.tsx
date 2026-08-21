import { mutators, queries } from "@ragbag/contracts";
import { newId, typeChoices, type TTypeChoice } from "@ragbag/shared";
// The package root IS the universal namespace: SwiftUI on iOS, Jetpack
// Compose on Android, a plain view anywhere else.
import { Host, Switch } from "@expo/ui";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Directory, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Icon, iconNamed } from "@/components/icon";
import { Text } from "@/components/text";
import { useIdentity } from "@/features/session/identity-provider";
import { authClient } from "@/lib/auth";
import { clearBlobQueues } from "@/lib/blobs/queue";
import { formatBytes } from "@/lib/format";
import { clearIdentity, dropLocalData } from "@/lib/identity";
import { runMutation } from "@/lib/mutate";
import { setTheme, useThemePreference, type TTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";

// Settings: what Ragbag looks for, what this device is holding, how it looks,
// and who is signed in.
//
// The types half is ordinary mutations over synced rows, so a change reaches
// the sidebar, the cards and the next ingestion job by the same path any other
// write does. The counts are free: every entity is already on this device.
//
// The switches are `@expo/ui`'s, which means a real UISwitch on iOS and a
// Material 3 switch on Android rather than a drawn approximation of either.
// They sit inside a `Host`, which is the bridge into SwiftUI and Compose; it
// falls back to a plain view where neither exists.

export function SettingsScreen() {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-5 pb-16"
      showsVerticalScrollIndicator={false}
    >
      <TypesSection />
      <StorageSection />
      <AppearanceSection />
      <AccountSection />
    </ScrollView>
  );
}

/**
 * A section: its name, the one line under it, and the thing itself.
 *
 * The spacing lives here rather than at four call sites because it is a rhythm
 * and not a decoration. The three steps are: heading to its note, 4pt, because
 * they are one thought; the pair to what they introduce, 12pt; and section to
 * section, 32pt.
 */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View className="mb-8">
      <Text className={`text-xs font-semibold text-muted-foreground ${note ? "mb-1" : "mb-3"}`}>
        {title}
      </Text>
      {note ? <Text className="mb-3 text-[13px] text-muted-foreground">{note}</Text> : null}
      {children}
    </View>
  );
}

// --- what to look for ---

function TypesSection() {
  const zero = useZero();
  const router = useRouter();
  const [rows] = useQuery(queries.entityTypes());
  const [entities] = useQuery(queries.entities());

  const counts = useMemo(() => {
    // Messages are counted per kind rather than per thing: two links in one
    // message is one message.
    const seen = new Map<string, { things: number; messages: Set<string> }>();
    for (const entity of entities) {
      if (entity.mentions.length === 0) continue;
      const tally = seen.get(entity.kind) ?? { things: 0, messages: new Set<string>() };
      tally.things += 1;
      for (const mention of entity.mentions) tally.messages.add(mention.messageId);
      seen.set(entity.kind, tally);
    }
    return seen;
  }, [entities]);

  const choices = useMemo(() => typeChoices(rows), [rows]);

  const setOn = async (choice: TTypeChoice, wanted: boolean) => {
    try {
      await runMutation(
        zero.mutate(
          choice.id
            ? mutators.entityType.setEnabled({ id: choice.id, enabled: wanted })
            : // Nothing to update: this one has never been turned on here.
              mutators.entityType.install({ id: newId(), kind: choice.kind }),
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work");
    }
  };

  // One list, not two. A second heading ("Don't look for") turns a switch into
  // a place, so turning something off makes its row leave the screen and
  // reappear further down, and the reader has to find it again to change their
  // mind. The switch says the same thing without moving anything.
  return (
    <Section
      title="Things to look for"
      note="These get pulled out of your messages. Turn any off, or add your own."
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/settings/types/new" as Href)}
        className="h-10 flex-row items-center gap-1.5 self-start rounded-lg border border-border bg-card px-3.5 active:bg-background-hover"
      >
        <Icon name="plus" size={16} />
        <Text className="text-sm font-medium">Add</Text>
      </Pressable>

      <View className="mt-3 gap-1.5">
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.kind}
            choice={choice}
            count={counts.get(choice.kind)}
            onToggle={(wanted) => void setOn(choice, wanted)}
            onEdit={
              choice.id ? () => router.push(`/settings/types/${choice.id}` as Href) : undefined
            }
          />
        ))}
      </View>
    </Section>
  );
}

function ChoiceRow({
  choice,
  count,
  onToggle,
  onEdit,
}: {
  choice: TTypeChoice;
  count: { things: number; messages: Set<string> } | undefined;
  onToggle: (wanted: boolean) => void;
  /** Absent for one of ours with no row yet: there is nothing to edit. */
  onEdit?: () => void;
}) {
  const found = count?.things ?? 0;
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-border p-2.5">
      <View
        className={`size-9 shrink-0 items-center justify-center rounded-md bg-muted ${
          choice.enabled ? "" : "opacity-60"
        }`}
      >
        <Icon name={iconNamed(choice.icon)} size={16} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium" numberOfLines={1}>
          {choice.sidebarTitle}
        </Text>
        <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
          {found > 0
            ? `${found} in ${count!.messages.size} message${count!.messages.size === 1 ? "" : "s"}`
            : "None yet"}
        </Text>
      </View>
      {onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${choice.sidebarTitle}`}
          hitSlop={8}
          onPress={onEdit}
          className="size-9 items-center justify-center rounded-full active:bg-hover"
        >
          <Icon name="edit" size={16} />
        </Pressable>
      ) : null}
      <Host matchContents>
        <Switch
          value={choice.enabled}
          onValueChange={onToggle}
          label={`Look for ${choice.sidebarTitle}`}
        />
      </Host>
    </View>
  );
}

// --- storage ---

function StorageSection() {
  const [used, setUsed] = useState<number | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    // What this app is holding, and what the phone has left. The web asks the
    // browser for a quota; a phone has no quota, it has a disk, so the honest
    // pair is "this app uses N" and "the device has M free". The app's own
    // number is measured rather than estimated: the caches are directories.
    try {
      const root = new Directory(Paths.cache, "ragbag-blobs");
      setUsed(root.exists ? (root.size ?? 0) : 0);
      setFree(Paths.availableDiskSpace);
    } catch {
      setUsed(null);
    }
  }, [clearing]);

  const clear = () => {
    setClearing(true);
    void clearBlobQueues()
      .then(() => {
        // expo-image keeps its own disk cache of every thumbnail and display
        // copy, which is most of what "cached pictures" means here.
        void Image.clearDiskCache();
        toast.info("Cached pictures cleared", { description: "They come back as you browse." });
      })
      .finally(() => setClearing(false));
  };

  return (
    <Section title="Storage">
      <View className="rounded-lg border border-border p-3.5">
        <Text className="text-sm">
          {used === null ? "…" : formatBytes(used)} used
          {free !== null ? (
            <Text className="text-sm text-muted-foreground">
              {` · ${formatBytes(free)} free on this device`}
            </Text>
          ) : null}
        </Text>
        <Text className="mt-1 text-[13px] text-muted-foreground">
          Your whole archive is on this device, so search works offline.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: clearing }}
          disabled={clearing}
          onPress={clear}
          className="mt-3 h-9 flex-row items-center gap-1.5 self-start rounded-md border border-border px-3 active:bg-background-hover"
        >
          <Icon name={clearing ? "spinner" : "trash"} size={14} />
          <Text className="text-sm">Clear cached pictures</Text>
        </Pressable>
      </View>
    </Section>
  );
}

// --- appearance ---

const THEMES: { value: TTheme; label: string; icon: "sun" | "moon" | "monitor" }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

function AppearanceSection() {
  const theme = useThemePreference();
  return (
    <Section title="Appearance">
      <View className="flex-row gap-1.5">
        {THEMES.map((option) => {
          const selected = theme === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setTheme(option.value)}
              // The selected state is a ring rather than a different fill or a
              // dropped border: geometry never moves, so switching cannot slide
              // the row (see the same rule on every other selected state here).
              className={`h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border bg-card active:bg-background-hover ${
                selected ? "border-transparent ring-1 ring-primary" : "border-border"
              }`}
            >
              <Icon name={option.icon} size={14} />
              <Text className="text-sm">{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Section>
  );
}

// --- account ---

function AccountSection() {
  const { identity, forget } = useIdentity();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = () => {
    Alert.alert(
      "Sign out?",
      "This device's copy of the archive is deleted with it. It syncs back when you sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            setSigningOut(true);
            void (async () => {
              await clearIdentity();
              // Offline sign-out still signs out locally; the session dies
              // server-side when it expires.
              await authClient.signOut().catch(() => {});
              await dropLocalData(clearBlobQueues);
              // The gate above sends the app to the sign-in screen the moment
              // the identity is gone (app/_layout.tsx).
              forget();
            })();
          },
        },
      ],
    );
  };

  return (
    <Section title="Account">
      <View className="flex-row flex-wrap items-center gap-3">
        <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
          {identity?.email ?? "Signed in"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: signingOut }}
          disabled={signingOut}
          onPress={signOut}
          className="h-9 flex-row items-center gap-1.5 rounded-md border border-border px-3 active:bg-background-hover"
        >
          <Icon name={signingOut ? "spinner" : "logout"} size={14} />
          <Text className="text-sm">Sign out</Text>
        </Pressable>
      </View>
    </Section>
  );
}
