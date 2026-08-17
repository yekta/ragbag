import { field } from "./fields.js";
import type { EntityTypeDef } from "./types.js";

// The ready-made types this build ships.
//
// Two jobs, one list: it is what a new account is seeded with (copied, so a
// later release editing an entry does not reach back into anyone's archive),
// and it is the list "add a type" offers in settings, which is also how a user
// gets one back after deleting it.
//
// Six of these were kinds in code until v3. They are rows now because a user
// cannot delete something that only exists in code; what stayed behind is their
// behaviour, attached by kind name (behaviours.ts). A catalog entry is
// therefore a plain definition, whether or not code recognises its kind.
//
// Why eight and not fifty: every type in a user's set is printed into the
// synthesis prompt with its JSON Schema, which is roughly 700 to 900 tokens for
// these. That cost is per message, and it is what makes deleting a type a real
// lever rather than housekeeping.
//
// Nothing here is a secret (plan §10.6). The archive syncs in full to every
// device and sits unencrypted in each browser's IndexedDB. An IBAN is a routing
// number people publish on invoices; a password, a card number, a national id
// or a health record is not, and the catalog will never ship one.

const link: EntityTypeDef = {
  kind: "link",
  label: "Link",
  plural: "Links",
  slug: "links",
  icon: "link",
  railRow: true,
  promptHint: "A web address worth keeping, with the page it points at.",
  // Only `url` is really the model's to fill: everything below it is what the
  // page fetcher writes during enrichment (server synthesis.ts). They are
  // declared anyway because they are what the card and Details render, which is
  // also why this type's fields are not editable in settings (plan §9.1).
  fields: [
    field("url", "url", { required: true, description: "The address itself, as it appears" }),
    field("title", "text"),
    field("description", "longtext"),
    field("site_name", "text", { label: "Site" }),
    field("image_url", "url", { label: "Preview Image" }),
    field("favicon_url", "url", { label: "Favicon" }),
    field("lang", "text", { label: "Language" }),
    field("is_video", "bool", { label: "Video" }),
  ],
};

const tracking: EntityTypeDef = {
  kind: "tracking",
  label: "Tracking Number",
  plural: "Tracking Numbers",
  slug: "tracking",
  icon: "package",
  railRow: true,
  promptHint:
    "A parcel tracking number, with its carrier if identifiable. Never invent one from a " +
    "random alphanumeric: an order number or a reference code is not a tracking number.",
  fields: [
    field("number", "text", { label: "Tracking No", required: true }),
    field("carrier", "text", { description: "The carrier, lowercased: ups, fedex, dhl, usps" }),
    field("status", "text", { description: "Only what the text itself says about it" }),
  ],
};

const address: EntityTypeDef = {
  kind: "address",
  label: "Address",
  plural: "Addresses",
  slug: "addresses",
  icon: "address",
  railRow: true,
  promptHint:
    "A postal address or a place to go. `value` is the address as written; put the parts you " +
    "are sure of in data and leave the rest out.",
  // One name field, not two. Two fields that could each hold a name is how the
  // same address gets stored twice, and the description is wide enough to cover
  // "Ayşe's flat" as well as "Chapter White City".
  fields: [
    field("name", "text", { description: "The place or person this address belongs to" }),
    field("formatted", "longtext", {
      label: "Address",
      description: "The address as written, on one line",
    }),
    field("street", "text"),
    field("locality", "text", { label: "City" }),
    field("region", "text"),
    field("postal_code", "text"),
    field("country", "text"),
  ],
};

const phone: EntityTypeDef = {
  kind: "phone",
  label: "Phone Number",
  plural: "Phone Numbers",
  slug: "phones",
  icon: "phone",
  railRow: true,
  promptHint: "A phone number, with whose it is when the text says.",
  fields: [
    field("number", "text", { required: true }),
    field("name", "text", { description: "Whose number it is, when the text says" }),
    field("country", "text", { description: "ISO country code, only if it is certain" }),
  ],
};

const email: EntityTypeDef = {
  kind: "email",
  label: "Email",
  plural: "Email Addresses",
  slug: "emails",
  icon: "mail",
  railRow: true,
  promptHint: "An email address, with whose it is when the text says.",
  fields: [
    field("address", "text", { label: "Email", required: true }),
    field("name", "text", { description: "Whose address it is, when the text says" }),
    field("role", "text", { description: "What they do, when the text says" }),
  ],
};

const invoice: EntityTypeDef = {
  kind: "invoice",
  label: "Invoice",
  plural: "Invoices",
  slug: "invoices",
  icon: "receipt",
  railRow: true,
  promptHint:
    "A bill, receipt or invoice. `value` is how a person would refer to it (vendor plus " +
    "amount, say); put the vendor, the total and the date in data.",
  fields: [
    field("vendor", "text", { required: true, description: "Who issued it" }),
    field("number", "text", { label: "Invoice No" }),
    field("amount", "number", { label: "Total", description: "The total, as a number" }),
    field("currency", "text", { description: "ISO code: EUR, USD, TRY" }),
    field("issued_at", "date"),
    field("due_at", "date"),
  ],
};

const iban: EntityTypeDef = {
  kind: "iban",
  label: "IBAN",
  plural: "IBANs",
  slug: "ibans",
  icon: "bank",
  railRow: true,
  promptHint:
    "A bank account number in IBAN form, as sent to be paid into. Write it without spaces.",
  titleTemplate: "{iban}",
  fields: [
    field("iban", "text", { label: "IBAN", required: true }),
    field("holder", "text", { label: "Account Name" }),
    field("bank", "text"),
  ],
  // Recorded, then ignored: this kind has a normalizer in code, which strips
  // spacing the generic one would keep (behaviours.ts).
  keyFields: ["iban"],
};

const book: EntityTypeDef = {
  kind: "book",
  label: "Book",
  plural: "Books",
  slug: "books",
  icon: "book",
  railRow: true,
  promptHint:
    "A book someone recommended or referred to, with its author. Not the document you are " +
    "reading: the book it talks about.",
  titleTemplate: "{title}",
  fields: [
    field("title", "text", { required: true }),
    field("author", "text"),
    field("isbn", "text"),
    field("why", "longtext", {
      description: "Why it was recommended, in the recommender's words",
    }),
  ],
  // Author is in the key because one archive holds two different books called
  // "Drive". It is the second part, so a book with no author still keys on its
  // title alone: only an empty *first* key field drops the entity (fields.ts).
  keyFields: ["title", "author"],
};

/** In rail order, which is also the order a new account is seeded in. */
export const CATALOG: readonly EntityTypeDef[] = [
  link,
  tracking,
  address,
  phone,
  email,
  invoice,
  iban,
  book,
];

/** In v3 the catalog is the starter set: every entry is seeded (plan §5). */
export const STARTER_SET: readonly EntityTypeDef[] = CATALOG;

export function catalogEntry(kind: string): EntityTypeDef | undefined {
  return CATALOG.find((def) => def.kind === kind);
}
