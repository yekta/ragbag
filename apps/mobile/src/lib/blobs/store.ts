import {
  evictionOrder,
  type TBlobStore,
  type TCacheRecord,
  type TStoredBytes,
  type TUploadRecord,
} from "@ragbag/client-runtime";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";

// The phone's half of the blob queue's storage.
//
// Split in two, deliberately, where the web keeps one IndexedDB holding both:
// the bookkeeping goes in SQLite and the bytes go on the filesystem as
// ordinary files. That is not a stylistic choice. expo-file-system's `File`
// implements `Blob`, so a record read back from here hands the uploader
// something that streams off disk, and a picked 4K video is never resident in
// JS at all. Storing bytes in SQLite would mean reading every one of them into
// memory to hand them over.
//
// Both halves are scoped by user id, exactly as Zero scopes its own store, so
// signing in as someone else on a shared device cannot see the last person's
// queue.

type TRow = {
  blob_id: string;
  message_id: string | null;
  attachment_id: string | null;
  sha256: string;
  mime: string;
  size: number;
  original_name: string | null;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  last_error: string | null;
};

type TCacheRow = { blob_id: string; mime: string; size: number; last_used_at: number };

// Mobile cache bounds (plan §6: less than desktop/web, which holds 512 MB and
// 2000 entries). A phone's storage is shared with photos and everything else,
// and the archive itself is the thing that must not be evicted, so the
// *download* cache is kept small: originals are re-fetchable, and thumbnails
// are served by expo-image's own disk cache rather than this one.
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 500;

export class ExpoBlobStore implements TBlobStore {
  readonly ephemeral = false;
  readonly #db: SQLite.SQLiteDatabase;
  readonly #uploads: Directory;
  readonly #cache: Directory;

  constructor(userID: string) {
    this.#db = SQLite.openDatabaseSync(`ragbag-blobs-${userID}.db`);
    this.#db.execSync(`
      pragma journal_mode = WAL;
      create table if not exists uploads (
        blob_id text primary key not null,
        message_id text,
        attachment_id text,
        sha256 text not null,
        mime text not null,
        size integer not null,
        original_name text,
        attempts integer not null,
        next_attempt_at integer not null,
        created_at integer not null,
        last_error text
      );
      create index if not exists uploads_sha256 on uploads (sha256);
      create table if not exists cache (
        blob_id text primary key not null,
        mime text not null,
        size integer not null,
        last_used_at integer not null
      );
    `);

    // The cache directory, not documents: these bytes are all re-derivable
    // from the object store, so the OS is welcome to reclaim them under
    // pressure. The archive proper lives in Zero's own store, which is not
    // here and must not be evictable.
    const root = new Directory(Paths.cache, "ragbag-blobs", userID);
    this.#uploads = new Directory(root, "uploads");
    this.#cache = new Directory(root, "cache");
    for (const dir of [this.#uploads, this.#cache]) {
      if (!dir.exists) dir.create({ intermediates: true });
    }
  }

  // --- uploads ---

  async allUploads(): Promise<TUploadRecord[]> {
    const rows = await this.#db.getAllAsync<TRow>("select * from uploads");
    return rows.map((row) => this.#toRecord(row));
  }

  async getUpload(blobId: string): Promise<TUploadRecord | undefined> {
    const row = await this.#db.getFirstAsync<TRow>("select * from uploads where blob_id = ?", [
      blobId,
    ]);
    return row ? this.#toRecord(row) : undefined;
  }

  async putUpload(record: TUploadRecord): Promise<void> {
    // Bytes first, then the row. A row whose file is missing is a record that
    // can never upload and never fail cleanly; a file with no row is garbage
    // the next sweep collects. Only one of those is a bug.
    await this.#persistBytes(record);
    await this.#db.runAsync(
      `insert into uploads (blob_id, message_id, attachment_id, sha256, mime, size,
                            original_name, attempts, next_attempt_at, created_at, last_error)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (blob_id) do update set
         message_id = excluded.message_id,
         attachment_id = excluded.attachment_id,
         attempts = excluded.attempts,
         next_attempt_at = excluded.next_attempt_at,
         last_error = excluded.last_error`,
      [
        record.blobId,
        record.messageId ?? null,
        record.attachmentId ?? null,
        record.sha256,
        record.mime,
        record.size,
        record.originalName ?? null,
        record.attempts,
        record.nextAttemptAt,
        record.createdAt,
        record.lastError ?? null,
      ],
    );
  }

  async deleteUpload(blobId: string): Promise<void> {
    await this.#db.runAsync("delete from uploads where blob_id = ?", [blobId]);
    const file = new File(this.#uploads, blobId);
    if (file.exists) file.delete();
  }

  // --- download cache ---

  async cacheGet(blobId: string): Promise<TStoredBytes | null> {
    const row = await this.#db.getFirstAsync<TCacheRow>("select * from cache where blob_id = ?", [
      blobId,
    ]);
    if (!row) return null;
    const file = new File(this.#cache, blobId);
    if (!file.exists) {
      // The OS reclaimed the bytes out from under the row: forget it rather
      // than hand back a handle to nothing.
      await this.#db.runAsync("delete from cache where blob_id = ?", [blobId]);
      return null;
    }
    void this.#db
      .runAsync("update cache set last_used_at = ? where blob_id = ?", [Date.now(), blobId])
      .catch(() => {});
    return { bytes: file, mime: row.mime };
  }

  async cachePut(record: TCacheRecord): Promise<void> {
    const target = new File(this.#cache, record.blobId);
    await writeBytes(target, record.bytes);
    await this.#db.runAsync(
      `insert into cache (blob_id, mime, size, last_used_at) values (?, ?, ?, ?)
       on conflict (blob_id) do update set
         mime = excluded.mime, size = excluded.size, last_used_at = excluded.last_used_at`,
      [record.blobId, record.mime, record.size, record.lastUsedAt],
    );

    const rows = await this.#db.getAllAsync<TCacheRow>("select * from cache");
    const drop = evictionOrder(
      rows.map((r) => ({ blobId: r.blob_id, size: r.size, lastUsedAt: r.last_used_at })),
      { maxBytes: MAX_CACHE_BYTES, maxEntries: MAX_CACHE_ENTRIES },
    );
    for (const blobId of drop) {
      const file = new File(this.#cache, blobId);
      if (file.exists) file.delete();
      await this.#db.runAsync("delete from cache where blob_id = ?", [blobId]);
    }
  }

  async clear(): Promise<void> {
    await this.#db.execAsync("delete from uploads; delete from cache;");
    for (const dir of [this.#uploads, this.#cache]) {
      if (dir.exists) dir.delete();
      dir.create({ intermediates: true });
    }
  }

  // --- internals ---

  #toRecord(row: TRow): TUploadRecord {
    return {
      blobId: row.blob_id,
      ...(row.message_id ? { messageId: row.message_id } : {}),
      ...(row.attachment_id ? { attachmentId: row.attachment_id } : {}),
      sha256: row.sha256,
      mime: row.mime,
      size: row.size,
      ...(row.original_name ? { originalName: row.original_name } : {}),
      bytes: new File(this.#uploads, row.blob_id),
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      createdAt: row.created_at,
      ...(row.last_error ? { lastError: row.last_error } : {}),
    };
  }

  /**
   * Copy the captured bytes into this store's own directory, once.
   *
   * Once, because `putUpload` is called on every retry and every backoff
   * update: re-copying a video on each of six attempts is six copies of it.
   * The file is content-addressed by the queue's own id, so its presence is
   * the whole check.
   *
   * The copy itself is not optional. A picked photo's URI is a temporary one
   * the picker owns and the OS may reclaim at any point, which is exactly the
   * failure "my photo never uploaded" looks like from the outside.
   */
  async #persistBytes(record: TUploadRecord): Promise<void> {
    const target = new File(this.#uploads, record.blobId);
    if (target.exists) return;
    await writeBytes(target, record.bytes);
  }
}

async function writeBytes(target: File, bytes: Blob): Promise<void> {
  if (bytes instanceof File) {
    if (bytes.uri === target.uri) return;
    await bytes.copy(target);
    return;
  }
  // A Blob that is not already a file on disk: a recording assembled in
  // memory, or anything a future picker hands back as bytes.
  target.create({ overwrite: true });
  target.write(new Uint8Array(await bytes.arrayBuffer()));
}
