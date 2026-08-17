import { describe, expect, it } from "vitest";
import { Synthesis, buildSynthesisPrompt } from "./synthesis.js";

const sources = [
  { attachmentId: null, index: 0, label: "what the owner wrote", text: "parcel arriving thursday" },
  {
    attachmentId: "a1",
    index: 1,
    label: "invoice.pdf",
    text: "## Page 1\n\nAcme Ltd · total 42.00 EUR",
  },
];

describe("buildSynthesisPrompt", () => {
  it("shows every registry kind with its hint and the exact shape of its data", () => {
    const prompt = buildSynthesisPrompt({ sources, candidates: [], existingTopics: [] });
    for (const kind of ["link", "address", "tracking", "invoice", "email", "phone", "other"]) {
      expect(prompt).toContain(`- ${kind}: `);
    }
    // The registry's own zod schema is what validates the answer, so it is
    // what the model is shown: one source of truth for the shape.
    expect(prompt).toContain('"carrier"');
    expect(prompt).toContain('"vendor"');
  });

  it("hands the pre-pass's candidates over to be confirmed, corrected or rejected", () => {
    const prompt = buildSynthesisPrompt({
      sources,
      candidates: [{ kind: "tracking", value: "1Z999AA10123456784" }],
      existingTopics: [],
    });
    expect(prompt).toContain("Confirm, correct or reject");
    expect(prompt).toContain("- tracking: 1Z999AA10123456784");
  });

  it("labels each source so a mention can say which file it came from", () => {
    const prompt = buildSynthesisPrompt({ sources, candidates: [], existingTopics: [] });
    expect(prompt).toContain("[0] what the owner wrote");
    expect(prompt).toContain("[1] invoice.pdf");
  });

  it("feeds the owner's existing vocabulary so tags converge", () => {
    const prompt = buildSynthesisPrompt({
      sources,
      candidates: [],
      existingTopics: ["parcels", "invoices"],
    });
    expect(prompt).toContain("parcels, invoices");
  });

  it("bounds what one message can cost, however much was dumped", () => {
    const huge = [{ ...sources[0]!, text: "x".repeat(500_000) }];
    const prompt = buildSynthesisPrompt({ sources: huge, candidates: [], existingTopics: [] });
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

  it("accepts a well-formed answer", () => {
    expect(Synthesis.safeParse(good).success).toBe(true);
  });

  it("refuses a kind the registry has never heard of", () => {
    const invented = { ...good.entities[0]!, kind: "iban" };
    expect(Synthesis.safeParse({ ...good, entities: [invented] }).success).toBe(false);
  });

  it("requires every field, because strict structured outputs do", () => {
    const { summary: _omitted, ...missing } = good;
    expect(Synthesis.safeParse(missing).success).toBe(false);
  });
});
