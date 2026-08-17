import { ENTITY_DEFINITIONS, entityTitle, log, matchEntities, snippetAround } from "@ragbag/shared";
import { asc, eq } from "drizzle-orm";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { storage } from "../blobs/storage.js";
import { db } from "../db/client.js";
import { attachmentContents, attachments, messages } from "../db/schema.js";
import { env } from "../env.js";
import {
  applyAiTags,
  existingTopicNames,
  resolveEntity,
  writeEntities,
  type ResolvedEntity,
} from "./entities.js";
import { extractFromHtml } from "./extract-link.js";
import { NotHtmlError, fetchPage } from "./fetch-page.js";
import { describeAiError, openai } from "./openai.js";
import { recordUsage } from "./usage.js";

// Phase B (plan §5.4): read the whole message and pull the things out of it.
//
//   1. Deterministic pre-pass. Every registry entry with a `match` runs over
//      the text: URLs, emails, phone numbers, tracking-shaped strings. Free,
//      instant, and it never hallucinates a tracking number out of a random
//      alphanumeric.
//   2. One model call. It receives the step-1 candidates to confirm, correct
//      or reject, plus the registry list with its prompt hints and the exact
//      shape of each kind's data, for the kinds that need judgment.
//   3. Per-kind validation against the registry. Anything failing is dropped.
//   4. Link enrichment through the existing page fetcher.
//   5. The idempotent write (entities.ts).
//
// Hybrid extraction is the point. URLs, emails, phones and most tracking
// numbers have strong syntactic signatures: regex finds them for free and
// never invents them, and the model's job is confirmation, enrichment and the
// judgment cases. Model-only extraction confidently labels random
// alphanumerics as tracking numbers.

/** Multi-label vocabulary for the `type` tags. */
export const MESSAGE_TYPE_TAGS = [
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
  "photo",
  "meme",
  "quote",
  "idea",
  "task",
  "voice-note",
  "other",
] as const;

const ENTITY_KIND_VALUES = ENTITY_DEFINITIONS.map((d) => d.kind) as [string, ...string[]];

export const Synthesis = z.object({
  /** Short, for search results, permalinks and grids. */
  title: z.string(),
  /** 1-3 plain sentences. Plain text, never markdown: it renders in chips. */
  summary: z.string(),
  lang: z.string(),
  types: z.array(z.enum(MESSAGE_TYPE_TAGS)),
  topics: z.array(z.string()),
  entities: z.array(
    z.object({
      kind: z.enum(ENTITY_KIND_VALUES),
      value: z.string(),
      /**
       * The kind's structured fields as a JSON object, serialized.
       *
       * A string rather than a nested object because strict structured
       * outputs need every property of every object declared up front, and
       * these differ per kind. Keeping it a string leaves the registry's zod
       * schemas as the single authority on the shape (they are what the
       * prompt shows the model, and what validates the answer).
       */
      data_json: z.string(),
      confidence: z.number(),
      /** 0 for the message's own text, else the 1-based attachment number. */
      from_attachment: z.number(),
      topics: z.array(z.string()),
    }),
  ),
  attachment_topics: z.array(z.object({ index: z.number(), topics: z.array(z.string()) })),
});
export type SynthesisResult = z.infer<typeof Synthesis>;

/** One thing the model reads: the message's own words, or one attachment. */
export type SynthesisSource = {
  /** null for the message text itself. */
  attachmentId: string | null;
  /** 0 for the message text, 1-based for attachments. */
  index: number;
  label: string;
  text: string;
};

/** Per-attachment text handed to the model; the whole message is capped too. */
const MAX_SOURCE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 40_000;
const MAX_CANDIDATES = 60;

export function buildSynthesisPrompt(input: {
  sources: readonly SynthesisSource[];
  candidates: readonly { kind: string; value: string }[];
  existingTopics: readonly string[];
}): string {
  const lines: string[] = [
    "You are the synthesis stage of ragbag, a personal info-dump archive. One message was " +
      "dumped: the owner's own words plus the files they sent with it. Title it, summarize it, " +
      "tag it, and pull out the things worth finding again.",
    "",
    "Rules:",
    "- title: what a search result should say. No more than about eight words.",
    "- summary: 1-3 plain sentences a future search should match. Plain text, no markdown, no " +
      "'this message...' meta-phrasing.",
    "- types: every label that fits.",
    "- topics: 3-15 short lowercase tags about what this is ABOUT. Reuse the owner's existing " +
      "topics below whenever they fit; invent new ones only when nothing does.",
    "- lang: BCP-47 tag of the content's language (e.g. en, de, tr).",
    "- entities: the things in this message, one per occurrence. `value` is the thing as it " +
      "appears; `data_json` is a JSON object matching that kind's shape below; " +
      "`from_attachment` is 0 for the owner's own text or the numbered file it came from; " +
      "`confidence` is 0-1.",
    "- Never invent a kind. If something matters and no kind below covers it, use `other` and " +
      "put what you would have called it in data.label.",
    "- Never invent an entity that is not really there. A missing one costs a search; a wrong " +
      "one costs trust.",
    "",
    "Entity kinds:",
  ];

  for (const def of ENTITY_DEFINITIONS) {
    // The registry's own zod schema is what validates the answer, so it is
    // also what the model is shown: one source of truth for the shape.
    const shape = JSON.stringify(z.toJSONSchema(def.data, { io: "input" }));
    lines.push(`- ${def.kind}: ${def.promptHint} data: ${shape}`);
  }

  if (input.candidates.length > 0) {
    lines.push(
      "",
      "Found in the text by pattern matching. Confirm, correct or reject each one, and add " +
        "whatever structure you can. Do not repeat one you reject.",
    );
    for (const c of input.candidates.slice(0, MAX_CANDIDATES)) {
      lines.push(`- ${c.kind}: ${c.value}`);
    }
  }

  if (input.existingTopics.length > 0) {
    lines.push("", `Owner's existing topics: ${input.existingTopics.join(", ")}`);
  }

  lines.push("", "--- MESSAGE ---");
  let budget = MAX_TOTAL_CHARS;
  for (const source of input.sources) {
    if (budget <= 0) break;
    const body = source.text.slice(0, Math.min(MAX_SOURCE_CHARS, budget));
    budget -= body.length;
    lines.push("", `[${source.index}] ${source.label}`, body);
  }
  return lines.join("\n");
}

/**
 * Synthesize one message. Returns the notes to fold into `messages.error`:
 * this stage fails soft, like every other AI stage, and the entities the
 * deterministic pass found are written either way.
 */
export async function synthesizeMessage(job: {
  messageId: string;
  userId: string;
}): Promise<string[]> {
  const notes: string[] = [];
  const message = await db.query.messages.findFirst({ where: eq(messages.id, job.messageId) });
  if (!message) return notes;

  const parts = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      title: attachments.generatedTitle,
      summary: attachments.generatedSummary,
      contentMd: attachmentContents.contentMd,
    })
    .from(attachments)
    .leftJoin(attachmentContents, eq(attachmentContents.attachmentId, attachments.id))
    .where(eq(attachments.messageId, job.messageId))
    .orderBy(asc(attachments.position));

  const sources: SynthesisSource[] = [];
  if (message.text?.trim()) {
    sources.push({
      attachmentId: null,
      index: 0,
      label: "what the owner wrote",
      text: message.text,
    });
  }
  for (const [i, part] of parts.entries()) {
    const body = [part.title, part.summary, part.contentMd].filter(Boolean).join("\n\n");
    sources.push({
      attachmentId: part.id,
      index: i + 1,
      label: part.filename,
      text: body || part.filename,
    });
  }

  // 1. The deterministic pre-pass, per source, so a mention knows which file
  // it came from and can carry a snippet of the sentence it appeared in.
  const found = new Map<string, ResolvedEntity>();
  for (const source of sources) {
    for (const candidate of matchEntities(source.text)) {
      const resolved = resolveEntity(candidate);
      if (!resolved) continue;
      const key = `${resolved.kind}:${resolved.normalizedValue}`;
      if (found.has(key)) continue;
      found.set(key, {
        ...resolved,
        mention: {
          attachmentId: source.attachmentId,
          source: "regex",
          confidence: null,
          snippet: snippetAround(source.text, candidate.index, candidate.value.length),
        },
      });
    }
  }

  if (!openai) {
    // The pre-pass costs nothing and needs no key, so a keyless server still
    // finds links, emails, phones and parcels. It just cannot title, summarize
    // or tag, and says so.
    const snapshots = await enrichLinks(found, notes);
    const keylessWrites = await writeEntities({
      userId: job.userId,
      messageId: job.messageId,
      found: [...found.values()],
    });
    await snapshotArticles(job.userId, snapshots, keylessWrites);
    notes.push(
      "AI is off on this server (no OpenAI API key), so there is no summary or tags; " +
        "links, addresses and numbers were still found by pattern matching",
    );
    return notes;
  }

  // 2. One model call.
  const prompt = buildSynthesisPrompt({
    sources,
    candidates: [...found.values()].map((f) => ({ kind: f.kind, value: f.value })),
    existingTopics: await existingTopicNames(job.userId),
  });

  let result: SynthesisResult | null = null;
  try {
    const res = await openai.responses.parse({
      model: env.AI_ENRICH_MODEL,
      input: prompt,
      text: { format: zodTextFormat(Synthesis, "synthesis") },
    });
    await recordUsage({
      userId: job.userId,
      messageId: job.messageId,
      kind: "enrich",
      model: env.AI_ENRICH_MODEL,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    });
    result = res.output_parsed;
  } catch (err) {
    notes.push(`AI synthesis failed: ${describeAiError(err)}`);
    log.warn("synthesis failed; keeping what the pre-pass found", {
      messageId: job.messageId,
      err: String(err),
    });
  }

  if (result) {
    // 3. Per-kind validation. Anything that does not fit its registry entry is
    // dropped rather than written.
    const byIndex = new Map(sources.map((s) => [s.index, s]));
    for (const raw of result.entities) {
      const source = byIndex.get(raw.from_attachment) ?? sources[0];
      const resolved = resolveEntity({
        kind: raw.kind,
        value: raw.value,
        data: parseJson(raw.data_json),
      });
      if (!resolved) continue;
      const key = `${resolved.kind}:${resolved.normalizedValue}`;
      const at = source ? source.text.indexOf(raw.value) : -1;
      // The model's answer wins over the pre-pass's: it is the same thing,
      // with structure the regex could not know (a carrier, a vendor, a
      // locality). The pre-pass's job was to make sure it was noticed.
      found.set(key, {
        ...resolved,
        generatedTitle: entityTitle(resolved.kind, resolved.value, resolved.data),
        topics: raw.topics,
        mention: {
          attachmentId: source?.attachmentId ?? null,
          source: "ai",
          confidence: clamp01(raw.confidence),
          snippet:
            source && at >= 0
              ? snippetAround(source.text, at, raw.value.length)
              : (found.get(key)?.mention.snippet ?? null),
        },
      });
    }

    await db
      .update(messages)
      .set({
        generatedTitle: result.title.trim() || null,
        generatedSummary: result.summary.trim() || null,
        lang: result.lang.trim() || null,
      })
      .where(eq(messages.id, job.messageId));

    await applyAiTags({
      userId: job.userId,
      messageId: job.messageId,
      types: result.types,
      topics: result.topics,
    });
    for (const entry of result.attachment_topics) {
      const part = parts[entry.index - 1];
      if (part && entry.topics.length > 0) {
        await applyAiTags({ userId: job.userId, attachmentId: part.id, topics: entry.topics });
      }
    }
  }

  // 4. Link enrichment, then 5. the write.
  const snapshots = await enrichLinks(found, notes);
  const written = await writeEntities({
    userId: job.userId,
    messageId: job.messageId,
    found: [...found.values()],
  });
  await snapshotArticles(job.userId, snapshots, written);

  return notes;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clamp01(value: number): number | null {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/**
 * Fetch each link's page for its title, description, favicon and preview
 * image. Links being canonical entities is what makes this cheap: the same URL
 * dumped in five messages is fetched (and snapshotted) once, keyed by the
 * entity rather than by the message.
 */
async function enrichLinks(
  found: Map<string, ResolvedEntity>,
  notes: string[],
): Promise<Map<string, string>> {
  // Article HTML, held by entity key until the id it belongs to is known.
  // Local to the call: two messages carrying the same link can be in flight at
  // once, and a module-level map would let one job's snapshot follow the
  // other's write.
  const snapshots = new Map<string, string>();
  for (const [key, entity] of found) {
    if (entity.kind !== "link") continue;
    if (typeof entity.data.title === "string" && entity.data.title) continue;
    const url = typeof entity.data.url === "string" ? entity.data.url : entity.value;
    try {
      const page = await fetchPage(url);
      const extracted = extractFromHtml(page.html, page.finalUrl);
      entity.data = {
        ...entity.data,
        url,
        ...definedOnly({
          title: extracted.title,
          description: extracted.description,
          siteName: extracted.siteName,
          faviconUrl: extracted.faviconUrl,
          imageUrl: extracted.imageUrl,
          lang: extracted.lang,
          isVideo: extracted.isVideo,
        }),
      };
      entity.generatedTitle = extracted.title ?? entity.generatedTitle ?? null;
      entity.generatedSummary = extracted.description ?? entity.generatedSummary ?? null;
      if (extracted.articleHtml) snapshots.set(key, extracted.articleHtml);
    } catch (err) {
      if (err instanceof NotHtmlError) {
        // A direct link to a file: keep it, with what its URL already says.
        entity.data = { ...entity.data, url, description: `Direct link (${err.contentType})` };
        continue;
      }
      // The SSRF guard, a dead host, a timeout: the link is still a link.
      notes.push(`couldn't read ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return snapshots;
}

function definedOnly(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Store the readable article so the bookmark survives link rot. Keyed by the
 * entity, which is why the same URL in five messages is snapshotted once
 * rather than five times (plan §6.6).
 */
async function snapshotArticles(
  userId: string,
  snapshots: ReadonlyMap<string, string>,
  written: readonly { key: string; entityId: string }[],
): Promise<void> {
  if (!storage || snapshots.size === 0) return;
  const idByKey = new Map(written.map((w) => [w.key, w.entityId]));
  for (const [key, html] of snapshots) {
    const entityId = idByKey.get(key);
    if (!entityId) continue;
    await storage
      .put(
        `snapshots/${userId}/${entityId}.html`,
        new TextEncoder().encode(html),
        "text/html; charset=utf-8",
      )
      .catch((err: unknown) => log.debug("snapshot failed", { entityId, err: String(err) }));
  }
}
