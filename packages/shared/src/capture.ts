import { isBareUrl } from "./url.js";
import type { ItemKind } from "./kinds.js";

// Zero-friction capture (plan §1): the composer never asks "what is this?".
// A bare URL is a link, a checkbox/`todo:` marker is a todo, everything else
// is a note, and ingestion may later promote a note it recognises as a todo
// or an address. Explicit picks in the composer bypass all of this.

/** Markers people already type when they mean "this is a task". */
const TODO_PREFIX_RE = /^\s*(?:todo\s*:|-\s*\[\s*\]|\[\s*\]|\/todo\b)\s*/i;
const ADDRESS_PREFIX_RE = /^\s*(?:address\s*:|\/address\b)\s*/i;

export type TextCapture = { kind: ItemKind; text?: string; url?: string };

/**
 * Decide what a typed dump is. Returns the text with any marker stripped,
 * "todo: call the vet" is stored as "call the vet" so lists read cleanly.
 */
export function parseTextCapture(raw: string): TextCapture {
  const text = raw.trim();

  const todo = TODO_PREFIX_RE.exec(text);
  if (todo) return { kind: "todo", text: text.slice(todo[0].length).trim() || text };

  const address = ADDRESS_PREFIX_RE.exec(text);
  if (address) return { kind: "address", text: text.slice(address[0].length).trim() || text };

  if (isBareUrl(text)) return { kind: "link", url: text };

  return { kind: "note", text };
}
