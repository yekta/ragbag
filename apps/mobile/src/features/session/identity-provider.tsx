import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth";
import { loadIdentity, saveIdentity, type TIdentity } from "@/lib/identity";
import { useOnline } from "@/lib/network";

// Who this device belongs to, and how much the server currently agrees.
//
// Ported from the gate at the top of apps/web/src/app.tsx, with one change:
// the stored identity comes out of the keychain, so it arrives asynchronously.
// `ready` is what the splash screen waits on, and it is the only reason this
// is a provider rather than a hook: the answer has to be resolved once, above
// everything, instead of raced by every screen that wants it.

export type TSessionStatus = "checking" | "ok" | "expired" | "offline";

type TIdentityValue = {
  identity: TIdentity | null;
  status: TSessionStatus;
  /** The stored identity has been read; before this, nothing may paint. */
  ready: boolean;
  /** Forget this device's identity, for an explicit sign-out. */
  forget: () => void;
};

const IdentityContext = createContext<TIdentityValue>({
  identity: null,
  status: "checking",
  ready: false,
  forget: () => undefined,
});

export function useIdentity(): TIdentityValue {
  return use(IdentityContext);
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const online = useOnline();
  const [stored, setStored] = useState<TIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadIdentity().then((found) => {
      setStored(found);
      setReady(true);
    });
  }, []);

  useSessionRecovery(session.error, session.refetch);

  // Remember the signed-in identity, so the next launch opens offline.
  useEffect(() => {
    if (!session.data) return;
    const identity = {
      userID: session.data.user.id,
      email: session.data.user.email || "you",
    };
    void saveIdentity(identity);
    setStored(identity);
  }, [session.data]);

  const value = useMemo<TIdentityValue>(() => {
    let identity: TIdentity | null;
    let status: TSessionStatus;
    if (session.data) {
      identity = { userID: session.data.user.id, email: session.data.user.email || "you" };
      status = "ok";
    } else if (session.isPending) {
      identity = stored;
      status = "checking";
    } else if (session.error || !online) {
      // Could not reach the server: offline launch from the local store.
      identity = stored;
      status = "offline";
    } else {
      // The server says: no session. Expired, with the identity kept and the
      // local archive still usable, or never signed in on this device.
      identity = stored;
      status = "expired";
    }
    return { identity, status, ready, forget: () => setStored(null) };
  }, [online, ready, session.data, session.error, session.isPending, stored]);

  return <IdentityContext value={value}>{children}</IdentityContext>;
}

/**
 * better-auth probes the session once on mount and then leaves `error` set
 * forever. One failed probe is not a verdict, though: it is a flaky network,
 * an API redeploy, or a phone that just came off a lock screen, and treating
 * it as one parks the app in `offline` until it is force-quit, on an app whose
 * whole premise is riding those out. So retry on a backoff, and immediately
 * when the connection returns.
 */
function useSessionRecovery(error: unknown, refetch: () => void): void {
  const [attempt, setAttempt] = useState(0);
  const online = useOnline();

  useEffect(() => {
    if (!error) {
      setAttempt(0);
      return;
    }
    // 1s, 2s, 4s … capped at 30s. `attempt` is a dependency so this re-arms
    // even when the error object happens to be identical between tries.
    const timer = setTimeout(
      () => {
        void refetch();
        setAttempt((n) => n + 1);
      },
      Math.min(1_000 * 2 ** attempt, 30_000),
    );
    return () => clearTimeout(timer);
  }, [attempt, error, refetch]);

  useEffect(() => {
    if (!online) return;
    setAttempt(0);
    void refetch();
  }, [online, refetch]);
}
