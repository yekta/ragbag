import { getIp } from "better-auth/api";
import { Hono } from "hono";
import { auth } from "../auth.js";
import { sql } from "../db/client.js";

// Temporary diagnostic for deployed environments: which proxy header actually
// carries the client IP behind whatever CDN/router sits in front of us, and
// what better-auth makes of it. `resolvedIp: null` means rate limiting has no
// per-client key and collapses onto one shared bucket. Only IP-bearing headers
// are echoed — never cookies or Authorization.

const IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
  "x-client-ip",
  "x-envoy-external-address",
  "forwarded",
];

export const debugRoutes = new Hono()
  .get("/ip", (c) => {
    return c.json({
      resolvedIp: getIp(c.req.raw, auth.options),
      headers: Object.fromEntries(IP_HEADERS.map((h) => [h, c.req.header(h) ?? null])),
    });
  })
  // Splits the three ways a session can fail to reach us, which the 401 alone
  // can't distinguish: the cookie never arrived (domain/SameSite), it arrived
  // but resolves to no session (wrong value, expired row, stale duplicate), or
  // the database is unreachable. Cookie NAMES only — values stay secret. A name
  // appearing twice means a leftover host-only cookie is shadowing the new
  // parent-domain one. Open it in the browser, and via zero-cache's own path.
  .get("/session", async (c) => {
    const cookieHeader = c.req.header("cookie");
    const cookieNames = (cookieHeader ?? "")
      .split(";")
      .map((part) => part.split("=")[0]?.trim())
      .filter((name): name is string => Boolean(name));

    let db: string;
    const dbStarted = performance.now();
    try {
      await sql`select 1`;
      db = `ok in ${Math.round(performance.now() - dbStarted)}ms`;
    } catch (err) {
      db = `FAILED after ${Math.round(performance.now() - dbStarted)}ms: ${String(err)}`;
    }

    let session: string;
    const authStarted = performance.now();
    try {
      const result = await auth.api.getSession({ headers: new Headers(c.req.raw.headers) });
      session = result
        ? `resolved user ...${result.user.id.slice(-6)} in ${Math.round(performance.now() - authStarted)}ms`
        : `no session (cookie absent, unrecognised or expired)`;
    } catch (err) {
      session = `THREW: ${String(err)}`;
    }

    return c.json({ cookieReceived: Boolean(cookieHeader), cookieNames, session, db });
  });
