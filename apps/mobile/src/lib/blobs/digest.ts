import * as Crypto from "expo-crypto";

/**
 * SHA-256 of a blob, lowercase hex.
 *
 * The whole file is read into memory to hash it, which is the trade
 * expo-crypto's API forces: `digest` takes a BufferSource and there is no
 * streaming variant. That is affordable here because the composer enforces
 * MAX_BLOB_BYTES before anything reaches this function, so the ceiling is
 * known rather than whatever the picker handed over.
 *
 * `bytes()` on an expo-file-system File reads off disk, so a picked photo is
 * not held twice: the Blob is a handle, and this is the one moment its
 * contents are resident.
 */
export async function expoDigest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
