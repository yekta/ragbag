// Which slugs this user's entity types claimed, as this device last saw them.
//
// The router decides whether a path segment names a view *before* any Zero row
// exists (`beforeLoad` in main.tsx, which redirects an unknown slug home), and
// a type is a row: no build knows that /links is a view until it has synced the
// type that claims it. So a bookmarked /links would bounce to the chat on every
// cold load.
//
// One list in localStorage, rewritten whenever the types query lands. Wrong only
// on the first launch of a device that has never synced, and it heals the moment
// it does. The same shape as lib/archive-hint.ts, for the same reason: the one
// question the router has to answer before the store is open has to be answered
// by the device itself.

const KEY = "ragbag:thingSlugs";

let cache: readonly string[] | null = null;

export function declaredSlugs(): readonly string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((slug) => typeof slug === "string") : [];
  } catch {
    // Unparseable or storage blocked: no declared slugs is a fine answer.
    cache = [];
  }
  return cache;
}

export function rememberDeclaredSlugs(slugs: readonly string[]): void {
  const next = [...slugs].toSorted();
  if (cache && cache.length === next.length && cache.every((slug, i) => slug === next[i])) return;
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: the router simply falls back to the built-ins.
  }
}
