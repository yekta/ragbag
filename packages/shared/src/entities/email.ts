import { z } from "zod";
import type { EntityCandidate, EntityDefinition } from "./types.js";

const EMAIL_RE =
  /\b[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z]{2,})+/g;

export const emailEntity: EntityDefinition = {
  kind: "email",
  label: "Email",
  plural: "Email addresses",
  slug: "emails",
  icon: "mail",
  railRow: true,
  promptHint: "An email address, with whose it is when the text says.",
  data: z.object({
    address: z.string(),
    name: z.string().optional(),
    role: z.string().optional(),
  }),
  match(text) {
    const found: EntityCandidate[] = [];
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
