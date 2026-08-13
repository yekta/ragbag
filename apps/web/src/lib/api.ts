// Where the API lives, from the browser's point of view.
//
// Empty in dev: the Vite server proxies /api to the API, so requests stay
// same-origin and the better-auth session cookie is first-party. In production
// the web and API are separate origins under one registrable domain
// (app.ragbag.app / api.ragbag.app), which is still *same-site* — so the
// session cookie is shared via `crossSubDomainCookies` on the server and
// travels on ordinary SameSite=Lax rules. Every call still has to opt in with
// `credentials: "include"`, because same-site is not same-origin.
//
// Build-time value: changing VITE_API_URL needs a rebuild, not a restart.

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** Absolute URL for an API path (`/api/...`). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
