import { metaResponse, type MetaResponse } from "@ragbag/contracts";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

/**
 * Server capabilities from /api/meta (google configured? dev login? blobs?).
 * Stays undefined while loading AND when the server is unreachable — callers
 * must not treat "unknown" as "off" (offline capture still works).
 */
export function useMeta(): MetaResponse | undefined {
  const [meta, setMeta] = useState<MetaResponse>();
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/meta"), { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setMeta(metaResponse.parse(data));
      })
      .catch(() => {
        // Unreachable — leave undefined; the app runs local-first regardless.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return meta;
}
