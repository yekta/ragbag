import { z } from "zod";

// Zod schemas for the plain-HTTP API payloads (everything that is NOT synced
// through Zero). Shared so clients and server validate the same shapes.

/** Blobs above this size are rejected at presign time. */
export const MAX_BLOB_BYTES = 100 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const blobId = z.string().regex(UUID_RE, "blobId must be a UUID");

/** The derivatives an image has, all served from the same URL shape (§6.3). */
export const BLOB_VARIANTS = ["original", "display", "thumb"] as const;
export type BlobVariant = (typeof BLOB_VARIANTS)[number];

export const presignUploadRequest = z.object({
  // Client-minted UUID v7 (offline capture creates the message before the
  // server ever hears about the blob). The server uses it for the new blob
  // row; on a content-address hit it still keeps the client's id, so nothing
  // has to be told its id was reassigned.
  blobId,
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex chars (content address)"),
  mime: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_BLOB_BYTES),
  originalName: z.string().max(512).optional(),
});
export type PresignUploadRequest = z.infer<typeof presignUploadRequest>;

export const presignUploadResponse = z.object({
  blobId: z.string(),
  // null when the bytes are already in the store (content-addressed dedupe)
  // and no upload is needed.
  uploadUrl: z.string().nullable(),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponse>;

export const downloadUrlResponse = z.object({
  url: z.string(),
});
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponse>;

/**
 * How many blobs one batch presign may ask about (plan §6.4).
 *
 * Presigning is a local HMAC with no round trip to the bucket, so a hundred
 * is nearly free and a grid scroll becomes one request rather than forty.
 */
export const MAX_DOWNLOAD_URL_BATCH = 100;

export const downloadUrlsRequest = z.object({
  blobIds: z.array(blobId).min(1).max(MAX_DOWNLOAD_URL_BATCH),
  variant: z.enum(BLOB_VARIANTS).default("original"),
});
export type DownloadUrlsRequest = z.infer<typeof downloadUrlsRequest>;

export const downloadUrlsResponse = z.object({
  /** blobId → presigned GET; ids the caller does not own are simply absent. */
  urls: z.record(z.string(), z.string()),
});
export type DownloadUrlsResponse = z.infer<typeof downloadUrlsResponse>;

/** GET /api/meta: lets clients adapt to server capabilities. */
export const metaResponse = z.object({
  googleAuth: z.boolean(),
  devLogin: z.boolean(),
  blobs: z.boolean(),
  /** AI enrichment configured (always true in production; boot requires it). */
  ai: z.boolean(),
});
export type MetaResponse = z.infer<typeof metaResponse>;
