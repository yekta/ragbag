import type { MetaResponse } from "@ragbag/contracts";
import { Hono } from "hono";
import { googleConfigured } from "../auth.js";
import { env, storageConfigured } from "../env.js";

// Server capabilities, so clients can adapt (e.g. show the dev sign-in button
// only when the server actually has DEV_LOGIN enabled).
export const metaRoutes = new Hono().get("/", (c) => {
  const meta: MetaResponse = {
    googleAuth: googleConfigured,
    devLogin: env.DEV_LOGIN,
    blobs: storageConfigured,
    ai: Boolean(env.OPENAI_API_KEY),
  };
  return c.json(meta);
});
