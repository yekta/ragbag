// Addresses are stored as the user typed them (plan §4: item.text). We never
// geocode — a maps *search* URL is universal (opens Google Maps on the web,
// and the native app on iOS/Android via the platform's URL handling), needs no
// API key, and tolerates the half-remembered addresses people actually dump.

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
