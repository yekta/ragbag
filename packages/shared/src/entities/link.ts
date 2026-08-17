import { z } from "zod";
import { normalizeUrl } from "../url.js";
import type { EntityCandidate, EntityDefinition } from "./types.js";

// A bare URL is no longer a kind of dump: it is text that produces a link
// entity, and the entity is what draws the preview card. Because links are
// canonical per user, the same URL dumped in five messages is enriched (and
// snapshotted, plan §6.6) once.

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * Trailing punctuation that ends the sentence rather than the URL. Closing
 * brackets only come off when nothing opened them, so a Wikipedia URL keeps
 * its `(disambiguation)`.
 */
function trimTrailing(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (!last) break;
    if (".,;:!?'\"".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = { ")": "(", "]": "[", "}": "{" }[last];
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

export const linkEntity: EntityDefinition = {
  kind: "link",
  label: "Link",
  plural: "Links",
  slug: "links",
  icon: "link",
  railRow: true,
  promptHint: "A web address worth keeping, with the page it points at.",
  data: z.object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    siteName: z.string().optional(),
    faviconUrl: z.string().optional(),
    imageUrl: z.string().optional(),
    lang: z.string().optional(),
    isVideo: z.boolean().optional(),
  }),
  match(text) {
    const found: EntityCandidate[] = [];
    for (const m of text.matchAll(URL_RE)) {
      const value = trimTrailing(m[0]);
      if (normalizeUrl(value)) found.push({ value, data: { url: value }, index: m.index });
    }
    return found;
  },
  normalize(value, data) {
    return normalizeUrl(typeof data.url === "string" ? data.url : value);
  },
  title(value, data) {
    if (typeof data.title === "string" && data.title) return data.title;
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return value;
    }
  },
};
