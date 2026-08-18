import { addressBehaviour } from "./address.js";
import { emailBehaviour } from "./email.js";
import { ibanBehaviour } from "./iban.js";
import { invoiceBehaviour } from "./invoice.js";
import { linkBehaviour } from "./link.js";
import { phoneBehaviour } from "./phone.js";
import { trackingBehaviour } from "./tracking.js";
import type { EntityBehaviour } from "./types.js";

// The code half of a type, keyed by the string in `entities.kind`.
//
// Types are rows a user owns, so the definition of `link` can be renamed,
// disabled or deleted like any other. What cannot move into a row is the URL
// matcher, the dedupe that strips tracking params, the carrier patterns, the
// rule that says two invoices are the same bill. Those stay here and attach by
// name while the row compiles (registry.ts), which means a `link` row behaves
// exactly like the built-in kind it replaces, and a row with no entry here is a
// plain declared type: fields, a card, a sidebar row, a page, search.
//
// Code beats data (plan §10.3): a kind with a `normalize` here ignores its
// rows' `key_rank` entirely, and a row cannot turn any of this off.

export const BEHAVIOURS: Readonly<Record<string, EntityBehaviour>> = {
  link: linkBehaviour,
  tracking: trackingBehaviour,
  address: addressBehaviour,
  phone: phoneBehaviour,
  email: emailBehaviour,
  invoice: invoiceBehaviour,
  iban: ibanBehaviour,
};

/**
 * The kinds that carry behaviour. A user-created type may not land on one of
 * these by accident (plan §10.2): `entityType.create` derives a kind from the
 * label and suffixes it when it would collide, so the only way to get `link` is
 * to install it from the catalog.
 */
export const BEHAVIOUR_KINDS: readonly string[] = Object.keys(BEHAVIOURS);

/** Does this build understand this kind itself? Settings says so out loud. */
export function hasBehaviour(kind: string): boolean {
  return kind in BEHAVIOURS;
}
