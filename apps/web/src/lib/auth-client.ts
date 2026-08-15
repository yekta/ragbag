import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_BASE } from "@/lib/api";

// In dev the Vite server proxies /api to the API, so leaving baseURL unset
// keeps everything same-origin. In production it points at api.ragbag.app:
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
 * Both URLs have to be absolute: better-auth resolves a relative one against
 * its own baseURL, which in production would drop the user on api.ragbag.app
 * after the round trip. The server accepts them because WEB_ORIGIN is in
 * `trustedOrigins`: it origin-checks `errorCallbackURL` exactly like
 * `callbackURL`.
 */
export async function signInWithGoogle(): Promise<string | undefined> {
  // better-auth's client resolves with `{data, error}` instead of throwing, so
  // an unhandled failure here is completely silent: the button does nothing and
  // nothing reaches the console. Hand the message back for the UI to show.
  const { error } = await authClient.signIn.social({
    provider: "google",
    callbackURL: `${window.location.origin}/`,
    errorCallbackURL: `${window.location.origin}/`,
  });
  if (!error) return undefined; // success navigates away; nothing to report
  return error.message ?? error.statusText ?? `Sign-in failed (${error.status}).`;
}

// better-auth reports a failed round trip as an `error` query parameter on the
// URL it sends the browser back to, with a machine-readable code. Only the ones
// a user can actually cause are worth rewording; anything else falls through to
// the code itself, which is the useful thing to paste into a bug report.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  state_mismatch: "That sign-in attempt expired before it finished. Try again.",
  please_restart_the_process: "That sign-in attempt expired before it finished. Try again.",
};

/**
 * The failure from a sign-in that died *during* the Google round trip, if this
 * page load is the return leg of one.
 *
 * `signInWithGoogle` can't report these: by the time they happen the browser
 * has navigated to Google and its promise is long gone, so the failure arrives
 * as a query parameter on a fresh page load instead. Read once at module load
 * rather than per component: StrictMode double-invokes both state initialisers
 * and effects, and the URL stays untouched because the router owns history.
 */
export const OAUTH_REDIRECT_ERROR = ((): string | undefined => {
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return undefined;
  return OAUTH_ERROR_MESSAGES[code] ?? `Sign-in failed (${code.replace(/_/g, " ")}).`;
})();
