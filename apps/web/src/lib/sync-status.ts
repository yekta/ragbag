import { useConnectionState } from "@rocicorp/zero/react";
import { useEffect, useRef, useState } from "react";
import { STATUS_HOLD_MS } from "@/lib/settle";

// One derived answer to "how is syncing going?" (SETTLE_PLAN.md §3.2).
//
// Three places used to interpret `useConnectionState()` their own way — the
// sidebar dot, the banner, and the timeline's empty state — which is how a
// connection blip could shove the timeline down by a banner's height while the
// dot said something else. They all read this instead.
//
// The hysteresis rule is asymmetric on purpose: **bad news waits, good news is
// instant.** A `disconnected` that lasts 200 ms between reconnects is not an
// outage and must never reach the screen; being back is worth showing the
// moment it happens. `null` means "no verdict worth showing yet" — callers
// render nothing (with the space reserved), which is what keeps the first paint
// from claiming "Connecting…" on every single load.

/** Zero reports precisely who refused us and with what — pass it on verbatim. */
type AuthRejection = Extract<
  ReturnType<typeof useConnectionState>,
  { name: "needs-auth" }
>["reason"];

export type SyncStatus =
  | { name: "synced" }
  | { name: "syncing" }
  | { name: "offline" }
  /** Signed in, and sync was still turned away — the server's problem, not the user's. */
  | { name: "refused"; detail: string }
  /** The API says this session is gone. Signing in is the fix. */
  | { name: "expired" };

function describeRejection(reason: AuthRejection): string {
  return reason.type === "zero-cache"
    ? `the sync service reported: ${reason.reason}`
    : `its ${reason.type} endpoint answered ${reason.status}`;
}

/** Nothing more is coming until something changes, so waiting on sync is pointless. */
export function isSyncPaused(status: SyncStatus | null): boolean {
  return status?.name === "offline" || status?.name === "refused" || status?.name === "expired";
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function useSyncStatus(sessionExpired: boolean): SyncStatus | null {
  const conn = useConnectionState();
  const online = useOnline();

  let current: SyncStatus;
  if (sessionExpired) current = { name: "expired" };
  else if (conn.name === "needs-auth")
    current = { name: "refused", detail: describeRejection(conn.reason) };
  else if (!online || conn.name === "disconnected" || conn.name === "error")
    current = { name: "offline" };
  else if (conn.name === "connected") current = { name: "synced" };
  else current = { name: "syncing" };

  return useSettledStatus(current);
}

/**
 * Reports `synced` immediately and everything else only once it has held for
 * `STATUS_HOLD_MS`. Before the first verdict, reports nothing at all.
 */
function useSettledStatus(current: SyncStatus): SyncStatus | null {
  const [reported, setReported] = useState<SyncStatus | null>(
    current.name === "synced" ? current : null,
  );
  // Compared by value, not identity: `refused` carries a string, and every
  // render of the provider hands back a fresh object for the same state.
  const key = current.name === "refused" ? `refused:${current.detail}` : current.name;
  const latest = useRef(current);
  latest.current = current;

  useEffect(() => {
    if (latest.current.name === "synced") {
      setReported(latest.current);
      return;
    }
    const timer = setTimeout(() => setReported(latest.current), STATUS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return reported;
}
