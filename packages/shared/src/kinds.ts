export const ITEM_KINDS = ["note", "link", "image", "pdf", "file"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const TAG_KINDS = ["topic", "type", "entity"] as const;
export type TagKind = (typeof TAG_KINDS)[number];
