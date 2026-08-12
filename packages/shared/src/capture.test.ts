import { describe, expect, it } from "vitest";
import { parseTextCapture } from "./capture.js";

describe("parseTextCapture", () => {
  it("keeps ordinary text a note", () => {
    expect(parseTextCapture("thinking about caching")).toEqual({
      kind: "note",
      text: "thinking about caching",
    });
  });

  it("still recognises a bare url as a link", () => {
    expect(parseTextCapture("  https://example.com/post ")).toEqual({
      kind: "link",
      url: "https://example.com/post",
    });
  });

  it("reads the markers people type for tasks, and strips them", () => {
    for (const raw of [
      "todo: call the vet",
      "TODO:call the vet",
      "- [ ] call the vet",
      "[] call the vet",
    ]) {
      expect(parseTextCapture(raw)).toEqual({ kind: "todo", text: "call the vet" });
    }
  });

  it("takes an explicit address marker", () => {
    expect(parseTextCapture("address: Karl-Marx-Allee 90, Berlin")).toEqual({
      kind: "address",
      text: "Karl-Marx-Allee 90, Berlin",
    });
  });

  it("never strips a marker down to nothing", () => {
    expect(parseTextCapture("todo:")).toEqual({ kind: "todo", text: "todo:" });
  });
});
