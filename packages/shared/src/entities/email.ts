import type { TEntityBehaviour, TEntityCandidate } from "./types.js";

const EMAIL_RE =
  /\b[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z]{2,})+/g;

export const emailBehaviour: TEntityBehaviour = {
  match(text) {
    const found: TEntityCandidate[] = [];
    for (const m of text.matchAll(EMAIL_RE)) {
      found.push({ value: m[0], data: { address: m[0] }, index: m.index });
    }
    return found;
  },
  normalize(value, data) {
    const address = (
      typeof data.address === "string" && data.address ? data.address : value
    ).trim();
    const at = address.lastIndexOf("@");
    if (at <= 0 || at === address.length - 1) return null;
    // The local part is case-sensitive by the RFC and case-insensitive at
    // every mail host anyone actually uses; folding it is the merge people
    // expect. The domain is case-insensitive outright.
    return address.toLowerCase();
  },
  title(value, data) {
    return typeof data.name === "string" && data.name ? data.name : value;
  },
};
