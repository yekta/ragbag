import type { TBlobVariant } from "@ragbag/contracts";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/auth";

// Media delivery, on a device.
//
// One stable URL per picture, exactly as on web (plan §6.3):
//
//   <API_BASE>/api/media/<blobId>/<variant>       thumb | display | original
//
// The web app needs a service worker behind that URL to get caching, because a
// browser will not cache a 302 to a presigned target and the alternative
// (fetch the bytes in JS, createObjectURL) costs native lazy loading. None of
// that applies here: expo-image caches by URL on disk itself, decodes off the
// JS thread, and evicts under memory pressure, so the worker, the object-URL
// cache and the retry ladder that went with them are all simply gone.
//
// What the worker did have to be told, and what this still has to say, is the
// credential: the media route checks the session before it redirects, and a
// phone has no cookie jar the API would trust. Every image source carries the
// bearer header instead.

export function mediaUrl(blobId: string, variant: TBlobVariant): string {
  return `${API_BASE}/api/media/${blobId}/${variant}`;
}

/**
 * A source for `expo-image`: the stable URL plus the credential.
 *
 * Read per render rather than captured once, because the token changes when a
 * session refreshes and a source built from a stale one 401s for as long as
 * the component stays mounted.
 */
export function mediaSource(blobId: string, variant: TBlobVariant) {
  return { uri: mediaUrl(blobId, variant), headers: authHeaders() };
}
