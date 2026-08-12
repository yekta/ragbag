import { describe, expect, it } from "vitest";
import { addressQuery, mapsSearchUrl } from "./address.js";

describe("addressQuery", () => {
  it("collapses the multi-line form people paste", () => {
    expect(addressQuery("  Karl-Marx-Allee 90\n10243 Berlin\n")).toBe(
      "Karl-Marx-Allee 90 10243 Berlin",
    );
  });
});

describe("mapsSearchUrl", () => {
  it("builds an encoded maps search", () => {
    expect(mapsSearchUrl("1600 Amphitheatre Pkwy, Mountain View")).toBe(
      "https://www.google.com/maps/search/?api=1&query=1600%20Amphitheatre%20Pkwy%2C%20Mountain%20View",
    );
  });

  it("has nothing to open for a blank address", () => {
    expect(mapsSearchUrl("   ")).toBeNull();
  });
});
