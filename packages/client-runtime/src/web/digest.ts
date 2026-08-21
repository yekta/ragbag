/**
 * SHA-256 of a blob, lowercase hex, from the Web Crypto API.
 *
 * `crypto.subtle` only exists in a secure context, so a plain-http deploy
 * would otherwise die here as an inscrutable TypeError on the first file
 * anyone picked. Say what is actually wrong instead.
 */
export async function subtleDigest(blob: Blob): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Files need a secure (HTTPS) connection, and this page has none");
  }
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
