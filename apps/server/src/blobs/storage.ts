import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CORSRule } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, localBlobDir, r2Configured } from "../env.js";

// Blob bytes live in an object store keyed by content address
// (<user_id>/<sha256>) and move directly between client and store via
// presigned URLs (plan §5). Two drivers behind one interface:
//
//   - r2: Cloudflare R2 / any S3-compatible bucket — the SaaS + self-host path.
//   - local: plain files under LOCAL_BLOB_DIR served by this server through
//     HMAC-"presigned" URLs with the same bearer semantics as S3 presigning.
//     Default in dev (file dumps work with zero setup); production only when
//     LOCAL_BLOB_DIR is set explicitly.
//
// The server itself reads/writes objects too: ingestion (M4) pulls blob bytes
// for PDF/image extraction and stores HTML snapshots of link articles.

export type BlobStorage = {
  presignUpload(key: string, mime: string): Promise<string>;
  presignDownload(key: string, mime: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
};

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

// One client for the storage driver AND bucket administration (CORS below).
const s3Client: S3Client | null = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

function s3Storage(s3: S3Client): BlobStorage {
  const Bucket = env.R2_BUCKET;
  return {
    presignUpload: (key, mime) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: mime }), {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),
    presignDownload: (key, mime) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentType: mime }), {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      }),
    exists: async (key) => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    get: async (key) => {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
        return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
      } catch {
        return null;
      }
    },
    put: async (key, bytes, mime) => {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: mime }));
    },
  };
}

// --- local driver ---

// Object keys are path-like but never user-controlled beyond these shapes.
const KEY_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key) && !key.includes("..");
}

function sign(method: string, key: string, mime: string, exp: number): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${method}\n${key}\n${mime}\n${exp}`)
    .digest("hex");
}

/** Verify an HMAC-presigned local URL. Used by the /api/blobs/local routes. */
export function verifyLocalSignature(
  method: string,
  key: string,
  query: { mime?: string; exp?: string; sig?: string },
): boolean {
  const exp = Number(query.exp);
  if (!isValidKey(key) || !Number.isFinite(exp) || exp * 1000 < Date.now() || !query.sig) {
    return false;
  }
  const want = Buffer.from(sign(method, key, query.mime ?? "", exp), "hex");
  const got = Buffer.from(query.sig, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

function localUrl(method: "PUT" | "GET", key: string, mime: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const q = new URLSearchParams({ mime, exp: String(exp), sig: sign(method, key, mime, exp) });
  // BETTER_AUTH_URL is the browser-facing base of /api (the Vite proxy in dev,
  // the public server URL when self-hosting) — same origin as auth cookies.
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/blobs/local/${key}?${q}`;
}

function localPath(dir: string, key: string): string {
  return join(dir, ...key.split("/"));
}

function localStorage(dir: string): BlobStorage {
  return {
    presignUpload: (key, mime) =>
      Promise.resolve(localUrl("PUT", key, mime, UPLOAD_URL_TTL_SECONDS)),
    presignDownload: (key, mime) =>
      Promise.resolve(localUrl("GET", key, mime, DOWNLOAD_URL_TTL_SECONDS)),
    exists: async (key) => {
      try {
        await stat(localPath(dir, key));
        return true;
      } catch {
        return false;
      }
    },
    get: async (key) => {
      try {
        return await readFile(localPath(dir, key));
      } catch {
        return null;
      }
    },
    put: async (key, bytes) => {
      const path = localPath(dir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
  };
}

export const storage: BlobStorage | null = s3Client
  ? s3Storage(s3Client)
  : localBlobDir
    ? localStorage(localBlobDir)
    : null;

// --- bucket CORS (the R2 driver's browser-upload prerequisite) ---

// Presigned PUT/GET run straight from the browser to the bucket, which is a
// cross-origin request: without a CORS rule allowing the web origin, every
// browser upload dies in the preflight — while server-side access (ingest,
// proofs) works fine, which made this failure maddening to diagnose.

/** The one rule browser upload/download needs; also printed for manual setup. */
export function requiredCorsRule(): CORSRule {
  return {
    AllowedOrigins: [env.WEB_ORIGIN],
    AllowedMethods: ["PUT", "GET"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["etag"],
    MaxAgeSeconds: 3600,
  };
}

export type BucketCorsStatus =
  /** Local driver (same-site, covered by the API's own CORS middleware). */
  | { state: "not-applicable" }
  | { state: "ok"; detail: string }
  /** Couldn't verify or apply — a human must set the policy on the bucket. */
  | { state: "manual-needed"; detail: string };

let corsStatus: BucketCorsStatus = { state: "not-applicable" };

export function bucketCorsStatus(): BucketCorsStatus {
  return corsStatus;
}

function ruleCovers(rule: CORSRule, origin: string): boolean {
  const origins = rule.AllowedOrigins ?? [];
  const methods = rule.AllowedMethods ?? [];
  const headers = (rule.AllowedHeaders ?? []).map((h) => h.toLowerCase());
  return (
    (origins.includes("*") || origins.includes(origin)) &&
    ["PUT", "GET"].every((m) => methods.includes(m)) &&
    (headers.includes("*") || headers.includes("content-type"))
  );
}

/**
 * Make the bucket's CORS policy allow browser uploads from WEB_ORIGIN,
 * following the ensureVectorColumn() precedent: the server fixes its own
 * prerequisites on boot when it can. Appends to existing rules, never
 * replaces them. Never throws — a failure lands in bucketCorsStatus() (and
 * the boot log) with instructions instead.
 */
export async function ensureBucketCors(): Promise<BucketCorsStatus> {
  if (!s3Client) {
    corsStatus = { state: "not-applicable" };
    return corsStatus;
  }
  const Bucket = env.R2_BUCKET;
  try {
    let rules: CORSRule[] = [];
    try {
      const existing = await s3Client.send(new GetBucketCorsCommand({ Bucket }));
      rules = existing.CORSRules ?? [];
    } catch (err) {
      // "No CORS configuration" is the normal first-boot answer, not an error.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NoSuchCORSConfiguration" && name !== "CORSConfigurationNotFound") throw err;
    }
    if (rules.some((r) => ruleCovers(r, env.WEB_ORIGIN))) {
      corsStatus = { state: "ok", detail: `an existing rule already allows ${env.WEB_ORIGIN}` };
      return corsStatus;
    }
    await s3Client.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: { CORSRules: [...rules, requiredCorsRule()] },
      }),
    );
    corsStatus = { state: "ok", detail: `added a rule allowing ${env.WEB_ORIGIN}` };
  } catch (err) {
    // Object-scoped R2 API tokens can read/write objects but not bucket
    // configuration — the common reason this lands here.
    corsStatus = {
      state: "manual-needed",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
  return corsStatus;
}

/** Reads/writes bytes for the local driver's presigned routes. */
export async function localDriverPut(key: string, bytes: Uint8Array): Promise<void> {
  if (!localBlobDir) throw new Error("local blob storage not active");
  await localStorage(localBlobDir).put(key, bytes, "");
}

export async function localDriverGet(key: string): Promise<Uint8Array | null> {
  if (!localBlobDir) return null;
  return localStorage(localBlobDir).get(key);
}

export function blobKey(userId: string, sha256: string): string {
  return `${userId}/${sha256}`;
}
