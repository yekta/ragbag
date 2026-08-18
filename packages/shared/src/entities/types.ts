import type { z } from "zod";

// The shape of an entity type. Every type is a row in Postgres now
// (`entity_types` plus `entity_type_fields`), owned by one user and seeded at
// signup from the catalog this build ships (catalog.ts). What stays in code is
// the *behaviour* a few kinds carry: a matcher, a hand-written dedupe rule, a
// title (behaviours.ts), attached by kind name while the row compiles.
//
// A definition alone works end to end: extraction, validation, dedupe, card,
// sidebar row, its own page, search. Behaviour is the exception, not the ladder.
//
// Nothing in here may import React: the web app keeps a parallel map of cards
// keyed by the same strings.

/** One occurrence a deterministic matcher found in a block of text. */
export type EntityCandidate = {
  /** The display form, exactly as it appears in the text. */
  value: string;
  /** Whatever per-kind structure the matcher could determine for free. */
  data: Record<string, unknown>;
  /** Character offset in the scanned text, so a snippet can be cut around it. */
  index: number;
};

/** A candidate plus the kind whose matcher produced it. */
export type KindedCandidate = EntityCandidate & { kind: string };

/**
 * What a field can hold. This list IS the check constraint on
 * `entity_type_fields.type`; the two move together.
 *
 * `text` and `longtext` differ only in how the UI renders them (one line
 * against wrapped); both are strings. `date` is an ISO-8601 string rather than
 * a timestamp, because "2026-08" is a real answer to "when was this issued"
 * and a date column cannot hold it.
 */
export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "integer",
  "bool",
  "date",
  "url",
  "enum",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldSpec = {
  /**
   * The key inside `entities.data`, and the name the model answers with.
   * snake_case, always: one spelling for the jsonb, the wire and the prompt.
   */
  name: string;
  /**
   * What a person sees: "Postal Code". Title Case, and defaulted from `name`
   * (fields.ts `humanize`), so a type only writes it out when the derived one
   * is wrong ("Marka Adı", "VAT No").
   */
  label: string;
  type: FieldType;
  /** An `enum`'s complete vocabulary. Absent for every other type. */
  values?: readonly string[];
  required: boolean;
  /** One line for the model. Never rendered. */
  description?: string;
};

/**
 * One type as declared: exactly what a row carries, and nothing a function
 * could only express in code.
 *
 * That split is the point. This half is data, so a user can add, edit, disable
 * and delete their own kinds without a deploy; the other half is `EntityBehaviour`
 * below, looked up by kind name.
 */
export type EntityTypeDef = {
  /** The value stored in `entities.kind`. An open text column, never an enum. */
  kind: string;
  /** What one of them is called: "Phone Number". Title Case. */
  label: string;
  /**
   * What a group of them is called: the sidebar row, the search-result heading,
   * the settings row. Title Case, because it sits beside "Images", "Files" and
   * "Favorites" in the sidebar, and one row reading "Phone numbers" next to
   * those read like a typo.
   *
   * Its own field rather than a pluralized `label`, because pluralizing is a
   * per-language problem no rule gets right, and this is copy a user writes.
   */
  sidebarTitle: string;
  /**
   * The path segment this kind lives at (`/links`, `/addresses`). Its own
   * field rather than a lowercased title, because these are URLs someone can
   * bookmark and the title is copy that can be reworded.
   */
  slug: string;
  /** Icon name in the web app's registry (apps/web/src/components/icon.tsx). */
  icon: string;
  /** Whether this kind gets its own row in the sidebar's Things section. */
  inSidebar: boolean;
  /** One line telling the synthesis model what this kind is. */
  promptHint: string;
  /** The fields, in the order the prompt, the card and Details show them. */
  fields: readonly FieldSpec[];
  /** A few real values, so the model can see what it is looking for. */
  examples?: readonly string[];
  /** `{field}` template for the display title, e.g. `"{name}"`. */
  titleTemplate?: string;
  /**
   * Which fields form the dedupe key, in order. Ignored when the kind has a
   * `normalize` behaviour, which is how the hand-written rules keep winning.
   */
  keyFields?: readonly string[];
  /**
   * False means "stop extracting": the type leaves the prompt and the sidebar,
   * and every thing it already found stays, still drawn under its own labels.
   */
  enabled?: boolean;
  /**
   * Bumped by Postgres whenever the type or one of its fields changes. Stamped
   * onto every entity the type writes, so a later run can tell that the shape
   * moved under it.
   */
  version?: number;
};

/**
 * The code attached to a kind by name: what a row cannot say.
 *
 * Looked up while compiling (behaviours.ts), so a row whose kind has no entry
 * is a plain declared type and a row that claims `link` gets the URL matcher,
 * the tracking-param-stripping dedupe and the page fetcher whoever wrote it.
 */
export type EntityBehaviour = {
  /**
   * The free, deterministic pre-pass. Code-only, and absent for the kinds that
   * genuinely need judgment: a regex there would only invent things for the
   * model to have to reject.
   */
  match?: (text: string) => EntityCandidate[];
  /**
   * The dedupe key behind `unique (user_id, kind, normalized_value)`.
   *
   * Returns null when the value cannot be normalized with confidence, which
   * drops the entity rather than risking a merge. A wrong merge (two different
   * addresses collapsing into one) is worse than a missed one.
   */
  normalize?: (value: string, data: Record<string, unknown>) => string | null;
  /** What to call it before the model has written a title of its own. */
  title?: (value: string, data: Record<string, unknown>) => string;
};

/** A definition compiled for use: the zod validator, and the behaviour resolved. */
export type EntityType = EntityTypeDef & {
  version: number;
  enabled: boolean;
  /** Built from `fields`. What validates the model's answer before it is written. */
  data: z.ZodType;
  match?: (text: string) => EntityCandidate[];
  normalize: (value: string, data: Record<string, unknown>) => string | null;
  title: (value: string, data: Record<string, unknown>) => string;
};

/** One filled field of one entity, ready to render. */
export type FieldEntry = { name: string; label: string; value: string };

/**
 * The resolved set: one user's rows, compiled.
 *
 * Everything that used to be a module-level registry lookup is a method here,
 * because the set is no longer a constant. The server resolves one per
 * ingestion job (so a type added mid-run cannot half-apply) and the web app
 * resolves one from the synced rows.
 */
export type EntityTypes = {
  /** Every type in the set, disabled ones included, in the order given. */
  list: readonly EntityType[];
  /** The kinds the model may answer with: enabled only, and no `other`. */
  kinds: readonly string[];
  /** The enabled types that claim a sidebar row, in the same order. */
  sidebar: readonly EntityType[];
  get: (kind: string) => EntityType | undefined;
  bySlug: (slug: string) => EntityType | undefined;
  /** A human name for a kind, including one this build has never heard of. */
  label: (kind: string) => string;
  sidebarTitle: (kind: string) => string;
  icon: (kind: string) => string;
  /** Every matcher in the set, run over one block of text. */
  match: (text: string) => KindedCandidate[];
  /** Validate one entity's fields, or null to drop it. */
  parseData: (kind: string, data: unknown) => Record<string, unknown> | null;
  normalize: (kind: string, value: string, data: Record<string, unknown>) => string | null;
  title: (kind: string, value: string, data: Record<string, unknown>) => string;
  /** The filled fields of one entity, in declared order, with their labels. */
  fieldEntries: (kind: string, data: Record<string, unknown>) => FieldEntry[];
};
