import type { ItemKind } from "./kinds.js";

/** Map an uploaded blob's MIME type to the item kind it should create. */
export function kindForMime(mime: string): Extract<ItemKind, "image" | "pdf" | "file"> {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "file";
}
