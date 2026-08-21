import { WorkspaceProvider } from "@/features/workspace/workspace-provider";
import { WorkspaceShell } from "@/features/sidebar/workspace-shell";

// Everything behind the identity gate.
//
// Two layers, and the order matters. `WorkspaceProvider` opens the local store,
// the upload queue and the user's entity types; `WorkspaceShell` is the
// platform's sidebar container, which on iOS is a UISplitViewController and on
// Android a drawer, and its contents read all three of those.
//
// The shell is also the navigator: the routes under (main) are slotted into its
// content column, so this file declares no screens of its own.

export default function AppLayout() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
