import type { TEntityBehaviour, TEntityCandidate } from "./types.js";

// Phone numbers have a signature, but a loose one: any run of digits with
// spaces in it looks like a number. So the matcher only fires on the two
// shapes that are unambiguous on sight (a leading `+`, or an area code in
// brackets) and leaves the rest to the model, which has the sentence around
// it to go on.

const INTERNATIONAL = /(?<![\w+])\+\d[\d\s().-]{6,20}\d/g;
const BRACKETED = /(?<![\w+])\(\d{2,5}\)[\s.-]?\d[\d\s.-]{4,15}\d/g;

const MIN_DIGITS = 7;
const MAX_DIGITS = 15; // E.164's ceiling

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export const phoneBehaviour: TEntityBehaviour = {
  match(text) {
    const found: TEntityCandidate[] = [];
    const seen = new Set<string>();
    for (const re of [INTERNATIONAL, BRACKETED]) {
      for (const m of text.matchAll(re)) {
        const value = m[0].trim();
        const digits = digitsOf(value);
        if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) continue;
        if (seen.has(digits)) continue;
        seen.add(digits);
        found.push({ value, data: { number: value }, index: m.index });
      }
    }
    return found;
  },
  normalize(value, data) {
    const raw = (typeof data.number === "string" && data.number ? data.number : value).trim();
    const digits = digitsOf(raw);
    if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
    // A number without a country code cannot be resolved to one without
    // guessing where its owner lives, so it keeps its own key. That is a
    // missed merge rather than a wrong one, which is the trade this app makes
    // everywhere (plan §5.5).
    return raw.startsWith("+") ? `+${digits}` : digits;
  },
  title(value, data) {
    return typeof data.name === "string" && data.name ? data.name : value;
  },
};
