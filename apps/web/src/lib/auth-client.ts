import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_BASE } from "@/lib/api";

// In dev the Vite server proxies /api to the API, so leaving baseURL unset
// keeps everything same-origin. In production it points at api.ragbag.app —
// same-site as the web app, so the session cookie still rides along (the
// client sends `credentials: "include"` by default). anonymousClient only does
// anything when the server has DEV_LOGIN enabled.
export const authClient = createAuthClient({
  baseURL: API_BASE || undefined,
  plugins: [anonymousClient()],
});

/**
 * Google is the only real sign-in method (plan §9).
 *
 * `callbackURL` has to be absolute: better-auth resolves a relative one against
 * its own baseURL, which in production would drop the user on api.ragbag.app
 * after the round trip. The server accepts it because WEB_ORIGIN is in
 * `trustedOrigins`.
 */
export async function signInWithGoogle(): Promise<string | undefined> {
  // better-auth's client resolves with `{data, error}` instead of throwing, so
  // an unhandled failure here is completely silent: the button does nothing and
  // nothing reaches the console. Hand the message back for the UI to show.
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}/`,
  });
  if (!error) return undefined; // success navigates away; nothing to report
  return error.message ?? error.statusText ?? `Sign-in failed (${error.status}).`;
}
