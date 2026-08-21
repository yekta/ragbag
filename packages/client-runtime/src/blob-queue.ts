import { faceForMime, newId } from "@ragbag/shared";
import type { TAttachmentFace } from "@ragbag/shared";
import { MemoryBlobStore, type TBlobStore, type TUploadRecord } from "./blob-store.js";
import type { TBlobUploader } from "./blob-upload.js";

// The persistent blob upload queue + lazy blob cache: Zero syncs rows, not
// files. Capture stores the bytes locally and returns a client-minted blobId
// IMMEDIATELY: the message is created and syncs before any network happens,
// offline included. A background flush presigns, PUTs the bytes to the object
// store, and survives app restarts (the constructor resumes whatever is still
// pending). Downloaded blobs land in a bounded LRU cache so other devices only
// fetch originals once.
//
// Everything here is observable: every blob's upload lifecycle (waiting →
// inflight → done, with progress and a classified lastError) is published
// through `state.blobs` so the composer chips, timeline badges and the
// sidebar can show what is actually happening. A queue that silently retried
// on a 15-minute backoff looked exactly like a dead app; never again.
//
// Every stage is also bounded: record writes fall back to an in-memory overlay
// when the store is wedged (uploads still work, they just do not survive a
// relaunch, `state.ephemeral`), the presign has a deadline, and the PUT has a
// stall watchdog inside whichever uploader is handed in. Nothing in this file
// may hang forever.
//
// What is NOT here is anything platform-specific. Storage arrives as a
// `TBlobStore`, the transport as a `TBlobUploader`, the hash as a `digest`
// function, and "the world changed" as a `watchWake` subscription. Web hands
// over IndexedDB, XMLHttpRequest and crypto.subtle; the Expo app hands over
// SQLite, expo-file-system's UploadTask and expo-crypto. The state machine
// below is the same one on both, which is the entire point: it is the part
// that took production outages to get right.

export type TCapturedBlob = {
  blobId: string;
  sha256: string;
  mime: string;
  size: number;
  originalName?: string | undefined;
  /** How it renders and which extraction path it will take. */
  face: TAttachmentFace;
  /**
   * True when capture matched bytes already queued on this device: the
   * blobId belongs to an earlier attachment (possibly an already-sent
   * message), so removing this attachment must NOT cancel the shared upload.
   */
  reused: boolean;
};

export type TBlobUploadState = {
  /** waiting = queued or backing off; inflight = presign/PUT running now. */
  stage: "waiting" | "inflight" | "done";
  /** 0..1 while the transfer reports progress, else null (indeterminate). */
  progress: number | null;
  attempts: number;
  /** Epoch ms of the next scheduled attempt; 0 = as soon as possible. */
  nextAttemptAt: number;
  /** Human-readable, classified reason for the last failure, if any. */
  lastError: string | null;
};

export type TBlobQueueState = {
  /** Uploads waiting or retrying (persisted; survives restarts). */
  pending: number;
  /** Why the queue is parked, if it is. */
  blocked: "auth" | "storage" | null;
  /**
   * Local storage is unavailable, so queued uploads live in memory only: they
   * still upload normally but will be lost if the app restarts first.
   */
  ephemeral: boolean;
  /** Per-blob upload lifecycle, keyed by blobId; drives all upload UI. */
  blobs: Record<string, TBlobUploadState>;
};

// 5s → 15s → 45s → 2¼m → 6¾m → 15m cap. The first retries are quick because
// the common failure (flaky network, API redeploy) is short-lived and the
// user is often still looking at the chip; the cap keeps a dead bucket from
// burning battery overnight.
const BACKOFF_BASE_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

const PRESIGN_TIMEOUT_MS = 15_000;
/** Deadline on individual store operations before falling back to memory. */
const STORE_OP_TIMEOUT_MS = 4_000;

export type TBlobQueueOptions = {
  /** Scopes the store, like Zero scopes its own. */
  userID: string;
  /** Base URL of the API, "" when same-origin (web behind the dev proxy). */
  apiBase?: string;
  /** Extra headers for API calls; native shells pass their bearer token. */
  authHeaders?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Where records and cached bytes live. Defaults to memory only. */
  store?: TBlobStore;
  /** How bytes reach the presigned URL. */
  upload: TBlobUploader;
  /** SHA-256 of a blob, lowercase hex. */
  digest: (blob: Blob) => Promise<string>;
  /**
   * Whether there is a connection. Used only to word a failure honestly:
   * "offline, will resume" reads very differently from "couldn't reach the
   * API", and a queue that says the wrong one sends people to check a server
   * that is fine.
   */
  isOnline?: () => boolean;
  /**
   * Subscribe to every signal that the world changed: the network came back,
   * the app came to the foreground, a new session landed. Each is a reason to
   * abandon a backoff earned during an outage that has since ended, because
   * waiting out fifteen minutes after the wifi returns just looks broken.
   */
  watchWake?: (retry: () => void) => () => void;
};

function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export class BlobQueue {
  readonly #apiBase: string;
  readonly #authHeaders: (() => Record<string, string>) | undefined;
  readonly #fetch: typeof fetch;
  readonly #store: TBlobStore;
  readonly #upload: TBlobUploader;
  readonly #digest: (blob: Blob) => Promise<string>;
  readonly #isOnline: () => boolean;
  readonly #unwatch: (() => void) | undefined;
  /**
   * In-memory overlay over the store. Normally empty; holds records whenever
   * the store is broken or a write to it times out. Consulted first
   * everywhere, so a record's home never matters to the rest of the code.
   */
  readonly #mem = new Map<string, TUploadRecord>();
  readonly #listeners = new Set<() => void>();
  /** Abort controllers for in-flight transfers, keyed by blobId. */
  readonly #aborts = new Map<string, AbortController>();
  /** Blobs canceled mid-flight; their failure is cleanup, not a retry. */
  readonly #cancelled = new Set<string>();
  #state: TBlobQueueState = { pending: 0, blocked: null, ephemeral: false, blobs: {} };
  #flushing = false;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: TBlobQueueOptions) {
    this.#apiBase = opts.apiBase ?? "";
    this.#authHeaders = opts.authHeaders;
    this.#fetch = opts.fetchImpl ?? fetch.bind(globalThis);
    this.#store = opts.store ?? new MemoryBlobStore();
    this.#upload = opts.upload;
    this.#digest = opts.digest;
    this.#isOnline = opts.isOnline ?? (() => true);
    if (this.#store.ephemeral) this.#state = { ...this.#state, ephemeral: true };

    // Resume anything a previous session left behind, now and whenever the
    // platform says something changed.
    void this.retryNow();
    this.#unwatch = opts.watchWake?.(() => void this.retryNow());
  }

  /** Release the wake subscription. Only a test or a sign-out needs this. */
  dispose(): void {
    this.#unwatch?.();
    clearTimeout(this.#flushTimer);
  }

  /** Drop all backoff and flush immediately. */
  async retryNow(): Promise<void> {
    for (const record of await this.#allUploads()) {
      if (record.nextAttemptAt > 0) {
        await this.#putUpload({ ...record, nextAttemptAt: 0 });
      }
    }
    clearTimeout(this.#flushTimer);
    await this.#refreshPending();
    this.flush(true);
  }

  /** Drop one blob's backoff and flush; the chip's "retry now" button. */
  async retryBlob(blobId: string): Promise<void> {
    const record = await this.#getUpload(blobId);
    if (record) await this.#putUpload({ ...record, nextAttemptAt: 0 });
    await this.#refreshPending();
    this.flush(true);
  }

  /**
   * Abort and forget a queued upload: an attachment removed before sending.
   * A record already linked to a message survives untouched (the message still
   * needs its bytes); callers also pass `reused` captures through unharmed.
   */
  async cancel(blobId: string): Promise<void> {
    const record = await this.#getUpload(blobId);
    if (record?.messageId) return; // sent: the message needs its bytes
    const wasInflight = this.#aborts.has(blobId);
    this.#cancelled.add(blobId);
    this.#aborts.get(blobId)?.abort(); // an in-flight attempt unwinds via #finishCancelled
    if (record) await this.#deleteUpload(blobId);
    if (!wasInflight) {
      this.#cancelled.delete(blobId);
      this.#noteBlob(blobId, null);
      await this.#refreshPending();
    }
  }

  // --- state for UI ---

  get state(): TBlobQueueState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setState(patch: Partial<TBlobQueueState>) {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }

  #markEphemeral() {
    if (!this.#state.ephemeral) this.#setState({ ephemeral: true });
  }

  /** Replace (or with null, remove) one blob's published upload state. */
  #noteBlob(blobId: string, entry: TBlobUploadState | null) {
    const blobs = { ...this.#state.blobs };
    if (entry === null) delete blobs[blobId];
    else blobs[blobId] = entry;
    this.#setState({ blobs });
  }

  #noteProgress(blobId: string, progress: number | null) {
    const entry = this.#state.blobs[blobId];
    if (!entry || entry.stage !== "inflight") return;
    // Progress events arrive every ~50ms; only re-render on visible change.
    const same =
      entry.progress !== null &&
      progress !== null &&
      Math.round(entry.progress * 100) === Math.round(progress * 100);
    if (!same) this.#noteBlob(blobId, { ...entry, progress });
  }

  /**
   * Recount pending uploads and rebuild the per-blob map from the records:
   * in-flight and completed entries are preserved, everything else mirrors
   * what is actually persisted (attempts, backoff, last error).
   */
  async #refreshPending() {
    const uploads = await this.#allUploads();
    const blobs: Record<string, TBlobUploadState> = {};
    for (const [id, entry] of Object.entries(this.#state.blobs)) {
      if (entry.stage === "done" || entry.stage === "inflight") blobs[id] = entry;
    }
    for (const record of uploads) {
      if (blobs[record.blobId]?.stage === "inflight") continue;
      blobs[record.blobId] = {
        stage: "waiting",
        progress: null,
        attempts: record.attempts,
        nextAttemptAt: record.nextAttemptAt,
        lastError: record.lastError ?? null,
      };
    }
    this.#setState({ pending: uploads.length, blobs });
  }

  /** Sign-in happened (or a session refreshed): unpark and retry now. */
  notifyAuthChanged() {
    if (this.#state.blocked === "auth") this.#setState({ blocked: null });
    this.flush(true);
  }

  // --- record storage (the injected store, with a memory overlay) ---

  async #allUploads(): Promise<TUploadRecord[]> {
    let stored: TUploadRecord[] = [];
    try {
      stored = await withDeadline(this.#store.allUploads(), STORE_OP_TIMEOUT_MS, "read");
    } catch {
      this.#markEphemeral();
    }
    const merged = new Map(stored.map((r) => [r.blobId, r] as const));
    for (const [id, record] of this.#mem) merged.set(id, record);
    return [...merged.values()];
  }

  async #getUpload(blobId: string): Promise<TUploadRecord | undefined> {
    const inMem = this.#mem.get(blobId);
    if (inMem) return inMem;
    try {
      return await withDeadline(this.#store.getUpload(blobId), STORE_OP_TIMEOUT_MS, "read");
    } catch {
      return undefined;
    }
  }

  async #putUpload(record: TUploadRecord): Promise<void> {
    if (this.#mem.has(record.blobId)) {
      this.#mem.set(record.blobId, record);
      return;
    }
    try {
      await withDeadline(this.#store.putUpload(record), STORE_OP_TIMEOUT_MS, "write");
      return;
    } catch {
      // fall through to memory
    }
    this.#mem.set(record.blobId, record);
    this.#markEphemeral();
  }

  async #deleteUpload(blobId: string): Promise<void> {
    this.#mem.delete(blobId);
    try {
      await withDeadline(this.#store.deleteUpload(blobId), STORE_OP_TIMEOUT_MS, "delete");
    } catch {
      // the read deadline already degrades reads; nothing better to do
    }
  }

  // --- capture (the composer path) ---

  /**
   * Hash + persist the bytes locally and return the blobId to put on the
   * message. Pure local work: safe offline; the upload happens in the flush.
   */
  async capture(file: Blob, originalName?: string): Promise<TCapturedBlob> {
    const sha256 = await this.#digest(file);
    const mime = file.type || "application/octet-stream";

    // Same bytes already waiting to upload? Reuse the record so the message
    // points at the id the server will learn about.
    const existing = (await this.#allUploads()).find((u) => u.sha256 === sha256);
    if (existing) {
      return {
        blobId: existing.blobId,
        sha256,
        mime: existing.mime,
        size: existing.size,
        originalName: existing.originalName,
        face: faceForMime(existing.mime),
        reused: true,
      };
    }

    const record: TUploadRecord = {
      blobId: newId(),
      sha256,
      mime,
      size: file.size,
      originalName,
      bytes: file,
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: Date.now(),
    };
    await this.#putUpload(record);
    await this.#refreshPending();
    this.flush();
    return {
      blobId: record.blobId,
      sha256,
      mime,
      size: file.size,
      originalName,
      face: faceForMime(mime),
      reused: false,
    };
  }

  /**
   * Remember which attachment a captured blob belongs to, once the message
   * has been sent. That is what makes `cancel` refuse to drop it: an
   * attachment removed from the composer is ours to abort, an attachment on a
   * sent message still needs its bytes to reach the bucket.
   */
  async linkAttachment(blobId: string, messageId: string, attachmentId: string): Promise<void> {
    const record = await this.#getUpload(blobId);
    if (record) await this.#putUpload({ ...record, messageId, attachmentId });
  }

  // --- flush (the background upload loop) ---

  flush(force = false): void {
    if (this.#flushing) return;
    if (this.#state.blocked === "auth" && !force) return;
    this.#flushing = true;
    void this.#flushLoop()
      .catch(() => {})
      .finally(() => {
        this.#flushing = false;
      });
  }

  async #flushLoop(): Promise<void> {
    let nextWake = Infinity;

    for (const record of (await this.#allUploads()).sort((a, b) => a.createdAt - b.createdAt)) {
      if (record.nextAttemptAt > Date.now()) {
        nextWake = Math.min(nextWake, record.nextAttemptAt);
        continue;
      }
      const outcome = await this.#uploadOne(record);
      if (outcome === "auth") {
        this.#setState({ blocked: "auth" });
        return; // parked until notifyAuthChanged()
      }
      if (outcome === "retry") {
        const updated = await this.#getUpload(record.blobId);
        if (updated) nextWake = Math.min(nextWake, updated.nextAttemptAt);
      }
    }

    await this.#refreshPending();
    if (nextWake < Infinity) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = setTimeout(() => this.flush(), Math.max(1000, nextWake - Date.now()));
    }
  }

  async #uploadOne(record: TUploadRecord): Promise<"done" | "retry" | "auth"> {
    const blobId = record.blobId;
    if (this.#cancelled.has(blobId)) return this.#finishCancelled(blobId);

    const fail = async (error: string, extraDelayMs = 0) => {
      if (this.#cancelled.has(blobId)) return this.#finishCancelled(blobId);
      const attempts = record.attempts + 1;
      const backoff =
        Math.min(BACKOFF_BASE_MS * 3 ** (attempts - 1), MAX_BACKOFF_MS) + extraDelayMs;
      const nextAttemptAt = Date.now() + backoff;
      await this.#putUpload({ ...record, attempts, nextAttemptAt, lastError: error });
      this.#noteBlob(blobId, {
        stage: "waiting",
        progress: null,
        attempts,
        nextAttemptAt,
        lastError: error,
      });
      return "retry" as const;
    };

    this.#noteBlob(blobId, {
      stage: "inflight",
      progress: null,
      attempts: record.attempts,
      nextAttemptAt: 0,
      lastError: record.lastError ?? null,
    });

    let presign: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PRESIGN_TIMEOUT_MS);
      try {
        presign = await this.#fetch(`${this.#apiBase}/api/blobs/presign-upload`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", ...this.#authHeaders?.() },
          body: JSON.stringify({
            blobId,
            sha256: record.sha256,
            mime: record.mime,
            size: record.size,
            originalName: record.originalName,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return fail("The API did not answer the upload request (timed out)");
      }
      return fail(
        this.#isOnline()
          ? "Couldn't reach the API to start the upload"
          : "Offline. The upload will resume when the connection returns",
      );
    }
    if (presign.status === 401) {
      // Parked, not failed: the chip shows "waiting for sign-in" via
      // state.blocked, so this is not an error on the blob itself.
      this.#noteBlob(blobId, {
        stage: "waiting",
        progress: null,
        attempts: record.attempts,
        nextAttemptAt: 0,
        lastError: null,
      });
      return "auth";
    }
    if (presign.status === 503) {
      this.#setState({ blocked: "storage" });
      return fail("The server has no blob storage configured", 5 * 60 * 1000);
    }
    if (!presign.ok) return fail(`The API refused the upload request (HTTP ${presign.status})`);
    this.#setState({ blocked: null });

    const { uploadUrl } = (await presign.json()) as { uploadUrl: string | null };

    if (uploadUrl) {
      const controller = new AbortController();
      this.#aborts.set(blobId, controller);
      let put;
      try {
        put = await this.#upload({
          url: uploadUrl,
          record,
          onProgress: (progress) => this.#noteProgress(blobId, progress),
          signal: controller.signal,
        });
      } finally {
        this.#aborts.delete(blobId);
      }
      if (!put.ok) return fail(put.reason);
    }

    if (this.#cancelled.has(blobId)) return this.#finishCancelled(blobId);

    // Uploaded (or already in the store): keep the bytes in the read cache
    // under the id the message references, and retire the upload record.
    await this.#cachePut({
      blobId,
      mime: record.mime,
      size: record.size,
      bytes: record.bytes,
      lastUsedAt: Date.now(),
    });
    await this.#deleteUpload(blobId);
    this.#noteBlob(blobId, {
      stage: "done",
      progress: null,
      attempts: record.attempts,
      nextAttemptAt: 0,
      lastError: null,
    });
    await this.#refreshPending();
    return "done";
  }

  async #finishCancelled(blobId: string): Promise<"done"> {
    await this.#deleteUpload(blobId);
    this.#cancelled.delete(blobId);
    this.#noteBlob(blobId, null);
    await this.#refreshPending();
    return "done";
  }

  // --- lazy blob cache (downloads) ---

  async #cachePut(record: Parameters<TBlobStore["cachePut"]>[0]): Promise<void> {
    try {
      await this.#store.cachePut(record);
    } catch {
      // cache is best-effort: a miss just refetches
    }
  }

  /** Bytes we already have locally (pending upload or cached download). */
  async getLocalBytes(blobId: string): Promise<{ bytes: Blob; mime: string } | null> {
    const pending = await this.#getUpload(blobId);
    if (pending) return { bytes: pending.bytes, mime: pending.mime };
    try {
      return await this.#store.cacheGet(blobId);
    } catch {
      return null;
    }
  }

  /**
   * Resolve blob bytes: local first, else download via a presigned URL and
   * cache for next time. Null when offline/missing: callers render a
   * placeholder.
   */
  async fetchBytes(blobId: string): Promise<{ bytes: Blob; mime: string } | null> {
    const local = await this.getLocalBytes(blobId);
    if (local) return local;

    try {
      const res = await this.#fetch(`${this.#apiBase}/api/blobs/${blobId}/download-url`, {
        credentials: "include",
        headers: { ...this.#authHeaders?.() },
      });
      if (!res.ok) return null;
      const { url } = (await res.json()) as { url: string };
      const download = await this.#fetch(url);
      if (!download.ok) return null;
      const bytes = await download.blob();
      const mime = download.headers.get("content-type") ?? bytes.type ?? "application/octet-stream";

      await this.#cachePut({ blobId, mime, size: bytes.size, bytes, lastUsedAt: Date.now() });
      return { bytes, mime };
    } catch {
      return null;
    }
  }

  /** Drop everything (explicit sign-out on a shared device). */
  async clear(): Promise<void> {
    this.#mem.clear();
    await this.#store.clear().catch(() => {});
    this.#setState({ blobs: {} });
    await this.#refreshPending();
  }
}
