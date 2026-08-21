import { expoClient } from "@better-auth/expo/client";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_BASE, APP_SCHEME } from "@/lib/api";

// Sign-in, on a device that has no cookie jar.
//
// A browser stores the better-auth session cookie itself and sends it back on
// every request. React Native's networking layer has a cookie store too, but
// it is per-platform, invisible, and not something an app can hand to another
// subsystem: zero-cache needs that same credential to authenticate the sync
// connection, and it takes it as a string. So the Expo plugin owns the cookie
// instead: it captures the `Set-Cookie` off the sign-in response, keeps it in
// the keychain, replays it on the client's own calls, and hands it out through
// `getCookie()` for everything else.
//
// The server side of that handshake already existed before this app did:
// apps/server/src/session.ts turns `Authorization: Bearer <cookie>` back into a
// Cookie header for exactly this case.

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [
    expoClient({
      // Must match app.config.ts and the server's trustedOrigins, or the OAuth
      // round trip has nowhere to land.
      scheme: APP_SCHEME,
      storagePrefix: "ragbag",
      // The keychain, not AsyncStorage: this string is a live session.
      storage: SecureStore,
    }),
    // Only does anything when the server has DEV_LOGIN enabled, which
    // /api/meta reports and the sign-in screen reads before offering it.
    anonymousClient(),
  ],
});

/**
 * The stored session cookie, or undefined when there is none.
 *
 * This is what Zero's `auth` option is given and what every hand-written fetch
 * to the API sends. Deliberately not reactive: `getCookie` reads the keychain
 * cache synchronously, so callers re-read it when the session changes rather
 * than subscribing to it.
 */
export function sessionCookie(): string | undefined {
  return authClient.getCookie() || undefined;
}

/** Headers that authenticate a hand-written call to the API. */
export function authHeaders(): Record<string, string> {
  const cookie = sessionCookie();
  return cookie ? { Authorization: `Bearer ${cookie}` } : {};
}

/**
 * Google is the only real sign-in method (plan §9).
 *
 * `callbackURL` is the app's own scheme rather than a URL: the Expo plugin
 * opens the round trip in an in-app browser and closes it when the system
 * hands that scheme back. better-auth resolves with `{data, error}` instead of
 * throwing, so an unhandled failure here would be completely silent; the
 * message is handed back for the screen to show.
 */
export async function signInWithGoogle(): Promise<string | undefined> {
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: `${APP_SCHEME}://`,
  });
  if (!error) return undefined;
  return error.message ?? error.statusText ?? `Sign-in failed (${error.status}).`;
}

/** The dev-only anonymous sign-in, offered only when /api/meta says it exists. */
export async function signInAnonymously(): Promise<string | undefined> {
  const { error } = await authClient.signIn.anonymous();
  return error ? (error.message ?? "Dev sign-in failed.") : undefined;
}
