import { Slot, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastHost } from "@/components/toast-host";
import { IdentityProvider, useIdentity } from "@/features/session/identity-provider";
import { applyStoredTheme, useResolvedTheme } from "@/lib/theme";

import "../global.css";

// The app shell.
//
// The gate this layout implements is the web app's, unchanged in intent (plan
// §9): auth gates *syncing*, never *using*. Once a device has an identity the
// workspace opens straight from the local store, session pending, expired or
// fully offline, and a banner nudges when sync needs a sign-in. Only an
// explicit sign-out clears the identity, and the local data with it.
//
// `<Slot/>` rather than `<Stack/>`, and that is load-bearing: the workspace
// layout below this one hosts a UISplitViewController on iOS, and
// react-native-screens refuses to mount one inside another navigator. Slot is
// the one expo-router layout that is not one. Nothing is lost by it: there is
// no transition worth animating between the sign-in screen and the archive.

// Before the first render, not in an effect: uniwind resolves every className
// against the current theme, so a theme applied after mount is one frame of
// the wrong one on every cold start.
applyStoredTheme();

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Unavailable outside a native runtime; nothing here depends on it.
});

export default function RootLayout() {
  const scheme = useResolvedTheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider statusBarTranslucent>
        <SafeAreaProvider>
          {/* Inverted on purpose: the bar's content has to contrast with the
              canvas behind it, so a dark theme wants light glyphs. */}
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <IdentityProvider>
            <SessionGate />
          </IdentityProvider>
          {/* Outside the gate, so a failure that happens while signing in
              still has somewhere to be said. */}
          <ToastHost />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sends the app to the sign-in screen when this device has no identity, and
 * back to the archive the moment it gets one.
 *
 * A redirect rather than a branch in the render, because the two sides are
 * routes: the workspace needs a URL for deep links, notifications and the
 * share sheet to land on, and a screen rendered in place of the router has
 * none. `useSegments` rather than a pathname string so the check survives a
 * route being renamed.
 */
function SessionGate() {
  const { identity, ready } = useIdentity();
  const segments = useSegments();
  const router = useRouter();
  const onSignIn = segments[0] === "sign-in";

  useEffect(() => {
    if (!ready) return;
    // The splash screen has covered every frame up to this one, so the first
    // thing anyone sees is the screen they are owed rather than a flash of the
    // other one.
    void SplashScreen.hideAsync().catch(() => {});
    if (!identity && !onSignIn) router.replace("/sign-in");
    if (identity && onSignIn) router.replace("/");
  }, [identity, onSignIn, ready, router]);

  return <Slot />;
}
