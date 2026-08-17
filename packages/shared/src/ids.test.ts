import { describe, expect, it } from "vitest";
import { isUuid, newId } from "./ids.js";

describe("newId", () => {
  it("generates valid, unique, time-ordered uuids", () => {
    const a = newId();
    const b = newId();
    expect(isUuid(a)).toBe(true);
    expect(isUuid(b)).toBe(true);
    expect(a).not.toBe(b);
    // v7 keeps a sequence counter, so a later id sorts after an earlier one
    // even when both are minted inside the same millisecond.
    expect(b > a).toBe(true);
  });

  it("rejects things that are not uuids", () => {
    expect(isUuid("01JBQ3W4XK9V0R4T5N6M7P8Q9A")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
