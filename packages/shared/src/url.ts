// Tracking params stripped during normalization — they change the string
// without changing the resource, which would defeat dedup-by-url (M7).
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "twclid",
]);

function isTrackingParam(name: string): boolean {
  return name.startsWith("utm_") || TRACKING_PARAMS.has(name.toLowerCase());
}

/**
 * Canonicalize a URL for storage and dedup: lowercase scheme/host, drop
 * default ports, tracking params, fragments, and trailing slashes.
 * Returns null for anything that isn't an absolute http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);

  let out = url.toString();
  if (url.pathname === "/" && !url.search) out = out.replace(/\/$/, "");
  return out;
}

/** True if the text is a single bare URL (what makes a dump a `link` item). */
export function isBareUrl(text: string): boolean {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return false;
  return normalizeUrl(trimmed) !== null;
}
