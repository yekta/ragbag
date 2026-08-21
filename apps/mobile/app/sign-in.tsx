import { useLocalSearchParams } from "expo-router";
import { useEffect, useState, useTransition } from "react";
import { View } from "react-native";
import { Button } from "@/components/button";
import { Logo } from "@/components/logo";
import { Muted, Text, Title } from "@/components/text";
import { oauthRedirectError, signInAnonymously, signInWithGoogle } from "@/lib/auth";
import { dropLocalData } from "@/lib/identity";
import { useMeta } from "@/lib/meta";

// The way in.
//
// Which buttons exist is a server capability, so this screen waits for
// /api/meta rather than guessing: a card that gains a button a beat after it
// is drawn is a card that moves under a thumb already reaching for it.
//
// This screen only shows when no device identity exists: first launch, or
// right after an explicit sign-out. Clearing the local stores happens here
// rather than during sign-out, which is what lets Zero close first.

export default function SignInScreen() {
  const meta = useMeta();
  const params = useLocalSearchParams<{ error?: string | string[] }>();
  const [error, setError] = useState<string | undefined>(() => oauthRedirectError(params.error));

  // The route may already be mounted when the in-app browser hands an OAuth
  // failure back, so the initial state alone is not enough.
  useEffect(() => {
    const returned = oauthRedirectError(params.error);
    if (returned) setError(returned);
  }, [params.error]);

  // One transition per button, because each is its own action and only the one
  // that was pressed should be busy. A transition rather than a boolean of our
  // own: React holds `pending` for exactly as long as the async function runs,
  // including the part after the await, so there is no pair of set-calls to
  // keep in step and no way to leave a button spinning by returning early.
  const [signingIn, startSignIn] = useTransition();
  const [devSigningIn, startDevSignIn] = useTransition();

  useEffect(() => {
    void dropLocalData(async () => {
      // The blob store is cleared by the workspace, which owns it. Nothing to
      // do from here on a device that has never had one.
    });
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <View className="w-full max-w-sm gap-6 rounded-xl border border-border bg-card p-6 shadow-lg">
        <View className="items-center gap-3">
          <Logo size={40} />
          <View className="items-center gap-1">
            <Title>Ragbag</Title>
            <Muted className="text-center">Send anything. Find everything, even offline.</Muted>
          </View>
        </View>

        <View className="gap-2">
          {meta?.googleAuth ? (
            <Button
              size="lg"
              variant="foreground"
              pending={signingIn}
              onPress={() =>
                startSignIn(async () => {
                  setError(undefined);
                  setError(await signInWithGoogle());
                })
              }
            >
              Continue with Google
            </Button>
          ) : null}

          {meta?.devLogin ? (
            <Button
              variant="outline"
              pending={devSigningIn}
              onPress={() =>
                startDevSignIn(async () => {
                  setError(undefined);
                  setError(await signInAnonymously());
                })
              }
            >
              Dev sign-in (anonymous)
            </Button>
          ) : null}

          {error ? <Message>{error}</Message> : null}

          {meta && !meta.googleAuth && !meta.devLogin ? (
            <Message>
              This server has neither Google OAuth nor DEV_LOGIN configured. There is nothing to
              sign in with.
            </Message>
          ) : null}

          {!meta ? (
            <Message>
              Can&apos;t reach the server. Your archive is safe; this is only the way in. Retrying
              automatically.
            </Message>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <Text className="text-center text-sm text-destructive">{children}</Text>;
}
