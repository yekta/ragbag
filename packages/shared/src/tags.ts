// Tags apply to all three taggable things (messages, attachments, entities)
// through three join tables (plan §3.1). The vocabulary is the same for each.

export const TAG_KINDS = ["topic", "type", "entity"] as const;
export type TTagKind = (typeof TAG_KINDS)[number];

/** Who put the tag there. Ingestion owns `ai`; the user's own always win. */
export const TAG_SOURCES = ["user", "ai"] as const;
export type TTagSource = (typeof TAG_SOURCES)[number];
