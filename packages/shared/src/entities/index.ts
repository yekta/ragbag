// The entity types. Every one is a row in `entity_types` plus its
// `entity_type_fields` rows, owned by one user: a new account is seeded with the
// catalog below, and from then on adding, editing, disabling and deleting a kind
// are the user's own to do. No migration for any of it, because `entities.kind`
// is an open text column and the per-kind fields live in `entities.data` jsonb,
// validated by the zod object compiled from those rows (registry.ts).
//
// A few kinds carry behaviour a row cannot: regex matchers, hand-written dedupe
// rules, link enrichment, bespoke cards. That code stays here (behaviours.ts)
// and attaches by kind name, so `link` is a row a user can rename or delete and
// still the kind this app understands itself.
//
// There is deliberately no `other`: a model that may invent a kind invents one
// per message ("marka adı", "slogan"), and those are unmergeable, unbrowsable
// and unsearchable as a group.

export * from "./types.js";
export * from "./fields.js";
export * from "./registry.js";
export * from "./catalog.js";
export { BEHAVIOURS, BEHAVIOUR_KINDS, hasBehaviour } from "./behaviours.js";
export { addressQuery, mapsSearchUrl } from "./address.js";
export { trackingUrl } from "./tracking.js";
