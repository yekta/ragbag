import { faceForMime, newId } from "@ragbag/shared";
import type { AttachmentFace } from "@ragbag/shared";
import { idbDelete, idbGet, idbGetAll, idbPut, openDb } from "./idb.js";

// The persistent blob upload queue + lazy blob cache: Zero syncs rows, not
// files. Capture stores the bytes in IndexedDB and returns a client-minted
// blobId IMMEDIATELY: the message is created and syncs before any network
// happens, offline included. A background flush presigns, PUTs the
// bytes to the object store, and survives app restarts (the constructor
// resumes whatever is still pending). Downloaded blobs land in a bounded LRU
// cache so other devices only fetch originals once.
//
// Everything here is observable: every blob's upload lifecycle (waiting →
// inflight → done, with progress and a classified lastError) is published
// through `state.blobs` so the composer chips, timeline badges and the
// sidebar can show what is actually happening. A queue that silently retried
// on a 15-minute backoff looked exactly like a dead app; never again.
//
// Every stage is also bounded: IndexedDB opens time out (see idb.ts), record
// writes fall back to an in-memory overlay when IndexedDB is wedged (uploads
// still work, they just don't survive a reload, `state.ephemeral`), the
// presign has a deadline, and the PUT has a stall watchdog. Nothing in this
// file may hang forever.

export type CapturedBlob = {
  blobId: string;
  sha256: string;
  mime: string;
  size: number;
  originalName?: string | undefined;
  /** How it renders and which extraction path it will take. */
  face: AttachmentFace;
  /**
   * True when capture matched bytes already queued on this device: the
   * blobId belongs to an earlier attachment (possibly an already-sent
   * message), so removing this attachment must NOT cancel the shared upload.
   */
  reused: boolean;
};

export type BlobUploadState = {
  /** waiting = queued or backing off; inflight = presign/PUT running now. */
  stage: "waiting" | "inflight" | "done";
  /** 0..1 while the PUT reports progress, else null (indeterminate). */
  progress: number | null;
  attempts: number;
  /** Epoch ms of the next scheduled attempt; 0 = as soon as possible. */
  nextAttemptAt: number;
  /** Human-readable, classified reason for the last failure, if any. */
  lastError: string | null;
};

export type BlobQueueState = {
  /** Uploads waiting or retrying (persisted; survives restarts). */
  pending: number;
  /** Why the queue is parked, if it is. */
  blocked: "auth" | "storage" | null;
  /**
   * IndexedDB is unavailable, so queued uploads live in memory only: they
   * still upload normally but will be lost if the page reloads first.
   */
  ephemeral: boolean;
  /** Per-blob upload lifecycle, keyed by blobId; drives all upload UI. */
  blobs: Record<string, BlobUploadState>;
};

type UploadRecord = {
  blobId: string;
  /** Set on send: the bytes now belong to a message and are not ours to drop. */
  messageId?: string;
  attachmentId?: string;
  sha256: string;
  mime: string;
  size: number;
  originalName?: string;
  bytes: Blob;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
};

type CacheRecord = {
  blobId: string;
  mime: string;
  size: number;
  bytes: Blob;
  lastUsedAt: number;
};

const UPLOADS = "uploads";
const CACHE = "cache";

// Web/desktop cache bounds (plan §6: "desktop/web: more" than mobile).
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 2_000;

// 5s → 15s → 45s → 2¼m → 6¾m → 15m cap. The first retries are quick because
// the common failure (flaky network, API redeploy) is short-lived and the
// user is often still looking at the chip; the cap keeps a dead bucket from
// burning battery overnight.
const BACKOFF_BASE_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

const PRESIGN_TIMEOUT_MS = 15_000;
/** Abort the PUT when no progress event arrives for this long. */
const PUT_STALL_MS = 45_000;
/** Hard ceiling on a single PUT, however slowly it trickles. */
const PUT_TIMEOUT_MS = 20 * 60 * 1000;
/** Deadline on individual IndexedDB operations before falling back. */
const IDB_OP_TIMEOUT_MS = 4_000;

const CORS_HINT =
  "The storage bucket blocked the browser's upload; its CORS policy must allow this site (see DEPLOY.md)";

export type BlobQueueOptions = {
  /** Scopes the IndexedDB database, like Zero scopes its store. */
  userID: string;
  /** Base URL of the API, "" when same-origin (web behind the dev proxy). */
  apiBase?: string;
  /** Extra headers for API calls; native shells pass their bearer token. */
  authHeaders?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
};

async function sha256Hex(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // crypto.subtle only exists in secure contexts; a plain-http deploy
    // used to die here as an inscrutable TypeError.
    throw new Error("Files need a secure (HTTPS) connection, and this page has none");
  }
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

function describeHttp(status: number): string {
  if (status === 403) return "The storage bucket rejected the upload signature (HTTP 403)";
  if (status === 413) return "The storage bucket says this file is too large (HTTP 413)";
  return `The storage bucket refused the upload (HTTP ${status})`;
}

type PutResult = { ok: true } | { ok: false; reason: string };

export class BlobQueue {
  readonly #apiBase: string;
  readonly #authHeaders: (() => Record<string, string>) | undefined;
  readonly #fetch: typeof fetch;
  /** Resolves null when IndexedDB is unusable; the queue runs from memory. */
  readonly #idb: Promise<IDBDatabase | null>;
  /**
   * In-memory overlay over the uploads store. Normally empty; holds records
   * whenever IndexedDB is broken or a write to it times out. Consulted first
   * everywhere, so a record's home never matters to the rest of the code.
   */
  readonly #mem = new Map<string, UploadRecord>();
  readonly #listeners = new Set<() => void>();
  /** Abort hooks for in-flight PUTs, keyed by blobId. */
  readonly #aborts = new Map<string, () => void>();
  /** Blobs canceled mid-flight; their failure is cleanup, not a retry. */
  readonly #cancelled = new Set<string>();
  #state: BlobQueueState = { pending: 0, blocked: null, ephemeral: false, blobs: {} };
  #flushing = false;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: BlobQueueOptions) {
    this.#apiBase = opts.apiBase ?? "";
    this.#authHeaders = opts.authHeaders;
    this.#fetch = opts.fetchImpl ?? fetch.bind(globalThis);
    this.#idb = openDb(`ragbag-blobs-${opts.userID}`, 1, (db) => {
      db.createObjectStore(UPLOADS, { keyPath: "blobId" });
      db.createObjectStore(CACHE, { keyPath: "blobId" });
    }).catch(() => {
      this.#markEphemeral();
      return null;
    });

    // Resume anything a previous session left behind, and whenever the
    // browser comes back online or the tab becomes visible again. All are
    // signals that the world changed (new page load, network back, user
    // looking), so clear any backoff first: waiting out a 15-minute delay
    // earned during an outage that's since been fixed just looks broken.
    void this.retryNow();
    if (typeof addEventListener === "function") {
      addEventListener("online", () => {
        void this.retryNow();
      });
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.#state.pending > 0) void this.retryNow();
      });
    }
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
   * A record already linked to an item survives untouched (the item still
   * needs its bytes); callers also pass `reused` captures through unharmed.
   */
  async cancel(blobId: string): Promise<void> {
    const record = await this.#getUpload(blobId);
    if (record?.messageId) return; // sent: the message needs its bytes
    const wasInflight = this.#aborts.has(blobId);
    this.#cancelled.add(blobId);
    this.#aborts.get(blobId)?.(); // an in-flight attempt unwinds via #finishCancelled
    if (record) await this.#deleteUpload(blobId);
    if (!wasInflight) {
      this.#cancelled.delete(blobId);
      this.#noteBlob(blobId, null);
      await this.#refreshPending();
    }
  }

  // --- state for UI ---

  get state(): BlobQueueState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #setState(patch: Partial<BlobQueueState>) {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }

  #markEphemeral() {
    if (!this.#state.ephemeral) this.#setState({ ephemeral: true });
  }

  /** Replace (or with null, remove) one blob's published upload state. */
  #noteBlob(blobId: string, entry: BlobUploadState | null) {
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
    const blobs: Record<string, BlobUploadState> = {};
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

  // --- record storage (IndexedDB with a memory fallback) ---

  async #allUploads(): Promise<UploadRecord[]> {
    const db = await this.#idb;
    let disk: UploadRecord[] = [];
    if (db) {
      try {
        disk = await withDeadline(idbGetAll<UploadRecord>(db, UPLOADS), IDB_OP_TIMEOUT_MS, "read");
      } catch {
        this.#markEphemeral();
      }
    }
    const merged = new Map(disk.map((r) => [r.blobId, r] as const));
    for (const [id, record] of this.#mem) merged.set(id, record);
    return [...merged.values()];
  }

  async #getUpload(blobId: string): Promise<UploadRecord | undefined> {
    const inMem = this.#mem.get(blobId);
    if (inMem) return inMem;
    const db = await this.#idb;
    if (!db) return undefined;
    try {
      return await withDeadline(
        idbGet<UploadRecord>(db, UPLOADS, blobId),
        IDB_OP_TIMEOUT_MS,
        "read",
      );
    } catch {
      return undefined;
    }
  }

  async #putUpload(record: UploadRecord): Promise<void> {
    if (this.#mem.has(record.blobId)) {
      this.#mem.set(record.blobId, record);
      return;
    }
    const db = await this.#idb;
    if (db) {
      try {
        await withDeadline(idbPut(db, UPLOADS, record), IDB_OP_TIMEOUT_MS, "write");
        return;
      } catch {
        // fall through to memory
      }
    }
    this.#mem.set(record.blobId, record);
    this.#markEphemeral();
  }

  async #deleteUpload(blobId: string): Promise<void> {
    this.#mem.delete(blobId);
    const db = await this.#idb;
    if (db) {
      try {
        await withDeadline(idbDelete(db, UPLOADS, blobId), IDB_OP_TIMEOUT_MS, "delete");
      } catch {
        // the getAll deadline already degrades reads; nothing better to do
      }
    }
  }

  // --- capture (the composer path) ---

  /**
   * Hash + persist the bytes locally and return the blobId to put on the
   * item. Pure local work: safe offline; the upload happens in the flush.
   */
  async capture(file: Blob, originalName?: string): Promise<CapturedBlob> {
    const sha256 = await sha256Hex(file);
    const mime = file.type || "application/octet-stream";

    // Same bytes already waiting to upload? Reuse the record so the item
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

    const record: UploadRecord = {
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

    for (const record of (await this.#allUploads()).toSorted((a, b) => a.createdAt - b.createdAt)) {
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

  async #uploadOne(record: UploadRecord): Promise<"done" | "retry" | "auth"> {
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
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      return fail(
        offline
          ? "Offline. The upload will resume when the connection returns"
          : "Couldn't reach the API to start the upload",
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
      const put = await this.#putBytes(uploadUrl, record);
      if (!put.ok) return fail(put.reason);
    }

    if (this.#cancelled.has(blobId)) return this.#finishCancelled(blobId);

    // Uploaded (or already in the store): keep the bytes in the read cache
    // under the id the item references, and retire the upload record.
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

  /**
   * PUT the bytes to the presigned URL. XMLHttpRequest when the runtime has
   * it (fetch cannot report upload progress) with a stall watchdog so a
   * dead connection surfaces in under a minute instead of never. Non-browser
   * runtimes (tests, workers) fall back to fetch without progress.
   */
  #putBytes(url: string, record: UploadRecord): Promise<PutResult> {
    const blobId = record.blobId;
    if (typeof XMLHttpRequest === "undefined") {
      const controller = new AbortController();
      this.#aborts.set(blobId, () => controller.abort());
      return this.#fetch(url, {
        method: "PUT",
        body: record.bytes,
        headers: { "content-type": record.mime },
        signal: controller.signal,
      })
        .then<PutResult>((res) =>
          res.ok ? { ok: true } : { ok: false, reason: describeHttp(res.status) },
        )
        .catch(() => ({ ok: false, reason: CORS_HINT }) satisfies PutResult)
        .finally(() => this.#aborts.delete(blobId));
    }

    return new Promise<PutResult>((resolve) => {
      const xhr = new XMLHttpRequest();
      let stalled = false;
      let lastProgressAt = Date.now();
      const stallTimer = setInterval(() => {
        if (Date.now() - lastProgressAt > PUT_STALL_MS) {
          stalled = true;
          xhr.abort();
        }
      }, 5_000);
      const finish = (result: PutResult) => {
        clearInterval(stallTimer);
        this.#aborts.delete(blobId);
        resolve(result);
      };

      xhr.open("PUT", url);
      xhr.setRequestHeader("content-type", record.mime);
      xhr.timeout = PUT_TIMEOUT_MS;
      xhr.upload.addEventListener("progress", (e) => {
        lastProgressAt = Date.now();
        this.#noteProgress(blobId, e.lengthComputable ? e.loaded / e.total : null);
      });
      xhr.addEventListener("load", () =>
        finish(
          xhr.status >= 200 && xhr.status < 300
            ? { ok: true }
            : { ok: false, reason: describeHttp(xhr.status) },
        ),
      );
      // A network-level failure on a presigned PUT is almost always the
      // bucket rejecting the CORS preflight: say so instead of "error".
      xhr.addEventListener("error", () => finish({ ok: false, reason: CORS_HINT }));
      xhr.addEventListener("timeout", () => finish({ ok: false, reason: "The upload timed out" }));
      xhr.addEventListener("abort", () =>
        finish({
          ok: false,
          reason: stalled ? "The upload stalled: no data moved for 45s" : "Upload canceled",
        }),
      );
      this.#aborts.set(blobId, () => xhr.abort());
      xhr.send(record.bytes);
    });
  }

  // --- lazy blob cache (downloads) ---

  async #cachePut(record: CacheRecord): Promise<void> {
    const db = await this.#idb;
    if (!db) return; // no cache without IndexedDB: downloads just refetch
    try {
      await withDeadline(idbPut(db, CACHE, record), IDB_OP_TIMEOUT_MS, "cache write");
      await this.#evict(db);
    } catch {
      // cache is best-effort
    }
  }

  /** Bytes we already have locally (pending upload or cached download). */
  async getLocalBytes(blobId: string): Promise<{ bytes: Blob; mime: string } | null> {
    const pending = await this.#getUpload(blobId);
    if (pending) return { bytes: pending.bytes, mime: pending.mime };
    const db = await this.#idb;
    if (!db) return null;
    try {
      const cached = await withDeadline(
        idbGet<CacheRecord>(db, CACHE, blobId),
        IDB_OP_TIMEOUT_MS,
        "cache read",
      );
      if (cached) {
        void idbPut(db, CACHE, { ...cached, lastUsedAt: Date.now() }).catch(() => {});
        return { bytes: cached.bytes, mime: cached.mime };
      }
    } catch {
      // fall through
    }
    return null;
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

  /** LRU-evict the download cache; pending uploads are never touched. */
  async #evict(db: IDBDatabase): Promise<void> {
    const all = await idbGetAll<CacheRecord>(db, CACHE);
    let total = all.reduce((sum, r) => sum + r.size, 0);
    let count = all.length;
    for (const record of all.toSorted((a, b) => a.lastUsedAt - b.lastUsedAt)) {
      if (total <= MAX_CACHE_BYTES && count <= MAX_CACHE_ENTRIES) break;
      await idbDelete(db, CACHE, record.blobId);
      total -= record.size;
      count -= 1;
    }
  }

  /** Drop everything (explicit sign-out on a shared machine). */
  async clear(): Promise<void> {
    this.#mem.clear();
    const db = await this.#idb;
    if (db) {
      for (const store of [UPLOADS, CACHE]) {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).clear();
      }
    }
    this.#setState({ blobs: {} });
    await this.#refreshPending();
  }
}
