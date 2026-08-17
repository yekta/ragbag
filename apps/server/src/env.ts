import { existsSync } from "node:fs";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Dev convenience: pick up the repo-root .env (compose uses the same file).
// Already-set variables win; production containers just set real env vars.
for (const candidate of [".env", "../../.env"]) {
  if (existsSync(candidate)) process.loadEnvFile(candidate);
}

// All server configuration comes from the environment (12-factor; identical
// code paths for SaaS and self-host; see plan §11). Validated through
// t3-env's createEnv: `emptyStringAsUndefined` means `SOME_VAR=` behaves like
// an unset variable (so defaults apply) instead of smuggling "" past every
// `z.string().optional()`, which once let blank R2 vars half-configure a
// driver. A validation failure refuses to boot, loudly.

const shape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),

  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/ragbag"),
  // Run drizzle migrations on boot (compose/Railway friendly).
  MIGRATE_ON_START: z.stringbool().default(true),

  // Browser-facing base URL of the auth endpoints. In dev the Vite proxy
  // fronts the API, so this is the web origin.
  BETTER_AUTH_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-only-secret-change-me"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  // Set when the web app, the API and zero-cache sit on sibling subdomains
  // (e.g. ".ragbag.app" for app./api./zero.ragbag.app): the session cookie is
  // issued for the parent domain so all three see it. Unset in dev, where
  // everything is localhost: cookies ignore the port, so they already are.
  // Must be a registrable domain; a Railway-style "*.up.railway.app" host
  // won't work, those are separate sites.
  COOKIE_DOMAIN: z.string().optional(),

  // Google OAuth is the only sign-in method (§9). Optional so the server
  // can boot in dev without credentials.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Dev/test escape hatch: enables an anonymous sign-in endpoint so the M1
  // sync proof and integration tests can run without Google credentials.
  // Never enable in production.
  DEV_LOGIN: z.stringbool().default(false),

  // Blob storage: Cloudflare R2 via the S3 API, or any S3-compatible bucket
  // for self-hosters. When unset, LOCAL_BLOB_DIR (plain files served by this
  // server through HMAC-presigned URLs) takes over, defaulted in dev so
  // file dumps work with zero setup, opt-in in production.
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  LOCAL_BLOB_DIR: z.string().optional(),

  // OpenAI powers every AI stage (plan §5): a core feature, not an add-on,
  // and REQUIRED in production (see the guard below; a keyless deploy
  // silently produced no summaries or tags for a day before anyone noticed).
  // Optional in dev/test so the stack boots without credentials.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  // Vision, the scanned-PDF pass and synthesis all share this one.
  AI_ENRICH_MODEL: z.string().default("gpt-5.6-luna"),
  AI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-transcribe"),
  // How a PDF handed to the model is rendered. The real cost lever: `auto`
  // means high-quality rendering and more input tokens per page (plan §5.2).
  AI_PDF_DETAIL: z.enum(["auto", "low", "high"]).default("low"),
  /** Past this many pages a PDF is truncated rather than sent whole (§5.2). */
  AI_PDF_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(50),

  // The ingestion worker runs inside the API process for now; the flag is
  // the groundwork for a dedicated worker instance (plan §11).
  INGEST_WORKER: z.stringbool().default(true),
  INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
};

/** The whole-environment schema, also the unit-test seam (env.test.ts). */
export const EnvSchema = z.object(shape).superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV !== "production") return;
  if (cfg.BETTER_AUTH_SECRET === "dev-only-secret-change-me") {
    ctx.addIssue({ code: "custom", message: "BETTER_AUTH_SECRET must be set in production" });
  }
  if (cfg.DEV_LOGIN) {
    ctx.addIssue({ code: "custom", message: "DEV_LOGIN must not be enabled in production" });
  }
  if (!cfg.OPENAI_API_KEY) {
    ctx.addIssue({
      code: "custom",
      message:
        "OPENAI_API_KEY must be set in production. Enrichment is a core feature and the " +
        "server refuses to run without it (set it on the API service's variables)",
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = createEnv({
  server: shape,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  createFinalSchema: () => EnvSchema,
});

export const r2Configured = Boolean(
  env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
);

/** Local-disk blob root; active only when R2 is not configured. */
export const localBlobDir = r2Configured
  ? undefined
  : (env.LOCAL_BLOB_DIR ?? (env.NODE_ENV === "production" ? undefined : ".data/blobs"));

export const storageConfigured = r2Configured || Boolean(localBlobDir);
