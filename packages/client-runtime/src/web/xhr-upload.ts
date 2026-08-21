import { CORS_HINT, describeHttp, fetchUploader, type TBlobUploader } from "../blob-upload.js";

/** Abort the PUT when no progress event arrives for this long. */
const PUT_STALL_MS = 45_000;
/** Hard ceiling on a single PUT, however slowly it trickles. */
const PUT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * PUT the bytes to the presigned URL, with progress and a stall watchdog.
 *
 * XMLHttpRequest rather than fetch, and that is not nostalgia: fetch cannot
 * report upload progress at all, so a 40 MB video would sit at "sending" with
 * nothing moving for two minutes and look exactly like a dead app. The
 * watchdog is the other half of the same problem: a connection that dies
 * mid-transfer never fires an error, it simply stops, so silence for 45s is
 * treated as failure rather than waited out forever.
 *
 * Runtimes without XMLHttpRequest (a worker, a test) fall through to the plain
 * fetch transport, which works and reports no progress.
 */
export function xhrUploader(fetchImpl: typeof fetch): TBlobUploader {
  const fallback = fetchUploader(fetchImpl);

  return (args) => {
    if (typeof XMLHttpRequest === "undefined") return fallback(args);
    const { url, record, onProgress, signal } = args;

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      let stalled = false;
      let lastProgressAt = Date.now();
      const stallTimer = setInterval(() => {
        if (Date.now() - lastProgressAt > PUT_STALL_MS) {
          stalled = true;
          xhr.abort();
        }
      }, 5_000);
      const onAbort = () => xhr.abort();
      signal.addEventListener("abort", onAbort);
      const finish = (result: Awaited<ReturnType<TBlobUploader>>) => {
        clearInterval(stallTimer);
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", record.mime);
      xhr.timeout = PUT_TIMEOUT_MS;
      xhr.upload.addEventListener("progress", (e) => {
        lastProgressAt = Date.now();
        onProgress(e.lengthComputable ? e.loaded / e.total : null);
      });
      xhr.addEventListener("load", () =>
        finish(
          xhr.status >= 200 && xhr.status < 300
            ? { ok: true }
            : { ok: false, reason: describeHttp(xhr.status) },
        ),
      );
      xhr.addEventListener("error", () => finish({ ok: false, reason: CORS_HINT }));
      xhr.addEventListener("timeout", () => finish({ ok: false, reason: "The upload timed out" }));
      xhr.addEventListener("abort", () =>
        finish({
          ok: false,
          reason: stalled ? "The upload stalled: no data moved for 45s" : "Upload canceled",
        }),
      );
      xhr.send(record.bytes);
    });
  };
}
