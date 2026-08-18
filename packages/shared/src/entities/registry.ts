import { BEHAVIOURS } from "./behaviours.js";
import {
  dataSchema,
  fieldEntries,
  field,
  humanize,
  normalizerFromKey,
  titleFromTemplate,
} from "./fields.js";
import {
  FIELD_TYPES,
  type EntityType,
  type EntityTypeDef,
  type EntityTypes,
  type FieldSpec,
  type FieldType,
  type KindedCandidate,
} from "./types.js";

// Resolving a set of entity types.
//
// Every type is a row (`entity_types` + `entity_type_fields`) belonging to one
// user, seeded at signup from the catalog and theirs to edit from then on. A
// row compiles to `EntityType` here, picking up whatever behaviour code has
// registered for its kind, and the resolved `EntityTypes` is what the prompt,
// the validator and the UI read.
//
// Nothing is a module-level constant: the server resolves a set per ingestion
// job and the client resolves one from the synced rows, which is what makes
// "the set is fixed for a given job" true rather than aspirational.

/**
 * Fill in what a definition leaves to be derived: the validator from its
 * fields, and the dedupe key and title from its own behaviour if its kind has
 * any, otherwise from what it declared.
 *
 * Behaviour wins outright (plan §10.3). A `link` row cannot describe the dedupe
 * that strips tracking params, so `key_rank` on it is ignored rather than
 * fought with, and settings hides the column for those kinds.
 */
export function compileEntityType(def: EntityTypeDef): EntityType {
  const behaviour = BEHAVIOURS[def.kind];
  return {
    ...def,
    version: def.version ?? 0,
    enabled: def.enabled ?? true,
    data: dataSchema(def.fields),
    match: behaviour?.match,
    normalize: behaviour?.normalize ?? normalizerFromKey(def.keyFields ?? [], def.fields),
    title: behaviour?.title ?? titleFromTemplate(def.titleTemplate) ?? ((value) => value),
  };
}

/**
 * One `entity_types` row, structurally. Written as a plain shape rather than
 * imported from drizzle or Zero so the same mapper serves the server's rows and
 * the client's synced ones.
 */
export type EntityTypeRow = {
  kind: string;
  label: string;
  sidebarTitle: string;
  slug: string;
  icon: string;
  hint: string;
  titleTemplate?: string | null;
  examples?: readonly string[] | null;
  sidebar: boolean;
  /** Absent on the server, which filters disabled types out in SQL. */
  enabled?: boolean;
  version: number;
};

/** One `entity_type_fields` row, same deal. */
export type EntityTypeFieldRow = {
  name: string;
  label: string;
  type: string;
  values?: readonly string[] | null;
  required: boolean;
  description?: string | null;
  position: number;
  keyRank?: number | null;
};

function isFieldType(type: string): type is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(type);
}

/**
 * One declared type, as its rows describe it.
 *
 * Returns null for rows this build cannot make sense of: a field type it has
 * never heard of, or an enum with no vocabulary. The check constraints make
 * both unreachable from SQL; this is the belt to that braces, and the caller
 * logs and skips rather than failing a job over config.
 *
 * No fields at all is fine, and means what it says: the thing is its own value
 * (a recipe name, a person), with no structure worth filling in.
 */
export function typeFromRows(
  row: EntityTypeRow,
  fieldRows: readonly EntityTypeFieldRow[],
): EntityTypeDef | null {
  if (!row.kind || !row.label || !row.slug) return null;
  const ordered = [...fieldRows].toSorted((a, b) => a.position - b.position);
  const fields: FieldSpec[] = [];
  for (const spec of ordered) {
    if (!isFieldType(spec.type)) return null;
    const values = spec.values ?? undefined;
    if (spec.type === "enum" && (!values || values.length === 0)) return null;
    fields.push(
      field(spec.name, spec.type, {
        label: spec.label || humanize(spec.name),
        required: spec.required,
        values,
        description: spec.description ?? undefined,
      }),
    );
  }
  return {
    kind: row.kind,
    label: row.label,
    sidebarTitle: row.sidebarTitle || row.label,
    slug: row.slug,
    icon: row.icon || "sparkles",
    inSidebar: row.sidebar,
    enabled: row.enabled ?? true,
    promptHint: row.hint,
    fields,
    examples: row.examples ?? undefined,
    titleTemplate: row.titleTemplate ?? undefined,
    // key_rank orders the key; a field outside it has none.
    keyFields: ordered
      .filter((spec) => spec.keyRank !== null && spec.keyRank !== undefined)
      .toSorted((a, b) => a.keyRank! - b.keyRank!)
      .map((spec) => spec.name),
    version: row.version,
  };
}

/**
 * A label's words, folded to ASCII: "Şarkı Listesi" to `["sark", "listesi"]`.
 *
 * A kind and a slug are keys, not copy: one is a jsonb-adjacent identifier and
 * the other is a URL segment, and both are ASCII by constraint. The label is
 * the part a person reads, and it keeps every letter it was typed with.
 */
function keyWords(label: string): string[] {
  return (
    label
      .normalize("NFKD")
      // What the decomposition left behind: the cedilla of Ş, the umlaut of Ö.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

/**
 * "Trading Cards" to `trading_cards`: a label, as the kind derived from it.
 *
 * Always returns something valid, because a label with no ASCII in it at all
 * still has to produce a key. Collisions are the caller's to resolve with
 * `freeName`; a kind is immutable once entities reference it (plan §10.1), so
 * this runs once, at creation.
 */
export function kindFromLabel(label: string): string {
  let base = keyWords(label).join("_").slice(0, 40);
  if (/^[0-9]/.test(base)) base = `t_${base}`;
  if (base.replace(/_+$/, "").length < 2) base = base ? `${base}_type` : "type";
  return base.slice(0, 40).replace(/_+$/, "");
}

/** "Trading Cards" to `trading-cards`: the same label, as a URL segment. */
export function slugFromLabel(label: string): string {
  return keyWords(label).join("-").slice(0, 48).replace(/-+$/, "") || "things";
}

/**
 * `books`, then `books-2`, then `books-3`: the first spelling nothing has taken.
 *
 * What makes deriving a kind from a label safe. A user calling their type
 * "Links" gets `links_2` rather than the kind this build understands itself, so
 * the only way to get `link` is to install it from the catalog (plan §10.2).
 */
export function freeName(
  base: string,
  taken: Iterable<string>,
  opts: { separator?: string; max?: number } = {},
): string {
  const { separator = "_", max = 40 } = opts;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const trim = (raw: string) => raw.slice(0, max).replace(/[_-]+$/, "");
  for (let n = 2; ; n += 1) {
    const suffix = `${separator}${n}`;
    const candidate = `${trim(base.slice(0, max - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * A definition as the two tables hold it, which is what installing a catalog
 * entry writes.
 *
 * The inverse of `typeFromRows`, and shared so the server's seeder and the
 * client's `entityType.install` mutator derive `position` and `key_rank` the
 * same way rather than each having its own idea of the order.
 */
export function typeRowFor(def: EntityTypeDef): EntityTypeRow {
  return {
    kind: def.kind,
    label: def.label,
    sidebarTitle: def.sidebarTitle,
    slug: def.slug,
    icon: def.icon,
    hint: def.promptHint,
    titleTemplate: def.titleTemplate ?? null,
    examples: def.examples ?? [],
    sidebar: def.inSidebar,
    enabled: def.enabled ?? true,
    version: def.version ?? 1,
  };
}

/** The field rows of one definition, in declared order. */
export function fieldRowsFor(def: EntityTypeDef): EntityTypeFieldRow[] {
  const keyFields = def.keyFields ?? [];
  return def.fields.map((spec, position) => {
    const rank = keyFields.indexOf(spec.name);
    return {
      name: spec.name,
      label: spec.label,
      type: spec.type,
      values: spec.values ?? null,
      required: spec.required,
      description: spec.description ?? null,
      position,
      keyRank: rank < 0 ? null : rank + 1,
    };
  });
}

/**
 * The deterministic pre-pass: every type in the set with a matcher, run over one
 * block of text. Free, instant, and it never invents a tracking number out of a
 * random alphanumeric. What comes back is candidates for the model to confirm,
 * correct or reject, not a result.
 *
 * Deduped by (kind, normalized value): the same URL twice in one message is one
 * entity with, at this stage, one candidate.
 */
function matchIn(types: readonly EntityType[], text: string): KindedCandidate[] {
  const found: KindedCandidate[] = [];
  const seen = new Set<string>();
  for (const type of types) {
    if (!type.match || !type.enabled) continue;
    for (const candidate of type.match(text)) {
      const key = `${type.kind}:${type.normalize(candidate.value, candidate.data) ?? candidate.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ ...candidate, kind: type.kind });
    }
  }
  return found.toSorted((a, b) => a.index - b.index);
}

/**
 * One user's declared types, compiled into the set in effect for them.
 *
 * First claim wins on both a kind and a slug. `unique (user_id, kind)` and
 * `unique (user_id, slug)` make that unreachable from SQL; it is here so a
 * duplicate can never make two entries of one list fight over a URL.
 *
 * A disabled type stays in the set and out of `kinds` and `sidebar`: it may not be
 * extracted any more, and everything it already found still draws under its own
 * labels, which is the difference between disabling a type and deleting one.
 */
export function resolveEntityTypes(declared: readonly EntityTypeDef[]): EntityTypes {
  const byKind = new Map<string, EntityType>();
  for (const def of declared) {
    if (byKind.has(def.kind)) continue;
    byKind.set(def.kind, compileEntityType(def));
  }
  const list = [...byKind.values()];
  const bySlug = new Map<string, EntityType>();
  for (const type of list) if (!bySlug.has(type.slug)) bySlug.set(type.slug, type);

  return {
    list,
    kinds: list.filter((type) => type.enabled).map((type) => type.kind),
    sidebar: list.filter((type) => type.inSidebar && type.enabled),
    get: (kind) => byKind.get(kind),
    bySlug: (slug) => bySlug.get(slug),
    // A kind this set has never heard of is data, not an error: it renders
    // through the generic card under a humanized version of its own name.
    label: (kind) => byKind.get(kind)?.label ?? humanize(kind),
    sidebarTitle: (kind) => byKind.get(kind)?.sidebarTitle ?? humanize(kind),
    icon: (kind) => byKind.get(kind)?.icon ?? "sparkles",
    match: (text) => matchIn(list, text),
    parseData: (kind, data) => {
      const type = byKind.get(kind);
      if (!type) return null;
      const parsed = type.data.safeParse(data ?? {});
      return parsed.success ? (parsed.data as Record<string, unknown>) : null;
    },
    normalize: (kind, value, data) => byKind.get(kind)?.normalize(value, data) ?? null,
    title: (kind, value, data) => byKind.get(kind)?.title(value, data) ?? value,
    fieldEntries: (kind, data) => fieldEntries(byKind.get(kind)?.fields ?? [], data),
  };
}

/** How much text either side of a match a mention's snippet carries. */
const SNIPPET_PAD = 60;

/**
 * The `why it matched` line on a mention: the match with enough of its sentence
 * around it to recognise, on one line, ellipsed at both ends when it was cut.
 * Newlines are folded out; a snippet is a caption, not an excerpt.
 */
export function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_PAD);
  const end = Math.min(text.length, index + length + SNIPPET_PAD);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
