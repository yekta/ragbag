import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PermanentError } from "./errors.js";

// Fetch a user-dumped URL with realistic headers (plan §7), a byte cap, a
// timeout, and a baseline SSRF guard: this server fetches arbitrary URLs on
// behalf of users, so every hop must resolve to a public address. (DNS
// re-resolution between check and connect remains — full pinning is M8
// hardening territory.) Guard refusals are permanent: retrying cannot change
// the answer.

export class NotHtmlError extends Error {
  constructor(public readonly contentType: string) {
    super(`not an HTML page (${contentType || "unknown content type"})`);
  }
}

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

function isPrivateIpV4(ip: string): boolean {
  const [a = -1, b = -1] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b < 128) || // CGNAT
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local / cloud metadata
    a >= 224 // multicast + reserved
  );
}

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(".") && !ip.includes(":")) return isPrivateIpV4(ip);
  const low = ip.toLowerCase();
  if (low.startsWith("::ffff:")) return isPrivateIp(low.slice("::ffff:".length));
  return (
    low === "::" ||
    low === "::1" ||
    low.startsWith("fc") ||
    low.startsWith("fd") ||
    low.startsWith("fe8") ||
    low.startsWith("fe9") ||
    low.startsWith("fea") ||
    low.startsWith("feb")
  );
}

export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new PermanentError(`refusing to fetch ${host}`);
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new PermanentError(`refusing to fetch private address ${host}`);
    return;
  }
  const addresses = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) throw new Error(`cannot resolve ${host}`);
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new PermanentError(`refusing to fetch ${host} (resolves to a private address)`);
    }
  }
}

export type FetchedPage = { html: string; finalUrl: string };

export type FetchPageOptions = {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Test hook: skip the DNS/SSRF guard. */
  guard?: boolean;
};

export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const {
    fetchImpl = fetch,
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 15_000,
    maxRedirects = 5,
    guard = true,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("page fetch timed out")), timeoutMs);
  try {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new PermanentError(`refusing non-http(s) URL ${url.protocol}`);
      }
      if (guard) await assertPublicHost(url);

      const res = await fetchImpl(url.href, {
        headers: BROWSER_HEADERS,
        redirect: "manual",
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) throw new Error(`redirect (${res.status}) without a location`);
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        throw new NotHtmlError(contentType.split(";")[0]?.trim() ?? "");
      }

      // Read with a byte cap — a page that exceeds it is truncated, not fatal.
      let bytes: Uint8Array;
      if (!res.body) {
        bytes = new Uint8Array(await res.arrayBuffer());
      } else {
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          received += value.byteLength;
          if (received >= maxBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
        bytes = new Uint8Array(received > maxBytes ? maxBytes : received);
        let offset = 0;
        for (const part of parts) {
          const take = Math.min(part.byteLength, bytes.byteLength - offset);
          bytes.set(take === part.byteLength ? part : part.subarray(0, take), offset);
          offset += take;
          if (offset >= bytes.byteLength) break;
        }
      }

      const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
      let html: string;
      try {
        html = new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(bytes);
      } catch {
        html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      return { html, finalUrl: url.href };
    }
    throw new Error("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
