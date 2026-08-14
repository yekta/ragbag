import { getIp } from "better-auth/api";
import { Hono } from "hono";
import { auth } from "../auth.js";
import { bucketCorsStatus, storage } from "../blobs/storage.js";
import { sql } from "../db/client.js";
import { env, localBlobDir, r2Configured } from "../env.js";
import { hasVectorColumn } from "../ingest/indexing.js";
import { spentLast24h } from "../ingest/usage.js";
import { ingestHeartbeat } from "../ingest/worker.js";
import { getAuthData } from "../session.js";

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

/** Last /storage probe, held for 60s — see that route's comment. */
let storageProbe: { at: number; body: Record<string, unknown> } | null = null;

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
  })
  // Answers "is blob storage actually usable?" from the server's side: a
  // put→exists→get roundtrip on a 1-byte diagnostic object, with timings.
  // The crucial nuance is in `note`: a PASSING roundtrip plus FAILING browser
  // uploads means the bucket's CORS policy is the problem — the exact split
  // this endpoint exists to make visible. Results are cached for 60s so the
  // (unauthenticated, like /session) route can't be spammed into R2 traffic.
  .get("/storage", async (c) => {
    if (storageProbe && Date.now() - storageProbe.at < 60_000) {
      return c.json(storageProbe.body);
    }

    const store = storage;
    const driver = r2Configured ? "r2" : localBlobDir ? "local" : null;
    if (!store || !driver) {
      const body = {
        driver: null,
        note: "No blob storage configured (neither R2_* nor LOCAL_BLOB_DIR) — attachments are disabled.",
      };
      storageProbe = { at: Date.now(), body };
      return c.json(body);
    }

    const roundtrip: Record<string, string> = {};
    const step = async (name: string, run: () => Promise<string>) => {
      const started = performance.now();
      try {
        const detail = await run();
        roundtrip[name] =
          `ok in ${Math.round(performance.now() - started)}ms${detail ? ` (${detail})` : ""}`;
        return true;
      } catch (err) {
        roundtrip[name] =
          `FAILED after ${Math.round(performance.now() - started)}ms: ${String(err)}`;
        return false;
      }
    };

    // Fixed key: overwritten every probe, so it never accumulates objects.
    const key = "_diag/probe";
    const payload = new TextEncoder().encode(`ragbag storage probe ${new Date().toISOString()}`);
    const putOk = await step("put", async () => {
      await store.put(key, payload, "text/plain");
      return `${payload.byteLength} bytes`;
    });
    if (putOk) {
      await step("exists", async () => {
        if (!(await store.exists(key))) throw new Error("object not found after put");
        return "";
      });
      await step("get", async () => {
        const got = await store.get(key);
        if (!got || Buffer.compare(Buffer.from(got), Buffer.from(payload)) !== 0) {
          throw new Error("bytes came back different");
        }
        return "";
      });
    }

    const body = {
      driver,
      ...(driver === "r2" ? { bucket: env.R2_BUCKET, bucketCors: bucketCorsStatus() } : {}),
      roundtrip,
      note:
        driver === "r2"
          ? "This roundtrip proves the server's credentials and bucket. Browser uploads ALSO need " +
            `the bucket CORS policy to allow ${env.WEB_ORIGIN} — if this passes while uploads ` +
            "fail in the browser, that policy is what's missing (see bucketCors above and DEPLOY.md)."
          : "Local-disk driver: browser uploads go through this API's own CORS middleware; no bucket policy involved.",
    };
    storageProbe = { at: Date.now(), body };
    return c.json(body);
  })
  // Answers "why is nothing getting enriched?" without psql: is the worker
  // alive, what's queued/failed and why, and is AI actually configured. The
  // per-user spend appears only when the request carries a session — the rest
  // is aggregate/config state, unauthenticated like its siblings above.
  .get("/ingest", async (c) => {
    const heartbeat = ingestHeartbeat();

    const counts = Object.fromEntries(
      (
        await sql<{ status: string; count: number }[]>`
          select status, count(*)::int as count from ingest_job group by status`
      ).map((r) => [r.status, r.count]),
    );
    const [oldest] = await sql<{ age: number | null }[]>`
      select extract(epoch from now() - min(created_at))::int as age
      from ingest_job where status = 'queued'`;
    const recentErrors = (
      await sql<
        { item_id: string; status: string; attempts: number; last_error: string; at: string }[]
      >`
        select item_id, status, attempts, last_error, updated_at::text as at
        from ingest_job where last_error is not null
        order by updated_at desc limit 5`
    ).map((r) => ({
      itemId: r.item_id,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      at: r.at,
    }));

    const authData = await getAuthData(c.req.raw).catch(() => null);

    return c.json({
      worker: {
        enabled: heartbeat.enabled,
        // 0 = never looped since boot; small numbers mean it's alive.
        lastLoopSecondsAgo: heartbeat.lastLoopAt
          ? Math.round((Date.now() - heartbeat.lastLoopAt) / 1000)
          : null,
      },
      jobs: {
        counts,
        oldestQueuedSeconds: oldest?.age ?? null,
        recentErrors,
      },
      ai: {
        configured: Boolean(env.OPENAI_API_KEY),
        enrichModel: env.AI_ENRICH_MODEL,
        embedModel: env.AI_EMBED_MODEL,
        vectorColumn: await hasVectorColumn().catch(() => false),
        // Reporting only — spend is metered, never capped.
        ...(authData
          ? { yourSpendLast24hUsd: await spentLast24h(authData.userID).catch(() => null) }
          : {}),
      },
      note: env.OPENAI_API_KEY
        ? "AI is configured. If items still lack summaries, check recentErrors above and each item's detail view."
        : "AI is NOT configured (no OPENAI_API_KEY) — every job completes extraction-only: no summaries, no tags.",
    });
  });
