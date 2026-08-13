import { metaResponse, type MetaResponse } from "@ragbag/contracts";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

/**
 * Server capabilities from /api/meta (google configured? dev login? blobs?).
 * Stays undefined while loading AND when the server is unreachable — callers
 * must not treat "unknown" as "off" (offline capture still works).
 *
 * Retries on failure, because one unreachable moment is not a verdict: without
 * it, a fetch that lost a race with the API's boot left the sign-in screen on
 * its spinner forever, since nothing ever asked again.
 */
export function useMeta(): MetaResponse | undefined {
  const [meta, setMeta] = useState<MetaResponse>();

  useEffect(() => {
    // Capabilities don't change under a running server; once we have them, stop.
    if (meta) return;

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      fetch(apiUrl("/api/meta"), { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setMeta(metaResponse.parse(data));
        })
        .catch(() => {
          // Unreachable — the app runs local-first regardless, so just keep
          // asking on a backoff rather than giving up.
          if (cancelled) return;
          timer = setTimeout(load, Math.min(1_000 * 2 ** attempt++, 30_000));
        });
    };
    load();

    // Reconnecting is a much better signal than any timer.
    const onOnline = () => {
      attempt = 0;
      clearTimeout(timer);
      load();
    };
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [meta]);

  return meta;
}
