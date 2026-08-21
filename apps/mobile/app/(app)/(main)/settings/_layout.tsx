import { Stack } from "expo-router";
import { useCSSVariable } from "uniwind";

// Settings is a stack inside the sheet, not a single screen.
//
// The web app swaps the drawer's body between a list and an editor and keeps
// one heading over both. A phone has a better answer already built: a nested
// native stack, so opening a type pushes with the platform's own transition
// and closing it is the back gesture rather than a button that says "done".
// That is also what t3 code does with its own settings sheet.

export default function SettingsLayout() {
  const canvas = useCSSVariable("--color-background") as string;
  const ink = useCSSVariable("--color-foreground") as string;

  return (
    <Stack
      screenOptions={{
        headerTintColor: ink,
        headerStyle: { backgroundColor: canvas },
        contentStyle: { backgroundColor: canvas },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        // A sheet reads better with the centred title the platform gives a
        // modal, rather than the leading-aligned one a root screen takes.
        headerTitleAlign: "center",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="types/[id]" options={{ title: "" }} />
    </Stack>
  );
}
