import { describe, expect, it } from "vitest";
import { newId } from "@ragbag/shared";
import { createItemArgs, setTagsArgs } from "./mutators.js";
import { presignUploadRequest } from "./payloads.js";

describe("createItemArgs", () => {
  it("accepts a note with text", () => {
    expect(createItemArgs.safeParse({ id: newId(), kind: "note", text: "hi" }).success).toBe(true);
  });

  it("rejects a note without text and a link without url", () => {
    expect(createItemArgs.safeParse({ id: newId(), kind: "note" }).success).toBe(false);
    expect(createItemArgs.safeParse({ id: newId(), kind: "link" }).success).toBe(false);
  });

  it("rejects blob kinds without a blobId and non-ulid ids", () => {
    expect(createItemArgs.safeParse({ id: newId(), kind: "image" }).success).toBe(false);
    expect(createItemArgs.safeParse({ id: "not-a-ulid", kind: "note", text: "x" }).success).toBe(
      false,
    );
  });
});

describe("setTagsArgs", () => {
  it("bounds tag count and length", () => {
    expect(setTagsArgs.safeParse({ itemId: newId(), names: ["rust", "systems"] }).success).toBe(
      true,
    );
    expect(
      setTagsArgs.safeParse({ itemId: newId(), names: Array.from({ length: 51 }, () => "t") })
        .success,
    ).toBe(false);
  });
});

describe("presignUploadRequest", () => {
  it("requires a lowercase hex sha256", () => {
    const ok = {
      sha256: "a".repeat(64),
      mime: "image/png",
      size: 123,
    };
    expect(presignUploadRequest.safeParse(ok).success).toBe(true);
    expect(presignUploadRequest.safeParse({ ...ok, sha256: "XYZ" }).success).toBe(false);
  });
});
