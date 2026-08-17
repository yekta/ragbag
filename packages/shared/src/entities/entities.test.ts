import { describe, expect, it } from "vitest";
import {
  ENTITY_DEFINITIONS,
  entityDefinition,
  matchEntities,
  normalizeEntity,
  parseEntityData,
  snippetAround,
} from "./index.js";
import { addressQuery, mapsSearchUrl } from "./address.js";
import { trackingUrl } from "./tracking.js";

describe("the registry", () => {
  it("has a unique kind per entry and a data schema on each", () => {
    const kinds = ENTITY_DEFINITIONS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const def of ENTITY_DEFINITIONS) {
      expect(def.label).toBeTruthy();
      expect(def.promptHint).toBeTruthy();
      expect(def.data).toBeTruthy();
    }
  });

  it("treats a kind it has never heard of as data, not an error", () => {
    expect(entityDefinition("iban")).toBeUndefined();
    expect(parseEntityData("iban", { label: "IBAN" })).toBeNull();
    expect(normalizeEntity("iban", "TR33", {})).toBeNull();
  });
});

describe("link", () => {
  it("finds urls and leaves the sentence's punctuation behind", () => {
    const text = "see https://example.com/a?utm_source=x, and (https://b.example.com/docs).";
    const found = matchEntities(text).filter((c) => c.kind === "link");
    expect(found.map((c) => c.value)).toEqual([
      "https://example.com/a?utm_source=x",
      "https://b.example.com/docs",
    ]);
  });

  it("normalizes tracking params away so one link is one entity", () => {
    expect(normalizeEntity("link", "https://example.com/a?utm_source=x", {})).toBe(
      "https://example.com/a",
    );
  });
});

describe("tracking", () => {
  it("finds the unmistakable carrier formats on sight", () => {
    const found = matchEntities("parcel 1Z999AA10123456784 arriving thursday");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "tracking", value: "1Z999AA10123456784" });
    expect(found[0]!.data).toMatchObject({ carrier: "ups" });
  });

  it("needs context before it calls a bare run of digits a parcel", () => {
    expect(matchEntities("order 123456789012 confirmed")).toHaveLength(0);
    const withContext = matchEntities("fedex tracking 123456789012");
    expect(withContext).toHaveLength(1);
    expect(withContext[0]!.data).toMatchObject({ carrier: "fedex" });
  });

  it("keys on carrier and number, so the same digits at two carriers stay apart", () => {
    expect(normalizeEntity("tracking", "1Z999AA1 0123456784", { carrier: "UPS" })).toBe(
      "ups:1Z999AA10123456784",
    );
    expect(normalizeEntity("tracking", "123456789012", {})).toBe("?:123456789012");
  });

  it("has somewhere to send you even for a carrier it does not know", () => {
    expect(trackingUrl("ups", "1Z999")).toContain("ups.com");
    expect(trackingUrl("", "1Z999")).toContain("google.com/search");
  });
});

describe("email and phone", () => {
  it("finds an address and folds its case", () => {
    const found = matchEntities("mail Ada.Lovelace@Example.COM about it");
    expect(found[0]).toMatchObject({ kind: "email", value: "Ada.Lovelace@Example.COM" });
    expect(normalizeEntity("email", "Ada.Lovelace@Example.COM", {})).toBe(
      "ada.lovelace@example.com",
    );
  });

  it("only fires on a phone number that is unambiguous on sight", () => {
    expect(matchEntities("call +90 532 123 45 67").some((c) => c.kind === "phone")).toBe(true);
    // A bare run of digits with spaces is left to the model.
    expect(matchEntities("meeting 2026 08 17 at ten").some((c) => c.kind === "phone")).toBe(false);
  });

  it("keeps a local number out of the international bucket", () => {
    expect(normalizeEntity("phone", "+90 532 123 45 67", {})).toBe("+905321234567");
    expect(normalizeEntity("phone", "(0532) 123 45 67", {})).toBe("05321234567");
  });
});

describe("invoice", () => {
  it("is the same bill when the vendor and the invoice number agree", () => {
    expect(normalizeEntity("invoice", "Acme 42", { vendor: "Acme", number: "INV-9" })).toBe(
      "acme|#inv-9",
    );
  });

  it("refuses to guess when there is not enough to key on", () => {
    expect(normalizeEntity("invoice", "Acme", { vendor: "Acme" })).toBeNull();
    expect(normalizeEntity("invoice", "something", {})).toBeNull();
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
    const a = normalizeEntity("address", "Karl-Marx-Allee 90,\n10243 Berlin", {});
    const b = normalizeEntity("address", "karl-marx-allee 90 10243 berlin", {});
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
