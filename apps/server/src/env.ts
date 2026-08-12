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
    // for self-hosters. Optional in dev — blob routes 503 until configured.
    R2_ENDPOINT: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
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
