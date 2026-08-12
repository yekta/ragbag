import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

function s3Storage(): BlobStorage {
  const s3 = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
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

export const storage: BlobStorage | null = r2Configured
  ? s3Storage()
  : localBlobDir
    ? localStorage(localBlobDir)
    : null;

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
