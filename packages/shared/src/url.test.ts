import { describe, expect, it } from "vitest";
import { isBareUrl, normalizeUrl } from "./url.js";

describe("normalizeUrl", () => {
  it("keeps ordinary urls intact", () => {
    expect(normalizeUrl("https://example.com/a/b?x=1")).toBe("https://example.com/a/b?x=1");
  });

  it("lowercases scheme and host, drops default port and fragment", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/Path#section")).toBe("https://example.com/Path");
  });

  it("strips tracking params but keeps meaningful ones", () => {
    expect(normalizeUrl("https://a.com/p?utm_source=x&id=7&fbclid=abc")).toBe(
      "https://a.com/p?id=7",
    );
  });

  it("drops the trailing slash on bare hosts", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("rejects non-http(s) and garbage", () => {
    expect(normalizeUrl("ftp://example.com/file")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("isBareUrl", () => {
  it("accepts a single pasted link, with surrounding whitespace", () => {
    expect(isBareUrl("  https://example.com/post  ")).toBe(true);
  });

  it("rejects prose containing a link", () => {
    expect(isBareUrl("read this https://example.com/post later")).toBe(false);
  });
});
