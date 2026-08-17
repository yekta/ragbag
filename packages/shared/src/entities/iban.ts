import type { EntityBehaviour } from "./types.js";

// The whole of IBAN's behaviour, and the reason it has any: people paste the
// same account both ways, `TR33 0006 1005` and `TR3300061005`, and the generic
// normalizer only folds case and collapses runs of whitespace. Without this
// those are two accounts.

export const ibanBehaviour: EntityBehaviour = {
  normalize(value, data) {
    const raw = typeof data.iban === "string" && data.iban ? data.iban : value;
    return raw.replace(/\s/g, "").toUpperCase() || null;
  },
};
