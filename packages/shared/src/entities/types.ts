import type { z } from "zod";

// The shape of one entry in the entity registry (plan §3.3). It lives in
// @ragbag/shared because the server needs matchers, normalizers and
// validators, and the client needs the same list for the rail and the search
// facets. Nothing in here may import React: the web app keeps a parallel map
// of cards keyed by the same strings.

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

export type EntityDefinition = {
  /** The value stored in `entities.kind`. An open text column, never an enum. */
  kind: string;
  /** Rail row and search-result group heading. */
  label: string;
  plural: string;
  /**
   * The path segment this kind lives at (`/links`, `/addresses`). Its own
   * field rather than a lowercased plural, because these are URLs someone can
   * bookmark and the plural is copy that can be reworded. It is also why a new
   * kind gets a route for free: `SLUG_BY_VIEW` is built from the registry.
   */
  slug: string;
  /** Icon name in the web app's registry (apps/web/src/components/icon.tsx). */
  icon: string;
  /** Whether this kind gets its own row in the rail's Things section. */
  railRow: boolean;
  /** One line telling the synthesis model what this kind is (plan §5.4). */
  promptHint: string;
  /** Per-kind structured fields, stored in `entities.data` as jsonb. */
  data: z.ZodType;
  /**
   * The free, deterministic pre-pass. Absent for the kinds that genuinely
   * need judgment (addresses, invoices): a regex there would only invent
   * things for the model to have to reject.
   */
  match?: (text: string) => EntityCandidate[];
  /**
   * The dedupe key behind `unique (user_id, kind, normalized_value)`.
   *
   * Returns null when the value cannot be normalized with confidence, which
   * drops the entity rather than risking a merge. A wrong merge (two
   * different addresses collapsing into one) is worse than a missed one.
   */
  normalize: (value: string, data: Record<string, unknown>) => string | null;
  /** What to call it before the model has written a title of its own. */
  title?: (value: string, data: Record<string, unknown>) => string;
};
