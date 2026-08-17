import { addressEntity } from "./address.js";
import { emailEntity } from "./email.js";
import { invoiceEntity } from "./invoice.js";
import { linkEntity } from "./link.js";
import { otherEntity } from "./other.js";
import { phoneEntity } from "./phone.js";
import { trackingEntity } from "./tracking.js";
import type { EntityDefinition, KindedCandidate } from "./types.js";

// The entity registry (plan §3.3). Adding a kind is one entry here and zero
// migrations: `entities.kind` is an open text column and the per-kind fields
// live in `entities.data` jsonb, validated by that entry's zod schema.
//
// Order is the order the rail lists them in.

export * from "./types.js";
export { addressQuery, mapsSearchUrl } from "./address.js";
export { trackingUrl } from "./tracking.js";

export const ENTITY_DEFINITIONS = [
  linkEntity,
  addressEntity,
  trackingEntity,
  invoiceEntity,
  emailEntity,
  phoneEntity,
  otherEntity,
] as const satisfies readonly EntityDefinition[];

/** The kinds this build knows. The column accepts any string; see below. */
export const ENTITY_KINDS = ENTITY_DEFINITIONS.map((d) => d.kind);

/**
 * The kinds a client of this build can name.
 *
 * Deliberately NOT how the column is typed. `entities.kind` is `text` in
 * Postgres and `string()` in the Zero schema, so a client on an older build
 * that receives a kind it has never heard of gets data rather than a type it
 * cannot represent, and renders it through the generic fallback card.
 */
export type EntityKind = (typeof ENTITY_DEFINITIONS)[number]["kind"];

const BY_KIND = new Map(ENTITY_DEFINITIONS.map((d) => [d.kind, d as EntityDefinition]));

export function entityDefinition(kind: string): EntityDefinition | undefined {
  return BY_KIND.get(kind);
}

/** Rows the rail's Things section offers, in registry order. */
export const RAIL_ENTITY_KINDS: readonly EntityDefinition[] = ENTITY_DEFINITIONS.filter(
  (d) => d.railRow,
);

/** A human name for a kind, including one this build has never heard of. */
export function entityLabel(kind: string): string {
  return entityDefinition(kind)?.label ?? kind;
}

export function entityPlural(kind: string): string {
  return entityDefinition(kind)?.plural ?? kind;
}

const BY_SLUG = new Map(ENTITY_DEFINITIONS.map((d) => [d.slug, d as EntityDefinition]));

/** Which entity kind a path segment names, if it names one. */
export function entityKindForSlug(slug: string): string | undefined {
  return BY_SLUG.get(slug)?.kind;
}

/**
 * Validate one entity's structured fields against its kind. Returns null for
 * an unknown kind or a shape that does not fit, which drops the entity rather
 * than writing something no card can render (plan §5.4 step 3).
 */
export function parseEntityData(kind: string, data: unknown): Record<string, unknown> | null {
  const def = entityDefinition(kind);
  if (!def) return null;
  const parsed = def.data.safeParse(data ?? {});
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/** The dedupe key for one entity, or null when normalization is unsure. */
export function normalizeEntity(
  kind: string,
  value: string,
  data: Record<string, unknown>,
): string | null {
  return entityDefinition(kind)?.normalize(value, data) ?? null;
}

/** What to call an entity before the model has written it a title. */
export function entityTitle(kind: string, value: string, data: Record<string, unknown>): string {
  const def = entityDefinition(kind);
  return def?.title?.(value, data) ?? value;
}

/**
 * The deterministic pre-pass (plan §5.4 step 1): every registry entry with a
 * matcher, run over one block of text. Free, instant, and it never invents a
 * tracking number out of a random alphanumeric. What comes back is a list of
 * candidates for the model to confirm, correct or reject, not a result.
 *
 * Deduped by (kind, normalized value): the same URL twice in one message is
 * one entity with, at this stage, one candidate.
 */
export function matchEntities(text: string): KindedCandidate[] {
  const found: KindedCandidate[] = [];
  const seen = new Set<string>();
  for (const def of ENTITY_DEFINITIONS) {
    if (!def.match) continue;
    for (const candidate of def.match(text)) {
      const key = `${def.kind}:${def.normalize(candidate.value, candidate.data) ?? candidate.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ ...candidate, kind: def.kind });
    }
  }
  return found.toSorted((a, b) => a.index - b.index);
}

/** How much text either side of a match a mention's snippet carries. */
const SNIPPET_PAD = 60;

/**
 * The `why it matched` line on a mention: the match with enough of its
 * sentence around it to recognise, on one line, ellipsed at both ends when it
 * was cut. Newlines are folded out; a snippet is a caption, not an excerpt.
 */
export function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_PAD);
  const end = Math.min(text.length, index + length + SNIPPET_PAD);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
