import { dropAllDatabases } from "@rocicorp/zero";
import { clearArchiveHint } from "@/lib/archive-hint";

// Offline identity (plan §9): auth gates *syncing*, never *using* the app.
// After a successful sign-in we remember who this device belongs to; on later
// launches the workspace opens instantly from the local store (even when the
// session has expired or the network is down) and a banner nudges to sign
// back in to resume sync. Explicit sign-out clears the identity AND the local
// data (shared-computer safety).

export type Identity = { userID: string; email: string };

const KEY = "ragbag:last-user";

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Identity> & { name?: string };
    if (typeof parsed.userID !== "string") return null;
    // `name` is what this used to hold. A device that last signed in before
    // the switch keeps showing that until its next session lands.
    return { userID: parsed.userID, email: parsed.email ?? parsed.name ?? "you" };
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Storage full/blocked: offline resume just won't work; sync still does.
  }
}

export function clearIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  // What this device knew about the archive belonged to that user.
  clearArchiveHint();
}

/**
 * Drop every local trace: Zero's replicache databases and the blob
 * queue/cache databases. Runs on the sign-in screen after an explicit
 * sign-out (never on mere session expiry).
 */
export async function dropLocalData(): Promise<void> {
  try {
    await dropAllDatabases();
  } catch {
    // best effort
  }
  try {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs
        .filter((db) => db.name?.startsWith("ragbag-blobs-"))
        .map(
          (db) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              // Deleted, refused or blocked: all three mean "stop waiting".
              for (const event of ["success", "error", "blocked"] as const) {
                req.addEventListener(event, () => resolve());
              }
            }),
        ),
    );
  } catch {
    // indexedDB.databases() unsupported → leave the caches; they are keyed
    // by user id and unreachable without a session anyway.
  }
}
