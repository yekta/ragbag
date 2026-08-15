import type { ZeroOptions } from "@rocicorp/zero";
import { mutators, schema, type AuthData, type Schema } from "@ragbag/contracts";

// Thin per-platform glue (plan §3): Zero owns the store, optimistic
// mutations, and sync. This package only wires platform details together.
// The blob upload queue and lazy blob cache land here in M3.

export type RagbagZeroConfig = {
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
  kvStore: "idb" | "mem";
};

/** Options for `new Zero(...)` / `<ZeroProvider {...opts}>`, shared by all shells. */
export function ragbagZeroOptions(config: RagbagZeroConfig) {
  const context: AuthData = { userID: config.userID };
  return {
    schema,
    mutators,
    context,
    userID: config.userID,
    auth: config.auth,
    cacheURL: config.cacheURL,
    kvStore: config.kvStore,
  } satisfies ZeroOptions<Schema>;
}
