import { BLOB_VARIANTS } from "@ragbag/contracts";
import type { BlobVariant } from "@ragbag/contracts";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { blobKey, storage, variantKey } from "../blobs/storage.js";
import { db } from "../db/client.js";
import { blobs } from "../db/schema.js";
import { getAuthData } from "../session.js";

// One URL shape for every picture in the app (plan §6.3):
//
//   /api/media/<blobId>/<variant>       variant in thumb | display | original
//
// That string is the only thing that ever goes in a `src`.
//
// Why it matters: a presigned URL is different every time you mint one, so the
// browser cache can never hit it. That rules out presigned URLs in `src`
// directly. The alternative (fetch the bytes in JS and createObjectURL, which
// is what v1 did) works but costs native `loading="lazy"`, so a grid of
// several hundred tiles means JS holding several hundred Blobs and doing its
// own viewport math. A stable URL hands lazy loading, off-main-thread decode
// and memory eviction back to the browser.
//
// Two layers serve it. This route, always present: it checks the session
// cookie and 302s to a freshly presigned GET, so bytes still never stream
// through application code, only the redirect does. And a service worker, when
// registered, which intercepts the same path and serves from Cache Storage.
// Same markup either way.

function isVariant(value: string): value is BlobVariant {
  return (BLOB_VARIANTS as readonly string[]).includes(value);
}

export const mediaRoutes = new Hono().get("/:blobId/:variant", async (c) => {
  const authData = await getAuthData(c.req.raw);
  if (!authData) return c.json({ error: "unauthorized" }, 401);
  if (!storage) return c.json({ error: "blob storage not configured" }, 503);

  const variant = c.req.param("variant");
  if (!isVariant(variant)) return c.json({ error: "unknown variant" }, 404);

  const row = await db.query.blobs.findFirst({
    where: and(eq(blobs.id, c.req.param("blobId")), eq(blobs.userId, authData.userID)),
  });
  if (!row) return c.json({ error: "not found" }, 404);

  // A derivative exists only once the pipeline has made it, and asking for one
  // that does not exist yet should give you the picture rather than a 404: a
  // freshly dumped photo is browsed before ingestion has finished with it.
  const key =
    variant === "original"
      ? blobKey(authData.userID, row.sha256)
      : variantKey(authData.userID, row.sha256, variant);
  const derived = variant !== "original" && (await storage.exists(key));
  const url = await storage.presignDownload(
    derived ? key : blobKey(authData.userID, row.sha256),
    derived ? "image/webp" : row.mime,
  );

  // 302, not 301: the target is a presigned URL that expires, so nothing may
  // remember this mapping. The response itself is private and short-lived; the
  // caching that matters happens in the service worker, against this path.
  return c.redirect(url, 302);
});
