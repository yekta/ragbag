import { describe, expect, it } from "vitest";
import { newId } from "@ragbag/shared";
import { MAX_ATTACHMENTS, createMessageArgs, mentionArgs, setMessageTagsArgs } from "./mutators.js";
import { downloadUrlsRequest, presignUploadRequest } from "./payloads.js";

const file = () => ({
  id: newId(),
  blobId: newId(),
  filename: "photo.heic",
  mime: "image/heic",
  size: 2_400_000,
});

describe("createMessageArgs", () => {
  it("accepts text on its own, files on their own, and both together", () => {
    expect(createMessageArgs.safeParse({ id: newId(), text: "hi" }).success).toBe(true);
    expect(createMessageArgs.safeParse({ id: newId(), attachments: [file()] }).success).toBe(true);
    expect(
      createMessageArgs.safeParse({ id: newId(), text: "look", attachments: [file()] }).success,
    ).toBe(true);
  });

  it("rejects a send with nothing in it", () => {
    expect(createMessageArgs.safeParse({ id: newId() }).success).toBe(false);
    expect(createMessageArgs.safeParse({ id: newId(), text: "   " }).success).toBe(false);
  });

  it("caps the attachment count, because the client is not the only writer", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS }, file);
    expect(createMessageArgs.safeParse({ id: newId(), attachments: many }).success).toBe(true);
    expect(
      createMessageArgs.safeParse({ id: newId(), attachments: [...many, file()] }).success,
    ).toBe(false);
  });

  it("rejects the same attachment twice and non-uuid ids", () => {
    const one = file();
    expect(createMessageArgs.safeParse({ id: newId(), attachments: [one, one] }).success).toBe(
      false,
    );
    expect(createMessageArgs.safeParse({ id: "01JBQ3W4XK", text: "x" }).success).toBe(false);
  });
});

describe("mentionArgs", () => {
  it("takes an attachment or none: a mention can come from the text itself", () => {
    const base = { messageId: newId(), entityId: newId() };
    expect(mentionArgs.safeParse(base).success).toBe(true);
    expect(mentionArgs.safeParse({ ...base, attachmentId: null }).success).toBe(true);
    expect(mentionArgs.safeParse({ ...base, attachmentId: newId() }).success).toBe(true);
    expect(mentionArgs.safeParse({ ...base, attachmentId: "nope" }).success).toBe(false);
  });
});

describe("setMessageTagsArgs", () => {
  it("bounds tag count and length", () => {
    expect(
      setMessageTagsArgs.safeParse({ messageId: newId(), names: ["rust", "systems"] }).success,
    ).toBe(true);
    expect(
      setMessageTagsArgs.safeParse({
        messageId: newId(),
        names: Array.from({ length: 51 }, () => "t"),
      }).success,
    ).toBe(false);
  });
});

describe("blob payloads", () => {
  it("requires a client-minted UUID blobId and a lowercase hex sha256", () => {
    const ok = { blobId: newId(), sha256: "a".repeat(64), mime: "image/png", size: 123 };
    expect(presignUploadRequest.safeParse(ok).success).toBe(true);
    expect(presignUploadRequest.safeParse({ ...ok, sha256: "XYZ" }).success).toBe(false);
    expect(presignUploadRequest.safeParse({ ...ok, blobId: "not-a-uuid" }).success).toBe(false);
  });

  it("bounds the batch presign and defaults to the original", () => {
    const parsed = downloadUrlsRequest.safeParse({ blobIds: [newId()] });
    expect(parsed.success && parsed.data.variant).toBe("original");
    expect(
      downloadUrlsRequest.safeParse({ blobIds: Array.from({ length: 101 }, newId) }).success,
    ).toBe(false);
    expect(downloadUrlsRequest.safeParse({ blobIds: [] }).success).toBe(false);
  });
});
