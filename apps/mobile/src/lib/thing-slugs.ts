import { readPref, writePref } from "@/lib/prefs";

// Which slugs this user's entity types claimed, as this device last saw them.
//
// The router decides whether a path segment names a view *before* any Zero row
// exists, and a type is a row: no build knows that /links is a view until it
// has synced the type that claims it. So a link into /links would bounce to the
// chat on every cold launch.
//
// One list in device preferences, rewritten whenever the types query lands.
// Wrong only on the first launch of a device that has never synced, and it
// heals the moment it does. Same shape and same reason as the web app's
// lib/thing-slugs.ts; the storage underneath is expo-sqlite's key-value store
// rather than localStorage, which reads synchronously exactly as the router
// needs it to.

const KEY = "ragbag.thingSlugs";

let cache: readonly string[] | null = null;

export function declaredSlugs(): readonly string[] {
  if (cache) return cache;
  try {
    const raw = readPref(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((slug) => typeof slug === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function rememberDeclaredSlugs(slugs: readonly string[]): void {
  const next = [...slugs].sort();
  if (cache && cache.length === next.length && cache.every((slug, i) => slug === next[i])) return;
  cache = next;
  writePref(KEY, JSON.stringify(next));
}
