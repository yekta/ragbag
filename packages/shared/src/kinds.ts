// Order is the sidebar's order: the text kinds a user writes first, then the
// things they dump. `todo`/`address` are notes with a purpose — same capture
// path, different body and actions.
export const ITEM_KINDS = ["note", "todo", "address", "link", "image", "pdf", "file"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Kinds whose content is the user's own text — freely convertible between. */
export const TEXT_ITEM_KINDS = ["note", "todo", "address"] as const;
export type TextItemKind = (typeof TEXT_ITEM_KINDS)[number];

export function isTextKind(kind: ItemKind): kind is TextItemKind {
  return (TEXT_ITEM_KINDS as readonly string[]).includes(kind);
}

export const TAG_KINDS = ["topic", "type", "entity"] as const;
export type TagKind = (typeof TAG_KINDS)[number];
