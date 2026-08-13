import { serve } from "@hono/node-server";
import { log } from "@ragbag/shared";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, googleConfigured } from "./auth.js";
import { ensureBucketCors, requiredCorsRule } from "./blobs/storage.js";
import { db } from "./db/client.js";
import { env } from "./env.js";
import { startIngestWorker } from "./ingest/worker.js";
import { blobRoutes } from "./routes/blobs.js";
import { debugRoutes } from "./routes/debug.js";
import { metaRoutes } from "./routes/meta.js";
import { zeroRoutes } from "./routes/zero.js";

if (env.MIGRATE_ON_START) {
  // Relative to cwd: apps/server in dev, /app in the container.
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("migrations applied");
}

// Browser uploads PUT straight to the bucket, so the bucket must allow the
// web origin — the server sets that up itself when its token can. When it
// can't, say exactly what to paste where: this misconfiguration used to
// surface only as uploads silently dying in the browser.
{
  const bucketCors = await ensureBucketCors();
  if (bucketCors.state === "ok") log.info("bucket CORS ready", { detail: bucketCors.detail });
  if (bucketCors.state === "manual-needed") {
    log.warn(
      "bucket CORS could not be configured — browser uploads WILL FAIL until the policy below " +
        "is added manually (Cloudflare dashboard → R2 → bucket → Settings → CORS policy), or " +
        "the R2 API token is given bucket-admin rights",
      { error: bucketCors.detail, requiredPolicy: JSON.stringify([requiredCorsRule()]) },
    );
  }
}

const stopIngestWorker = startIngestWorker();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Finish in-flight jobs, then exit; a hard deadline in case one hangs.
    const deadline = setTimeout(() => process.exit(1), 15_000);
    deadline.unref();
    void stopIngestWorker().then(() => process.exit(0));
  });
}

const app = new Hono();

// Dev uses the Vite proxy (same-origin); this covers direct cross-origin use.
app.use("/api/*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api/meta", metaRoutes);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/zero", zeroRoutes);
app.route("/api/blobs", blobRoutes);
app.route("/api/debug", debugRoutes);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("api listening", {
    port: info.port,
    env: env.NODE_ENV,
    googleAuth: googleConfigured,
    devLogin: env.DEV_LOGIN,
  });
});
