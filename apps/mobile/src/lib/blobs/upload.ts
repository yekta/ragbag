import { File } from "expo-file-system";
import { UploadType } from "expo-file-system";
import { describeHttp, type TBlobUploader } from "@ragbag/client-runtime";

// Putting the bytes on the presigned URL, natively.
//
// This is the one place the phone is strictly better equipped than the browser.
// The web has to drive an XMLHttpRequest and watch for a stall, because a dead
// connection never fires an error; expo-file-system hands the transfer to
// NSURLSession or OkHttp, which stream straight off disk, report progress, and
// on iOS keep going while the app is suspended. A 40 MB video sent as the
// screen locks still arrives.
//
// `BINARY_CONTENT` rather than multipart, because a presigned S3 PUT wants the
// raw bytes as the body and nothing else; a multipart envelope would be stored
// verbatim as the object.

export function expoUploader(): TBlobUploader {
  return async ({ url, record, onProgress, signal }) => {
    // Always a real file by this point: the store persists bytes on capture
    // and hands them back as a File, so there is nothing in memory to spill.
    const file = record.bytes instanceof File ? record.bytes : null;
    if (!file) {
      return { ok: false, reason: "The file is no longer on this device" };
    }

    const task = file.createUploadTask(url, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: record.mime,
      headers: { "content-type": record.mime },
      // Keep going when the app is backgrounded. Its JS promise does not
      // survive the process being killed, but the queue's own record does, so
      // a transfer lost that way is simply retried on the next launch.
      sessionType: "background",
      onProgress: ({ bytesSent, totalBytes }) =>
        onProgress(totalBytes > 0 ? bytesSent / totalBytes : null),
    });

    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort);
    try {
      const result = await task.uploadAsync();
      return result.status >= 200 && result.status < 300
        ? { ok: true }
        : { ok: false, reason: describeHttp(result.status) };
    } catch (err) {
      if (signal.aborted) return { ok: false, reason: "Upload canceled" };
      // No CORS on a phone, so unlike the web there is nothing to blame the
      // bucket's policy for: a throw here is the network or the file.
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "The upload failed",
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };
}
