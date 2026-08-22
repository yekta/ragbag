import { useZero } from "@rocicorp/zero/react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/text";
import { useIdentity } from "@/features/session/identity-provider";
import { signInAnonymously, signInWithGoogle } from "@/lib/auth";
import { useMeta } from "@/lib/meta";
import { useSyncStatus } from "@/lib/sync-status";
import { toast } from "@/lib/toast";

// What the app says when syncing is not happening, and only then.
//
// `useSyncStatus` has already settled the verdict (lib/sync-status.ts), so a
// blip between reconnects never reaches this point and a banner appearing is
// always news. That matters more here than on the web: this block is in the
// flow above the list, so anything it does moves the whole archive down, and a
// phone reconnects every time it comes off a lock screen.
//
// Three states, three different things to say, and the difference is who can
// fix it. `expired` is the user's to fix by signing in. `refused` is the
// server's, so it names what happened and offers a retry rather than a
// pointless sign-in. `offline` is nobody's and simply reports.

export function SyncBanner() {
  const { status, remember } = useIdentity();
  const sync = useSyncStatus(status === "expired");
  const meta = useMeta();
  const zero = useZero();

  if (sync?.name === "expired") {
    return (
      <Banner tone="warning">
        <Text className="flex-1 text-sm text-warning-foreground">
          Signed out. Your archive is safe on this device and syncing is paused.
        </Text>
        {meta?.googleAuth ? (
          <BannerButton
            label="Sign in"
            onPress={() =>
              void signInWithGoogle().then((result) => {
                if (result.error) toast.error(result.error);
                if (result.identity) remember(result.identity);
              })
            }
          />
        ) : null}
        {meta?.devLogin ? (
          <BannerButton
            label="Dev sign-in"
            onPress={() =>
              void signInAnonymously().then((error) => {
                if (error) toast.error(error);
              })
            }
          />
        ) : null}
      </Banner>
    );
  }

  if (sync?.name === "refused") {
    return (
      <Banner tone="warning">
        <Text className="flex-1 text-sm text-warning-foreground">
          Signed in, but sync was refused: {sync.detail}. Your archive is safe on this device; new
          messages stay local until sync is accepted.
        </Text>
        <BannerButton label="Retry" onPress={() => void zero.connection.connect()} />
      </Banner>
    );
  }

  if (sync?.name === "offline") {
    return (
      <View className="bg-muted px-4 py-1.5">
        <Text className="text-center text-xs text-muted-foreground">
          Offline. New messages and search keep working; sync resumes automatically.
        </Text>
      </View>
    );
  }

  return null;
}

function Banner({ tone, children }: { tone: "warning"; children: React.ReactNode }) {
  return (
    <View
      className={`flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 ${
        tone === "warning" ? "bg-warning" : ""
      }`}
    >
      {children}
    </View>
  );
}

// The banner's own amber rather than the brand primary, so the strip reads as
// one thing rather than as a notice with a button from somewhere else on it.
function BannerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-8 justify-center rounded-md bg-warning-foreground px-2.5 active:opacity-80"
    >
      <Text className="text-xs font-semibold text-warning">{label}</Text>
    </Pressable>
  );
}
