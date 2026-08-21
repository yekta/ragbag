// Where a blob queue keeps what it has not uploaded yet, and what it has
// already downloaded.
//
// Split out of blob-queue.ts, which used to reach for IndexedDB directly. The
// queue's hard parts (bounded stages, classified errors, backoff, dedupe,
// cancellation, the published per-blob lifecycle) are not web-specific and are
// not worth writing twice, but every line of the *storage* is: a browser has
// IndexedDB and a phone has SQLite and a filesystem. This is the seam between
// the two, and it is deliberately the smallest one that works.

/** A blob captured on this device and not yet in the object store. */
export type TUploadRecord = {
  blobId: string;
  /** Set on send: the bytes now belong to a message and are not ours to drop. */
  messageId?: string;
  attachmentId?: string;
  sha256: string;
  mime: string;
  size: number;
  originalName?: string;
  /**
   * The bytes. A `Blob` on web; on native, expo-file-system's `File`, which
   * implements `Blob` and reads off disk rather than out of memory. That is
   * why this stayed a `Blob` rather than becoming a URI: a phone can hand the
   * same object to `fetch` as a body that a browser can.
   */
  bytes: Blob;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
};

/** A blob fetched from the object store, kept so no device fetches it twice. */
export type TCacheRecord = {
  blobId: string;
  mime: string;
  size: number;
  bytes: Blob;
  lastUsedAt: number;
};

export type TStoredBytes = { bytes: Blob; mime: string };

export type TBlobStore = {
  /**
   * Whether records live only in memory, so queued uploads will not survive a
   * relaunch. They still upload; the UI says so rather than pretending.
   */
  readonly ephemeral: boolean;
  allUploads(): Promise<TUploadRecord[]>;
  getUpload(blobId: string): Promise<TUploadRecord | undefined>;
  putUpload(record: TUploadRecord): Promise<void>;
  deleteUpload(blobId: string): Promise<void>;
  cacheGet(blobId: string): Promise<TStoredBytes | null>;
  /** Write, then evict down to this store's own bounds. */
  cachePut(record: TCacheRecord): Promise<void>;
  /** Drop everything: an explicit sign-out on a shared device. */
  clear(): Promise<void>;
};

/**
 * Records in a Map, bytes in whatever the caller handed over.
 *
 * Two callers, and both matter. It is the web store's fallback when IndexedDB
 * is unavailable or wedged, which is a real state a real browser gets into
 * (private mode, a stuck backend, a profile with no quota) and which used to
 * mean uploads silently stopped. And it is what the queue's own tests run
 * against, so they exercise the state machine rather than a storage engine.
 */
export class MemoryBlobStore implements TBlobStore {
  readonly ephemeral = true;
  readonly #uploads = new Map<string, TUploadRecord>();
  readonly #cache = new Map<string, TCacheRecord>();

  async allUploads(): Promise<TUploadRecord[]> {
    return [...this.#uploads.values()];
  }

  async getUpload(blobId: string): Promise<TUploadRecord | undefined> {
    return this.#uploads.get(blobId);
  }

  async putUpload(record: TUploadRecord): Promise<void> {
    this.#uploads.set(record.blobId, record);
  }

  async deleteUpload(blobId: string): Promise<void> {
    this.#uploads.delete(blobId);
  }

  async cacheGet(blobId: string): Promise<TStoredBytes | null> {
    const found = this.#cache.get(blobId);
    if (!found) return null;
    this.#cache.set(blobId, { ...found, lastUsedAt: Date.now() });
    return { bytes: found.bytes, mime: found.mime };
  }

  async cachePut(record: TCacheRecord): Promise<void> {
    this.#cache.set(record.blobId, record);
  }

  async clear(): Promise<void> {
    this.#uploads.clear();
    this.#cache.clear();
  }
}

/**
 * LRU eviction, shared by every store that has bounds to keep.
 *
 * Pure and parameterised rather than a method, because the two stores hold
 * their entries in different places and the *policy* is the part that has to
 * agree: least recently used goes first, pending uploads are never touched
 * (they are not in this list), and the bounds are a size and a count because
 * an archive of ten thousand thumbnails and one of ten videos both need one.
 */
export function evictionOrder(
  entries: readonly { blobId: string; size: number; lastUsedAt: number }[],
  bounds: { maxBytes: number; maxEntries: number },
): string[] {
  let total = entries.reduce((sum, r) => sum + r.size, 0);
  let count = entries.length;
  const drop: string[] = [];
  for (const record of entries.toSorted((a, b) => a.lastUsedAt - b.lastUsedAt)) {
    if (total <= bounds.maxBytes && count <= bounds.maxEntries) break;
    drop.push(record.blobId);
    total -= record.size;
    count -= 1;
  }
  return drop;
}
