import { describe, expect, it } from "vitest";
import { addressQuery, mapsSearchUrl } from "./address.js";
import {
  BEHAVIOUR_KINDS,
  carrierName,
  CATALOG,
  catalogEntry,
  dataSchema,
  field,
  fieldEntries,
  fieldRowsFor,
  humanize,
  promptSchema,
  resolveEntityTypes,
  snippetAround,
  trackingUrl,
  typeChoices,
  typeFromRows,
  typeRowFor,
  type EntityTypeDef,
  type EntityTypeFieldRow,
  type EntityTypeRow,
} from "./index.js";

/**
 * The catalog as a user actually gets it: written to the two tables at signup
 * and read back out again. Everything below runs against that round trip rather
 * than against the definitions in code, because rows are the only thing the
 * pipeline and the UI ever see.
 */
function seeded(defs: readonly EntityTypeDef[] = CATALOG) {
  return resolveEntityTypes(defs.map((def) => typeFromRows(typeRowFor(def), fieldRowsFor(def))!));
}

const types = seeded();

// One type a user made up, exactly as its two tables describe it.
const brandRow: EntityTypeRow = {
  kind: "brand",
  label: "Brand",
  sidebarTitle: "Brands",
  slug: "brands",
  icon: "sparkles",
  hint: "A company or product brand the message is about.",
  titleTemplate: "{name}",
  examples: ["Daikin"],
  sidebar: true,
  version: 3,
};

const brandFields: EntityTypeFieldRow[] = [
  {
    name: "name",
    label: "Brand Name",
    type: "text",
    values: null,
    required: true,
    description: "The brand as written",
    position: 0,
    keyRank: 1,
  },
  {
    name: "slogan",
    label: "Tagline",
    type: "text",
    values: null,
    required: false,
    description: null,
    position: 1,
    keyRank: null,
  },
  {
    name: "sector",
    label: "Sector",
    type: "enum",
    values: ["hvac", "appliance"],
    required: false,
    description: null,
    position: 2,
    keyRank: null,
  },
];

function withBrand() {
  const declared = typeFromRows(brandRow, brandFields);
  expect(declared).not.toBeNull();
  return resolveEntityTypes([declared!]);
}

describe("the catalog", () => {
  it("is eight starter types, each one a row that compiles", () => {
    expect(CATALOG).toHaveLength(8);
    expect(types.list.map((t) => t.kind)).toEqual([
      "link",
      "tracking",
      "address",
      "phone",
      "email",
      "invoice",
      "iban",
      "book",
    ]);
    for (const type of types.list) {
      expect(type.label).toBeTruthy();
      expect(type.sidebarTitle).toBeTruthy();
      expect(type.promptHint).toBeTruthy();
      expect(type.fields.length).toBeGreaterThan(0);
      expect(type.fields.every((f) => /^[a-z][a-z0-9_]{0,39}$/.test(f.name))).toBe(true);
    }
  });

  it("claims one kind and one slug each, so nothing can shadow anything", () => {
    expect(new Set(CATALOG.map((d) => d.kind)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((d) => d.slug)).size).toBe(CATALOG.length);
    for (const def of CATALOG) expect(catalogEntry(def.kind)).toBe(def);
  });

  it("has no `other`, so the model has nothing to invent a kind into", () => {
    expect(types.get("other")).toBeUndefined();
    expect(types.kinds).not.toContain("other");
  });

  it("attaches code behaviour to the kinds that have it, by name", () => {
    // A seeded `link` is the kind this build understands itself: the matcher,
    // the dedupe and the title come from code, not from the row.
    expect(types.get("link")!.match).toBeTypeOf("function");
    expect(types.get("book")!.match).toBeUndefined();
    for (const kind of BEHAVIOUR_KINDS) expect(types.get(kind)).toBeDefined();
  });

  it("treats a kind it does not carry as data, not an error", () => {
    const set = seeded(CATALOG.filter((d) => d.kind !== "iban"));
    expect(set.get("iban")).toBeUndefined();
    expect(set.parseData("iban", { iban: "TR33" })).toBeNull();
    expect(set.normalize("iban", "TR33", {})).toBeNull();
    // Enough to render through the generic card rather than a blank.
    expect(set.label("iban")).toBe("IBAN");
    expect(set.icon("iban")).toBe("sparkles");
  });

  it("names its fields in snake_case and labels them in Title Case", () => {
    const address = types.get("address")!;
    expect(address.fields.map((f) => f.name)).toContain("postal_code");
    expect(address.fields.find((f) => f.name === "postal_code")!.label).toBe("Postal Code");
    expect(types.parseData("address", { postal_code: "W12 0DD" })).toEqual({
      postal_code: "W12 0DD",
    });
  });

  it("keeps a disabled type's things readable and stops extracting them", () => {
    const set = seeded(CATALOG.map((d) => (d.kind === "phone" ? { ...d, enabled: false } : d)));
    expect(set.kinds).not.toContain("phone");
    expect(set.sidebar.map((t) => t.kind)).not.toContain("phone");
    expect(set.match("call +90 532 123 45 67").some((c) => c.kind === "phone")).toBe(false);
    // Still the type it was: its label, its fields, its card.
    expect(set.get("phone")!.label).toBe("Phone Number");
    expect(set.fieldEntries("phone", { name: "Ayşe" })[0]!.label).toBe("Name");
  });
});

const row = (over: Partial<Parameters<typeof typeChoices>[0][number]> = {}) => ({
  id: "id-1",
  kind: "link",
  sidebarTitle: "Links",
  icon: "link",
  hint: "hint",
  enabled: true,
  origin: "catalog",
  ...over,
});

describe("the list settings shows", () => {
  it("lists everything that can be found, on or off", () => {
    const choices = typeChoices([
      row(),
      row({ id: "id-2", kind: "book", sidebarTitle: "Books", enabled: false }),
    ]);
    // Every catalog entry is here, whether or not it has a row.
    expect(choices).toHaveLength(CATALOG.length);
    expect(choices.filter((t) => t.enabled).map((t) => t.kind)).toEqual(["link"]);
    expect(choices.find((t) => t.kind === "book")!.enabled).toBe(false);
    expect(choices.find((t) => t.kind === "iban")!.enabled).toBe(false);
  });

  it("does not tell a switched-off type from one never switched on", () => {
    const choices = typeChoices([row({ enabled: false })]);
    const switchedOff = choices.find((t) => t.kind === "link")!;
    const neverOn = choices.find((t) => t.kind === "book")!;
    // One has a row to update, the other has none to install: the only
    // difference, and the screen does not show it.
    expect(switchedOff.id).toBeTruthy();
    expect(neverOn.id).toBeUndefined();
    expect(switchedOff.enabled).toBe(false);
    expect(neverOn.enabled).toBe(false);
    expect(switchedOff.understood).toBe(true);
    expect(neverOn.understood).toBe(false);
  });

  it("keeps a type the catalog has never heard of, and sorts by title", () => {
    const choices = typeChoices(
      [
        row({ id: "id-3", kind: "trading_card", sidebarTitle: "Trading Cards", origin: "user" }),
        row(),
      ],
      [],
    );
    expect(choices.map((t) => t.sidebarTitle)).toEqual(["Links", "Trading Cards"]);
    expect(choices[1]!.origin).toBe("user");
  });
});

describe("user-declared types", () => {
  it("compiles rows into a type the model can be asked for", () => {
    const set = withBrand();
    const brand = set.get("brand")!;
    expect(brand.version).toBe(3);
    expect(set.kinds).toContain("brand");
    expect(set.sidebar.map((t) => t.slug)).toContain("brands");
    expect(set.bySlug("brands")!.kind).toBe("brand");
    expect(brand.fields.map((f) => f.label)).toEqual(["Brand Name", "Tagline", "Sector"]);
  });

  it("validates against the fields, keeping only what they declare", () => {
    const set = withBrand();
    expect(set.parseData("brand", { name: "Daikin", sector: "hvac", junk: 1 })).toEqual({
      name: "Daikin",
      sector: "hvac",
    });
    // A required field missing drops the entity: no card can render it.
    expect(set.parseData("brand", { slogan: "Doğru Hava Uzmanı" })).toBeNull();
    // A value outside an optional enum's vocabulary costs the field only.
    expect(set.parseData("brand", { name: "Daikin", sector: "space travel" })).toEqual({
      name: "Daikin",
    });
  });

  it("keys on the fields key_rank names, and drops what it cannot key", () => {
    const set = withBrand();
    expect(set.normalize("brand", "DAIKIN", { name: "  Daikin " })).toBe("daikin");
    expect(set.normalize("brand", "DAIKIN", {})).toBeNull();
  });

  it("titles from the template, falling back to the value", () => {
    const set = withBrand();
    expect(set.title("brand", "DAIKIN", { name: "Daikin" })).toBe("Daikin");
    expect(set.title("brand", "DAIKIN", {})).toBe("DAIKIN");
  });

  it("refuses rows it cannot make sense of rather than half-compiling them", () => {
    expect(typeFromRows(brandRow, [{ ...brandFields[0]!, type: "geometry" }])).toBeNull();
    expect(typeFromRows(brandRow, [{ ...brandFields[2]!, values: [] }])).toBeNull();
  });

  it("takes a type with no details at all: the thing is its own value", () => {
    const bare = typeFromRows({ ...brandRow, titleTemplate: null }, []);
    expect(bare).not.toBeNull();
    const set = resolveEntityTypes([bare!]);
    expect(set.kinds).toContain("brand");
    expect(set.parseData("brand", { anything: 1 })).toEqual({});
    // Nothing to key on but the value itself, which is the right answer here.
    expect(set.normalize("brand", "  Daikin ", {})).toBe("daikin");
    expect(set.title("brand", "Daikin", {})).toBe("Daikin");
  });

  it("lets code beat data: a row cannot turn a kind's behaviour off", () => {
    // Same fields, but claiming `link`. The URL matcher and the dedupe that
    // strips tracking params come with the kind, whatever the row says.
    const shadow = typeFromRows({ ...brandRow, kind: "link", slug: "link" }, brandFields)!;
    const set = resolveEntityTypes([shadow]);
    expect(set.get("link")!.label).toBe("Brand");
    expect(set.get("link")!.match).toBeTypeOf("function");
    expect(set.normalize("link", "https://example.com/a?utm_source=x", {})).toBe(
      "https://example.com/a",
    );
  });
});

describe("field helpers", () => {
  it("humanizes a snake_case name, acronyms included", () => {
    expect(humanize("postal_code")).toBe("Postal Code");
    expect(humanize("favicon_url")).toBe("Favicon URL");
    expect(humanize("name")).toBe("Name");
  });

  it("defaults a field's label from its name", () => {
    expect(field("issued_at", "date").label).toBe("Issued At");
    expect(field("number", "text", { label: "Invoice No" }).label).toBe("Invoice No");
  });

  it("shows the model the labels, the vocabulary and what is required", () => {
    const schema = promptSchema([
      field("name", "text", { required: true, description: "as written" }),
      field("sector", "enum", { values: ["hvac", "appliance"] }),
    ]);
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string", description: "Name. as written" },
        sector: { type: "string", enum: ["hvac", "appliance"], description: "Sector" },
      },
      required: ["name"],
    });
  });

  it("renders the filled fields in declared order, then the ones no field claims", () => {
    const fields = [field("name", "text"), field("postal_code", "text")];
    const entries = fieldEntries(fields, {
      postal_code: "W12 0DD",
      name: "Chapter White City",
      old_key: "kept",
      blank: "  ",
    });
    expect(entries).toEqual([
      { name: "name", label: "Name", value: "Chapter White City" },
      { name: "postal_code", label: "Postal Code", value: "W12 0DD" },
      { name: "old_key", label: "Old Key", value: "kept" },
    ]);
  });

  it("keeps booleans and numbers readable", () => {
    const schema = dataSchema([field("is_video", "bool"), field("amount", "number")]);
    expect(schema.safeParse({ is_video: true, amount: 42 }).success).toBe(true);
    expect(fieldEntries([field("is_video", "bool")], { is_video: false })[0]!.value).toBe("No");
  });

  it("puts a type's key fields in rank order and leaves the rest out of it", () => {
    const rows = fieldRowsFor(catalogEntry("book")!);
    expect(rows.map((r) => [r.name, r.position, r.keyRank])).toEqual([
      ["title", 0, 1],
      ["author", 1, 2],
      ["isbn", 2, null],
      ["why", 3, null],
    ]);
  });
});

describe("link", () => {
  it("finds urls and leaves the sentence's punctuation behind", () => {
    const text = "see https://example.com/a?utm_source=x, and (https://b.example.com/docs).";
    const found = types.match(text).filter((c) => c.kind === "link");
    expect(found.map((c) => c.value)).toEqual([
      "https://example.com/a?utm_source=x",
      "https://b.example.com/docs",
    ]);
  });

  it("normalizes tracking params away so one link is one entity", () => {
    expect(types.normalize("link", "https://example.com/a?utm_source=x", {})).toBe(
      "https://example.com/a",
    );
  });
});

describe("tracking", () => {
  it("finds the unmistakable carrier formats on sight", () => {
    const found = types.match("parcel 1Z999AA10123456784 arriving thursday");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "tracking", value: "1Z999AA10123456784" });
    expect(found[0]!.data).toMatchObject({ carrier: "ups" });
  });

  it("needs context before it calls a bare run of digits a parcel", () => {
    expect(types.match("order 123456789012 confirmed")).toHaveLength(0);
    const withContext = types.match("fedex tracking 123456789012");
    expect(withContext).toHaveLength(1);
    expect(withContext[0]!.data).toMatchObject({ carrier: "fedex" });
  });

  it("keys on carrier and number, so the same digits at two carriers stay apart", () => {
    expect(types.normalize("tracking", "1Z999AA1 0123456784", { carrier: "UPS" })).toBe(
      "ups:1Z999AA10123456784",
    );
    expect(types.normalize("tracking", "123456789012", {})).toBe("?:123456789012");
  });

  it("has somewhere to send you even for a carrier it does not know", () => {
    expect(trackingUrl("ups", "1Z999")).toContain("ups.com");
    expect(trackingUrl("", "1Z999")).toContain("google.com/search");
  });

  it("spells a carrier the way the carrier does", () => {
    // The stored value is a key, always folded; only the display side differs.
    expect(carrierName("ups")).toBe("UPS");
    expect(carrierName("fedex")).toBe("FedEx");
    expect(carrierName("royal mail")).toBe("Royal Mail");
    // Not in the table, so title case rather than a shout.
    expect(carrierName("evri")).toBe("Evri");
    expect(carrierName("")).toBe("");
    expect(types.title("tracking", "1Z999", { carrier: "fedex" })).toBe("FedEx 1Z999");
  });
});

describe("email and phone", () => {
  it("finds an address and folds its case", () => {
    const found = types.match("mail Ada.Lovelace@Example.COM about it");
    expect(found[0]).toMatchObject({ kind: "email", value: "Ada.Lovelace@Example.COM" });
    expect(types.normalize("email", "Ada.Lovelace@Example.COM", {})).toBe(
      "ada.lovelace@example.com",
    );
  });

  it("only fires on a phone number that is unambiguous on sight", () => {
    expect(types.match("call +90 532 123 45 67").some((c) => c.kind === "phone")).toBe(true);
    // A bare run of digits with spaces is left to the model.
    expect(types.match("meeting 2026 08 17 at ten").some((c) => c.kind === "phone")).toBe(false);
  });

  it("keeps a local number out of the international bucket", () => {
    expect(types.normalize("phone", "+90 532 123 45 67", {})).toBe("+905321234567");
    expect(types.normalize("phone", "(0532) 123 45 67", {})).toBe("05321234567");
  });
});

describe("invoice", () => {
  it("is the same bill when the vendor and the invoice number agree", () => {
    expect(types.normalize("invoice", "Acme 42", { vendor: "Acme", number: "INV-9" })).toBe(
      "acme|#inv-9",
    );
  });

  it("falls back to vendor, day and amount, in snake_case like every field", () => {
    expect(
      types.normalize("invoice", "Acme", {
        vendor: "Acme",
        amount: 42,
        currency: "EUR",
        issued_at: "2026-08-17",
      }),
    ).toBe("acme|2026-08-17|42.00eur");
  });

  it("refuses to guess when there is not enough to key on", () => {
    expect(types.normalize("invoice", "Acme", { vendor: "Acme" })).toBeNull();
    expect(types.normalize("invoice", "something", {})).toBeNull();
  });
});

describe("iban", () => {
  it("is one account however it was pasted", () => {
    const spaced = types.normalize("iban", "TR33 0006 1005 1978 6457 8413 26", {});
    const packed = types.normalize("iban", "tr330006100519786457841326", {});
    expect(spaced).toBe("TR330006100519786457841326");
    expect(packed).toBe(spaced);
  });

  it("titles itself with the number when nothing else named it", () => {
    expect(types.title("iban", "TR33", { iban: "TR33 0006" })).toBe("TR33 0006");
  });
});

describe("book", () => {
  it("keys on title and author, because one archive holds two books called Drive", () => {
    expect(types.normalize("book", "Drive", { title: "Drive", author: "Daniel Pink" })).toBe(
      "drive|daniel pink",
    );
    expect(types.normalize("book", "Drive", { title: "Drive", author: "James Sallis" })).not.toBe(
      types.normalize("book", "Drive", { title: "Drive", author: "Daniel Pink" }),
    );
  });

  it("keys on the title alone when the author was never named", () => {
    expect(types.normalize("book", "Drive", { title: "Drive" })).toBe("drive");
    // Only an empty FIRST key part is fatal: without a title there is no book.
    expect(types.normalize("book", "Drive", { author: "Daniel Pink" })).toBeNull();
  });

  it("is a judgment call, so it has no matcher to make it for free", () => {
    expect(types.get("book")!.match).toBeUndefined();
  });
});

describe("address helpers", () => {
  it("collapses the multi-line form people paste", () => {
    expect(addressQuery("  Karl-Marx-Allee 90\n10243 Berlin\n")).toBe(
      "Karl-Marx-Allee 90 10243 Berlin",
    );
  });

  it("builds an encoded maps search", () => {
    expect(mapsSearchUrl("1600 Amphitheatre Pkwy, Mountain View")).toBe(
      "https://www.google.com/maps/search/?api=1&query=1600%20Amphitheatre%20Pkwy%2C%20Mountain%20View",
    );
  });

  it("has nothing to open for a blank address", () => {
    expect(mapsSearchUrl("   ")).toBeNull();
  });

  it("ignores case and sentence punctuation when deduping", () => {
    const a = types.normalize("address", "Karl-Marx-Allee 90,\n10243 Berlin", {});
    const b = types.normalize("address", "karl-marx-allee 90 10243 berlin", {});
    expect(a).toBe(b);
  });
});

describe("snippetAround", () => {
  it("cuts a one-line caption and marks where it cut", () => {
    const text = `${"a".repeat(200)} 1Z999AA10123456784 ${"b".repeat(200)}`;
    const snippet = snippetAround(text, 201, 18);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("1Z999AA10123456784");
    expect(snippet).not.toContain("\n");
  });
});
