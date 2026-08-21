import { hasBehaviour } from "./behaviours.js";
import { field } from "./fields.js";
import type { TEntityTypeDef } from "./types.js";

// The ready-made types this build ships.
//
// Two jobs, one list: it is what a new account is seeded with (copied, so a
// later release editing an entry does not reach back into anyone's archive),
// and it is what settings offers under "not looking for", which is how a user
// turns one back on after switching it off or deleting it.
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

const link: TEntityTypeDef = {
  kind: "link",
  label: "Link",
  sidebarTitle: "Links",
  slug: "links",
  icon: "link",
  inSidebar: true,
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

const tracking: TEntityTypeDef = {
  kind: "tracking",
  label: "Tracking Number",
  sidebarTitle: "Tracking Numbers",
  slug: "tracking",
  icon: "package",
  inSidebar: true,
  promptHint:
    "A parcel tracking number. Name the carrier only when the text says who it is: the shape " +
    "of a number tells you who printed the label, not who has the parcel. An order number or " +
    "a reference code is not a tracking number, so never make one out of a random string of " +
    "characters.",
  fields: [
    field("number", "text", { label: "Tracking No", required: true }),
    field("carrier", "text", {
      description: "Lowercased (ups, fedex, dhl, usps), and only when the text names it",
    }),
    field("status", "text", { description: "Only what the text itself says about it" }),
  ],
};

const address: TEntityTypeDef = {
  kind: "address",
  label: "Address",
  sidebarTitle: "Addresses",
  slug: "addresses",
  icon: "address",
  inSidebar: true,
  promptHint: "A postal address or a place to go, kept exactly as it was written.",
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

const phone: TEntityTypeDef = {
  kind: "phone",
  label: "Phone Number",
  sidebarTitle: "Phone Numbers",
  slug: "phones",
  icon: "phone",
  inSidebar: true,
  promptHint: "A phone number, with whose it is when the text says.",
  fields: [
    field("number", "text", { required: true }),
    field("name", "text", { description: "Whose number it is, when the text says" }),
    field("country", "text", { description: "ISO country code, only if it is certain" }),
  ],
};

const email: TEntityTypeDef = {
  kind: "email",
  label: "Email",
  sidebarTitle: "Email Addresses",
  slug: "emails",
  icon: "mail",
  inSidebar: true,
  promptHint: "An email address, with whose it is when the text says.",
  fields: [
    field("address", "text", { label: "Email", required: true }),
    field("name", "text", { description: "Whose address it is, when the text says" }),
    field("role", "text", { description: "What they do, when the text says" }),
  ],
};

const invoice: TEntityTypeDef = {
  kind: "invoice",
  label: "Invoice",
  sidebarTitle: "Invoices",
  slug: "invoices",
  icon: "receipt",
  inSidebar: true,
  promptHint: "A bill, receipt or invoice: who issued it, what it came to, and when.",
  fields: [
    field("vendor", "text", { required: true, description: "Who issued it" }),
    field("number", "text", { label: "Invoice No" }),
    field("amount", "number", { label: "Total", description: "The total, as a number" }),
    field("currency", "text", { description: "ISO code: EUR, USD, TRY" }),
    field("issued_at", "date"),
    field("due_at", "date"),
  ],
};

const iban: TEntityTypeDef = {
  kind: "iban",
  label: "IBAN",
  sidebarTitle: "IBANs",
  slug: "ibans",
  icon: "bank",
  inSidebar: true,
  promptHint: "A bank account number in IBAN form, the kind people send to be paid into.",
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

const book: TEntityTypeDef = {
  kind: "book",
  label: "Book",
  sidebarTitle: "Books",
  slug: "books",
  icon: "book",
  inSidebar: true,
  promptHint:
    "A book someone recommended or referred to, with its author. Not the document itself: " +
    "the book it talks about.",
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

/** In sidebar order, which is also the order a new account is seeded in. */
export const CATALOG: readonly TEntityTypeDef[] = [
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
export const STARTER_SET: readonly TEntityTypeDef[] = CATALOG;

export function catalogEntry(kind: string): TEntityTypeDef | undefined {
  return CATALOG.find((def) => def.kind === kind);
}

/** One entry of the list settings shows, whether or not it has a row yet. */
export type TTypeChoice = {
  /** Absent for a catalog entry this user has never turned on. */
  id?: string;
  kind: string;
  sidebarTitle: string;
  icon: string;
  hint: string;
  /** True when this build understands the kind itself (behaviours.ts). */
  understood: boolean;
  /** 'catalog' for one of ours, 'user' for one they made. */
  origin: "catalog" | "user";
  /** Whether this one is being pulled out of what arrives. */
  enabled: boolean;
};

/** What settings needs off a row to list it. */
export type TTypeChoiceRow = {
  id: string;
  kind: string;
  sidebarTitle: string;
  icon: string;
  hint: string;
  enabled: boolean;
  origin: string;
};

/**
 * The list settings is made of: everything that can be found, each carrying
 * whether it is being found.
 *
 * One list rather than two, because the second one was three states pretending
 * to be a place: a type switched off, one of ours never switched on, and one
 * deleted (which puts it back) all landed there, and a person has no reason to
 * tell them apart. Turning any of them on is one tap; whether that is an update
 * or an insert is the mutator's problem, not the screen's.
 */
const byTitle = (a: TTypeChoice, b: TTypeChoice) => a.sidebarTitle.localeCompare(b.sidebarTitle);

const choiceOf = (row: TTypeChoiceRow): TTypeChoice => ({
  id: row.id,
  kind: row.kind,
  sidebarTitle: row.sidebarTitle,
  icon: row.icon,
  hint: row.hint,
  understood: hasBehaviour(row.kind),
  origin: row.origin === "catalog" ? "catalog" : "user",
  enabled: row.enabled,
});

export function typeChoices(
  rows: readonly TTypeChoiceRow[],
  catalog: readonly TEntityTypeDef[] = CATALOG,
): TTypeChoice[] {
  const choices: TTypeChoice[] = [];
  const claimed = new Set<string>();
  for (const row of rows) {
    claimed.add(row.kind);
    choices.push(choiceOf(row));
  }
  for (const def of catalog) {
    if (claimed.has(def.kind)) continue;
    choices.push({
      kind: def.kind,
      sidebarTitle: def.sidebarTitle,
      icon: def.icon,
      hint: def.promptHint,
      understood: hasBehaviour(def.kind),
      origin: "catalog",
      enabled: false,
    });
  }
  return choices.sort(byTitle);
}
