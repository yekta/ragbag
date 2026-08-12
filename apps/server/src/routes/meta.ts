import type { MetaResponse } from "@ragbag/contracts";
import { Hono } from "hono";
import { googleConfigured } from "../auth.js";
import { env, r2Configured } from "../env.js";

// Server capabilities, so clients can adapt (e.g. show the dev sign-in button
// only when the server actually has DEV_LOGIN enabled).
export const metaRoutes = new Hono().get("/", (c) => {
  const meta: MetaResponse = {
    googleAuth: googleConfigured,
    devLogin: env.DEV_LOGIN,
    blobs: r2Configured,
  };
  return c.json(meta);
});
