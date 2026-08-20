// What this device knew last time.
//
// Zero has no "the local store has finished opening" event; measured: both
// forms of `zero.run()` answer in milliseconds with zero rows against a store
// that yields the whole archive a second later, and `preload().complete`
// resolves *after* the data is already on screen. So the one question the UI
// actually needs answered on boot (*should this device expect rows?*) has to
// be answered by the device itself.
//
// One number, rewritten whenever the timeline settles. It is wrong only in the
// direction of waiting a beat longer (an archive deleted elsewhere) or opening
// straight into the empty state (a first message sent on another device), and it
// heals on the next settle either way.

const KEY = "ragbag:archive";

export type TArchiveHint = { count: number; at: number };

export function loadArchiveHint(): TArchiveHint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TArchiveHint>;
    return typeof parsed.count === "number" ? { count: parsed.count, at: parsed.at ?? 0 } : null;
  } catch {
    // Unparseable or storage blocked: no hint is a perfectly good answer.
    return null;
  }
}

export function saveArchiveHint(count: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ count, at: Date.now() } satisfies TArchiveHint));
  } catch {
    // Private mode / quota: the app simply waits for rows next time.
  }
}

export function clearArchiveHint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
