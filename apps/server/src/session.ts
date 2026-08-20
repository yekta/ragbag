import type { TAuthData } from "@ragbag/contracts";
import { auth } from "./auth.js";

/**
 * Resolve the authenticated user for any incoming request.
 *
 * Web/desktop send the better-auth session cookie (zero-cache forwards it via
 * ZERO_*_FORWARD_COOKIES). Native shells without cookie jars send the stored
 * session cookie as `Authorization: Bearer <cookie>` (the Zero client's
 * `auth` option), which we translate back into a Cookie header here.
 */
export async function getAuthData(req: Request): Promise<TAuthData | undefined> {
  const headers = new Headers(req.headers);
  const bearer = headers.get("authorization");
  if (bearer?.startsWith("Bearer ") && !headers.get("cookie")) {
    headers.set("cookie", bearer.slice("Bearer ".length));
  }
  const session = await auth.api.getSession({ headers });
  return session ? { userID: session.user.id } : undefined;
}
