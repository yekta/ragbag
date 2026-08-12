import { describe, expect, it } from "vitest";
import { newId } from "@ragbag/shared";
import { createItemArgs, setDoneArgs, setKindArgs, setTagsArgs } from "./mutators.js";
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

  it("treats todos and addresses as text kinds", () => {
    expect(
      createItemArgs.safeParse({ id: newId(), kind: "todo", text: "call the vet" }).success,
    ).toBe(true);
    expect(
      createItemArgs.safeParse({ id: newId(), kind: "address", text: "Karl-Marx-Allee 90" })
        .success,
    ).toBe(true);
    expect(createItemArgs.safeParse({ id: newId(), kind: "todo" }).success).toBe(false);
    expect(createItemArgs.safeParse({ id: newId(), kind: "address", text: "  " }).success).toBe(
      false,
    );
  });
});

describe("setDoneArgs / setKindArgs", () => {
  it("takes a done flag for a todo", () => {
    expect(setDoneArgs.safeParse({ id: newId(), done: true }).success).toBe(true);
    expect(setDoneArgs.safeParse({ id: newId(), done: "yes" }).success).toBe(false);
  });

  it("only reclassifies between the text kinds", () => {
    expect(setKindArgs.safeParse({ id: newId(), kind: "todo" }).success).toBe(true);
    expect(setKindArgs.safeParse({ id: newId(), kind: "address" }).success).toBe(true);
    expect(setKindArgs.safeParse({ id: newId(), kind: "link" }).success).toBe(false);
    expect(setKindArgs.safeParse({ id: newId(), kind: "image" }).success).toBe(false);
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
  it("requires a client-minted ULID blobId and a lowercase hex sha256", () => {
    const ok = {
      blobId: newId(),
      sha256: "a".repeat(64),
      mime: "image/png",
      size: 123,
    };
    expect(presignUploadRequest.safeParse(ok).success).toBe(true);
    expect(presignUploadRequest.safeParse({ ...ok, sha256: "XYZ" }).success).toBe(false);
    expect(presignUploadRequest.safeParse({ ...ok, blobId: "not-a-ulid" }).success).toBe(false);
  });
});
