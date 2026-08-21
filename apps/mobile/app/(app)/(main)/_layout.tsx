import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useCSSVariable } from "uniwind";

// The content column's own stack: a real UINavigationController on iOS and a
// Fragment stack on Android, through react-native-screens.
//
// Every surface the web app opens as a query parameter over the view is a
// screen here instead (lib/routes.ts explains why). The three detail panels are
// form sheets, which is UIKit's own half-height-then-full presentation with the
// grabber and the swipe-to-dismiss, and the screen underneath stays mounted and
// scrolled behind them exactly as the web panels required by construction.
//
// The photo viewer is a full-screen modal rather than a sheet: a picture opened
// full screen is the one surface in this app that should have nothing else on
// screen at all.

export default function MainLayout() {
  const canvas = useCSSVariable("--color-background") as string;
  const ink = useCSSVariable("--color-foreground") as string;

  return (
    <Stack
      screenOptions={{
        headerTintColor: ink,
        headerStyle: { backgroundColor: canvas },
        contentStyle: { backgroundColor: canvas },
        headerShadowVisible: false,
        // The chevron alone. A back button that repeats the previous screen's
        // title is a second title on a phone-width bar.
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[view]/index" options={{ headerShown: false }} />
      <Stack.Screen name="[view]/tags/[tagId]" options={{ headerShown: false }} />
      <Stack.Screen name="tags/[tagId]" options={{ headerShown: false }} />

      <Stack.Screen
        name="message/[id]"
        options={{ presentation: "formSheet", ...SHEET, title: "Message" }}
      />
      <Stack.Screen
        name="entity/[id]"
        options={{ presentation: "formSheet", ...SHEET, title: "" }}
      />
      <Stack.Screen
        name="attachment/[id]"
        options={{ presentation: "formSheet", ...SHEET, title: "" }}
      />
      <Stack.Screen
        name="photo/[id]"
        options={{
          presentation: "fullScreenModal",
          headerShown: false,
          // The viewer paints its own black; a canvas-coloured screen would
          // flash light behind a photo on the way in.
          contentStyle: { backgroundColor: "#000000" },
          animation: "fade",
        }}
      />
      {/* No header on the sheet itself: settings is a stack of its own inside
          it (settings/_layout.tsx), and that stack draws the header. Two would
          be two bars over one screen. */}
      <Stack.Screen
        name="settings"
        options={{ presentation: "formSheet", ...SHEET, headerShown: false }}
      />
      <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
    </Stack>
  );
}

/**
 * Shared sheet geometry.
 *
 * Two detents, not one: a detail panel is usually skimmed and occasionally
 * read, so it opens at a height that leaves the chat visible behind it and
 * pulls up to full when there is more to read. `sheetGrabberVisible` is what
 * says out loud that it does.
 *
 * Android has no form sheet, so react-native-screens presents these as ordinary
 * modal screens there, which is that platform's own answer to the same thing.
 */
const SHEET = {
  sheetAllowedDetents: [0.6, 1] as number[],
  sheetGrabberVisible: true,
  sheetCornerRadius: Platform.OS === "ios" ? 20 : 0,
} as const;
