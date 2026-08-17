import { z } from "zod";
import type { EntityDefinition } from "./types.js";

// The escape hatch, and the growth path (plan §3.3). The model never invents
// a kind: anything it recognises that is not in the registry comes back as
// `other` with a free-form label in data. When two hundred of them come back
// labelled "IBAN", promoting it is one registry entry plus
//
//   update entities set kind = 'iban' where kind = 'other' and data->>'label' = 'IBAN'
//
// which is a data change, not a schema change. The rail row appears on its
// own, because rows hide at count zero.

export const otherEntity: EntityDefinition = {
  kind: "other",
  label: "Other",
  plural: "Other things",
  slug: "other",
  icon: "sparkles",
  // No rail row: `other` is a bucket, not a category. Its members show on the
  // messages that mention them, as a labelled chip.
  railRow: false,
  promptHint:
    "Anything else worth pulling out that none of the kinds above covers. Put what you would " +
    "have called the kind in data.label (a short noun phrase: 'IBAN', 'Flight number').",
  data: z.object({
    label: z.string(),
    detail: z.string().optional(),
  }),
  normalize(value, data) {
    const label = typeof data.label === "string" ? data.label.trim().toLowerCase() : "";
    const key = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!label || !key) return null;
    return `${label}|${key}`;
  },
  title(value, data) {
    const label = typeof data.label === "string" ? data.label : "";
    return label ? `${label}: ${value}` : value;
  },
};
