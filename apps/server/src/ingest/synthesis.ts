import { log, promptSchema, snippetAround } from "@ragbag/shared";
import type { TEntityTypes } from "@ragbag/shared";
import { asc, eq } from "drizzle-orm";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { storage } from "../blobs/storage.js";
import { db } from "../db/client.js";
import { attachmentContents, attachments, messages } from "../db/schema.js";
import { loadEntityTypes, seedEntityTypes } from "../entity-types.js";
import { env } from "../env.js";
import {
  applyAiTags,
  existingTopicNames,
  resolveEntity,
  writeEntities,
  type TResolvedEntity,
} from "./entities.js";
import { extractFromHtml } from "./extract-link.js";
import { NotHtmlError, fetchPage } from "./fetch-page.js";
import { describeAiError, openai } from "./openai.js";
import { recordUsage, tokenUsage } from "./usage.js";

// Phase B (plan §5.4): read the whole message and pull the things out of it.
//
//   0. Pin the type set: every enabled type this user keeps (entity-types.ts).
//      Everything below reads that one set, so a type added or deleted mid-run
//      cannot half-apply to this message.
//   1. Deterministic pre-pass. Every type in the set with a `match` runs over
//      the text: URLs, emails, phone numbers, tracking-shaped strings. Free,
//      instant, and it never hallucinates a tracking number out of a random
//      alphanumeric.
//   2. One model call. It receives the step-1 candidates to confirm, correct
//      or reject, plus the pinned kinds with their hints and the exact shape of
//      each one's fields, for the kinds that need judgment.
//   3. Per-kind validation against those fields. Anything failing is dropped.
//   4. Link enrichment through the existing page fetcher.
//   5. The idempotent write (entities.ts).
//
// Hybrid extraction is the point. URLs, emails, phones and most tracking
// numbers have strong syntactic signatures: regex finds them for free and
// never invents them, and the model's job is confirmation, enrichment and the
// judgment cases. Model-only extraction confidently labels random
// alphanumerics as tracking numbers.
//
// The set being closed is the other half. There is no `other` kind, so a model
// that finds something no kind covers leaves it out instead of coining a kind
// for it: those came back one spelling per message ("marka adı", "slogan"),
// deduplicated against nothing and browsable nowhere.

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

/**
 * The structured-output schema, built from the kinds this job pinned.
 *
 * `kind` is an enum of exactly those kinds, which is where the set stops being
 * a suggestion: the model cannot name a type nobody declared, and the
 * validation in entities.ts would drop it even if it did.
 *
 * A user who deleted every type still gets a title, a summary and tags, so the
 * enum falls back to one kind nothing can be written under rather than to an
 * empty vocabulary, which no structured-output API accepts.
 */
export function buildSynthesisSchema(types: TEntityTypes) {
  const kinds = (types.kinds.length > 0 ? types.kinds : ["none"]) as [string, ...string[]];
  return z.object({
    /** Short, for search results, permalinks and grids. */
    title: z.string(),
    /** 1-3 plain sentences. Plain text, never markdown: it renders in chips. */
    summary: z.string(),
    lang: z.string(),
    types: z.array(z.enum(MESSAGE_TYPE_TAGS)),
    topics: z.array(z.string()),
    entities: z.array(
      z.object({
        kind: z.enum(kinds),
        value: z.string(),
        /**
         * The kind's fields as a JSON object, serialized.
         *
         * A string rather than a nested object because strict structured
         * outputs need every property of every object declared up front, and
         * these differ per kind. Keeping it a string leaves the field rows as
         * the single authority on the shape: they are what the prompt shows the
         * model (as JSON Schema) and what validates the answer (as zod).
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
}

export type TSynthesisResult = z.infer<ReturnType<typeof buildSynthesisSchema>>;

/** One thing the model reads: the message's own words, or one attachment. */
export type TSynthesisSource = {
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
  sources: readonly TSynthesisSource[];
  candidates: readonly { kind: string; value: string }[];
  existingTopics: readonly string[];
  types: TEntityTypes;
}): string {
  const lines: string[] = [
    "You are the synthesis stage of ragbag, a personal archive. One message was sent: " +
      "the owner's own words plus the files they sent with it. Title it, summarize it, " +
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
      "appears; `data_json` is a JSON object matching that kind's shape below, with the field " +
      "names spelled exactly as they are written there; `from_attachment` is 0 for the owner's " +
      "own text or the numbered file it came from; `confidence` is 0-1.",
    "- The kinds below are the complete list, and there is no bucket for anything else. If " +
      "something matters and no kind covers it, leave it out: a kind you invent is a kind " +
      "nothing can group, browse or merge.",
    "- Fill a kind's required fields or leave the thing out. An `enum` field takes one of the " +
      "values listed for it and nothing else.",
    "- Never invent an entity that is not really there. A missing one costs a search; a wrong " +
      "one costs trust.",
    "",
    "Entity kinds:",
  ];

  for (const type of input.types.list) {
    // Generated from the same field rows that validate the answer, so the shape
    // the model is shown and the shape that is enforced cannot drift. The
    // labels ride along in each field's description.
    const shape = JSON.stringify(promptSchema(type.fields));
    const examples = type.examples?.length ? ` For example: ${type.examples.join(", ")}.` : "";
    lines.push(`- ${type.kind}: ${type.promptHint}${examples} data: ${shape}`);
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

  // 0. The set this job runs against, read once. Every step below takes it as
  // an argument rather than reaching for a module-level registry, which is what
  // makes the set fixed for this message even while types are being edited.
  //
  // The seed is the safety net for a signup hook that failed and for accounts
  // created before types were per user. It is gated on `user.types_seeded_at`,
  // so it fires once per account and never resurrects a type the user deleted.
  await seedEntityTypes(job.userId);
  const types = await loadEntityTypes(job.userId);

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

  const sources: TSynthesisSource[] = [];
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
  const found = new Map<string, TResolvedEntity>();
  for (const source of sources) {
    for (const candidate of types.match(source.text)) {
      const resolved = resolveEntity(types, candidate);
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
    types,
  });

  let result: TSynthesisResult | null = null;
  try {
    const res = await openai.responses.parse({
      model: env.AI_ENRICH_MODEL,
      input: prompt,
      text: { format: zodTextFormat(buildSynthesisSchema(types), "synthesis") },
    });
    await recordUsage({
      userId: job.userId,
      messageId: job.messageId,
      kind: "enrich",
      model: env.AI_ENRICH_MODEL,
      seconds: 0,
      ...tokenUsage({ usage: res.usage, stage: "enrich" }),
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
    // 3. Per-kind validation. Anything that does not fit its type's fields is
    // dropped rather than written.
    const byIndex = new Map(sources.map((s) => [s.index, s]));
    for (const raw of result.entities) {
      const source = byIndex.get(raw.from_attachment) ?? sources[0];
      const resolved = resolveEntity(types, {
        kind: raw.kind,
        value: raw.value,
        data: parseJson(raw.data_json),
      });
      if (!resolved) continue;
      const key = `${resolved.kind}:${resolved.normalizedValue}`;
      const at = source ? source.text.indexOf(raw.value) : -1;
      // The model's answer wins over the pre-pass's, field by field rather than
      // wholesale: it is the same thing, with structure the regex could not
      // know (a status, a vendor, a locality), and the pre-pass knew things the
      // model leaves out (the carrier a 1Z number can only be). A field the
      // model did not fill is not a field it denied, and the write merges the
      // two across runs anyway (entities.ts), so replacing here only made one
      // run less careful than two.
      const data = { ...found.get(key)?.data, ...filled(resolved.data) };
      found.set(key, {
        ...resolved,
        data,
        generatedTitle: types.title(resolved.kind, resolved.value, data),
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
 * sent in five messages is fetched (and snapshotted) once, keyed by the
 * entity rather than by the message.
 */
async function enrichLinks(
  found: Map<string, TResolvedEntity>,
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
      // snake_case on the way in: the extractor's own type is TypeScript, but
      // these keys are `entities.data` and every field name there is the
      // spelling its type declares.
      entity.data = {
        ...entity.data,
        url,
        ...filled({
          title: extracted.title,
          description: extracted.description,
          site_name: extracted.siteName,
          favicon_url: extracted.faviconUrl,
          image_url: extracted.imageUrl,
          lang: extracted.lang,
          is_video: extracted.isVideo,
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

/**
 * The fields an answer actually filled. An absent one and an empty one say the
 * same nothing, and neither may overwrite something already known.
 */
function filled(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ""));
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
