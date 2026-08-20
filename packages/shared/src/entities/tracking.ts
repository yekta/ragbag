import type { TEntityBehaviour, TEntityCandidate } from "./types.js";

// Parcel tracking numbers, the clearest case for hybrid extraction (plan
// §5.4): the strong carrier formats are unmistakable and free to find, while
// a bare run of digits is only a tracking number if something nearby says so.
// Model-only extraction confidently labels random alphanumerics as parcels.

type TPattern = { carrier: string; re: RegExp };

/**
 * Formats no other kind of number shares, so a match is a match on sight.
 * UPS's 1Z, USPS's 92-95 prefixed 22-digit codes, DHL's JJD express numbers,
 * and the UPU's S10 international form (two letters, nine digits, a country).
 *
 * Only 1Z names a carrier, because only 1Z can be one: UPS allocates them and
 * nobody else prints them. The others say who printed the label, not who has
 * the parcel. A 92-prefixed code is an IMpb barcode, which rides on FedEx
 * SmartPost, UPS SurePost and Amazon labels as readily as on USPS's own; a JJD
 * number reaches most people on a marketplace parcel handed to whichever local
 * carrier delivers that street. So the shape is what makes it a tracking
 * number, and the words around it are the only thing that says whose.
 */
const STRONG: TPattern[] = [
  { carrier: "ups", re: /\b1Z[0-9A-Z]{16}\b/gi },
  { carrier: "", re: /\b9[2-5]\d{20}\b/g },
  { carrier: "", re: /\bJJD\d{15,20}\b/gi },
  { carrier: "", re: /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g },
];

/** Digit-only formats: FedEx and friends. A bare number is not evidence. */
const WEAK = /\b(?:\d{12}|\d{15}|\d{20})\b/g;

/** How far before a weak match we look for something calling it a parcel. */
const CONTEXT_CHARS = 80;

const CARRIER_WORD =
  /\b(tracking|track|tracked|shipment|shipping|parcel|package|waybill|awb|consignment|kargo|takip)\b/i;

const CARRIER_NAME =
  /\b(fedex|ups|usps|dhl|gls|dpd|hermes|royal ?mail|tnt|aramex|yurti[çc]i|aras|ptt|mng|sendeo)\b/gi;

/** What can vouch for a match: the text immediately before it. */
function context(text: string, index: number): string {
  return text.slice(Math.max(0, index - CONTEXT_CHARS), index);
}

/**
 * The carrier that stretch of text names, folded to its key, or "" when it
 * names none. The last one, not the first: in "the DHL one arrived, it's the
 * FedEx parcel 123456789012 that is lost" only the nearest is the subject.
 */
function carrierIn(before: string): string {
  const named = [...before.matchAll(CARRIER_NAME)].at(-1);
  return named ? named[0].toLowerCase().replace(/\s/g, "") : "";
}

const TRACK_URL: Record<string, (n: string) => string> = {
  ups: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  dhl: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}`,
};

/**
 * A carrier as it spells itself.
 *
 * Everything upstream writes the carrier lowercased, because it is a key: the
 * matcher folds what it found, the model is asked for "ups, fedex, dhl, usps",
 * and the card looks the name up by it. Keys are not names, and the shortest
 * way from one to the other used to be `toUpperCase()`, which is right for the
 * four initialisms and turns FedEx into FEDEX, Hermes into HERMES and Yurtiçi
 * into YURTIÇI. So the ones that are words are spelled out, and anything
 * unknown is title-cased, the better guess for a carrier nobody listed here.
 */
const CARRIER_NAMES: Record<string, string> = {
  ups: "UPS",
  usps: "USPS",
  dhl: "DHL",
  fedex: "FedEx",
  gls: "GLS",
  dpd: "DPD",
  tnt: "TNT",
  ptt: "PTT",
  mng: "MNG",
  aras: "Aras",
  hermes: "Hermes",
  aramex: "Aramex",
  sendeo: "Sendeo",
  royalmail: "Royal Mail",
  "royal mail": "Royal Mail",
  yurtici: "Yurtiçi",
  yurtiçi: "Yurtiçi",
};

export function carrierName(carrier: string): string {
  const key = carrier.trim().toLowerCase();
  if (!key) return "";
  return (
    CARRIER_NAMES[key] ?? key.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap, c) => gap + c.toUpperCase())
  );
}

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

export const trackingBehaviour: TEntityBehaviour = {
  match(text) {
    const found: TEntityCandidate[] = [];
    const seen = new Set<string>();
    const add = (value: string, carrier: string, index: number) => {
      const key = value.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ value, data: carrier ? { number: value, carrier } : { number: value }, index });
    };

    for (const { carrier, re } of STRONG) {
      for (const m of text.matchAll(re)) {
        add(m[0], carrier || carrierIn(context(text, m.index)), m.index);
      }
    }
    for (const m of text.matchAll(WEAK)) {
      const before = context(text, m.index);
      const carrier = carrierIn(before);
      if (!carrier && !CARRIER_WORD.test(before)) continue;
      add(m[0], carrier, m.index);
    }
    return found;
  },
  normalize(value, data) {
    const number = (typeof data.number === "string" && data.number ? data.number : value)
      .replace(/[\s-]/g, "")
      .toUpperCase();
    // The number alone. The carrier was part of the key until it turned out to
    // be the field the two extractors most often differ on: the pre-pass reads
    // a format, the model reads the words, and either is right to say nothing.
    // Keyed together, one parcel came back as two things, "DHL JJD0002…" and
    // "JJD0002…, carrier unknown", one above the other in the same message.
    // The number is the parcel; the carrier is something learned about it.
    return number || null;
  },
  title(value, data) {
    const carrier = typeof data.carrier === "string" ? carrierName(data.carrier) : "";
    return carrier ? `${carrier} ${value}` : value;
  },
};
