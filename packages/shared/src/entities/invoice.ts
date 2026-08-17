import { z } from "zod";
import type { EntityDefinition } from "./types.js";

// No matcher: "invoice" is a judgment about a document, not a pattern in a
// string. The synthesis pass reads a receipt's extracted text and fills these
// in; the normalizer's job is to decide when two of them are the same bill.

export const invoiceEntity: EntityDefinition = {
  kind: "invoice",
  label: "Invoice",
  plural: "Invoices",
  slug: "invoices",
  icon: "receipt",
  railRow: true,
  promptHint:
    "A bill, receipt or invoice. `value` is how a person would refer to it (vendor plus " +
    "amount, say); put the vendor, the total and the date in data.",
  data: z.object({
    vendor: z.string(),
    number: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    issuedAt: z.string().optional(),
    dueAt: z.string().optional(),
  }),
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
    const issuedAt = typeof data.issuedAt === "string" ? data.issuedAt.slice(0, 10) : "";
    if (!amount || !issuedAt) return null;
    const currency = typeof data.currency === "string" ? data.currency.toLowerCase() : "";
    return `${vendor}|${issuedAt}|${amount}${currency}`;
  },
  title(value, data) {
    const vendor = typeof data.vendor === "string" ? data.vendor : "";
    return vendor || value;
  },
};
