import { queries, type TSchema } from "@ragbag/contracts";
import type { Zero } from "@rocicorp/zero";
import { ZeroProvider } from "@rocicorp/zero/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { BlobQueueProvider, blobQueueFor } from "@/lib/blobs/queue";
import { EntityTypesProvider } from "@/features/session/entity-types";
import { useIdentity } from "@/features/session/identity-provider";
import { sessionCookie } from "@/lib/auth";
import { mobileZeroOptions } from "@/lib/zero";

/**
 * The window on the archive, explicit from day one and unbounded today
 * (plan §14.1). When it needs a bound, this is the one value that changes.
 */
export const WHOLE_ARCHIVE = { limit: null };

/**
 * Preload the whole archive: every device holds it, so reads and search work
 * fully offline. 'forever' keeps the queries registered even when no screen is
 * showing them.
 *
 * Two passes, chained (plan §7). Zero 1.8's `PreloadOptions` is `{ ttl }` and
 * nothing else: there is no priority flag, so firing both at once would let a
 * zero-cache interleave document bodies into the payload the chat is waiting
 * on. Starting `contents` when `chat.complete` resolves is what keeps the chat
 * first; the search index then silently gets deeper, because
 * `TimelineSearchIndex.sync()` is diff-based and the second pass is just
 * another call with richer docs.
 *
 * Module scope, and it must stay there. Every prop of `ZeroProvider` (`init`
 * included) is a dependency of the effect that constructs the client, and that
 * effect's cleanup is `zero.close()`. An inline callback here would rebuild the
 * Zero client on every render of the provider, which resets every query view to
 * empty and makes the timeline flash its loading state over and over. The web
 * app measured five clients per page load before this was hoisted.
 */
const preloadArchive = (zero: Zero<TSchema>) => {
  zero.preload(queries.tags(), { ttl: "forever" });
  zero.preload(queries.entities(), { ttl: "forever" });
  // Tiny, and everything with a kind on it needs it to draw itself: the
  // sidebar rows, the cards, the details labels, the settings editor.
  zero.preload(queries.entityTypes(), { ttl: "forever" });
  const chat = zero.preload(queries.messages(WHOLE_ARCHIVE), { ttl: "forever" });
  void chat.complete.then(() => {
    zero.preload(queries.contents(), { ttl: "forever" });
  });
};

/**
 * Everything below the identity gate: the local store, the upload queue and
 * the user's own entity types.
 *
 * Keyed on the user id by the caller, so signing in as someone else builds a
 * fresh client against a fresh store rather than mixing two archives.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { identity, status } = useIdentity();
  if (!identity) throw new Error("WorkspaceProvider outside an identity");

  const queue = blobQueueFor(identity.userID);
  // The stored session cookie, read at construction. Not reactive on purpose:
  // Zero holds this string for the life of the client, and re-reading it into
  // a prop would rebuild the client on every session refresh. A session that
  // lands later reaches sync through `notifyAuthChanged` and Zero's own
  // reconnect instead.
  const opts = useMemo(
    () => mobileZeroOptions({ userID: identity.userID, auth: sessionCookie() }),
    [identity.userID],
  );

  useEffect(() => {
    // A fresh session unparks uploads that 401'd while signed out.
    if (status === "ok") queue.notifyAuthChanged();
  }, [queue, status]);

  return (
    <ZeroProvider {...opts} init={preloadArchive}>
      <BlobQueueProvider queue={queue}>
        <EntityTypesProvider>{children}</EntityTypesProvider>
      </BlobQueueProvider>
    </ZeroProvider>
  );
}
