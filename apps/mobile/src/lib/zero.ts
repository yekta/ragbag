import { ragbagZeroOptions } from "@ragbag/client-runtime";
import { expoSQLiteStoreProvider } from "@rocicorp/zero/expo-sqlite";
import { ZERO_CACHE_URL } from "@/lib/api";

// The one platform difference in setting Zero up, and its React Native docs
// say so in as many words: the local store. The web app hands `kvStore: "idb"`;
// there is no IndexedDB here, so the store is SQLite through expo-sqlite.
//
// Everything else, the schema, the mutators, the auth context, comes from
// `ragbagZeroOptions` in packages/client-runtime, shared with the web app so
// the two shells cannot drift on what they sync or how they authorize it.

export function mobileZeroOptions(args: { userID: string; auth: string | undefined }) {
  return ragbagZeroOptions({
    cacheURL: ZERO_CACHE_URL,
    userID: args.userID,
    // The stored session cookie. zero-cache forwards it to /api/zero/query and
    // /api/zero/mutate as `Authorization: Bearer`, which the server turns back
    // into a Cookie header (apps/server/src/session.ts).
    auth: args.auth,
    kvStore: expoSQLiteStoreProvider(),
  });
}
