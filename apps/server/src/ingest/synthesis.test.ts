import {
  CATALOG,
  fieldRowsFor,
  resolveEntityTypes,
  typeFromRows,
  typeRowFor,
} from "@ragbag/shared";
import type { EntityTypeFieldRow, EntityTypeRow } from "@ragbag/shared";
import { describe, expect, it } from "vitest";
import { buildSynthesisPrompt, buildSynthesisSchema } from "./synthesis.js";

/** What a job pins for an account that still has the starter set it was seeded. */
const types = resolveEntityTypes(
  CATALOG.map((def) => typeFromRows(typeRowFor(def), fieldRowsFor(def))!),
);
const Synthesis = buildSynthesisSchema(types);

const sources = [
  { attachmentId: null, index: 0, label: "what the owner wrote", text: "parcel arriving thursday" },
  {
    attachmentId: "a1",
    index: 1,
    label: "invoice.pdf",
    text: "## Page 1\n\nAcme Ltd · total 42.00 EUR",
  },
];

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
  version: 4,
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
    name: "sector",
    label: "Sector",
    type: "enum",
    values: ["hvac", "appliance"],
    required: false,
    description: null,
    position: 1,
    keyRank: null,
  },
];

const withBrand = resolveEntityTypes([typeFromRows(brandRow, brandFields)!]);

describe("buildSynthesisPrompt", () => {
  it("shows every pinned kind with its hint and the exact shape of its fields", () => {
    const prompt = buildSynthesisPrompt({ sources, candidates: [], existingTopics: [], types });
    for (const def of CATALOG) {
      expect(prompt).toContain(`- ${def.kind}: `);
    }
    // The field rows are what validate the answer, so they are what the model
    // is shown: one source of truth for the shape, snake_case included.
    expect(prompt).toContain('"carrier"');
    expect(prompt).toContain('"postal_code"');
    expect(prompt).not.toContain("postalCode");
  });

  it("closes the set instead of offering a bucket to invent kinds in", () => {
    const prompt = buildSynthesisPrompt({ sources, candidates: [], existingTopics: [], types });
    expect(prompt).toContain("the complete list");
    expect(prompt).not.toContain("- other:");
  });

  it("offers a declared kind with its vocabulary and its examples", () => {
    const prompt = buildSynthesisPrompt({
      sources,
      candidates: [],
      existingTopics: [],
      types: withBrand,
    });
    expect(prompt).toContain("- brand: A company or product brand");
    expect(prompt).toContain('"enum":["hvac","appliance"]');
    expect(prompt).toContain("For example: Daikin.");
    // The label is what a person calls the field; the model reads it too.
    expect(prompt).toContain('"description":"Brand Name. The brand as written"');
  });

  it("hands the pre-pass's candidates over to be confirmed, corrected or rejected", () => {
    const prompt = buildSynthesisPrompt({
      sources,
      candidates: [{ kind: "tracking", value: "1Z999AA10123456784" }],
      existingTopics: [],
      types,
    });
    expect(prompt).toContain("Confirm, correct or reject");
    expect(prompt).toContain("- tracking: 1Z999AA10123456784");
  });

  it("labels each source so a mention can say which file it came from", () => {
    const prompt = buildSynthesisPrompt({ sources, candidates: [], existingTopics: [], types });
    expect(prompt).toContain("[0] what the owner wrote");
    expect(prompt).toContain("[1] invoice.pdf");
  });

  it("feeds the owner's existing vocabulary so tags converge", () => {
    const prompt = buildSynthesisPrompt({
      sources,
      candidates: [],
      existingTopics: ["parcels", "invoices"],
      types,
    });
    expect(prompt).toContain("parcels, invoices");
  });

  it("bounds what one message can cost, however much was dumped", () => {
    const huge = [{ ...sources[0]!, text: "x".repeat(500_000) }];
    const prompt = buildSynthesisPrompt({
      sources: huge,
      candidates: [],
      existingTopics: [],
      types,
    });
    expect(prompt.length).toBeLessThan(60_000);
  });
});

describe("the Synthesis schema", () => {
  const good = {
    title: "Parcel arriving Thursday",
    summary: "A UPS parcel is due on Thursday, with the invoice attached.",
    lang: "en",
    types: ["invoice"],
    topics: ["parcels", "acme", "shipping"],
    entities: [
      {
        kind: "tracking",
        value: "1Z999AA10123456784",
        data_json: '{"number":"1Z999AA10123456784","carrier":"ups"}',
        confidence: 0.9,
        from_attachment: 0,
        topics: ["parcels"],
      },
    ],
    attachment_topics: [{ index: 1, topics: ["invoice"] }],
  };

  const asKind = (kind: string) => ({ ...good, entities: [{ ...good.entities[0]!, kind }] });

  it("accepts a well-formed answer", () => {
    expect(Synthesis.safeParse(good).success).toBe(true);
  });

  it("refuses a kind the pinned set does not carry", () => {
    // Including the escape hatch that used to let the model coin one.
    expect(Synthesis.safeParse(asKind("other")).success).toBe(false);
    expect(Synthesis.safeParse(asKind("brand")).success).toBe(false);
  });

  it("accepts a kind once the set carries it", () => {
    expect(Synthesis.safeParse(asKind("iban")).success).toBe(true);
    expect(buildSynthesisSchema(withBrand).safeParse(asKind("brand")).success).toBe(true);
  });

  it("still titles and summarizes for a user who has deleted every type", () => {
    const empty = buildSynthesisSchema(resolveEntityTypes([]));
    expect(empty.safeParse({ ...good, entities: [] }).success).toBe(true);
    // With nothing declared there is no kind to answer with, and nothing that
    // could be written if the model tried.
    expect(empty.safeParse(good).success).toBe(false);
  });

  it("requires every field, because strict structured outputs do", () => {
    const { summary: _omitted, ...missing } = good;
    expect(Synthesis.safeParse(missing).success).toBe(false);
  });
});
