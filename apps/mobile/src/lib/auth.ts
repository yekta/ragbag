import { expoClient, getCookie, storageAdapter } from "@better-auth/expo/client";
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import type { TIdentity } from "@/lib/identity";
import { API_BASE, APP_SCHEME, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "@/lib/api";

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

const AUTH_STORAGE_PREFIX = "ragbag";
const authStorage = storageAdapter(SecureStore);

if (GOOGLE_IOS_CLIENT_ID && GOOGLE_WEB_CLIENT_ID) {
  GoogleSignin.configure({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
}

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [
    expoClient({
      // Must match app.config.ts and the server's trustedOrigins, or the OAuth
      // round trip has nowhere to land.
      scheme: APP_SCHEME,
      storagePrefix: AUTH_STORAGE_PREFIX,
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
 * store synchronously, so callers re-read it when the session changes rather
 * than subscribing to it. Better Auth 1.7 made its convenience `getCookie()`
 * asynchronous, but Zero, expo-image, and the upload queue all require their
 * credential synchronously. Its exported storage adapter and cookie parser
 * read the exact same chunk-aware representation without maintaining a second
 * copy of the session.
 */
export function sessionCookie(): string | undefined {
  const stored = authStorage.getItem(`${AUTH_STORAGE_PREFIX}_cookie`);
  return getCookie(stored ?? "{}") || undefined;
}

/** Headers that authenticate a hand-written call to the API. */
export function authHeaders(): Record<string, string> {
  const cookie = sessionCookie();
  return cookie ? { Authorization: `Bearer ${cookie}` } : {};
}

/**
 * Google is the only real sign-in method (plan §9).
 *
 * The native Google SDK returns an ID token and Better Auth verifies it on the
 * server. This intentionally avoids the browser callback and Better Auth's
 * `/expo-authorization-proxy` state-cookie handoff, which is unreliable on
 * Expo/iOS and can strand a successful Google interaction in the web app.
 *
 * Better Auth resolves with `{data, error}` instead of throwing, so an
 * immediate failure is handed back for the screen to show.
 */
export type TGoogleSignInResult = { identity?: TIdentity; error?: string };

export async function signInWithGoogle(): Promise<TGoogleSignInResult> {
  if (!GOOGLE_IOS_CLIENT_ID || !GOOGLE_WEB_CLIENT_ID) {
    return { error: "Google Sign-In is missing its iOS or Web client ID." };
  }

  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) return {};
    if (!isSuccessResponse(response) || !response.data.idToken) {
      return { error: "Google did not return an identity token." };
    }

    const { data, error } = await authClient.signIn.social({
      provider: "google",
      idToken: { token: response.data.idToken },
    });
    if (error) {
      return { error: error.message ?? error.statusText ?? `Sign-in failed (${error.status}).` };
    }
    if (!data || !("user" in data) || !data.user?.id) {
      return { error: "Google sign-in succeeded, but the server returned no user." };
    }

    // The Expo plugin has finished persisting Set-Cookie before signIn.social
    // resolves. Verify that handoff instead of treating a Google user alone as
    // a usable app session: Zero and every API request need this same cookie.
    const cookie = await authClient.getCookie();
    if (!cookie) {
      return { error: "Google sign-in succeeded, but the app could not store its session." };
    }
    const verified = await authClient.getSession();
    if (verified.error || !verified.data?.user.id) {
      return { error: verified.error?.message ?? "The new session could not be verified." };
    }

    return {
      identity: {
        userID: verified.data.user.id,
        email: verified.data.user.email || "you",
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Google Sign-In failed." };
  }
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  state_mismatch: "That sign-in attempt expired before it finished. Try again.",
  please_restart_the_process: "That sign-in attempt expired before it finished. Try again.",
};

/** A useful message for an OAuth failure returned through the native deep link. */
export function oauthRedirectError(code: string | string[] | undefined): string | undefined {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return undefined;
  return OAUTH_ERROR_MESSAGES[value] ?? `Sign-in failed (${value.replace(/_/g, " ")}).`;
}

/** The dev-only anonymous sign-in, offered only when /api/meta says it exists. */
export async function signInAnonymously(): Promise<string | undefined> {
  const { error } = await authClient.signIn.anonymous();
  return error ? (error.message ?? "Dev sign-in failed.") : undefined;
}
