import { describe, expect, it } from "vitest";
import { NotHtmlError, fetchPage, isPrivateIp } from "./fetch-page.js";

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

describe("isPrivateIp", () => {
  it("flags loopback, RFC1918, link-local, CGNAT, and v6 private ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd12::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("passes public addresses", () => {
    for (const ip of ["93.184.216.34", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:2800::1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("fetchPage", () => {
  it("refuses localhost and private IP literals before any request", async () => {
    await expect(fetchPage("http://localhost:8080/x")).rejects.toThrow(/refusing/);
    await expect(fetchPage("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/refusing/);
    await expect(fetchPage("http://10.0.0.5/internal")).rejects.toThrow(/refusing/);
  });

  it("follows redirects and returns the final url", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(null, { status: 301, headers: { location: "/moved" } });
      }
      return htmlResponse("<html><body>arrived</body></html>");
    }) as typeof fetch;

    const page = await fetchPage("https://site.test/start", { fetchImpl, guard: false });
    expect(calls).toEqual(["https://site.test/start", "https://site.test/moved"]);
    expect(page.finalUrl).toBe("https://site.test/moved");
    expect(page.html).toContain("arrived");
  });

  it("rejects non-HTML responses with a typed error", async () => {
    const fetchImpl = (async () =>
      new Response("%PDF-1.7", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as typeof fetch;
    await expect(
      fetchPage("https://site.test/file.pdf", { fetchImpl, guard: false }),
    ).rejects.toBeInstanceOf(NotHtmlError);
  });

  it("truncates bodies at the byte cap instead of failing", async () => {
    const big = `<html><body>${"a".repeat(10_000)}</body></html>`;
    const fetchImpl = (async () => htmlResponse(big)) as typeof fetch;
    const page = await fetchPage("https://site.test/big", {
      fetchImpl,
      guard: false,
      maxBytes: 1_000,
    });
    expect(page.html.length).toBeLessThanOrEqual(1_000);
  });

  it("gives up after too many redirects", async () => {
    const fetchImpl = (async (url: string | URL) =>
      new Response(null, {
        status: 302,
        headers: { location: `${String(url)}/again` },
      })) as typeof fetch;
    await expect(fetchPage("https://site.test/loop", { fetchImpl, guard: false })).rejects.toThrow(
      /too many redirects/,
    );
  });

  it("errors on plain HTTP failures", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(fetchPage("https://site.test/404", { fetchImpl, guard: false })).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
