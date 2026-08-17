import type { EntityBehaviour, EntityCandidate } from "./types.js";

// Parcel tracking numbers, the clearest case for hybrid extraction (plan
// §5.4): the strong carrier formats are unmistakable and free to find, while
// a bare run of digits is only a tracking number if something nearby says so.
// Model-only extraction confidently labels random alphanumerics as parcels.

type Pattern = { carrier: string; re: RegExp };

/**
 * Formats no other kind of number shares, so a match is a match on sight.
 * UPS's 1Z, USPS's 92-95 prefixed 22-digit codes, DHL's JJD express numbers,
 * and the UPU's S10 international form (two letters, nine digits, a country).
 */
const STRONG: Pattern[] = [
  { carrier: "ups", re: /\b1Z[0-9A-Z]{16}\b/gi },
  { carrier: "usps", re: /\b9[2-5]\d{20}\b/g },
  { carrier: "dhl", re: /\bJJD\d{15,20}\b/gi },
  { carrier: "", re: /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g },
];

/** Digit-only formats: FedEx and friends. A bare number is not evidence. */
const WEAK = /\b(?:\d{12}|\d{15}|\d{20})\b/g;

/** How far before a weak match we look for something calling it a parcel. */
const CONTEXT_CHARS = 80;

const CARRIER_WORD =
  /\b(tracking|track|tracked|shipment|shipping|parcel|package|waybill|awb|consignment|kargo|takip)\b/i;

const CARRIER_NAME =
  /\b(fedex|ups|usps|dhl|gls|dpd|hermes|royal ?mail|tnt|aramex|yurti[çc]i|aras|ptt|mng|sendeo)\b/i;

const TRACK_URL: Record<string, (n: string) => string> = {
  ups: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  dhl: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`,
};

/**
 * Where to follow a parcel. Falls back to a web search rather than to
 * nothing: a number with an unrecognised carrier is still a number someone
 * wants to look up, and the search finds the right site more often than a
 * guess at a URL template would.
 */
export function trackingUrl(carrier: string, number: string): string {
  const template = TRACK_URL[carrier.toLowerCase()];
  if (template) return template(number);
  return `https://www.google.com/search?q=${encodeURIComponent(`${carrier} ${number} tracking`.trim())}`;
}

export const trackingBehaviour: EntityBehaviour = {
  match(text) {
    const found: EntityCandidate[] = [];
    const seen = new Set<string>();
    const add = (value: string, carrier: string, index: number) => {
      const key = value.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ value, data: carrier ? { number: value, carrier } : { number: value }, index });
    };

    for (const { carrier, re } of STRONG) {
      for (const m of text.matchAll(re)) add(m[0], carrier, m.index);
    }
    for (const m of text.matchAll(WEAK)) {
      const before = text.slice(Math.max(0, m.index - CONTEXT_CHARS), m.index);
      if (!CARRIER_WORD.test(before) && !CARRIER_NAME.test(before)) continue;
      add(m[0], CARRIER_NAME.exec(before)?.[0].toLowerCase().replace(/\s/g, "") ?? "", m.index);
    }
    return found;
  },
  normalize(value, data) {
    const number = (typeof data.number === "string" && data.number ? data.number : value)
      .replace(/[\s-]/g, "")
      .toUpperCase();
    if (!number) return null;
    // The carrier is part of the key, so the same digits at two carriers stay
    // two parcels. An unknown carrier gets its own bucket for the same reason.
    const carrier =
      typeof data.carrier === "string" && data.carrier ? data.carrier.toLowerCase().trim() : "?";
    return `${carrier}:${number}`;
  },
  title(value, data) {
    const carrier = typeof data.carrier === "string" ? data.carrier.toUpperCase() : "";
    return carrier ? `${carrier} ${value}` : value;
  },
};
