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
  // zero-cache authenticates by forwarding the browser's session cookie
  // (ZERO_*_FORWARD_COOKIES), so the cookie has to be visible on its origin
  // too. Scoping it to the parent domain covers app./api./zero. — all
  // same-site, so the default SameSite=Lax still applies and nothing needs
  // SameSite=None. Everything else (httpOnly, secure) is unchanged.
  advanced: {
    ...(env.COOKIE_DOMAIN
      ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
      : {}),
    // better-auth only reads `x-forwarded-for` by default, and refuses a
    // multi-hop chain unless it knows which hops are proxies. Behind
    // Cloudflare in front of the platform router that chain is always
    // multi-hop, so every request fell back to one shared rate-limit bucket.
    // `cf-connecting-ip` is single-valued and set by the CDN.
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
  },
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
