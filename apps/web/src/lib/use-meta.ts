import { metaResponse, type MetaResponse } from "@ragbag/contracts";
import { useEffect, useState } from "react";

/** Server capabilities from /api/meta (google configured? dev login? blobs?). */
export function useMeta(): MetaResponse | undefined {
  const [meta, setMeta] = useState<MetaResponse>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setMeta(metaResponse.parse(data));
      })
      .catch(() => {
        if (!cancelled) setMeta({ googleAuth: false, devLogin: false, blobs: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return meta;
}
