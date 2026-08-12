import { describe, expect, it } from "vitest";
import { isUlid, newId } from "./ids.js";

describe("newId", () => {
  it("generates valid, unique, time-ordered ulids", () => {
    const a = newId();
    const b = newId();
    expect(isUlid(a)).toBe(true);
    expect(isUlid(b)).toBe(true);
    expect(a).not.toBe(b);
    // Monotonic factory: later id sorts after earlier one even in the same ms.
    expect(b > a).toBe(true);
  });
});
