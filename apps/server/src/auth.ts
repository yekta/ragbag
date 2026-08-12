import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "./db/client.js";
import { account, session, user, verification } from "./db/schema.js";
import { env } from "./env.js";

// Google OAuth is the only sign-in method (plan §9). The anonymous plugin is
// a dev/test-only escape hatch (env-gated, rejected in production by env.ts)
// so the M1 sync proof and integration tests can run without Google creds.

export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  trustedOrigins: [env.WEB_ORIGIN],
  session: {
    // Long-lived sliding sessions (plan §9: 30–90 days): auth gates syncing,
    // never using the app.
    expiresIn: 60 * 60 * 24 * 60,
    updateAge: 60 * 60 * 24,
  },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  plugins: env.DEV_LOGIN ? [anonymous()] : [],
});
