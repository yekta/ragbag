import { describe, expect, it } from "vitest";
import { groupHits } from "./search-results.js";
import type { SearchHit } from "./search-index.js";

function hit(over: Partial<SearchHit> & { type: SearchHit["type"]; targetId: string }): SearchHit {
  return {
    id: `${over.type}:${over.targetId}`,
    score: over.score ?? 1,
    terms: [],
    ...over,
  };
}

const all = { hasMessage: () => true, hasEntity: () => true };

describe("groupHits", () => {
  it("collapses a message and the files inside it into one row", () => {
    const rows = groupHits(
      [
        hit({ type: "message", targetId: "m1", messageId: "m1", score: 9 }),
        hit({ type: "attachment", targetId: "a1", messageId: "m1", score: 5 }),
        hit({ type: "attachment", targetId: "a2", messageId: "m1", score: 4 }),
      ],
      all,
    );
    expect(rows).toEqual([
      {
        group: "messages",
        hit: expect.objectContaining({ targetId: "m1" }),
        messageId: "m1",
        attachmentId: undefined,
      },
    ]);
  });

  it("says which file matched when the file is why the message is here", () => {
    const rows = groupHits(
      [
        hit({ type: "attachment", targetId: "a1", messageId: "m1", score: 9 }),
        hit({ type: "message", targetId: "m2", messageId: "m2", score: 3 }),
      ],
      all,
    );
    expect(rows.map((r) => [r.messageId, r.attachmentId])).toEqual([
      ["m1", "a1"],
      ["m2", undefined],
    ]);
  });

  it("never folds a thing into a message: it is its own row", () => {
    const rows = groupHits(
      [
        hit({ type: "message", targetId: "m1", messageId: "m1", score: 9 }),
        hit({ type: "entity", targetId: "e1", score: 8 }),
      ],
      all,
    );
    expect(rows.map((r) => r.group)).toEqual(["messages", "things"]);
    expect(rows[1]!.entityId).toBe("e1");
  });

  it("shows one row per thing, however many messages mention it", () => {
    const rows = groupHits(
      [hit({ type: "entity", targetId: "e1", score: 9 }), hit({ type: "entity", targetId: "e1" })],
      all,
    );
    expect(rows).toHaveLength(1);
  });

  it("puts Messages before Things, each still in rank order", () => {
    const rows = groupHits(
      [
        hit({ type: "entity", targetId: "e1", score: 9 }),
        hit({ type: "message", targetId: "m1", messageId: "m1", score: 8 }),
        hit({ type: "entity", targetId: "e2", score: 7 }),
        hit({ type: "message", targetId: "m2", messageId: "m2", score: 6 }),
      ],
      all,
    );
    expect(rows.map((r) => r.messageId ?? r.entityId)).toEqual(["m1", "m2", "e1", "e2"]);
  });

  it("drops what the archive no longer has, deleted since it was indexed", () => {
    const rows = groupHits(
      [
        hit({ type: "message", targetId: "gone", messageId: "gone" }),
        hit({ type: "entity", targetId: "gone-too" }),
        hit({ type: "message", targetId: "m1", messageId: "m1" }),
      ],
      { hasMessage: (id) => id === "m1", hasEntity: () => false },
    );
    expect(rows.map((r) => r.messageId)).toEqual(["m1"]);
  });

  it("caps each section on its own, so one cannot starve the other", () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) =>
        hit({ type: "message", targetId: `m${i}`, messageId: `m${i}`, score: 10 - i }),
      ),
      ...Array.from({ length: 5 }, (_, i) => hit({ type: "entity", targetId: `e${i}`, score: 1 })),
    ];
    const rows = groupHits(many, { ...all, limit: 2 });
    expect(rows.filter((r) => r.group === "messages")).toHaveLength(2);
    expect(rows.filter((r) => r.group === "things")).toHaveLength(2);
  });
});
