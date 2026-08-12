import { existsSync } from "node:fs";
import { z } from "zod";

// Dev convenience: pick up the repo-root .env (compose uses the same file).
// Already-set variables win; production containers just set real env vars.
for (const candidate of [".env", "../../.env"]) {
  if (existsSync(candidate)) process.loadEnvFile(candidate);
}

// All server configuration comes from the environment (12-factor; identical
// code paths for SaaS and self-host — see plan §11).
export const EnvSchema = z
  .object({
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
    // server through HMAC-presigned URLs) takes over — defaulted in dev so
    // file dumps work with zero setup, opt-in in production.
    R2_ENDPOINT: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    LOCAL_BLOB_DIR: z.string().optional(),

    // OpenAI powers enrichment + embeddings (plan §7/§8). Optional: without a
    // key, ingestion still extracts content — it just skips the AI stages.
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    AI_ENRICH_MODEL: z.string().default("gpt-5.6-luna"),
    AI_EMBED_MODEL: z.string().default("text-embedding-3-small"),
    // Per-user AI budget over a rolling 24h window (plan §7: caps from day
    // one — ingestion spend is the SaaS's main variable cost).
    AI_USER_DAILY_BUDGET_USD: z.coerce.number().default(1),

    // The ingestion worker runs inside the API process for now; the flag is
    // the groundwork for a dedicated worker instance (plan §11).
    INGEST_WORKER: z.stringbool().default(true),
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== "production") return;
    if (cfg.BETTER_AUTH_SECRET === "dev-only-secret-change-me") {
      ctx.addIssue({ code: "custom", message: "BETTER_AUTH_SECRET must be set in production" });
    }
    if (cfg.DEV_LOGIN) {
      ctx.addIssue({ code: "custom", message: "DEV_LOGIN must not be enabled in production" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export const r2Configured = Boolean(
  env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
);

/** Local-disk blob root; active only when R2 is not configured. */
export const localBlobDir = r2Configured
  ? undefined
  : (env.LOCAL_BLOB_DIR ?? (env.NODE_ENV === "production" ? undefined : ".data/blobs"));

export const storageConfigured = r2Configured || Boolean(localBlobDir);
