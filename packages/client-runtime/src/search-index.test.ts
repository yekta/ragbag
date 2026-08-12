import { describe, expect, it } from "vitest";
import { TimelineSearchIndex, type SearchDoc } from "./search-index.js";

function doc(overrides: Partial<SearchDoc> & { id: string }): SearchDoc {
  return {
    kind: "note",
    title: "",
    text: "",
    summary: "",
    tags: "",
    site: "",
    url: "",
    extracted: "",
    ...overrides,
  };
}

describe("TimelineSearchIndex", () => {
  it("finds items through AI tags and summaries, not just titles (plan §8)", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({
        id: "a",
        kind: "link",
        title: "How adenosine receptors regulate rest",
        summary: "Why caffeine late in the day wrecks sleep quality.",
        tags: "caffeine sleep health article",
      }),
      doc({ id: "b", kind: "note", text: "buy milk and eggs" }),
    ]);

    const hits = index.search("sleep caffeine");
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("matches prefixes as you type", () => {
    const index = new TimelineSearchIndex();
    index.sync([doc({ id: "a", title: "Kubernetes networking deep dive" })]);
    expect(index.search("kuber").map((h) => h.id)).toEqual(["a"]);
  });

  it("ranks title matches above body matches", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ id: "title-hit", title: "rust ownership explained" }),
      doc({ id: "body-hit", extracted: "…a paragraph mentioning rust ownership in passing…" }),
    ]);
    const hits = index.search("rust ownership");
    expect(hits[0]?.id).toBe("title-hit");
    expect(hits.map((h) => h.id)).toContain("body-hit");
  });

  it("reconciles incrementally: updates and removals take effect", () => {
    const index = new TimelineSearchIndex();
    index.sync([doc({ id: "a", title: "postgres tuning" }), doc({ id: "b", title: "sourdough" })]);
    expect(index.search("postgres").map((h) => h.id)).toEqual(["a"]);
    expect(index.size).toBe(2);

    // Item a edited, item b deleted.
    index.sync([doc({ id: "a", title: "sqlite tuning" })]);
    expect(index.search("postgres")).toEqual([]);
    expect(index.search("sqlite").map((h) => h.id)).toEqual(["a"]);
    expect(index.search("sourdough")).toEqual([]);
    expect(index.size).toBe(1);
  });

  it("requires all terms (AND) so multi-word queries narrow down", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ id: "a", title: "react hooks guide" }),
      doc({ id: "b", title: "react server components" }),
    ]);
    expect(index.search("react hooks").map((h) => h.id)).toEqual(["a"]);
  });

  it("returns nothing for an empty query", () => {
    const index = new TimelineSearchIndex();
    index.sync([doc({ id: "a", title: "anything" })]);
    expect(index.search("  ")).toEqual([]);
  });
});
