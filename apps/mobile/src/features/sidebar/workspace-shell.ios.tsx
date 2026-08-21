import { SplitView } from "expo-router/unstable-split-view";
import { Sidebar } from "@/features/sidebar/sidebar";

// The iOS sidebar, which is UIKit's rather than ours.
//
// `SplitView` is expo-router's wrapper over react-native-screens' SplitHost,
// which is a real UISplitViewController. That is the whole reason to use it:
// the sidebar column gets the system's own material (Liquid Glass on iOS 26,
// through `primaryBackgroundStyle: "sidebar"`), the system's own show/hide
// gesture, and a real display-mode button in the navigation bar. None of those
// are things worth re-implementing, and an implementation of them is
// recognisably not the real one.
//
// `preferredSplitBehavior: "automatic"` is deliberate and is the point of
// using a split view at all: UIKit picks the presentation from the size class,
// so an iPhone gets the sidebar over the chat and an iPad gets it beside,
// changing on rotation and in Split View, with nothing here deciding anything.
// Every other approach means owning a width breakpoint and being wrong at the
// edges of it.
//
// The secondary column is not written here: SplitView slots the file-system
// routes into it, which is the stack in (main).
//
// EXPERIMENTAL upstream, in both react-native-screens and expo-router, and
// this file is where that risk is contained. Everything the sidebar shows is
// in ./sidebar, shared with Android, so if this has to be swapped for a
// drawer with a GlassView surface, that is this file and nothing else.

export function WorkspaceShell() {
  return (
    <SplitView
      preferredSplitBehavior="automatic"
      primaryBackgroundStyle="sidebar"
      // The system decides when to offer the toggle. On a phone it is the back
      // chevron's neighbour; on iPad it appears when the sidebar is hidden.
      displayModeButtonVisibility="automatic"
      columnMetrics={{
        // Wide enough for a sidebar title and a count on one line, narrow
        // enough that the chat keeps its own measure beside it.
        minimumPrimaryColumnWidth: 280,
        maximumPrimaryColumnWidth: 380,
      }}
    >
      <SplitView.Column>
        <Sidebar />
      </SplitView.Column>
    </SplitView>
  );
}
