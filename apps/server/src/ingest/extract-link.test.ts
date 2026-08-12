import { describe, expect, it } from "vitest";
import { extractFromHtml } from "./extract-link.js";

const ARTICLE_HTML = `<!doctype html>
<html lang="en-US">
<head>
  <title>Fallback title tag</title>
  <meta property="og:title" content="Why local-first software matters" />
  <meta property="og:description" content="Own your data while keeping realtime sync." />
  <meta property="og:site_name" content="The Sync Blog" />
  <meta property="og:image" content="/images/og-cover.png" />
  <link rel="icon" href="/static/favicon.svg" />
</head>
<body>
  <nav>Home · About · <a href="/subscribe">Subscribe</a></nav>
  <article>
    <h1>Why local-first software matters</h1>
    ${Array.from(
      { length: 12 },
      (_, i) =>
        `<p>Paragraph ${i}: local-first applications keep the primary copy of data on the
         device, giving instant reads, offline writes, and sync as a background concern.
         This paragraph pads the article so readability has enough content to work with.</p>`,
    ).join("\n")}
  </article>
  <footer>© 2026</footer>
</body>
</html>`;

describe("extractFromHtml", () => {
  it("pulls OG metadata and absolutizes urls", () => {
    const out = extractFromHtml(ARTICLE_HTML, "https://sync.blog/posts/local-first");
    expect(out.title).toBe("Why local-first software matters");
    expect(out.description).toBe("Own your data while keeping realtime sync.");
    expect(out.siteName).toBe("The Sync Blog");
    expect(out.imageUrl).toBe("https://sync.blog/images/og-cover.png");
    expect(out.faviconUrl).toBe("https://sync.blog/static/favicon.svg");
    expect(out.lang).toBe("en-US");
    expect(out.isVideo).toBe(false);
  });

  it("extracts readable article text and html", () => {
    const out = extractFromHtml(ARTICLE_HTML, "https://sync.blog/posts/local-first");
    expect(out.extractedText).toContain("local-first applications keep the primary copy");
    expect(out.extractedText).not.toContain("Subscribe"); // nav chrome stripped
    expect(out.articleHtml).toContain("<p>");
  });

  it("falls back to the title tag and default favicon", () => {
    const bare = `<html><head><title> Bare page </title></head><body><p>hi</p></body></html>`;
    const out = extractFromHtml(bare, "https://example.com/a");
    expect(out.title).toBe("Bare page");
    expect(out.faviconUrl).toBe("https://example.com/favicon.ico");
  });

  it("treats video links as metadata-only (no article extraction)", () => {
    const video = `<html><head>
      <meta property="og:title" content="Talk: Local-first (recorded)" />
      <meta property="og:description" content="Conference recording." />
      </head><body><p>${"transcript-ish page text ".repeat(100)}</p></body></html>`;
    const out = extractFromHtml(video, "https://www.youtube.com/watch?v=abc123");
    expect(out.isVideo).toBe(true);
    expect(out.title).toBe("Talk: Local-first (recorded)");
    expect(out.extractedText).toBe("");
    expect(out.articleHtml).toBeUndefined();
  });

  it("ignores javascript: favicons and unparsable image urls", () => {
    const sketchy = `<html><head>
      <link rel="icon" href="javascript:alert(1)" />
      <meta property="og:image" content="http://[broken" />
      </head><body></body></html>`;
    const out = extractFromHtml(sketchy, "https://example.com");
    expect(out.faviconUrl).toBe("https://example.com/favicon.ico");
    expect(out.imageUrl).toBeUndefined();
  });
});
