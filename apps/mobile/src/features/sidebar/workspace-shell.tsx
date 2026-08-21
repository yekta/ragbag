import { Slot } from "expo-router";

// The platform that is neither iOS nor Android, which today means Metro's web
// target: the shell resolves to `workspace-shell.ios.tsx` or
// `.android.tsx` everywhere it matters, and this file is what Metro falls back
// to. No sidebar, because the web app is the sidebar's real home; this exists
// so a `pnpm --filter mobile start --web` smoke test renders the archive
// rather than throwing.
export function WorkspaceShell() {
  return <Slot />;
}
