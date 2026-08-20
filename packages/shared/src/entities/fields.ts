import { z } from "zod";
import type { TFieldEntry, TFieldSpec, TFieldType } from "./types.js";

// Everything derived from a type's field list. One list, four consumers:
//
//   dataSchema    the zod object that validates what the model returned
//   promptSchema  the JSON Schema the prompt shows it beforehand
//   fieldEntries  the labelled, ordered rows the card and Details render
//   normalizerFromKey / titleFromTemplate   the dedupe key and the display title
//
// That is the point of moving shapes out of hand-written zod: a field's name,
// label, order and vocabulary are declared once, and no consumer can drift.

/** Words that look wrong in Title Case. */
const ACRONYMS = new Set(["url", "id", "vat", "iban", "sku", "isbn", "no", "pdf", "eta", "po"]);

/**
 * "postal_code" to "Postal Code".
 *
 * The default field label, and the fallback for a key no type declares any
 * more (a renamed field on an entity written by an older build).
 */
export function humanize(name: string): string {
  const words = name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word[0]!.toUpperCase() + word.slice(1),
    );
  return words.join(" ") || name;
}

/** One field, with the label humanized from the name unless it is given. */
export function field(
  name: string,
  type: TFieldType,
  opts: {
    label?: string;
    required?: boolean;
    values?: readonly string[];
    description?: string;
  } = {},
): TFieldSpec {
  return {
    name,
    label: opts.label ?? humanize(name),
    type,
    values: opts.values,
    required: opts.required ?? false,
    description: opts.description,
  };
}

function leafFor(spec: TFieldSpec): z.ZodType {
  switch (spec.type) {
    case "enum":
      return z.enum([...(spec.values ?? [])] as [string, ...string[]]);
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "bool":
      return z.boolean();
    default:
      // text, longtext, date (ISO-8601) and url are all strings on the wire.
      return z.string();
  }
}

/**
 * The zod object that validates one kind's `data`.
 *
 * Unknown keys are stripped rather than rejected (zod's default), which is what
 * quietly drops a field a type used to declare instead of failing the whole
 * entity over it.
 */
export function dataSchema(fields: readonly TFieldSpec[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const spec of fields) {
    // The check constraint forbids it, so this only fires on a row written
    // before the constraint existed. Skipping the field beats compiling a
    // z.enum with no members, which throws.
    if (spec.type === "enum" && !spec.values?.length) continue;
    const leaf = leafFor(spec);
    shape[spec.name] = spec.required
      ? leaf
      : spec.type === "enum"
        ? // A value outside an OPTIONAL enum's vocabulary costs the field, not
          // the entity: the model reaching for a word the type never declared
          // is the one failure tolerating is cheaper than dropping.
          leaf.optional().catch(undefined)
        : leaf.optional();
  }
  return z.object(shape);
}

/**
 * The JSON Schema the prompt prints for one kind.
 *
 * Generated from the fields rather than from the compiled zod: we own the
 * fields, `z.toJSONSchema` has opinions about wrappers like `.catch()`, and
 * this way the label rides along in the description so the model reads the
 * words a person would use for the field and not just its snake_case key.
 */
export function promptSchema(fields: readonly TFieldSpec[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const spec of fields) {
    const property: Record<string, unknown> = { type: jsonType(spec.type) };
    if (spec.type === "enum") property.enum = spec.values ?? [];
    if (spec.type === "date") property.format = "date";
    if (spec.type === "url") property.format = "uri";
    property.description = spec.description ? `${spec.label}. ${spec.description}` : spec.label;
    properties[spec.name] = property;
    if (spec.required) required.push(spec.name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

function jsonType(type: TFieldType): string {
  switch (type) {
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "bool":
      return "boolean";
    default:
      return "string";
  }
}

/** How one field's value reads, or null when there is nothing to show. */
export function displayValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  // Nothing else can be in there: no field type produces an array or an object.
  return null;
}

/**
 * The filled fields of one entity, in declared order, then any key the type no
 * longer declares, humanized, at the end.
 *
 * Both halves matter. Declared order is why Details reads Name, Street,
 * Locality rather than whatever order the jsonb happens to hold; the tail is
 * why editing a type never blanks data that is already stored.
 */
export function fieldEntries(
  fields: readonly TFieldSpec[],
  data: Record<string, unknown>,
): TFieldEntry[] {
  const entries: TFieldEntry[] = [];
  const declared = new Set<string>();
  for (const spec of fields) {
    declared.add(spec.name);
    const value = displayValue(data[spec.name]);
    if (value !== null) entries.push({ name: spec.name, label: spec.label, value });
  }
  for (const [name, raw] of Object.entries(data)) {
    if (declared.has(name)) continue;
    const value = displayValue(raw);
    if (value !== null) entries.push({ name, label: humanize(name), value });
  }
  return entries;
}

/** Case and spacing are noise in a dedupe key; everything else is signal. */
function fold(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The dedupe key for a declared type: the leading run of filled key fields,
 * folded and joined in the order they were declared.
 *
 * Only an empty *first* part drops the entity, because that is the part the
 * thing is. A trailing one is optional: a book keys on `title|author`, and a
 * recommendation that never named the author is still a book worth keeping, so
 * it keys on its title alone. That leaves it a separate row from the same book
 * with an author, which is a missed merge rather than a wrong one, the trade
 * this app makes everywhere.
 *
 * A type that declares no key falls back to its own value, which is the least
 * surprising thing a one-field type can do.
 */
export function normalizerFromKey(
  keyFields: readonly string[],
  fields: readonly TFieldSpec[],
): (value: string, data: Record<string, unknown>) => string | null {
  const declared = new Set(fields.map((spec) => spec.name));
  const keys = keyFields.filter((name) => declared.has(name));
  return (value, data) => {
    if (keys.length === 0) return fold(value) || null;
    const parts: string[] = [];
    for (const key of keys) {
      const part = fold(displayValue(data[key]) ?? "");
      if (!part) break;
      parts.push(part);
    }
    return parts.length > 0 ? parts.join("|") : null;
  };
}

/** `"{name}"` filled from the entity's data, falling back to its value. */
export function titleFromTemplate(
  template: string | null | undefined,
): ((value: string, data: Record<string, unknown>) => string) | undefined {
  if (!template?.trim()) return undefined;
  return (value, data) => {
    const filled = template
      .replace(/\{([a-z0-9_]+)\}/gi, (_, key: string) => displayValue(data[key]) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return filled || value;
  };
}
