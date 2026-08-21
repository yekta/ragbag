import { dropAllDatabases } from "@rocicorp/zero";
import * as SecureStore from "expo-secure-store";

// Offline identity (plan §9): auth gates *syncing*, never *using* the app.
//
// After a successful sign-in this device remembers who it belongs to; on later
// launches the workspace opens straight from the local store, even when the
// session has expired or there is no network, and a banner nudges to sign back
// in to resume sync. Explicit sign-out clears the identity AND the local data.
//
// SecureStore rather than the web app's localStorage. It is the keychain, so
// reads are asynchronous, which is why this module hands back a promise where
// the web one hands back a value: the identity gate awaits it once at launch
// and holds the splash screen until it lands.

export type TIdentity = { userID: string; email: string };

const KEY = "ragbag.last-user";

export async function loadIdentity(): Promise<TIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TIdentity>;
    if (typeof parsed.userID !== "string") return null;
    return { userID: parsed.userID, email: parsed.email ?? "you" };
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: TIdentity): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(identity));
  } catch {
    // Keychain refused: offline resume just will not work; sync still does.
  }
}

export async function clearIdentity(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}

/**
 * Drop every local trace: Zero's stores and the blob queue's own database and
 * files. Runs after an explicit sign-out, never on mere session expiry.
 *
 * The blob half is passed in rather than imported, because this module is
 * reached from the sign-in screen, which must not drag the queue (and its
 * SQLite connection) into the bundle it needs to paint.
 */
export async function dropLocalData(clearBlobs: () => Promise<void>): Promise<void> {
  await dropAllDatabases().catch(() => {});
  await clearBlobs().catch(() => {});
}
