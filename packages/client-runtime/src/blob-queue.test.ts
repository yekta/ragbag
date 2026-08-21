import { describe, expect, it } from "vitest";
import { BlobQueue } from "./blob-queue.js";
import { MemoryBlobStore } from "./blob-store.js";
import { fetchUploader } from "./blob-upload.js";
import { subtleDigest } from "./web/digest.js";

// The state machine, against the memory store and the plain fetch transport.
//
// Those are the seams the queue is built around (blob-store.ts,
// blob-upload.ts), so wiring them explicitly is not a compromise for the sake
// of Node: it is the same thing a browser falls back to when IndexedDB is
// wedged, and the same shape the Expo app hands over. What is under test here
// is waiting → inflight → done, the backoff, the classified errors, the
// dedupe and the cancellation rules, none of which are per platform.

type THandlers = {
  presign?: (body: Record<string, unknown>) => Response | Promise<Response>;
  put?: () => Response | Promise<Response>;
};

function makeQueue(handlers: THandlers) {
  const seen = { presigns: 0, puts: 0 };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/blobs/presign-upload")) {
      seen.presigns += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (!handlers.presign) throw new TypeError("fetch failed");
      return handlers.presign(body);
    }
    seen.puts += 1;
    if (!handlers.put) throw new TypeError("fetch failed");
    return handlers.put();
  }) as typeof fetch;
  const queue = new BlobQueue({
    userID: "test-user",
    apiBase: "http://api.test",
    fetchImpl,
    store: new MemoryBlobStore(),
    upload: fetchUploader(fetchImpl),
    digest: subtleDigest,
  });
  return { queue, seen };
}

function presignOk(uploadUrl: string | null = "http://bucket.test/key") {
  return () => new Response(JSON.stringify({ uploadUrl }), { status: 200 });
}

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function file(content: string, name = "photo.png", type = "image/png"): File {
  return new File([content], name, { type });
}

describe("BlobQueue", () => {
  it("captures locally, then uploads: waiting → done, pending drains", async () => {
    const { queue } = makeQueue({
      presign: presignOk(),
      put: () => new Response(null, { status: 200 }),
    });

    const captured = await queue.capture(file("hello"), "photo.png");
    expect(captured.face).toBe("image");
    expect(captured.reused).toBe(false);
    // A memory store does not survive a restart, and the queue must say so
    // rather than pretend: this is what the composer warns about.
    expect(queue.state.ephemeral).toBe(true);

    await waitFor(() => queue.state.blobs[captured.blobId]?.stage === "done");
    expect(queue.state.pending).toBe(0);
  });

  it("classifies a blocked PUT as a bucket CORS problem and schedules a retry", async () => {
    const handlers: THandlers = { presign: presignOk() }; // put: absent → network error
    const { queue } = makeQueue(handlers);

    const captured = await queue.capture(file("cors-me"));
    await waitFor(() => queue.state.blobs[captured.blobId]?.lastError !== null);

    const entry = queue.state.blobs[captured.blobId]!;
    expect(entry.stage).toBe("waiting");
    expect(entry.lastError).toContain("CORS");
    expect(entry.attempts).toBe(1);
    expect(entry.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(queue.state.pending).toBe(1);

    // The bucket gets fixed; the chip's "retry now" must not wait out backoff.
    handlers.put = () => new Response(null, { status: 200 });
    await queue.retryBlob(captured.blobId);
    await waitFor(() => queue.state.blobs[captured.blobId]?.stage === "done");
    expect(queue.state.pending).toBe(0);
  });

  it("parks on 401 and resumes on notifyAuthChanged", async () => {
    const handlers: THandlers = {
      presign: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
      put: () => new Response(null, { status: 200 }),
    };
    const { queue } = makeQueue(handlers);

    const captured = await queue.capture(file("auth-me"));
    await waitFor(() => queue.state.blocked === "auth");
    // Parked is not failed: the blob carries no error of its own.
    expect(queue.state.blobs[captured.blobId]?.lastError).toBeNull();

    handlers.presign = presignOk();
    queue.notifyAuthChanged();
    await waitFor(() => queue.state.blobs[captured.blobId]?.stage === "done");
    expect(queue.state.blocked).toBeNull();
  });

  it("dedupes identical bytes into the existing record", async () => {
    const { queue } = makeQueue({
      presign: () => new Response(null, { status: 401 }), // park so the record stays queued
    });

    const first = await queue.capture(file("same bytes"), "a.png");
    const second = await queue.capture(file("same bytes"), "b.png");
    expect(second.blobId).toBe(first.blobId);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(queue.state.pending).toBe(1);
  });

  it("cancel forgets an unlinked upload but never a sent one", async () => {
    const { queue } = makeQueue({
      presign: () => new Response(null, { status: 401 }), // park so records stay queued
    });

    const loose = await queue.capture(file("loose"));
    const sent = await queue.capture(file("sent"));
    await queue.linkAttachment(sent.blobId, "message-1", "attachment-1");

    await queue.cancel(loose.blobId);
    expect(queue.state.blobs[loose.blobId]).toBeUndefined();

    await queue.cancel(sent.blobId);
    expect(queue.state.pending).toBe(1); // the linked record survived

    const bytes = await queue.getLocalBytes(sent.blobId);
    expect(bytes).not.toBeNull();
    expect(await queue.getLocalBytes(loose.blobId)).toBeNull();
  });

  it("surfaces a refused presign as a classified error", async () => {
    const { queue } = makeQueue({
      presign: () => new Response("nope", { status: 500 }),
    });

    const captured = await queue.capture(file("refused"));
    await waitFor(() => queue.state.blobs[captured.blobId]?.lastError !== null);
    expect(queue.state.blobs[captured.blobId]?.lastError).toContain("HTTP 500");
  });
});
