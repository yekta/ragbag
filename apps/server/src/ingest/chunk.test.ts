import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk.js";

describe("chunkText", () => {
  it("returns nothing for empty text and one chunk for short text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n ")).toEqual([]);
    expect(chunkText("a short note")).toEqual(["a short note"]);
  });

  it("splits long text into overlapping chunks near the size cap", () => {
    const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(20).trim();
    const text = Array.from({ length: 10 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text, { maxChars: 1000, overlap: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A chunk may exceed maxChars by at most the carried overlap tail.
      expect(chunk.length).toBeLessThanOrEqual(1000 + 100 + 2);
    }
    // Overlap: the start of chunk 2 repeats the tail of chunk 1.
    const tail = chunks[0]!.slice(-50);
    expect(chunks[1]!.startsWith(chunks[0]!.slice(-100, -50))).toBe(true);
    expect(chunks[0]!.endsWith(tail)).toBe(true);
  });

  it("keeps paragraphs intact when they fit", () => {
    const chunks = chunkText("first paragraph\n\nsecond paragraph", { maxChars: 100 });
    expect(chunks).toEqual(["first paragraph\n\nsecond paragraph"]);
  });

  it("hard-splits a single monster paragraph", () => {
    const monster = "x".repeat(5000);
    const chunks = chunkText(monster, { maxChars: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.every((c) => c.length <= 1100 + 2)).toBe(true);
  });

  it("caps the number of chunks", () => {
    const text = Array.from({ length: 500 }, (_, i) => `paragraph number ${i} with words`).join(
      "\n\n",
    );
    expect(chunkText(text, { maxChars: 60, overlap: 10, maxChunks: 20 }).length).toBe(20);
  });
});
