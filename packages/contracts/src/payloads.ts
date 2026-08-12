import { z } from "zod";

// Zod schemas for the plain-HTTP API payloads (everything that is NOT synced
// through Zero). Shared so clients and server validate the same shapes.

/** Blobs above this size are rejected at presign time (v1 guardrail). */
export const MAX_BLOB_BYTES = 100 * 1024 * 1024;

export const presignUploadRequest = z.object({
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
  // null when the bytes are already in R2 (content-addressed dedupe) and no
  // upload is needed.
  uploadUrl: z.string().nullable(),
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponse>;

export const downloadUrlResponse = z.object({
  url: z.string(),
});
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponse>;

/** GET /api/meta — lets clients adapt to server capabilities. */
export const metaResponse = z.object({
  googleAuth: z.boolean(),
  devLogin: z.boolean(),
  blobs: z.boolean(),
});
export type MetaResponse = z.infer<typeof metaResponse>;
