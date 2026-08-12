import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { presignUploadRequest } from "@ragbag/contracts";
import { newId } from "@ragbag/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client.js";
import { blob } from "../db/schema.js";
import { env, r2Configured } from "../env.js";
import { getAuthData } from "../session.js";

// Blob bytes go straight between client and R2 via presigned URLs — they
// never stream through this server (plan §5). Keys are content-addressed:
// <user_id>/<sha256>, which makes re-dumps of the same file free.

const s3 = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export const blobRoutes = new Hono()
  .post("/presign-upload", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);
    if (!s3) return c.json({ error: "blob storage not configured" }, 503);

    const parsed = presignUploadRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { sha256, mime, size, originalName } = parsed.data;

    const existing = await db.query.blob.findFirst({
      where: and(eq(blob.userId, authData.userID), eq(blob.sha256, sha256)),
    });
    if (existing) {
      // Same content already dumped by this user — no upload needed.
      return c.json({ blobId: existing.id, uploadUrl: null });
    }

    const id = newId();
    await db.insert(blob).values({
      id,
      userId: authData.userID,
      sha256,
      mime,
      size,
      originalName,
    });

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: `${authData.userID}/${sha256}`,
        ContentType: mime,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return c.json({ blobId: id, uploadUrl });
  })
  .get("/:id/download-url", async (c) => {
    const authData = await getAuthData(c.req.raw);
    if (!authData) return c.json({ error: "unauthorized" }, 401);
    if (!s3) return c.json({ error: "blob storage not configured" }, 503);

    const row = await db.query.blob.findFirst({
      where: and(eq(blob.id, c.req.param("id")), eq(blob.userId, authData.userID)),
    });
    if (!row) return c.json({ error: "not found" }, 404);

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: `${authData.userID}/${row.sha256}`,
        ResponseContentType: row.mime,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return c.json({ url });
  });
