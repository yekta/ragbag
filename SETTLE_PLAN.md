# Settle plan — nothing paints until it is the final answer

Status: planned (root causes and available signals measured in a headless
browser, 2026-08-14).

Trigger: a cold load of the web app shows "Syncing your archive…", then the
cards, then "Syncing your archive…" again, then the cards — several times over.
The cards themselves arrive in waves, and each wave scrolls the page to the
bottom again: a fast, jarring staircase. The sign-in screen has its own version:
a spinner, then a card saying "Reaching the server…", then the same card 16px
taller with the actual buttons in it. All of it is the same defect wearing
different clothes.

The rule, everywhere in the app:

> **A screen may not show a state it is about to take back.** While the answer
> is still being worked out, show _nothing_ — the canvas, and nothing else.
> A loader appears only where the app knows it has nothing to show and something
> is genuinely running; then it is the only thing on screen, it does not move,
> and it stays long enough to be read. The finished screen arrives complete.

The discipline that keeps this from becoming a pile of timeouts:

> **Every transition is caused by an event, not by a delay.** Timers are budgets
> for when an expected event never arrives — never the mechanism by which the UI
> decides what is true.

---

## 1. Root causes

### 1.1 The Zero client is torn down and rebuilt on almost every render

This is the multi-flash. `ZeroProvider` keys its instantiating effect on every
prop it is given, including `init`
(`node_modules/@rocicorp/zero/out/zero-react/src/zero-provider.js:65-70`):

```js
}, [hasAuth, init, rotationGeneration, ...useMemo(() => Object.entries(props)…, [props])]);
```

`apps/web/src/app.tsx:156` passes `init` as an inline arrow, so it is a new
function on every render of `Workspace` — and the cleanup on that effect is
`z.close()`. Every re-render of `Workspace` therefore **closes the Zero client
and builds a new one**: new client ID, new query views, and `useQuery` back to
its default snapshot (`[], "unknown"`) — which is exactly the "Syncing your
archive…" branch in `timeline.tsx:214`.

`Workspace` re-renders for perfectly ordinary reasons: the session probe
resolves (`status: "checking"` → `"ok"`), `useMeta` lands, the identity object
is re-saved, a session retry fires.

Measured on a warm reload (dev, 5 items, instrumented build):

```
[dbg] Workspace render {status: checking, meta: false, t: 1162}
[dbg] ZERO INIT 1172        ← client #1
[dbg] ZERO INIT 1187        ← #2  (StrictMode's second mount)
[dbg] ZERO INIT 1426        ← #3
[dbg] Workspace render {status: ok, meta: true, t: 1551}
[dbg] ZERO INIT 1591        ← #4
[dbg] ZERO INIT 1633        ← #5
[dbg] ShellBody render {n: 0, result: unknown, …}   ← 12 renders at n=0
[dbg] ShellBody render {n: 5, result: unknown, t: 1885}
[dbg] ShellBody render {n: 5, result: complete, t: 2256}
```

**Five Zero clients for one page load.** Each one re-runs the local hydrate
(~250 ms here) from an empty snapshot, so the timeline oscillates
empty → cards → empty → cards for as long as the renders keep coming.

Everything downstream of the provider is rebuilt each time as well — the
composer draft and its attachment chips are component state, so a re-render of
`Workspace` while you are typing throws away what you typed.

### 1.2 "Syncing your archive…" is also shown for a store that is merely opening

Zero's first snapshot is `[[], "unknown"]` — indistinguishable, in the UI, from
"empty archive, nothing synced yet". The timeline treats it as the latter and
paints the sync spinner (`timeline.tsx:190,214`), then replaces it with cards
~250 ms later. Measured on a warm reload: spinner at 1531 ms, cards at 2100 ms —
570 ms of a loader that was never telling the truth, on a device that already
had every row on disk.

### 1.3 The sign-in card renders in two different shapes

`sign-in.tsx:61-72` renders the card on mount and fills in the buttons when
`/api/meta` answers. Measured with a 600 ms `/api/meta` (a stand-in for a remote
API):

```
1137ms  boot spinner        h=24   top=388
1224ms  card "Reaching…"    h=210  top=295
1869ms  card with buttons   h=226  top=287     ← +16px tall, 8px jump upward
```

Three different screens before the user can click anything, and the last
transition moves the target they were reaching for.

### 1.4 The archive arrives in waves, and every wave re-lays the whole document

Reported as: _"some messages load, page scrolls to bottom, some more load, page
scrolls to bottom"_. Three mechanisms stack up.

**(a) Each rebuilt Zero client replays the whole arrival.** The virtualized list
lives inside `timeline.tsx`'s `empty ? … : …` branch, so a client rebuild takes
the timeline from _N_ rows back to _0_ — the document collapses from tens of
thousands of pixels to one screen, scroll position with it — and then back to
_N_, where `anchorTo: "end"` re-pins the newest item and the page "scrolls to
the bottom" again. Five clients = five collapse-and-repin cycles in the first two
seconds. This is the bulk of the reported staircase.

**(b) A cold device gets the archive in two waves, and the first is a lie.**
Measured, 405 items, sampling every animation frame:

```
t(ms)   cards   docHeight   scrollY
 1832       5         841        41     ← whatever was already local, pinned to its end
 2941      27       58152     57283     ← the server's delivery: +57 311px of document
 3057      16       58181     57312     ← measurement corrections
```

**(c) The reveal itself is unanchored for a frame, and CLS cannot see any of
it.** With `init` hoisted (one client) and the archive arriving in a single
delivery, sampling the newest card's viewport box:

```
t(ms)     n    docHeight   scrollY   newestCardTop
  7562    15      58258     57436       -55310     ← list laid out, scroll not yet corrected
  7658    15      58220     57398          461     ← anchored
  7661    15      58220     57420          439     ← measurement correction, 22px
cls: 0.0000
```

One frame in which the reader is looking at nothing (the anchor is 55 000px
above the viewport), then a 22px settle. **Cumulative layout shift reports
0.0000 through all of it** — the virtualizer positions rows with transforms and
moves the scroll offset, and CLS counts neither. Any acceptance criterion for
this work has to measure the anchor's box directly; CLS would sign off on the
current behaviour.

### 1.5 The same shape elsewhere

- **`SyncDot`** (`sidebar.tsx:65-79`) starts every load on "Connecting…" because
  that is Zero's initial connection state, then flips to "Synced".
- **The offline strip** (`app.tsx:293`) is in the document flow: a momentary
  `disconnected` between reconnects inserts a band above the timeline, shifting
  the list and forcing the virtualizer to re-measure its `scrollMargin`.
- **Blob images** (`blobs.tsx:122`, `item-card.tsx:308`) always start at `null`
  and resolve their object URL asynchronously — including for blobs already
  resolved in `urlCache`. The list is virtualized, so scrolling an image card out
  and back mounts it again: pulsing grey box, then the image, then a height
  change as the real aspect ratio replaces the fixed `h-40 w-64` placeholder.
- **`ItemDetail`** (`item-detail.tsx:98`) shows a 160px spinner before the first
  query result, for an item that is nearly always already in the local store.
- **`useMeta`** is called from three components, each with its own state and its
  own `fetch` — three requests for one answer, none started until React mounts.

---

## 2. The model

### 2.1 What Zero actually tells us — and what it doesn't

Measured against the running stack, 405 rows, warm dev load:

| signal                       | means                                      | when it lands                        |
| ---------------------------- | ------------------------------------------ | ------------------------------------ |
| `useQuery` rows > 0          | the local store has answered, and has rows | 1.4–1.9 s after boot                 |
| `result.type === "complete"` | the server has confirmed the whole answer  | ~300 ms after the rows               |
| `preload().complete`         | same, for a preloaded query                | 2181 ms (rows were there at 1734 ms) |
| `useConnectionState()`       | whether syncing is even possible           | immediately, then live               |

And two that look like the signal we want and are not — both measured, both
rejected, recorded here so nobody re-litigates them:

- `zero.run(q, { type: "unknown" })` resolves in **6–28 ms with 0 rows** against
  a store that yields 405 rows a second later. It means "run against what is
  materialised _now_", not "the store has answered".
- `zero.run(q)` (the documented "waits for pending data to sync" form) resolved
  at 751 ms with **0 rows**, likewise.

**There is no "local store hydrated" event.** Anything that needs one has to
supply it — which is the entire design problem, and the reason the first draft
of this plan reached for timeouts.

### 2.2 The device supplies the missing signal — `lib/archive-hint.ts` (new)

One number in `localStorage`, written (debounced) whenever the timeline settles:

```ts
type ArchiveHint = { count: number; at: number };
```

It answers the one question Zero can't: **should this device expect rows?**
A returning device knows it has an archive before Zero has loaded a byte of it,
which is exactly what "local-first" ought to mean. It is self-healing (rewritten
on every settle), one number wide, and wrong only in the direction of waiting a
little longer or showing an empty state a beat early.

### 2.3 One state machine — `lib/archive-state.ts` (new)

Readiness stops being four booleans spread over `App`, `ShellBody` and
`Timeline` and becomes one derived value with one reason each:

```ts
type ArchiveState =
  | "opening" // rows are expected and not here yet → show nothing at all
  | "syncing" // nothing local to expect, sync is live and incomplete → the loader
  | "empty" //   known empty, or complete/paused with no rows → the empty state
  | "ready"; //  rows are here and the layout has stopped moving → the archive
```

| inputs                                           | state                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| rows > 0 and layout settled (§2.4)               | `ready`                                                          |
| rows > 0, layout still moving                    | `opening`                                                        |
| no rows, hint says this device had an archive    | `opening`                                                        |
| no rows, no hint, sync live and incomplete       | `syncing`                                                        |
| no rows, hint says 0 — or `complete` — or paused | `empty`                                                          |
| no rows, expected them, budget spent (§2.5)      | `syncing` or `empty`, by the same rules as a device with no hint |

Note what this buys on a genuinely first run: the app knows immediately that
nothing is local, so the sync loader appears **at once** rather than after a
guessing delay — honest _and_ faster than the current behaviour. And a device
whose archive is known-empty goes straight to the empty state with no loader at
all.

### 2.4 Reveal is measured, not timed — `useLayoutSettled()`

The reveal waits for the DOM to stop moving, sampled where it matters:

```ts
// Settled = two consecutive frames in which the document height and the anchor
// element's viewport box are both unchanged. Fast machine: ~32 ms. Slow one:
// as long as it needs. Nobody guesses.
useLayoutSettled(anchorRef): boolean
```

This is the same quantity §5 asserts on, so the thing we ship and the thing we
test are the same thing. It exists because of §1.4c: rows being present is not
the same as the list being anchored, and the difference is one very visible
frame.

### 2.5 The only two timers

```ts
export const BUDGET = {
  /** Expected rows that never came: stop waiting, tell the truth instead. */
  archive: 2_000,
  /** A loader that appears stays long enough to read. */
  loaderMin: 400,
};
```

A backstop and an anti-blink. Nothing else in this plan is timed; the previous
draft's `loaderAfter` / `quiet` / `reveal` / `status` delays are all replaced by
events — data arriving, layout settling, the hint, `complete`, connection state.

---

## 3. The changes

### 3.1 One Zero client per identity — `app.tsx`

```tsx
// Module scope. Every prop of ZeroProvider is an effect dependency and the
// effect's cleanup is zero.close() — an inline callback here rebuilds the
// client, and with it the local store, on every render.
const preloadArchive = (zero: Zero<Schema>) => {
  zero.preload(queries.timeline(), { ttl: "forever" });
  zero.preload(queries.tags(), { ttl: "forever" });
};
…
<ZeroProvider {...opts} init={preloadArchive}>
```

`opts` is already memoized on `identity.userID`, so with `init` stable the
client is built exactly once per signed-in user.

### 3.2 One readiness owner — `lib/archive-state.ts`, `lib/sync-status.ts` (new)

`useArchiveState()` implements §2.3 from the timeline query, the hint and the
connection state. `useSyncStatus()` derives the _presentation_ of the connection
once — `synced | syncing | offline | refused | expired` — with the hysteresis
built in (a state that has not held is not reported), and the sync dot, the
banner and the timeline all read that one value instead of three components
each interpreting `useConnectionState()` their own way. This is what replaces
sprinkling patience at call sites.

### 3.3 The cover — `components/settle-cover.tsx` (new), `app.tsx`

`SettleCover` is a `fixed inset-0 bg-background` canvas over a **mounted**
shell: the timeline lays out, measures and anchors to the newest item while
nobody is looking, so the first frame the user sees is the finished one. A cover
rather than `opacity` on the shell, because an ancestor with `opacity < 1`
becomes the containing block for `position: fixed` descendants and would move
the composer and sidebar for the duration of the fade.

It carries no loader of its own. `App` uses it for the boot gate:

```tsx
const booting = !identity && (session.isPending || !meta);
if (booting) return <SettleCover />; // canvas, nothing else
if (!identity) return <SignIn meta={meta} />; // complete, in one paint
return <Workspace key={identity.userID} identity={identity} status={status} />;
```

and `ShellBody` uses it for `state === "opening"`. In every other state the
shell is revealed and the timeline shows its own content — so there is exactly
**one loader position per screen**, and no handoff between two of them.

### 3.4 The timeline stops guessing — `timeline.tsx`

| `ArchiveState`        | what shows                                  |
| --------------------- | ------------------------------------------- |
| `opening`             | nothing (the cover is over it)              |
| `syncing`             | one centred loader, "Syncing your archive…" |
| `empty`               | the empty state, wording exactly as today   |
| `ready`               | the cards                                   |
| `ready` + filter miss | "Nothing matches this filter." (as today)   |

The loader honours `BUDGET.loaderMin`. The empty state renders only from a
settled truth, never as a way-station.

### 3.5 The list never goes backwards — `timeline.tsx`

```tsx
// An empty, unknown snapshot is "we don't know yet", not "the archive is
// empty" — keep painting the rows we have until something authoritative says
// otherwise.
const shown = items.length === 0 && itemsResult.type === "unknown" ? lastRows.current : items;
```

§3.1 removes today's cause of the collapse; this makes the collapse structurally
impossible to reintroduce. A `complete` snapshot with zero rows still clears the
list (deleting your last item works), and filtering is computed downstream.

### 3.6 Rows are the size they claim to be — `timeline.tsx`

`estimateSize` returns a flat 140px for every item (`timeline.tsx:94`), so the
document keeps resizing under the reader as real heights land (§1.4c). Replace
it with an estimate built from what is known before layout — kind, text length
at the current column width, whether there is an attachment or a link preview.
An image card is not a one-line todo, and the estimator can say so.

Deliberately **not** included: persisting measured heights across sessions. It
is the exact fix for the residual, and it is a cache with real invalidation
problems (font metrics, zoom, edited text, column width). The trigger for
adding it is written down instead: if §5's anchor invariant still shows movement

> 4px on a 400-row archive with the estimator in place, persistence is the next
> step, keyed by `(itemId, updatedAt, columnWidth)`.

### 3.7 The sign-in screen arrives complete — `sign-in.tsx`

`meta` becomes a required prop: the screen is only reachable once capabilities
are known, so the "Reaching the server…" branch and its resize are deleted. The
card renders its buttons — or the "this server has no sign-in configured"
message — in its first and only paint. `dropLocalData()` on mount is unchanged.

### 3.8 One shared `/api/meta` — `lib/use-meta.ts`

A module-level singleton: one in-flight request, one cached answer, subscribers
via `useSyncExternalStore`, existing backoff and `online` retry moved inside.
The fetch starts at **module import**, so it overlaps React's mount instead of
following it — worth ~100 ms on the one path that has nothing else to show.

### 3.9 Blobs resolve synchronously when they can — `lib/blobs.tsx`

Keep a `Map<blobId, string>` of **resolved** URLs beside the promise cache and
seed `useBlobUrl`'s state from it (`useState(() => resolved.get(id) ?? null)`).
A card scrolled back into view, or the detail overlay for an item you were just
looking at, renders its image on the first frame — no placeholder at all. Also
remember each blob's natural aspect ratio (written on `load`) for §3.10.

### 3.10 Media reserves its box — `item-card.tsx`, `item-detail.tsx`

The placeholder takes the remembered aspect ratio (falling back to today's box
when there is none), so the image swap does not change the row's height, does
not re-trigger measurement, and does not move the rows below it. The pulse only
runs if the wait is real. Same for the detail hero and the PDF frame.

### 3.11 The detail overlay — `item-detail.tsx`

The `!item` spinner appears only if the item genuinely has to be fetched; for a
local hit the panel's content is simply there when the sheet finishes its
entrance.

### 3.12 What the reveal looks like — motion and a11y

- The cover fades out over 160 ms, `ease-out`, **opacity only**. Nothing slides,
  scales or moves: motion is another way of taking a state back.
- `prefers-reduced-motion` already collapses this to 1 ms (`index.css:388`), and
  the reveal stays correct because it is a fade of a cover, not an animation the
  layout depends on.
- The cover is `aria-hidden`; the app root carries `aria-busy` while it is up.
  The one loader is `role="status"` with a polite live region, so the "Syncing
  your archive…" case is announced once and the silent settle announces nothing.
- Focus is not moved by the reveal. The composer's autofocus already runs under
  the cover and lands in the right place when it lifts.

### 3.13 A tripwire so this cannot come back — DEV only

Two invariants asserted in development, where they are free:

```ts
// timeline.tsx
if (import.meta.env.DEV && lastCount.current > 0 && rows.length === 0 && result.type === "unknown")
  console.error("[settle] timeline collapsed from %d rows to 0 — see SETTLE_PLAN.md §3.5", …);
```

and a one-line warning if `preloadArchive` runs more than once per identity —
the exact regression of §1.1, which nothing in the type system prevents.

---

## 4. What each path looks like afterwards

| path                         | before                                                               | after                                                                     |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| warm load, archive on device | spinner → cards → spinner → cards ×N, each pass re-pinned to the end | canvas → the archive, complete, anchored, once                            |
| warm load, slow local store  | the same, plus a 570 ms lying spinner                                | canvas → the archive when it arrives (loader only past the 2 s budget)    |
| first run on a device        | spinner → 5 local rows pinned → +57 311px → re-pin                   | loader immediately (nothing is local, and the app knows it) → the archive |
| archive still filling in     | document resizes under the reader                                    | the newest card does not move; only the scrollbar changes                 |
| known-empty archive          | spinner → empty state                                                | the empty state, at once, no loader                                       |
| offline, nothing on device   | spinner → empty state                                                | the empty state ("…syncs once the connection is back")                    |
| signed out                   | spinner → card "Reaching…" → card with buttons (8px jump)            | canvas → the card, complete, once                                         |

---

## 5. Verification — `apps/web/scripts/settle-proof.mjs` (new, committed)

The harness that produced every number in §1 becomes a repo script, in the
spirit of `apps/server/scripts/*-proof.mts`: headless Chromium against the local
stack, sampling every animation frame, run against a seeded 405-row archive.
Playwright joins `apps/web` as a devDependency (`npx playwright install
chromium` on a fresh machine). **CLS is recorded but is not the criterion** —
§1.4c measured 0.0000 while the reader was looking at an empty viewport.

Asserted:

1. **One** `ZERO INIT` per page load (was 5), including across session
   resolution, meta arrival and a session retry.
2. Warm reload ×5: the frame sequence is exactly `canvas → cards(n)`. No
   `syncing`, no `empty`, no alternation.
3. **Anchor invariant.** From the first revealed frame to steady state: the
   newest card's viewport box moves ≤ 1px, the document height never decreases,
   and its first value is within 1% of its final one. (Today: one frame at
   −55 310px, then a 22px settle, on a document that goes 841 → 58 152 → 58 111.)
4. First run (no hint, cold store, 400 kbit/s): loader is the first thing shown,
   is visible ≥ 400 ms, never re-appears once cards are up.
5. Signed out with `/api/meta` delayed 600 ms: one card box for the lifetime of
   the screen — same height, same top, from first paint to click.
6. A scroll pass over image cards: no row height changes after a card's first
   paint; no image placeholder appears for a blob resolved earlier in the
   session.
7. `pnpm lint` and `pnpm turbo run typecheck test build` clean.

---

## 6. Non-goals, and what is deliberately deferred

- **No skeleton screens.** A skeleton is a state the app takes back.
- **No change to what any state _says_** — the offline/expired/refused wording,
  the empty-archive copy and the banner actions are as they are today. Only when
  and how they arrive changes.
- **No change to the sync/auth model**: the device identity still opens the
  workspace without a live session, and auth still gates syncing, never using.
- **Deferred: persisted row heights** (§3.6), with a written trigger.
- **Deferred: a rendered app shell in `index.html`.** It would cut the pre-mount
  blank, and it is a second copy of the layout to keep in step — not worth it
  until the blank is measured as the dominant cost in a production build.
