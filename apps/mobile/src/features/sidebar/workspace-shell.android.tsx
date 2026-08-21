import Drawer from "expo-router/drawer";
import { useCSSVariable } from "uniwind";
import { Sidebar } from "@/features/sidebar/sidebar";

// The Android sidebar.
//
// Material 3's navigation drawer lives in Compose and nothing bridges it to
// React Native, so this is the standard drawer (react-native-drawer-layout,
// which expo-router already depends on) dressed in M3's tokens. The gesture is
// react-native-gesture-handler's and the animation is Reanimated's, both on the
// UI thread, so the swipe tracks a thumb at the display's own frame rate.
//
// RN core still exports `DrawerLayoutAndroid`, which IS the platform widget,
// and it was not used: it is the View-system AndroidX drawer from the Material
// 2 era, its native spec has moved into React Native's `specs_DEPRECATED`
// folder, and it has to be the direct parent of its content, which does not
// compose with a native stack inside it. A current-looking drawer built on
// current primitives beats a genuine 2018 one.

export function WorkspaceShell() {
  const surface = useCSSVariable("--color-sidebar") as string;
  const scrim = useCSSVariable("--color-scrim") as string;

  return (
    <Drawer
      drawerContent={() => <Sidebar />}
      screenOptions={{
        // The screen underneath draws its own chrome: a native stack header
        // with the menu button in it, which is where Android puts it.
        headerShown: false,
        drawerType: "front",
        drawerStyle: {
          backgroundColor: surface,
          // M3 shapes the drawer's trailing edge only, so the leading edge
          // stays flush with the screen it slides out of.
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
          width: 320,
        },
        overlayColor: scrim,
        swipeEdgeWidth: 40,
      }}
    />
  );
}
