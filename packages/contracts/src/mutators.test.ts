import { describe, expect, it } from "vitest";
import { CATALOG, freeName, kindFromLabel, newId, slugFromLabel } from "@ragbag/shared";
import {
  MAX_ATTACHMENTS,
  MAX_TYPE_FIELDS,
  createEntityTypeArgs,
  createMessageArgs,
  mentionArgs,
  setEntityTypeFieldsArgs,
  setMessageTagsArgs,
  updateEntityTypeArgs,
} from "./mutators.js";
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

const field = (over: Record<string, unknown> = {}) => ({
  name: "title",
  label: "Title",
  type: "text",
  required: true,
  ...over,
});

const type = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  label: "Trading Card",
  sidebarTitle: "Trading Cards",
  icon: "sparkles",
  hint: "A trading card someone is after or has spare.",
  fields: [field()],
  ...over,
});

describe("entity type args", () => {
  it("takes a type with one field and derives what it was not told", () => {
    const parsed = createEntityTypeArgs.safeParse(type());
    expect(parsed.success).toBe(true);
    // Not given, and not required: the mutator derives the slug from the label
    // and the kind is never the caller's to pick.
    expect(parsed.success && parsed.data.slug).toBeUndefined();
    expect(parsed.success && parsed.data.examples).toEqual([]);
  });

  it("takes a type with no details, and bounds how many it can have", () => {
    // Naming it and saying what to look for is the whole requirement.
    expect(createEntityTypeArgs.safeParse(type({ fields: [] })).success).toBe(true);
    const many = Array.from({ length: MAX_TYPE_FIELDS + 1 }, (_, i) =>
      field({ name: `f${i}`, label: `F${i}` }),
    );
    expect(createEntityTypeArgs.safeParse(type({ fields: many })).success).toBe(false);
  });

  it("keeps field names snake_case, because they are the jsonb keys", () => {
    expect(setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: [field()] }).success).toBe(
      true,
    );
    for (const name of ["Title", "postal code", "2nd", "_x"]) {
      expect(
        setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: [field({ name })] }).success,
      ).toBe(false);
    }
  });

  it("refuses two fields that would be one key in the data", () => {
    const twice = [field(), field({ label: "Also Title" })];
    expect(setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: twice }).success).toBe(false);
  });

  it("refuses two fields claiming the same place in the dedupe key", () => {
    const clash = [field({ keyRank: 1 }), field({ name: "author", label: "Author", keyRank: 1 })];
    expect(setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: clash }).success).toBe(false);
    const ordered = [field({ keyRank: 1 }), field({ name: "author", label: "Author", keyRank: 2 })];
    expect(setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: ordered }).success).toBe(true);
  });

  it("pairs an enum with its vocabulary, and nothing else with one", () => {
    const enumField = field({ name: "sector", label: "Sector", type: "enum" });
    expect(setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: [enumField] }).success).toBe(
      false,
    );
    expect(
      setEntityTypeFieldsArgs.safeParse({
        id: newId(),
        fields: [{ ...enumField, values: ["hvac"] }],
      }).success,
    ).toBe(true);
    expect(
      setEntityTypeFieldsArgs.safeParse({ id: newId(), fields: [field({ values: ["x"] })] })
        .success,
    ).toBe(false);
  });

  it("keeps a slug spellable in a URL", () => {
    const id = newId();
    expect(updateEntityTypeArgs.safeParse({ id, slug: "trading-cards" }).success).toBe(true);
    expect(updateEntityTypeArgs.safeParse({ id, slug: "Trading Cards" }).success).toBe(false);
    expect(updateEntityTypeArgs.safeParse({ id, slug: "" }).success).toBe(false);
  });

  it("has nothing to say about `kind`, because renaming one is not offered", () => {
    const parsed = updateEntityTypeArgs.safeParse({ id: newId(), kind: "something_else" });
    expect(parsed.success && "kind" in parsed.data).toBe(false);
  });
});

describe("deriving a kind and a slug from a label", () => {
  it("snake_cases the one and dashes the other", () => {
    expect(kindFromLabel("Trading Cards")).toBe("trading_cards");
    expect(slugFromLabel("Trading Cards")).toBe("trading-cards");
  });

  it("always lands on something the check constraints accept", () => {
    const shape = /^[a-z][a-z0-9_]{1,39}$/;
    for (const label of ["X", "3D Prints", "Şarkı Listesi", "汉字", "  ", "a".repeat(80)]) {
      expect(kindFromLabel(label)).toMatch(shape);
      expect(slugFromLabel(label)).toMatch(/^[a-z0-9-]{1,48}$/);
    }
  });

  it("steps aside rather than landing on a kind that carries behaviour", () => {
    const taken = CATALOG.map((def) => def.kind);
    expect(freeName(kindFromLabel("Link"), taken)).toBe("link_2");
    expect(freeName(kindFromLabel("Trading Cards"), taken)).toBe("trading_cards");
    expect(freeName("links", ["links", "links-2"], { separator: "-", max: 48 })).toBe("links-3");
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
