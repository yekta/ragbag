import { MAX_BLOB_BYTES, presignUploadRequest } from "@ragbag/contracts";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  blobKey,
  localDriverGet,
  localDriverPut,
  storage,
  verifyLocalSignature,
} from "../blobs/storage.js";
import { db } from "../db/client.js";
import { blob } from "../db/schema.js";
import { getAuthData } from "../session.js";

// Blob bytes go straight between client and the object store via presigned
// URLs: they never stream through application code (plan §5). Keys are
// content-addressed: <user_id>/<sha256>, which makes re-dumps of the same
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
    // possibly created offline before this request. Re-dumping identical bytes
    // therefore adds a cheap extra row pointing at the same content-addressed
    // object: the bytes are still stored exactly once, and no client ever has
    // to be told its id was reassigned.
    const key = blobKey(authData.userID, sha256);
    await db
      .insert(blob)
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

    const row = await db.query.blob.findFirst({
      where: and(eq(blob.id, c.req.param("id")), eq(blob.userId, authData.userID)),
    });
    if (!row) return c.json({ error: "not found" }, 404);

    const url = await storage.presignDownload(blobKey(authData.userID, row.sha256), row.mime);
    return c.json({ url });
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
