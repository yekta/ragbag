import {
  evictionOrder,
  type TBlobStore,
  type TCacheRecord,
  type TStoredBytes,
  type TUploadRecord,
} from "../blob-store.js";
import { idbDelete, idbGet, idbGetAll, idbPut, openDb } from "./idb.js";

// The browser's half of the blob queue's storage: IndexedDB, which is the only
// thing in a browser that will hold megabytes of file bytes durably.
//
// Every operation here can fail, and failing is not exceptional: private mode
// refuses, a profile with a stuck backend hangs the open forever with no event
// at all (see openDb's timeout), and a quota-full origin rejects writes. The
// queue above copes by falling back to memory, so this class's contract is
// only that it rejects rather than hangs, and that `ephemeral` is honest.

const UPLOADS = "uploads";
const CACHE = "cache";

// Web/desktop cache bounds (plan §6: "desktop/web: more" than mobile).
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 2_000;

export class IdbBlobStore implements TBlobStore {
  readonly #db: Promise<IDBDatabase | null>;
  #ephemeral = false;

  constructor(userID: string) {
    this.#db = openDb(`ragbag-blobs-${userID}`, 1, (db) => {
      db.createObjectStore(UPLOADS, { keyPath: "blobId" });
      db.createObjectStore(CACHE, { keyPath: "blobId" });
    }).catch(() => {
      this.#ephemeral = true;
      return null;
    });
  }

  get ephemeral(): boolean {
    return this.#ephemeral;
  }

  async allUploads(): Promise<TUploadRecord[]> {
    const db = await this.#db;
    if (!db) return [];
    return idbGetAll<TUploadRecord>(db, UPLOADS);
  }

  async getUpload(blobId: string): Promise<TUploadRecord | undefined> {
    const db = await this.#db;
    if (!db) return undefined;
    return idbGet<TUploadRecord>(db, UPLOADS, blobId);
  }

  async putUpload(record: TUploadRecord): Promise<void> {
    const db = await this.#db;
    if (!db) throw new Error("IndexedDB unavailable");
    await idbPut(db, UPLOADS, record);
  }

  async deleteUpload(blobId: string): Promise<void> {
    const db = await this.#db;
    if (!db) return;
    await idbDelete(db, UPLOADS, blobId);
  }

  async cacheGet(blobId: string): Promise<TStoredBytes | null> {
    const db = await this.#db;
    if (!db) return null;
    const cached = await idbGet<TCacheRecord>(db, CACHE, blobId);
    if (!cached) return null;
    // Touch, but do not wait: the read is what the caller asked for, and an
    // LRU timestamp is not worth a round trip on the critical path.
    void idbPut(db, CACHE, { ...cached, lastUsedAt: Date.now() }).catch(() => {});
    return { bytes: cached.bytes, mime: cached.mime };
  }

  async cachePut(record: TCacheRecord): Promise<void> {
    const db = await this.#db;
    if (!db) return; // no cache without IndexedDB: downloads just refetch
    await idbPut(db, CACHE, record);
    const all = await idbGetAll<TCacheRecord>(db, CACHE);
    for (const blobId of evictionOrder(all, {
      maxBytes: MAX_CACHE_BYTES,
      maxEntries: MAX_CACHE_ENTRIES,
    })) {
      await idbDelete(db, CACHE, blobId);
    }
  }

  async clear(): Promise<void> {
    const db = await this.#db;
    if (!db) return;
    for (const store of [UPLOADS, CACHE]) {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
    }
  }
}
