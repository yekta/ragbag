import type { TUploadRecord } from "./blob-store.js";

// Putting the bytes on the presigned URL, which is the one part of the upload
// that every platform does differently and that every platform has to report
// progress for.
//
// The web has to use XMLHttpRequest, because `fetch` cannot report upload
// progress at all and a chip that sits at "sending" for a 40 MB video with no
// ring is indistinguishable from a dead one. A phone has something better than
// either: expo-file-system's UploadTask streams off disk, reports progress,
// and on iOS keeps going while the app is suspended.
//
// So this is a function type rather than a class: the queue owns the retry
// loop, the backoff and the state, and only borrows a way to move bytes.

export type TUploadResult = { ok: true } | { ok: false; reason: string };

export type TUploadArgs = {
  url: string;
  record: TUploadRecord;
  /** 0..1, or null when the platform cannot say. */
  onProgress: (progress: number | null) => void;
  /** Aborts the transfer. The queue calls this to cancel a removed attachment. */
  signal: AbortSignal;
};

export type TBlobUploader = (args: TUploadArgs) => Promise<TUploadResult>;

export const CORS_HINT =
  "The storage bucket blocked the browser's upload; its CORS policy must allow this site (see DEPLOY.md)";

export function describeHttp(status: number): string {
  if (status === 403) return "The storage bucket rejected the upload signature (HTTP 403)";
  if (status === 413) return "The storage bucket says this file is too large (HTTP 413)";
  return `The storage bucket refused the upload (HTTP ${status})`;
}

/**
 * The transport of last resort: a plain PUT, no progress.
 *
 * Used where nothing better exists (a worker, a test, a browser without
 * XMLHttpRequest). Progress is reported as `null` throughout, which callers
 * already render as an indeterminate state rather than as zero.
 */
export function fetchUploader(fetchImpl: typeof fetch): TBlobUploader {
  return async ({ url, record, onProgress, signal }) => {
    onProgress(null);
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        body: record.bytes,
        headers: { "content-type": record.mime },
        signal,
      });
      return response.ok ? { ok: true } : { ok: false, reason: describeHttp(response.status) };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "Upload canceled" };
      }
      // A network-level failure on a presigned PUT is almost always the bucket
      // rejecting the preflight: say so instead of "error".
      return { ok: false, reason: CORS_HINT };
    }
  };
}
