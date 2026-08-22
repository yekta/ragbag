import { WorkspaceProvider } from "@/features/workspace/workspace-provider";
import { WorkspaceShell } from "@/features/sidebar/workspace-shell";
import { useIdentity } from "@/features/session/identity-provider";

// Everything behind the identity gate.
//
// Two layers, and the order matters. `WorkspaceProvider` opens the local store,
// the upload queue and the user's entity types; `WorkspaceShell` is the drawer
// the sidebar is revealed from, and its contents read all three of those.
//
// The shell is chrome rather than a navigator: the routes under (main) are
// slotted into it, so this file declares no screens of its own.

export default function AppLayout() {
  const { identity } = useIdentity();

  // The root gate redirects in an effect so its Slot stays mounted, but that
  // means this layout can render once before the stored identity has loaded,
  // and once more while sign-out is redirecting. Do not construct any of the
  // per-user workspace resources during either gap.
  if (!identity) return null;

  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
