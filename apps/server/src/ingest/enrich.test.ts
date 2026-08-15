import { describe, expect, it } from "vitest";
import { Enrichment, buildEnrichmentPrompt, plannedTags } from "./enrich.js";
import type { EnrichmentResult } from "./enrich.js";

describe("Enrichment schema", () => {
  it("accepts a well-formed enrichment and enforces the tagging rules", () => {
    const good = {
      summary: "A hands-on Rust tutorial about ownership.",
      types: ["blog-post", "tutorial", "code"],
      topics: ["rust", "ownership", "memory-safety"],
      entities: ["Rust"],
      lang: "en",
      suggestedKind: "note",
    };
    expect(Enrichment.safeParse(good).success).toBe(true);
    // At least one type, 3–15 topics (plan §7).
    expect(Enrichment.safeParse({ ...good, types: [] }).success).toBe(false);
    expect(Enrichment.safeParse({ ...good, topics: ["one", "two"] }).success).toBe(false);
    expect(Enrichment.safeParse({ ...good, types: ["not-a-real-type"] }).success).toBe(false);
  });

  it("classifies a dump as a todo or an address, and requires an answer", () => {
    const good = {
      summary: "Pick up the parcel from the depot before Friday.",
      types: ["todo"],
      topics: ["errands", "parcel", "logistics"],
      entities: [],
      lang: "en",
      suggestedKind: "todo",
    };
    expect(Enrichment.safeParse(good).success).toBe(true);
    expect(Enrichment.safeParse({ ...good, suggestedKind: "address" }).success).toBe(true);
    // Structured outputs are strict: the field must be present, and only the
    // three text kinds are promotable.
    expect(Enrichment.safeParse({ ...good, suggestedKind: "link" }).success).toBe(false);
    const { suggestedKind: _omitted, ...missing } = good;
    expect(Enrichment.safeParse(missing).success).toBe(false);
  });
});

describe("buildEnrichmentPrompt", () => {
  const base = {
    kind: "link" as const,
    url: "https://sync.blog/posts/local-first",
    title: "Why local-first software matters",
    siteName: "The Sync Blog",
    description: "Own your data.",
    userText: "read before the offsite",
    extractedText: "Local-first applications keep the primary copy of data on the device.",
    existingTopics: ["sync", "databases", "offline"],
  };

  it("includes the item's content and the owner's comment", () => {
    const prompt = buildEnrichmentPrompt(base);
    expect(prompt).toContain("kind: link");
    expect(prompt).toContain("Why local-first software matters");
    expect(prompt).toContain("read before the offsite");
    expect(prompt).toContain("primary copy of data");
  });

  it("asks for a kind, biased against promoting", () => {
    const prompt = buildEnrichmentPrompt(base);
    expect(prompt).toContain("suggestedKind");
    expect(prompt).toContain("When in doubt, answer 'note'");
  });

  it("feeds the existing topic vocabulary for convergence (plan §7)", () => {
    const prompt = buildEnrichmentPrompt(base);
    expect(prompt).toContain("sync, databases, offline");
  });

  it("marks video links as metadata-only", () => {
    expect(buildEnrichmentPrompt({ ...base, isVideo: true })).toContain("metadata only");
    expect(buildEnrichmentPrompt(base)).not.toContain("metadata only");
  });

  it("truncates giant content to bound per-item cost (plan §7)", () => {
    const prompt = buildEnrichmentPrompt({ ...base, extractedText: "x".repeat(100_000) });
    expect(prompt.length).toBeLessThan(30_000);
  });
});

describe("plannedTags", () => {
  const base: EnrichmentResult = {
    summary: "s",
    types: ["video"],
    topics: ["rust", "ownership", "realkey"],
    entities: ["Rust", "realkey", "Mozilla"],
    lang: "en",
    suggestedKind: "note",
  };

  it("emits one tag per name, most specific kind winning", () => {
    const tags = plannedTags({ ...base, types: ["video", "code"] });
    expect(tags.filter((t) => t.name.toLowerCase() === "rust")).toEqual([
      { kind: "topic", name: "rust" },
    ]);
    expect(tags.filter((t) => t.name.toLowerCase() === "realkey")).toEqual([
      { kind: "topic", name: "realkey" },
    ]);
    // Names are unique overall: the duplicate badges are gone at the source.
    const names = tags.map((t) => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps a type over a same-named topic, and unrelated entities survive", () => {
    const tags = plannedTags({ ...base, topics: ["video", "rust", "ownership"] });
    expect(tags).toContainEqual({ kind: "type", name: "video" });
    expect(tags).not.toContainEqual({ kind: "topic", name: "video" });
    expect(tags).toContainEqual({ kind: "entity", name: "Mozilla" });
  });

  it("normalizes topics, preserves entity casing, and drops blanks", () => {
    const tags = plannedTags({
      ...base,
      topics: ["  Rust  ", "ownership", "memory"],
      entities: ["  ", "Mozilla"],
    });
    expect(tags).toContainEqual({ kind: "topic", name: "rust" });
    expect(tags).toContainEqual({ kind: "entity", name: "Mozilla" });
    expect(tags.some((t) => t.name.trim() === "")).toBe(false);
  });
});
