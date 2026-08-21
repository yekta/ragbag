import { expo } from "@better-auth/expo";
import { log } from "@ragbag/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "./db/client.js";
import { account, session, user, verification } from "./db/schema.js";
import { seedEntityTypes } from "./entity-types.js";
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
  // The web origin, plus wherever a native shell sends the OAuth round trip
  // back to. `ragbag://` is the installed app (apps/mobile/app.config.ts);
  // `exp://` is the Expo dev client, which serves the app from the packager's
  // address, so the exact origin is not knowable ahead of time. The dev-client
  // entries are gated on NODE_ENV because a production server that trusts
  // `exp://**` trusts an origin anyone can mint.
  trustedOrigins: [
    env.WEB_ORIGIN,
    `${env.MOBILE_SCHEME}://`,
    ...(env.NODE_ENV === "production" ? [] : ["exp://", "exp://**"]),
  ],
  // A new account starts with the catalog's eight kinds of thing, which is what
  // makes an archive useful from its first message (plan §6). Seeding is not a
  // precondition for signing up: if this fails, the account is still fine and
  // the first ingestion job seeds it instead (ingest/synthesis.ts).
  databaseHooks: {
    user: {
      create: {
        after: async (created) => {
          await seedEntityTypes(created.id).catch((err: unknown) => {
            log.warn("could not seed entity types at signup", {
              userId: created.id,
              err: String(err),
            });
          });
        },
      },
    },
  },
  // Where a failed auth round trip lands the browser. Without this, better-auth
  // falls back to `Location: /?error=...`, a *relative* redirect, resolved
  // against baseURL, which is the API host. api.ragbag.app serves no web app,
  // so every sign-in failure dead-ended on a 404 there.
  //
  // This is the fallback arm. The client also sends a per-flow
  // `errorCallbackURL` (lib/auth-client.ts), but that one rides inside the
  // signed OAuth state, so it is unreadable in exactly the cases that need it
  // most: a state cookie that expired or never arrived. Both arms have to point
  // home for the dead end to be closed.
  onAPIError: { errorURL: `${env.WEB_ORIGIN.replace(/\/$/, "")}/` },
  // zero-cache authenticates by forwarding the browser's session cookie
  // (ZERO_*_FORWARD_COOKIES), so the cookie has to be visible on its origin
  // too. Scoping it to the parent domain covers app./api./zero. All three are
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
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for"],
    },
  },
  rateLimit: {
    customRules: {
      // better-auth caps /sign-in/* at 3 requests per 10s. That rule exists to
      // slow password guessing, and it keys on the client IP, but when no IP
      // resolves it degrades to ONE bucket shared by every visitor, so three
      // clicks anywhere on the internet lock out sign-in for everyone. Google
      // is our only provider, so this endpoint just mints an OAuth state and
      // redirects: there is no secret here to guess. Match the ordinary
      // default instead of the password-grade one.
      "/sign-in/*": { window: 10, max: 100 },
    },
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
  // `expo()` is what makes a phone a first-class client: it lets the OAuth
  // round trip land on the app's own scheme, and it returns the session as a
  // `Set-Cookie` the app can store and replay itself, because a native shell
  // has no cookie jar the way a browser does. The replay arrives as
  // `Authorization: Bearer <cookie>`, which src/session.ts translates back.
  plugins: [expo(), ...(env.DEV_LOGIN ? [anonymous()] : [])],
});
