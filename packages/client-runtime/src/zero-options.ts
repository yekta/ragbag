import type { ZeroOptions } from "@rocicorp/zero";
import { mutators, schema, type TAuthData, type TSchema } from "@ragbag/contracts";

// Thin per-platform glue (plan §3): Zero owns the store, optimistic
// mutations, and sync. This package only wires platform details together.

export type TRagbagZeroConfig = {
  /** zero-cache URL, e.g. http://localhost:4848 */
  cacheURL: string;
  userID: string;
  /**
   * Auth token forwarded by zero-cache to /api/zero/query|mutate as an
   * Authorization: Bearer header. On web this stays undefined: the better-auth
   * session cookie is forwarded instead (ZERO_*_FORWARD_COOKIES). Native shells
   * (Electron/Expo) pass their stored session token here.
   */
  auth?: string | undefined;
  /**
   * Where the local store lives. `"idb"` on web, `"mem"` for a headless
   * client (the sync proof), and a provider object on native: Expo has no
   * IndexedDB, so the shell passes `expoSQLiteStoreProvider()` from
   * `@rocicorp/zero/expo-sqlite`. Typed as Zero's own union rather than the
   * two web strings, so a shell can hand over a provider without this file
   * having to import a platform package to name its type.
   */
  kvStore: ZeroOptions<TSchema>["kvStore"];
};

/** Options for `new Zero(...)` / `<ZeroProvider {...opts}>`, shared by all shells. */
export function ragbagZeroOptions(config: TRagbagZeroConfig) {
  const context: TAuthData = { userID: config.userID };
  return {
    schema,
    mutators,
    context,
    userID: config.userID,
    auth: config.auth,
    cacheURL: config.cacheURL,
    kvStore: config.kvStore,
  } satisfies ZeroOptions<TSchema>;
}
