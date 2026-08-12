import { serve } from "@hono/node-server";
import { log } from "@ragbag/shared";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth, googleConfigured } from "./auth.js";
import { db } from "./db/client.js";
import { env } from "./env.js";
import { blobRoutes } from "./routes/blobs.js";
import { metaRoutes } from "./routes/meta.js";
import { zeroRoutes } from "./routes/zero.js";

if (env.MIGRATE_ON_START) {
  // Relative to cwd: apps/server in dev, /app in the container.
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("migrations applied");
}

const app = new Hono();

// Dev uses the Vite proxy (same-origin); this covers direct cross-origin use.
app.use("/api/*", cors({ origin: env.WEB_ORIGIN, credentials: true }));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api/meta", metaRoutes);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/zero", zeroRoutes);
app.route("/api/blobs", blobRoutes);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("api listening", {
    port: info.port,
    env: env.NODE_ENV,
    googleAuth: googleConfigured,
    devLogin: env.DEV_LOGIN,
  });
});
