import { Readability } from "@mozilla/readability";
import { isVideoUrl } from "@ragbag/shared";
import { parseHTML } from "linkedom";

// Stage 2 for links (plan §7): OG/meta/favicon from the raw page, article
// text via Readability. Video links stop at metadata: no transcript, no
// content-level analysis; they get tagged from title + description only.

export type LinkExtraction = {
  title?: string;
  description?: string;
  siteName?: string;
  faviconUrl?: string;
  imageUrl?: string;
  lang?: string;
  /** Plain article text (empty for video links / unreaderable pages). */
  extractedText: string;
  /** Readability's cleaned article HTML, stored as the link-rot snapshot. */
  articleHtml?: string;
  isVideo: boolean;
};

function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAX_EXTRACTED_CHARS = 200_000;

export function extractFromHtml(html: string, pageUrl: string): LinkExtraction {
  const { document } = parseHTML(html);

  const meta = (name: string): string | undefined => {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const content = el?.getAttribute("content")?.trim();
    return content || undefined;
  };
  const absolute = (href: string | null | undefined): string | undefined => {
    if (!href) return undefined;
    try {
      const url = new URL(href, pageUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  };

  let title = meta("og:title") ?? meta("twitter:title") ?? (document.title?.trim() || undefined);
  let description = meta("og:description") ?? meta("description") ?? meta("twitter:description");
  let siteName = meta("og:site_name");
  const imageUrl = absolute(meta("og:image") ?? meta("twitter:image"));
  const faviconUrl =
    absolute(
      document
        .querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
        ?.getAttribute("href"),
    ) ?? absolute("/favicon.ico");
  const lang = document.documentElement?.getAttribute("lang")?.trim().slice(0, 12) || undefined;

  const isVideo = isVideoUrl(pageUrl);
  let extractedText = "";
  let articleHtml: string | undefined;

  if (!isVideo) {
    try {
      // Readability mutates its input, so give it its own DOM. linkedom's
      // document satisfies it at runtime; the type systems don't meet (no DOM
      // lib on the server), hence the cast.
      const { document: readerDoc } = parseHTML(html);
      const article = new Readability(readerDoc as unknown as never, {
        charThreshold: 250,
      }).parse();
      if (article?.textContent && article.textContent.trim().length > 0) {
        extractedText = collapseWhitespace(article.textContent).slice(0, MAX_EXTRACTED_CHARS);
        articleHtml = article.content ?? undefined;
        title ??= article.title ?? undefined;
        siteName ??= article.siteName ?? undefined;
        description ??= article.excerpt ?? undefined;
      }
    } catch {
      // Readability chokes on some DOMs; metadata alone is a fine result.
    }
  }

  return {
    title,
    description,
    siteName,
    faviconUrl,
    imageUrl,
    lang,
    extractedText,
    articleHtml,
    isVideo,
  };
}
