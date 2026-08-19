import { MAX_BLOB_BYTES, downloadUrlsRequest, presignUploadRequest } from "@ragbag/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  blobKey,
  localDriverGet,
  localDriverPut,
  storage,
  variantKey,
  verifyLocalSignature,
} from "../blobs/storage.js";
import { db } from "../db/client.js";
import { blobs } from "../db/schema.js";
import { getAuthData } from "../session.js";

// Blob bytes go straight between client and the object store via presigned
// URLs: they never stream through application code (plan §5). Keys are
// content-addressed: <user_id>/<sha256>, which makes re-sends of the same
// file free. The /local/* routes ARE the object store when the local-disk
// driver is active; their auth is the HMAC signature (bearer semantics,
// exactly like an S3 presigned URL).

export const blobRoutes = new Hono()
  .post("/presign-upload", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);
    if (!storage) return c.json({ error: "blob storage not configured" }, 503);

    const parsed = presignUploadRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { blobId, sha256, mime, size, originalName } = parsed.data;

    // The client's blob id always wins: its items already reference it, very
    // possibly created offline before this request. Re-sending identical bytes
    // therefore adds a cheap extra row pointing at the same content-addressed
    // object: the bytes are still stored exactly once, and no client ever has
    // to be told its id was reassigned.
    const key = blobKey(authData.userID, sha256);
    await db
      .insert(blobs)
      .values({ id: blobId, userId: authData.userID, sha256, mime, size, originalName })
      .onConflictDoNothing(); // same id retried, the row is already right

    // Only skip the upload when the bytes are actually in the store: a row
    // alone can be a leftover from an interrupted upload, and this presign is
    // exactly that client retrying.
    const uploadUrl = (await storage.exists(key)) ? null : await storage.presignUpload(key, mime);
    return c.json({ blobId, uploadUrl });
  })
  .get("/:id/download-url", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);
    if (!storage) return c.json({ error: "blob storage not configured" }, 503);

    const row = await db.query.blobs.findFirst({
      where: and(eq(blobs.id, c.req.param("id")), eq(blobs.userId, authData.userID)),
    });
    if (!row) return c.json({ error: "not found" }, 404);

    const url = await storage.presignDownload(blobKey(authData.userID, row.sha256), row.mime);
    return c.json({ url });
  })
  /**
   * Batch presign (plan §6.4). Presigning is a local HMAC with no round trip
   * to the bucket, so a hundred is nearly free, and the service worker
   * coalesces its misses inside a short window into one call: a grid scroll
   * becomes one request rather than forty.
   *
   * Ids the caller does not own are simply absent from the map, which is also
   * what makes this safe to call with whatever the viewport happens to hold.
   */
  .post("/download-urls", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);
    if (!storage) return c.json({ error: "blob storage not configured" }, 503);

    const parsed = downloadUrlsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { blobIds, variant } = parsed.data;

    const rows = await db
      .select({ id: blobs.id, sha256: blobs.sha256, mime: blobs.mime })
      .from(blobs)
      .where(and(eq(blobs.userId, authData.userID), inArray(blobs.id, blobIds)));

    const urls: Record<string, string> = {};
    const fallback: string[] = [];
    for (const row of rows) {
      const original = blobKey(authData.userID, row.sha256);
      // A derivative that has not been generated yet falls back to the
      // original, so a photo browsed before ingestion finished still paints.
      // Said out loud in `fallback`, because the caller caches by variant key
      // and these bytes are not that variant: they are the file exactly as
      // sent, which for a phone photo is a HEIC most browsers cannot decode.
      const key =
        variant === "original" ? original : variantKey(authData.userID, row.sha256, variant);
      const derived = variant !== "original" && (await storage.exists(key));
      if (variant !== "original" && !derived) fallback.push(row.id);
      urls[row.id] = await storage.presignDownload(
        derived ? key : original,
        derived ? "image/webp" : row.mime,
      );
    }
    return c.json({ urls, fallback });
  })
  // --- local-disk driver endpoints (inactive when R2 is configured) ---
  .put("/local/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (!verifyLocalSignature("PUT", key, c.req.query())) {
      return c.json({ error: "bad signature" }, 403);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > MAX_BLOB_BYTES) return c.json({ error: "too large" }, 413);
    await localDriverPut(key, bytes);
    return c.body(null, 200);
  })
  .get("/local/:key{.+}", async (c) => {
    const key = c.req.param("key");
    const query = c.req.query();
    if (!verifyLocalSignature("GET", key, query)) {
      return c.json({ error: "bad signature" }, 403);
    }
    const bytes = await localDriverGet(key);
    if (!bytes) return c.json({ error: "not found" }, 404);
    // Copy into a fresh ArrayBuffer: a Node Buffer's backing store can be a
    // shared pool slab, which Response would leak in full.
    return c.body(bytes.slice().buffer as ArrayBuffer, 200, {
      "content-type": query.mime || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    });
  });
