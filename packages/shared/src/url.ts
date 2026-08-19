// Tracking params stripped during normalization: they change the string
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

/** True if the text is a single bare URL (what makes a message a `link` item). */
export function isBareUrl(text: string): boolean {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return false;
  return normalizeUrl(trimmed) !== null;
}

// Video links get metadata-only treatment (plan §7): title/thumbnail/
// description from OG tags, a `video` type tag; no transcript fetching or
// content-level analysis. Detection is by URL shape.
const VIDEO_PATTERNS: RegExp[] = [
  /^(www\.|m\.)?youtube\.com$/i,
  /^youtu\.be$/i,
  /^(www\.)?vimeo\.com$/i,
  /^(www\.|vm\.|vt\.)?tiktok\.com$/i,
  /^(www\.)?twitch\.tv$/i,
  /^clips\.twitch\.tv$/i,
  /^(www\.)?dailymotion\.com$/i,
  /^dai\.ly$/i,
  /^(www\.)?loom\.com$/i,
];

const VIDEO_PATH_REQUIRED: Record<string, RegExp> = {
  // These hosts serve plenty of non-video pages; require a video-looking path.
  "youtube.com": /^\/(watch|shorts|live|embed)/,
  "vimeo.com": /^\/\d+/,
  "tiktok.com": /\/video\/|^\/v\//,
  "twitch.tv": /^\/videos\/|\/clip\//,
  "dailymotion.com": /^\/video\//,
  "loom.com": /^\/(share|embed)\//,
};

export function isVideoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (!VIDEO_PATTERNS.some((p) => p.test(host))) return false;
  const bare = host.replace(/^(www\.|m\.|vm\.|vt\.)/i, "");
  const pathRule = VIDEO_PATH_REQUIRED[bare];
  return pathRule ? pathRule.test(url.pathname) : true;
}
