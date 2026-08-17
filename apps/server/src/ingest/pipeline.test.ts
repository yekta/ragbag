import { describe, expect, it } from "vitest";
import { fencedContentMd, imageContentMd } from "./pipeline.js";

// `content_md` is one universal representation per attachment (plan §5.3):
// readable by a human in the detail view and by the next model without a
// parsing contract. The format is the interface, so these shapes are load
// bearing rather than cosmetic.

describe("imageContentMd", () => {
  it("puts the description and the OCR under their own headings", () => {
    const md = imageContentMd("A whiteboard with a roadmap.", "Q3\nship the thing");
    expect(md).toBe(
      "## What this shows\n\nA whiteboard with a roadmap.\n\n## Text in the image\n\nQ3\nship the thing",
    );
  });

  it("leaves out a section it has nothing for", () => {
    expect(imageContentMd("Just a cat.", "")).toBe("## What this shows\n\nJust a cat.");
    expect(imageContentMd("", "   ")).toBe("");
  });
});

describe("fencedContentMd", () => {
  it("fences a textual file with its own extension as the language", () => {
    expect(fencedContentMd("const x = 1;", "text/plain", "main.ts")).toBe(
      "```ts\nconst x = 1;\n```",
    );
  });

  it("falls back to the mime subtype when the name has no extension", () => {
    expect(fencedContentMd("a,b\n1,2", "text/csv", "export")).toBe("```csv\na,b\n1,2\n```");
  });

  it("outgrows any fence the file itself contains", () => {
    // A markdown file full of code blocks would otherwise close the fence
    // early and the rest of the document would escape into the page.
    const md = fencedContentMd("```\ninner\n```\n````\ndeeper\n````", "text/markdown", "notes.md");
    expect(md.startsWith("`````md\n")).toBe(true);
    expect(md.endsWith("\n`````")).toBe(true);
  });
});
