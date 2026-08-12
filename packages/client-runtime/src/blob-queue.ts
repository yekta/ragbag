import { kindForMime, newId } from "@ragbag/shared";
import type { ItemKind } from "@ragbag/shared";
import { idbDelete, idbGet, idbGetAll, idbPut, openDb } from "./idb.js";

// The persistent blob upload queue + lazy blob cache (plan §6): Zero syncs
// rows, not files. Capture stores the bytes in IndexedDB and returns a
// client-minted blobId IMMEDIATELY — the item is created and syncs before any
// network happens, offline included. A background flush presigns, PUTs the
// bytes to the object store, and survives app restarts (the constructor
// resumes whatever is still pending). Downloaded blobs land in a bounded LRU
// cache so other devices only fetch originals once.

export type CapturedBlob = {
  blobId: string;
  sha256: string;
  mime: string;
  size: number;
  originalName?: string | undefined;
  kind: Extract<ItemKind, "image" | "pdf" | "file">;
};

export type BlobQueueState = {
  /** Uploads waiting or retrying (persisted; survives restarts). */
  pending: number;
  /** Why the queue is parked, if it is. */
  blocked: "auth" | "storage" | null;
};

type UploadRecord = {
  blobId: string;
  itemId?: string;
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

const MAX_BACKOFF_MS = 15 * 60 * 1000;

export type BlobQueueOptions = {
  /** Scopes the IndexedDB database, like Zero scopes its store. */
  userID: string;
  /** Base URL of the API, "" when same-origin (web behind the dev proxy). */
  apiBase?: string;
  /** Extra headers for API calls — native shells pass their bearer token. */
  authHeaders?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
};

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class BlobQueue {
  readonly #apiBase: string;
  readonly #authHeaders: (() => Record<string, string>) | undefined;
  readonly #fetch: typeof fetch;
  readonly #db: Promise<IDBDatabase>;
  readonly #listeners = new Set<() => void>();
  #state: BlobQueueState = { pending: 0, blocked: null };
  #flushing = false;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Called when the server dedupes an upload onto an existing blob row
   * (same bytes dumped before): the item must be repointed at the canonical
   * id. The app wires this to the item.relinkBlob mutator.
   */
  onRelink: ((itemId: string, canonicalBlobId: string) => void) | undefined;

  constructor(opts: BlobQueueOptions) {
    this.#apiBase = opts.apiBase ?? "";
    this.#authHeaders = opts.authHeaders;
    this.#fetch = opts.fetchImpl ?? fetch.bind(globalThis);
    this.#db = openDb(`ragbag-blobs-${opts.userID}`, 1, (db) => {
      db.createObjectStore(UPLOADS, { keyPath: "blobId" });
      db.createObjectStore(CACHE, { keyPath: "blobId" });
    });

    // Resume anything a previous session left behind, and whenever the
    // browser comes back online.
    void this.#refreshPending().then(() => this.flush());
    if (typeof addEventListener === "function") {
      addEventListener("online", () => {
        this.flush();
      });
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

  async #refreshPending() {
    const uploads = await idbGetAll<UploadRecord>(await this.#db, UPLOADS);
    this.#setState({ pending: uploads.length });
  }

  /** Sign-in happened (or a session refreshed): unpark and retry now. */
  notifyAuthChanged() {
    if (this.#state.blocked === "auth") this.#setState({ blocked: null });
    this.flush(true);
  }

  // --- capture (the composer path) ---

  /**
   * Hash + persist the bytes locally and return the blobId to put on the
   * item. Pure local work — safe offline; the upload happens in the flush.
   */
  async capture(file: Blob, originalName?: string): Promise<CapturedBlob> {
    const db = await this.#db;
    const sha256 = await sha256Hex(file);
    const mime = file.type || "application/octet-stream";

    // Same bytes already waiting to upload? Reuse the record so the item
    // points at the id the server will learn about.
    const existing = (await idbGetAll<UploadRecord>(db, UPLOADS)).find((u) => u.sha256 === sha256);
    if (existing) {
      return {
        blobId: existing.blobId,
        sha256,
        mime: existing.mime,
        size: existing.size,
        originalName: existing.originalName,
        kind: kindForMime(existing.mime),
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
    await idbPut(db, UPLOADS, record);
    await this.#refreshPending();
    this.flush();
    return {
      blobId: record.blobId,
      sha256,
      mime,
      size: file.size,
      originalName,
      kind: kindForMime(mime),
    };
  }

  /** Remember which item a captured blob belongs to (for dedupe relinks). */
  async linkItem(blobId: string, itemId: string): Promise<void> {
    const db = await this.#db;
    const record = await idbGet<UploadRecord>(db, UPLOADS, blobId);
    if (record) await idbPut(db, UPLOADS, { ...record, itemId });
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
    const db = await this.#db;
    let nextWake = Infinity;

    for (const record of (await idbGetAll<UploadRecord>(db, UPLOADS)).toSorted(
      (a, b) => a.createdAt - b.createdAt,
    )) {
      if (record.nextAttemptAt > Date.now()) {
        nextWake = Math.min(nextWake, record.nextAttemptAt);
        continue;
      }
      const outcome = await this.#uploadOne(db, record);
      if (outcome === "auth") {
        this.#setState({ blocked: "auth" });
        return; // parked until notifyAuthChanged()
      }
      if (outcome === "retry") {
        const updated = await idbGet<UploadRecord>(db, UPLOADS, record.blobId);
        if (updated) nextWake = Math.min(nextWake, updated.nextAttemptAt);
      }
    }

    await this.#refreshPending();
    if (nextWake < Infinity) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = setTimeout(() => this.flush(), Math.max(1000, nextWake - Date.now()));
    }
  }

  async #uploadOne(db: IDBDatabase, record: UploadRecord): Promise<"done" | "retry" | "auth"> {
    const fail = async (error: string, extraDelayMs = 0) => {
      const attempts = record.attempts + 1;
      const backoff = Math.min(30_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS) + extraDelayMs;
      await idbPut(db, UPLOADS, {
        ...record,
        attempts,
        nextAttemptAt: Date.now() + backoff,
        lastError: error,
      } satisfies UploadRecord);
      return "retry" as const;
    };

    let presign: Response;
    try {
      presign = await this.#fetch(`${this.#apiBase}/api/blobs/presign-upload`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...this.#authHeaders?.() },
        body: JSON.stringify({
          blobId: record.blobId,
          sha256: record.sha256,
          mime: record.mime,
          size: record.size,
          originalName: record.originalName,
        }),
      });
    } catch {
      return fail("network error during presign");
    }
    if (presign.status === 401) return "auth";
    if (presign.status === 503) {
      this.#setState({ blocked: "storage" });
      return fail("server has no blob storage configured", 5 * 60 * 1000);
    }
    if (!presign.ok) return fail(`presign failed: ${presign.status}`);
    this.#setState({ blocked: null });

    const { blobId: canonicalId, uploadUrl } = (await presign.json()) as {
      blobId: string;
      uploadUrl: string | null;
    };

    if (uploadUrl) {
      try {
        const put = await this.#fetch(uploadUrl, {
          method: "PUT",
          body: record.bytes,
          headers: { "content-type": record.mime },
        });
        if (!put.ok) return fail(`upload failed: ${put.status}`);
      } catch {
        return fail("network error during upload");
      }
    }

    // Uploaded (or already in the store): move bytes to the cache under the
    // canonical id and repoint the item if the server deduped onto an
    // existing blob row.
    await idbPut(db, CACHE, {
      blobId: canonicalId,
      mime: record.mime,
      size: record.size,
      bytes: record.bytes,
      lastUsedAt: Date.now(),
    } satisfies CacheRecord);
    await idbDelete(db, UPLOADS, record.blobId);
    if (canonicalId !== record.blobId && record.itemId) {
      this.onRelink?.(record.itemId, canonicalId);
    }
    await this.#evict(db);
    await this.#refreshPending();
    return "done";
  }

  // --- lazy blob cache (downloads) ---

  /** Bytes we already have locally (pending upload or cached download). */
  async getLocalBytes(blobId: string): Promise<{ bytes: Blob; mime: string } | null> {
    const db = await this.#db;
    const pending = await idbGet<UploadRecord>(db, UPLOADS, blobId);
    if (pending) return { bytes: pending.bytes, mime: pending.mime };
    const cached = await idbGet<CacheRecord>(db, CACHE, blobId);
    if (cached) {
      void idbPut(db, CACHE, { ...cached, lastUsedAt: Date.now() });
      return { bytes: cached.bytes, mime: cached.mime };
    }
    return null;
  }

  /**
   * Resolve blob bytes: local first, else download via a presigned URL and
   * cache for next time. Null when offline/missing — callers render a
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

      const db = await this.#db;
      await idbPut(db, CACHE, {
        blobId,
        mime,
        size: bytes.size,
        bytes,
        lastUsedAt: Date.now(),
      } satisfies CacheRecord);
      await this.#evict(db);
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
    const db = await this.#db;
    for (const store of [UPLOADS, CACHE]) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
    }
    await this.#refreshPending();
  }
}
