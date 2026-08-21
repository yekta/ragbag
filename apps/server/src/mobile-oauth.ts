import { createAuthMiddleware } from "better-auth/api";

type SocialSignInBody = Record<string, unknown>;

/**
 * Pin OAuth return URLs for requests made by the native Expo client.
 *
 * The Expo client identifies itself with `expo-origin`. A callback URL also
 * arrives in the request body, but that value can be derived from the current
 * JS runtime (Metro, an update, or the web origin). Letting it pass through
 * means a successful Google login can finish in the web app instead of closing
 * the iOS auth session. Once the request is known to be from our native scheme,
 * the server is the authority for every URL stored in the signed OAuth state.
 */
export function nativeOAuthBody(
  path: string,
  expoOrigin: string | null | undefined,
  body: SocialSignInBody | undefined,
  scheme: string,
): SocialSignInBody | undefined {
  if (path !== "/sign-in/social" || !expoOrigin || !body) return undefined;

  let protocol: string;
  try {
    protocol = new URL(expoOrigin).protocol;
  } catch {
    return undefined;
  }
  if (protocol !== `${scheme}:`) return undefined;

  const root = `${scheme}:///`;
  return {
    ...body,
    callbackURL: root,
    newUserCallbackURL: root,
    errorCallbackURL: `${root}sign-in`,
  };
}

/** Better Auth hook that applies {@link nativeOAuthBody} to real requests. */
export function nativeOAuthHook(scheme: string) {
  return createAuthMiddleware(async (ctx) => {
    const expoOrigin = ctx.request?.headers.get("expo-origin") ?? ctx.headers?.get("expo-origin");
    const body = nativeOAuthBody(ctx.path, expoOrigin, ctx.body, scheme);
    if (body) return { context: { body } };
  });
}
