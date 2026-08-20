import type { TEntityBehaviour } from "./types.js";

// Addresses are kept as they were written (plan §2.2: the model found them,
// it does not get to rewrite them). We never geocode: a maps *search* URL is
// universal (it opens Google Maps on the web and the native app on iOS and
// Android through the platform's own URL handling), needs no API key, and
// tolerates the half-remembered addresses people actually send.
//
// No matcher: an address has no syntactic signature worth trusting, and a
// regex here would only invent candidates for the model to reject.

const MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query=";

/** Single-line an address so it survives a URL query parameter. */
export function addressQuery(address: string): string {
  return address.replace(/\s+/g, " ").trim();
}

export function mapsSearchUrl(address: string): string | null {
  const query = addressQuery(address);
  if (!query) return null;
  return MAPS_SEARCH + encodeURIComponent(query);
}

export const addressBehaviour: TEntityBehaviour = {
  normalize(value, data) {
    const source = typeof data.formatted === "string" && data.formatted ? data.formatted : value;
    // Best effort, and deliberately shy: case, spacing and sentence
    // punctuation are noise, everything else is signal. Two spellings that
    // differ by a word stay two addresses, which is the safe direction.
    const key = addressQuery(source)
      .toLowerCase()
      .replace(/[.,;]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return key || null;
  },
  title(value, data) {
    if (typeof data.name === "string" && data.name) return data.name;
    if (typeof data.locality === "string" && data.locality) return data.locality;
    return addressQuery(value);
  },
};
