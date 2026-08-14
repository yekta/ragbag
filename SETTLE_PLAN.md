# Settle plan — nothing paints until it is the final answer

Status: planned (root causes measured in a headless browser, 2026-08-14).

Trigger: a cold load of the web app shows "Syncing your archive…", then the
cards, then "Syncing your archive…" again, then the cards — several times over.
The sign-in screen has its own version: a spinner, then a card saying "Reaching
the server…", then the same card 16px taller with the actual buttons in it.
Both are the same defect wearing different clothes.

The rule, everywhere in the app:

> **A screen may not show a state it is about to take back.** While the answer
> is still being worked out, show _nothing_ — the canvas, and nothing else.
> When the wait outlives a beat, one loader fades in, in one place, and stays
> long enough to be read. The finished screen then arrives complete: no
> second-guessing, no reflow, no swap.

Three ingredients: **settle** (don't paint an unsettled state), **patience**
(a status that hasn't held for N ms isn't a status yet), **reserve** (whatever
arrives late is allotted its space in advance).

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
empty → cards → empty → cards for as long as the renders keep coming. On this
box the archive is five rows and the API is on localhost, so the alternation
mostly hides inside the first second; with a real archive and a remote API each
cycle is long enough to see, which is the report.

Everything downstream of the provider is remounted each time as well — the
composer draft and its attachment chips are component state, so a re-render of
`Workspace` while you are typing throws away what you typed.

### 1.2 "Syncing your archive…" is also shown for a store that is merely opening

Even with one stable client, Zero's first snapshot is `[[], "unknown"]` —
indistinguishable, in the UI, from "empty archive, nothing synced yet". The
timeline treats it as the latter and immediately paints the sync spinner
(`timeline.tsx:190,214`), then replaces it with cards ~250 ms later when IndexedDB
answers. Measured on a warm reload: spinner at 1531 ms, cards at 2100 ms — 570 ms
of a loader that was never telling the truth, on a device that already had every
row on disk.

### 1.3 The sign-in card renders in two different shapes

`sign-in.tsx:61-72` renders the card as soon as the component mounts and fills
in the buttons when `/api/meta` answers; until then it shows a "Reaching the
server…" line. Measured with a 600 ms `/api/meta` (a stand-in for a remote API):

```
1137ms  boot spinner        h=24   top=388
1224ms  card "Reaching…"    h=210  top=295
1869ms  card with buttons   h=226  top=287     ← +16px tall, 8px jump upward
```

Three different screens before the user can click anything, and the last
transition moves the target they were reaching for.

### 1.4 The archive arrives in waves, and every wave re-lays the whole document

Reported as: _"some messages load, page scrolls to bottom, some more load, page
scrolls to bottom"_ — a fast, jarring staircase. Three mechanisms stack up, and
only the first is fixed by §1.1.

**(a) Each rebuilt Zero client replays the whole arrival.** The virtualized list
lives inside `timeline.tsx`'s `empty ? … : …` branch, so a client rebuild takes
the timeline from _N rows_ back to _0_ — document height collapses from tens of
thousands of pixels to one screen, scroll position with it — and then back to
_N_, at which point `anchorTo: "end"` + `followOnAppend` re-pin the newest item
and the page "scrolls to the bottom" again. Five clients (§1.1) = up to five
collapse-and-repin cycles in the first two seconds. This is the bulk of the
reported staircase.

**(b) A cold device gets the archive in two waves, and the first one is a lie.**
Measured, 405 items, fresh device, sampling every animation frame:

```
t(ms)   cards   docHeight   scrollY
 1832       5         841        41     ← whatever was already local, pinned to its end
 2941      27       58152     57283     ← the server's delivery lands: +57 311px of document
 3057      16       58181     57312     ← measurement corrections
```

The first wave is a complete, plausible, _wrong_ archive: it settles, it pins
itself to the bottom, and a second later it is replaced by one seventy times
taller. Waiting for the row set to go quiet — not merely non-empty — is what
distinguishes these two.

**(c) Late measurement corrections move the view after it has settled.** The
virtualizer estimates every unmeasured row at 140px (`timeline.tsx:94`) and
corrects as rows are measured; with end-anchoring, each correction is a scroll
adjustment. Measured on a warm load of the same archive: the document settles at
58 198px and is corrected to 58 111px ~500 ms later, dragging `scrollY` 87px with
it. That delta is small here only because the seeded rows are uniform text —
images, link cards and long notes are exactly what 140px is wrong about, and the
error is cumulative over the rows above the viewport.

### 1.5 The same shape elsewhere

- **`SyncDot`** (`sidebar.tsx:65-79`) starts every load on "Connecting…" because
  that is Zero's initial connection state, then flips to "Synced". A status that
  is true for 300 ms is not a status.
- **The offline strip** (`app.tsx:293`) is in the document flow: a momentary
  `disconnected` between reconnects inserts a band above the timeline, shifting
  the whole list and forcing the virtualizer to re-measure its `scrollMargin`.
- **Blob images** (`blobs.tsx:122`, `item-card.tsx:308`) always start at `null`
  and resolve their object URL asynchronously — including for blobs whose URL is
  already resolved in `urlCache`. Because the timeline is virtualized, scrolling
  an image card out and back mounts it again: pulsing grey box, then the image,
  then a height change as the real aspect ratio replaces the fixed `h-40 w-64`
  placeholder — which moves every row below it.
- **`ItemDetail`** (`item-detail.tsx:98`) shows a 160px-tall spinner before the
  first query result, for an item that is nearly always already in the local
  store.
- **`useMeta`** is called from three components, each with its own state and its
  own `fetch` — three requests for one answer, none of them started until React
  has mounted.

---

## 2. The primitives — `apps/web/src/lib/settle.ts` (new)

Four hooks, no dependencies, used by everything below.

```ts
/** True once `ms` have elapsed since mount. Re-renders once. */
export function useElapsed(ms: number): boolean;

/** True once `value` has not changed for `ms` — "the stream has gone quiet". */
export function useQuiet<T>(value: T, ms: number): boolean;

/**
 * A status you may show: true only after `active` has held continuously for
 * `delay`, and then for at least `min` however fast it goes away again.
 * Kills both halves of a flash — the one that appears too eagerly and the one
 * that disappears before it can be read.
 */
export function usePatient(active: boolean, opts?: { delay?: number; min?: number }): boolean;

/** Latches true and never goes back — for "we have painted the real thing". */
export function useLatch(value: boolean): boolean;
```

The timings, defined once, next to the hooks:

```ts
export const SETTLE = {
  /** Blank grace: nothing at all for this long. Covers a warm local hydrate. */
  loaderAfter: 400,
  /** Once a loader is up, it stays up this long. */
  loaderMin: 450,
  /** The row set must hold still this long before it counts as the archive —
      one wave is not the archive (§1.4b). Two frames' worth of slack. */
  quiet: 150,
  /** Hard cap on the cover: past this we reveal the shell and let the timeline
      show the honest in-place sync loader, so the app stays usable. */
  reveal: 1_500,
  /** A connection/session status must hold this long before it is shown. */
  status: 1_000,
};
```

`prefers-reduced-motion` already collapses transition durations to 1 ms
(`index.css:388`) — the delays here are timing, not motion, and stay as they are.

---

## 3. The changes

### 3.1 One Zero client per identity — `app.tsx`

Hoist `init` out of the render:

```tsx
// Module scope: a new identity for this callback is a new Zero client.
const preloadArchive = (zero: Zero<Schema>) => {
  zero.preload(queries.timeline(), { ttl: "forever" });
  zero.preload(queries.tags(), { ttl: "forever" });
};
…
<ZeroProvider {...opts} init={preloadArchive}>
```

`opts` is already memoized on `identity.userID`, so with `init` stable the
provider's effect deps are stable and the client is built exactly once per
signed-in user. This alone removes the repeat alternation of §1.1; everything
below is what is left over.

Guard rail: `Workspace` gets a short comment saying that every prop of
`ZeroProvider` is an effect dependency, so an inline object or callback there
rebuilds the client and wipes local state.

### 3.2 One boot gate — `app.tsx` + `components/settle-cover.tsx` (new)

`SettleCover` is a `fixed inset-0 bg-background` canvas that sits **over** the
app, holds an optional loader, and fades out (180 ms) when the thing underneath
is ready, unmounting itself afterwards. Deliberately a cover rather than
`opacity` on the shell: an ancestor with `opacity < 1` becomes the containing
block for `position: fixed` descendants, which would move the composer and the
sidebar for the duration of the fade. It also lets the shell mount, measure and
scroll to the newest item while nobody is looking, so the first frame the user
sees is the finished one.

While the cover is up it takes pointer events (nobody clicks blind), and it
shows nothing for `loaderAfter`, then a centred spinner with a line of text.

`App`'s gate becomes:

```tsx
const identity = …;                       // as today
const booting = !identity && (session.isPending || !meta);
if (booting) return <SettleCover show />;             // nothing, then a loader
if (!identity) return <SignIn meta={meta} />;         // complete, in one paint
return <Workspace key={identity.userID} identity={identity} status={status} />;
```

The device-identity path is untouched: a returning device still opens the
workspace immediately from localStorage without waiting for the session probe.

### 3.3 The shell reveals settled — `app.tsx` (`ShellBody`) + `timeline.tsx`

`ShellBody` already holds the timeline query, so it decides:

```tsx
// Non-empty is not enough: the first wave of a cold sync is a complete, wrong
// archive (§1.4b). The row set has to have stopped moving.
const arrived = items.length > 0 && useQuiet(items, SETTLE.quiet);
const known = arrived || itemsResult.type === "complete" || syncPaused;
const settled = useLatch(known || useElapsed(SETTLE.reveal));
…
<SettleCover show={!settled} message="Syncing your archive…" />   // message only once patient
```

`useQuiet(items, …)` compares the snapshot by reference, which is exactly right
here: Zero hands back a new array for every delivery and the identical one when
nothing has changed, so "quiet" means "no wave for 150 ms" without hashing
anything.

`Timeline` takes `settled` and stops guessing:

| state                                  | what shows                                |
| -------------------------------------- | ----------------------------------------- |
| not settled                            | nothing (the cover is over it anyway)     |
| rows > 0                               | the cards                                 |
| no rows, sync incomplete and running   | in-place loader, "Syncing your archive…"  |
| no rows, query complete or sync paused | the empty state (as worded today)         |
| no rows, filter active                 | "Nothing matches this filter." (as today) |

The in-place loader is wrapped in `usePatient` so it cannot blink, and the
empty state renders only from a settled, complete truth — never as a way-station.

### 3.4 The sign-in screen arrives complete — `sign-in.tsx`

`meta` becomes a prop (required, non-undefined): the screen is only reachable
once the capabilities are known, so the "Reaching the server…" branch and its
attendant resize are deleted outright. The card renders its buttons, or the
"this server has no sign-in configured" message, in its first and only paint.
`dropLocalData()` on mount is unchanged.

### 3.5 One shared `/api/meta` — `lib/use-meta.ts`

Turn the hook into a module-level singleton: one in-flight request, one cached
answer, subscribers via `useSyncExternalStore`; the existing backoff and
`online` retry move into the singleton. The fetch starts at **module import**,
so it overlaps React's mount instead of following it — worth ~100 ms on the
sign-in path, which is precisely the path that has nothing else to show.

### 3.6 Patient status — `app.tsx` (`SyncBanner`), `sidebar.tsx` (`SyncDot`)

Both go through `usePatient(…, { delay: SETTLE.status })`: the offline strip
only appears once the app has really been offline for a second (no more
one-frame band shoving the timeline down), and the sync dot shows "Connecting…"
only if connecting is actually taking time. Neither ever changes the height of
anything: the dot's row keeps its size, the strip is either there or not.

### 3.7 Blobs resolve synchronously when they can — `lib/blobs.tsx`

- Keep a `Map<blobId, string | null>` of **resolved** URLs beside the existing
  promise cache, and have `useBlobUrl` seed its state from it
  (`useState(() => resolved.get(id) ?? null)`). A card scrolled back into view,
  or the detail overlay for an item you were just looking at, then renders the
  image on its first frame — no placeholder at all.
- Remember each blob's natural aspect ratio (`Map` + `localStorage`, written on
  the image's `load`), exposed as `useBlobAspect(blobId)`.

### 3.8 Media reserves its box — `item-card.tsx`, `item-detail.tsx`

`ImageBody`'s placeholder takes the remembered aspect ratio (falling back to
today's box when there is none), so the image swap does not change the row's
height, does not re-trigger the virtualizer's measurement, and does not move the
rows below it. The pulse is `usePatient`-gated, so a fast local blob never
pulses. Same treatment for the detail view's hero image and PDF frame.

### 3.9 The detail overlay — `item-detail.tsx`

The `!item` spinner becomes patient: for a local hit (the normal case) the
panel's content is simply there when the sheet finishes its entrance; the
spinner appears only if the item genuinely has to be fetched.

---

## 4. What each path looks like afterwards

| path                         | before                                                    | after                                                         |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| warm load, archive on device | spinner → cards → spinner → cards ×N                      | canvas → the archive, complete, once                          |
| warm load, slow local store  | same, plus a 570 ms lying spinner                         | canvas → loader (≥450 ms) → the archive                       |
| new device, real first sync  | spinner → cards → spinner → cards                         | canvas → loader → shell with the in-place sync loader → cards |
| empty archive                | spinner → empty state                                     | canvas → empty state                                          |
| offline, nothing on device   | spinner → empty state                                     | canvas → empty state ("…syncs once the connection is back")   |
| signed out                   | spinner → card "Reaching…" → card with buttons (8px jump) | canvas → the card, complete, once                             |

---

## 5. Verification

Headless Chromium against the local stack, sampling the DOM every animation
frame (the harness used to produce §1's numbers), plus an instrumented build
that logs Zero constructions. Acceptance:

1. **One** `ZERO INIT` per page load (was 5), and no second one on session
   resolution, meta arrival or a session retry.
2. Warm reload: the frame sequence contains exactly `blank → cards(n)` — no
   `syncing`, no `empty`, no alternation, across 5 consecutive reloads.
3. First-run device (fresh profile, seeded server): `blank → loader → cards`,
   loader visible ≥ 450 ms, and never re-shown after cards appear.
4. Signed out with `/api/meta` delayed 600 ms: exactly one card box for the
   lifetime of the screen — same height, same top, from first paint to click.
5. Cumulative layout shift over a warm load ≈ 0 (measure with a
   `PerformanceObserver` on `layout-shift`), including a scroll pass over image
   cards, which today shift on every remount.
6. `pnpm lint` and `pnpm turbo run typecheck test build` clean.

---

## 6. Non-goals

- No skeleton screens. A skeleton is a state the app takes back; this plan is
  about not doing that. The only loader is the one that appears when a wait is
  real, and it appears once.
- No change to what the states _say_ — the offline/expired/refused wording, the
  empty-archive copy and the banner actions all stay as they are. Only when and
  how they arrive changes.
- No change to the sync/auth model: the device identity still opens the
  workspace without a live session, and auth still gates syncing, never using.
