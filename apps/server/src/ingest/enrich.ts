import type { ItemKind } from "@ragbag/shared";
import { newId } from "@ragbag/shared";
import { and, eq, inArray } from "drizzle-orm";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { db } from "../db/client.js";
import { itemTag, tag } from "../db/schema.js";
import { env } from "../env.js";
import { openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Stage 3 (plan §7): one OpenAI call per item, structured outputs via the
// SDK's Zod helper. Generous, multi-dimensional tagging — several `type`
// tags, 3–15 lowercase `topic` tags, `entity` tags — plus a 1–3 sentence
// summary. The prompt includes the user's existing topic vocabulary so tags
// converge instead of fragmenting ("js" vs "javascript").

export const ITEM_TYPE_TAGS = [
  "article",
  "blog-post",
  "news",
  "paper",
  "tutorial",
  "documentation",
  "reference",
  "code",
  "tool",
  "product",
  "recipe",
  "review",
  "social-post",
  "discussion",
  "video",
  "podcast",
  "book",
  "document",
  "receipt",
  "invoice",
  "ticket",
  "event",
  "place",
  "screenshot",
  "meme",
  "quote",
  "idea",
  "todo",
  "other",
] as const;

export const Enrichment = z.object({
  summary: z.string(), // 1–3 sentences
  types: z.array(z.enum(ITEM_TYPE_TAGS)).min(1), // multi-label
  topics: z.array(z.string()).min(3).max(15), // lowercase topical tags
  entities: z.array(z.string()), // people, orgs, products, places
  lang: z.string(),
});
export type EnrichmentResult = z.infer<typeof Enrichment>;

export type EnrichmentInput = {
  kind: ItemKind;
  isVideo?: boolean;
  url?: string | null;
  title?: string | null;
  siteName?: string | null;
  description?: string | null;
  /** The user's own words — strongest signal for intent. */
  userText?: string | null;
  extractedText?: string | null;
  existingTopics: readonly string[];
};

const MAX_CONTENT_CHARS = 24_000;
const MAX_EXISTING_TOPICS = 300;

export function buildEnrichmentPrompt(input: EnrichmentInput): string {
  const lines: string[] = [
    "You are the enrichment stage of ragbag, a personal info-dump archive. " +
      "Tag and summarize ONE dumped item so its owner can find it again later.",
    "",
    "Rules:",
    "- types: every label that fits (a Rust tutorial blog post is blog-post + tutorial + code).",
    "- topics: 3-15 short lowercase tags about what the item is ABOUT. Reuse the owner's existing topics below whenever they fit; invent new ones only when nothing fits.",
    "- entities: specific people, organizations, products, places mentioned (original casing, may be empty).",
    "- summary: 1-3 plain sentences a future search should match. No 'this article...' meta-phrasing.",
    "- lang: BCP-47 tag of the item's content language (e.g. en, de, pt-BR).",
  ];
  if (input.isVideo) {
    lines.push(
      "- This is a video link with metadata only (no transcript): include the 'video' type and tag from the title/description alone.",
    );
  }
  if (input.existingTopics.length > 0) {
    lines.push(
      "",
      `Owner's existing topics: ${input.existingTopics.slice(0, MAX_EXISTING_TOPICS).join(", ")}`,
    );
  }
  lines.push("", "--- ITEM ---", `kind: ${input.kind}`);
  if (input.url) lines.push(`url: ${input.url}`);
  if (input.siteName) lines.push(`site: ${input.siteName}`);
  if (input.title) lines.push(`title: ${input.title}`);
  if (input.description) lines.push(`description: ${input.description}`);
  if (input.userText) lines.push(`owner's note/comment: ${input.userText.slice(0, 4_000)}`);
  if (input.extractedText) {
    lines.push("", "content:", input.extractedText.slice(0, MAX_CONTENT_CHARS));
  }
  return lines.join("\n");
}

export async function enrichItem(
  input: EnrichmentInput,
  meta: { userId: string; itemId: string },
): Promise<EnrichmentResult | null> {
  if (!openai) return null;
  const res = await openai.responses.parse({
    model: env.AI_ENRICH_MODEL,
    input: buildEnrichmentPrompt(input),
    text: { format: zodTextFormat(Enrichment, "enrichment") },
  });
  await recordUsage({
    userId: meta.userId,
    itemId: meta.itemId,
    kind: "enrich",
    model: env.AI_ENRICH_MODEL,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  });
  return res.output_parsed;
}

/**
 * Replace the item's AI tags with the enrichment result. User-applied tags
 * are never touched (and win when the AI picks the same tag). Tag/item_tag
 * writes replicate to every device through Zero automatically.
 */
export async function applyAiTags(
  enrichment: EnrichmentResult,
  meta: { userId: string; itemId: string },
): Promise<void> {
  const wanted = new Map<string, { kind: "type" | "topic" | "entity"; name: string }>();
  for (const t of enrichment.types) wanted.set(`type:${t}`, { kind: "type", name: t });
  for (const raw of enrichment.topics) {
    const name = raw.trim().toLowerCase().slice(0, 64);
    if (name) wanted.set(`topic:${name}`, { kind: "topic", name });
  }
  for (const raw of enrichment.entities.slice(0, 20)) {
    const name = raw.trim().slice(0, 64);
    if (name) wanted.set(`entity:${name.toLowerCase()}`, { kind: "entity", name });
  }
  const tags = [...wanted.values()];

  if (tags.length > 0) {
    await db
      .insert(tag)
      .values(tags.map((t) => ({ id: newId(), userId: meta.userId, ...t })))
      .onConflictDoNothing();
  }
  const rows =
    tags.length > 0
      ? await db
          .select({ id: tag.id, kind: tag.kind, name: tag.name })
          .from(tag)
          .where(
            and(
              eq(tag.userId, meta.userId),
              inArray(
                tag.name,
                tags.map((t) => t.name),
              ),
            ),
          )
      : [];
  const wantedIds = rows
    .filter((r) => wanted.has(`${r.kind}:${r.kind === "entity" ? r.name.toLowerCase() : r.name}`))
    .map((r) => r.id);

  // Ingestion owns AI tags: full replacement on every (re-)run.
  await db.delete(itemTag).where(and(eq(itemTag.itemId, meta.itemId), eq(itemTag.source, "ai")));
  if (wantedIds.length > 0) {
    await db
      .insert(itemTag)
      .values(wantedIds.map((tagId) => ({ itemId: meta.itemId, tagId, source: "ai" as const })))
      .onConflictDoNothing(); // a user tag on the same tag id wins
  }
}

/** The owner's topic vocabulary, for convergence in the prompt. */
export async function existingTopicNames(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tag.name })
    .from(tag)
    .where(and(eq(tag.userId, userId), eq(tag.kind, "topic")))
    .limit(MAX_EXISTING_TOPICS);
  return rows.map((r) => r.name);
}
