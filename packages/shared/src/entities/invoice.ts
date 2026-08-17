import type { EntityBehaviour } from "./types.js";

// No matcher: "invoice" is a judgment about a document, not a pattern in a
// string. The synthesis pass reads a receipt's extracted text and fills the
// fields in; the normalizer's job is to decide when two of them are the same
// bill, which is more than a list of key fields can say.

export const invoiceBehaviour: EntityBehaviour = {
  normalize(_value, data) {
    const vendor = typeof data.vendor === "string" ? data.vendor.trim().toLowerCase() : "";
    if (!vendor) return null;
    const number = typeof data.number === "string" ? data.number.trim().toLowerCase() : "";
    // An invoice number from the same vendor is the identity, full stop.
    if (number) return `${vendor}|#${number}`;
    // Without one, the same vendor on the same day for the same money is the
    // same bill; anything less than all three stays a separate row rather
    // than swallowing a second purchase from the same shop.
    const amount = typeof data.amount === "number" ? data.amount.toFixed(2) : "";
    const issuedAt = typeof data.issued_at === "string" ? data.issued_at.slice(0, 10) : "";
    if (!amount || !issuedAt) return null;
    const currency = typeof data.currency === "string" ? data.currency.toLowerCase() : "";
    return `${vendor}|${issuedAt}|${amount}${currency}`;
  },
  title(value, data) {
    const vendor = typeof data.vendor === "string" ? data.vendor : "";
    return vendor || value;
  },
};
