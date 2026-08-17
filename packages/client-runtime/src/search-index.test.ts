import { describe, expect, it } from "vitest";
import { TimelineSearchIndex, type DocType, type SearchDoc } from "./search-index.js";

function doc(overrides: Partial<SearchDoc> & { targetId: string; type?: DocType }): SearchDoc {
  const type = overrides.type ?? "message";
  return {
    id: `${type}:${overrides.targetId}`,
    type,
    messageId: overrides.messageId ?? overrides.targetId,
    title: "",
    text: "",
    summary: "",
    tags: "",
    entities: "",
    body: "",
    ...overrides,
  };
}

describe("TimelineSearchIndex", () => {
  it("finds messages through AI tags and summaries, not just titles", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({
        targetId: "a",
        title: "How adenosine receptors regulate rest",
        summary: "Why caffeine late in the day wrecks sleep quality.",
        tags: "caffeine sleep health article",
      }),
      doc({ targetId: "b", text: "buy milk and eggs" }),
    ]);
    expect(index.search("sleep caffeine").map((h) => h.targetId)).toEqual(["a"]);
  });

  it("carries the type and the message a hit belongs to, so results can group", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ targetId: "m1", title: "shipping" }),
      doc({ type: "attachment", targetId: "a1", messageId: "m1", body: "shipping label" }),
      doc({ type: "entity", targetId: "e1", messageId: "m1", entities: "shipping ups" }),
    ]);
    const hits = index.search("shipping");
    expect(hits.map((h) => h.type).toSorted()).toEqual(["attachment", "entity", "message"]);
    expect(new Set(hits.map((h) => h.messageId))).toEqual(new Set(["m1"]));
  });

  it("matches an entity's exact value, which is what replaced embeddings", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({
        type: "entity",
        targetId: "e1",
        messageId: "m1",
        text: "1Z999AA10123456784",
        entities: "ups 1Z999AA10123456784",
      }),
      doc({ targetId: "m2", text: "unrelated note" }),
    ]);
    expect(index.search("1Z999AA10123456784").map((h) => h.targetId)).toEqual(["e1"]);
  });

  it("matches prefixes as you type", () => {
    const index = new TimelineSearchIndex();
    index.sync([doc({ targetId: "a", title: "Kubernetes networking deep dive" })]);
    expect(index.search("kuber").map((h) => h.targetId)).toEqual(["a"]);
  });

  it("ranks title matches above body matches", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ targetId: "title-hit", title: "rust ownership explained" }),
      doc({
        type: "attachment",
        targetId: "body-hit",
        messageId: "m2",
        body: "…a paragraph mentioning rust ownership in passing…",
      }),
    ]);
    const hits = index.search("rust ownership");
    expect(hits[0]?.targetId).toBe("title-hit");
    expect(hits.map((h) => h.targetId)).toContain("body-hit");
  });

  it("reconciles incrementally, which is what makes the second pass free", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ targetId: "a", title: "postgres tuning" }),
      doc({ targetId: "b", title: "sourdough" }),
    ]);
    expect(index.search("postgres").map((h) => h.targetId)).toEqual(["a"]);
    expect(index.size).toBe(2);

    // The deeper pass: the same ids, now with their document bodies.
    index.sync([
      doc({ targetId: "a", title: "postgres tuning", body: "shared_buffers and work_mem" }),
      doc({ targetId: "b", title: "sourdough" }),
    ]);
    expect(index.size).toBe(2);
    expect(index.search("work_mem").map((h) => h.targetId)).toEqual(["a"]);

    // Message a edited, message b deleted.
    index.sync([doc({ targetId: "a", title: "sqlite tuning" })]);
    expect(index.search("postgres")).toEqual([]);
    expect(index.search("sqlite").map((h) => h.targetId)).toEqual(["a"]);
    expect(index.search("sourdough")).toEqual([]);
    expect(index.size).toBe(1);
  });

  it("requires all terms (AND) so multi-word queries narrow down", () => {
    const index = new TimelineSearchIndex();
    index.sync([
      doc({ targetId: "a", title: "react hooks guide" }),
      doc({ targetId: "b", title: "react server components" }),
    ]);
    expect(index.search("react hooks").map((h) => h.targetId)).toEqual(["a"]);
  });

  it("returns nothing for an empty query", () => {
    const index = new TimelineSearchIndex();
    index.sync([doc({ targetId: "a", title: "anything" })]);
    expect(index.search("  ")).toEqual([]);
  });
});
