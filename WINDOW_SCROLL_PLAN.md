# Window scroll plan — the timeline scrolls the page, not a box

Status: implemented (2026-08-14), measured in a headless browser (§6). Three
things the plan did not foresee are folded in and marked as such: the router's
scroll reset (§3.6), the resize re-pin (§3.4), and `useFlushSync` (§4).

Trigger: on a phone the archive scrolls inside its own `overflow-y-auto` div,
so the browser never sees a _document_ scroll. Safari keeps the URL bar at full
height forever, Chrome never collapses its toolbar, and none of the native
scroll affordances fire. The same box is what scrolls on desktop. The timeline
should scroll the **window**.

The rule: **the document is the app's only scroller.** Everything that used to
be held in place by the shell's fixed height is held by the viewport instead
(`sticky` / `fixed`), and the timeline becomes ordinary flow content that
happens to be virtualized.

---

## 1. What holds the scroll inside a box today

Four things, outermost first:

1. `apps/web/src/app.tsx:324` — `SidebarProvider className="h-dvh min-h-0"`.
   The shell is exactly one viewport tall, forever (it overrides shadcn's own
   `min-h-svh`, `ui/sidebar.tsx:137`).
2. `apps/web/src/app.tsx:365` — `SidebarInset … overflow-hidden`. The column
   clips rather than grows.
3. `apps/web/src/components/timeline.tsx:88-94` — the scroll box itself:
   `min-h-0 flex-1 overflow-y-auto overscroll-contain`.
4. `apps/web/src/components/timeline.tsx:63-72` — `useVirtualizer` with
   `getScrollElement: () => scrollRef.current`, plus the hand-rolled bottom pin
   (`:77-82`, `el.scrollTop = el.scrollHeight`) and the at-bottom probe on the
   box's `onScroll` (`:95-99`).

Two more things _depend_ on the column having a fixed height, and stop being
pinned the moment it is as tall as the archive:

- the composer, `components/composer.tsx:337` — `absolute inset-x-0 bottom-0`;
- the floating menu/search/sidebar controls, anchored to a zero-height
  `relative z-10` div at `app.tsx:369`.

The sync banner (`app.tsx:366`) is in flow above the scroll box, which is why
it is permanently visible today. Once the page scrolls, it scrolls away unless
something is done about it.

---

## 2. The shape afterwards

```
<body>                                    ← the scroller
  SidebarProvider  min-h-dvh              (flex row; grows with the archive)
    Sidebar        fixed inset-y-0 h-svh  (unchanged — already viewport-anchored)
    SidebarInset   relative flex-1 flex-col
      ┌ sticky top-0 z-30 ──────────────┐ ← new: one header block
      │ SyncBanner                      │   (height 0 when there is no banner)
      │ relative (zero-height anchor)   │   floating controls hang off this
      └─────────────────────────────────┘
      Timeline     flex-1                  ← in flow; window-virtualized
      Composer     sticky bottom-0 z-20    ← was absolute
```

Nothing between `<body>` and the timeline may have `overflow` other than
`visible`, or `sticky` resolves against that box instead of the viewport and
both the header and the composer freeze at their flow positions.

---

## 3. The changes

### 3.1 Let the shell grow — `apps/web/src/app.tsx`

```diff
-      className="h-dvh min-h-0"
+      className="min-h-dvh"
```

```diff
-      <SidebarInset className="relative min-h-0 min-w-0 overflow-hidden">
+      <SidebarInset className="relative min-w-0">
```

`min-h-dvh` (not shadcn's `min-h-svh`) keeps the composer at the bottom of what
is actually visible when the archive is short. If horizontal clipping turns out
to be load-bearing, the replacement is `overflow-x-clip`, **not**
`overflow-x-hidden`: `clip` is not a scroll container, `hidden` is, and a
scroll container here breaks every `sticky` below it.

### 3.2 One sticky header for the chrome — `apps/web/src/app.tsx:366-398`

```diff
-        <SyncBanner status={status} meta={meta} />
-        {/* Zero-height anchors: the floating controls land below the sync
-            banner without covering it. */}
-        <div className="relative z-10">
+        {/* What the column's fixed height used to pin, the viewport pins now.
+            Sticky rather than fixed so the banner keeps its flow slot: the
+            controls stay below it, and the timeline's own offset accounts for
+            it without anyone measuring the banner twice. */}
+        <div className="sticky top-0 z-30">
+          <SyncBanner status={status} meta={meta} />
+          {/* Zero-height anchor: the floating controls land below the sync
+              banner without covering it. */}
+          <div className="relative">
```

(and the matching closing tag). The block is zero-height when no banner is
showing — a zero-height sticky box still sticks, and its absolutely positioned
children ride along, so the controls keep floating exactly where they do today.

### 3.3 The composer sticks instead of floating — `components/composer.tsx:337`

```diff
-      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-(--composer-inset) md:px-4">
+      <div className="pointer-events-none sticky bottom-0 z-20 px-3 pb-(--composer-inset) md:px-4">
```

Nothing else in the composer changes. This is the cheapest of the three ways to
keep it at the bottom of the viewport, and the only one with no arithmetic:

- **sticky** (this): the card stays laid out _inside_ the column, so it keeps
  its left/right bounds from the sidebar automatically, and its flow slot at the
  end of the document means the last card can never come to rest under it.
- `fixed inset-x-0`: spans the whole viewport, so on desktop the card would
  center over the sidebar too; it needs the sidebar width and its collapsed
  state plumbed into a left offset.
- keeping it absolute: it would sit at the bottom of a document-tall column, i.e.
  scroll away.

The canvas strip at `composer.tsx:348` still works: it is `absolute` inside this
wrapper, which is now a sticky (still positioned) box.

Consequence: `pb-36` on the timeline goes away (§3.4). The composer's own flow
height is the runway now — real space instead of a constant guessed to match it.

### 3.4 The timeline — `apps/web/src/components/timeline.tsx`

The scroll box, the pin effect and the `onScroll` probe all go. Sketch:

```tsx
import { useWindowVirtualizer } from "@tanstack/react-virtual";

/** How close to the newest item still counts as "at the newest item". */
const AT_END_PX = 120;

const listRef = useRef<HTMLDivElement>(null);
const [scrollMargin, setScrollMargin] = useState(0);

// Two deviations from the documented recipe (`listRef.current.offsetTop`, read
// once in a layout effect), both because of the sync banner: measured against
// the document rather than off `offsetTop`, because the nearest positioned
// ancestor is the Timeline's own wrapper and that starts *below* the banner;
// and re-measured on every document resize, because a banner appearing moves
// the whole list down. Measuring to the same number doesn't re-render.
useLayoutEffect(() => {
  const measure = () =>
    setScrollMargin(
      listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0,
    );
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(document.documentElement);
  return () => observer.disconnect();
}, []);

const virtualizer = useWindowVirtualizer({
  count: rows.length,
  estimateSize: (i) => (rows[i]?.type === "day" ? 46 : 140),
  overscan: 10,
  getItemKey: (i) => { … },          // unchanged
  scrollMargin,
  // Chat anchoring, from the library instead of by hand (§4).
  anchorTo: "end",
  followOnAppend: true,
  scrollEndThreshold: AT_END_PX,
  useFlushSync: false,               // see §4
});

// Open at the newest item, and go back there when a filter swaps the row set
// out from under the anchor. Also the mount case: Zero can return the whole
// archive on the first render, and `followOnAppend` only fires on a *change*.
useLayoutEffect(() => {
  virtualizer.scrollToEnd();
}, [viewFilter, tagFilter, virtualizer]);
```

Plus one thing the plan did not foresee, added after measuring (§6): a resize
re-pin. Every viewport change moves the end of the document — the keyboard
opening, a rotation, a window drag, the URL bar sliding away — and the
library's end-anchoring absorbs most but not all of it (26px short after a
1280→768 width change, 180px after 1024→844). Someone who was at the newest
item ends up with the newest card behind the composer. Three guards keep it off
the reader's gesture: they must have been at the end when the resize arrived
(sampled on scroll, since by resize time the end has already moved), the page
must have gone quiet (`virtualizer.isScrolling` — re-measuring at a new width
takes several frames and the virtualizer scrolls the window itself while it
corrects, so "still scrolling" means wait, not give up), and `wheel`/`touchmove`
cancels. Not `keydown`: typing in the composer is what opens the keyboard.

and in the markup:

```diff
-      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--timeline-inset-top) pb-36" onScroll={…}>
+      <div className="flex flex-1 flex-col pt-(--timeline-inset-top)">
```

```diff
-          <div className="relative mx-auto max-w-3xl px-4" style={{ height: totalSize }}>
+          <div
+            ref={listRef}
+            // The browser's own scroll anchoring would correct on top of the
+            // virtualizer's measurement corrections; one of them has to go.
+            className="relative mx-auto w-full max-w-3xl px-4 [overflow-anchor:none]"
+            style={{ height: virtualizer.getTotalSize() }}
+          >
```

```diff
-                  style={{ transform: `translateY(${v.start}px)` }}
+                  style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
```

Empty state: `h-full` (`timeline.tsx:102`) becomes `flex-1`, so it centres in
the slack of the `min-h-dvh` column instead of in a box that no longer exists.

`--timeline-inset-top` stays exactly as it is (`index.css:51`). Because the ref
sits on the _inner_ container — below that padding — the 56px lands inside the
measured `scrollMargin` on its own. This supersedes INSET_PLAN §4's "`scrollMargin:
56` would be technically more correct … deliberately skipped": it is required
now, and it still does not put the number in two places.

### 3.5 No restored offsets — `apps/web/src/main.tsx`

```ts
// The archive opens at the newest item, so a document offset restored from the
// last visit is never where we want to be — and it would be restored before
// Zero has hydrated a single row anyway.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
```

### 3.6 The router must stop scrolling the page — the four `navigate` calls

Not in the plan; found by measuring (§6). Opening an item took the page to
`scrollY: 0` and closing it left it there. The cause is not the overlay's scroll
lock — the search dialog locks the body the same way and preserves the offset —
but TanStack Router: **every navigation resets window scroll unless told not
to**, and `setupScrollRestoration` installs that on the client whether or not
`scrollRestoration` is configured (`router-core/dist/esm/router.js:141`, and
`scroll.next = next.resetScroll ?? true` at `:420`). With a scroll box this was
invisible, because the window had nothing to reset.

So every navigation in the app now says so. In `item-card.tsx`, where three of
them live, through one helper:

```tsx
const openItem = (id: string) => ({ to: "/item/$id", params: { id }, resetScroll: false }) as const;
```

and the same `resetScroll: false` on `search-overlay.tsx:63` (pick a result) and
`item-detail.tsx:60` (close, back to `/`).

Deliberately not the alternative — `createRouter({ scrollRestoration: () =>
false })` would disable the reset globally in one line, but the truthy option
also switches on the restoration machinery it is meant to suppress: a capturing
document scroll listener that runs on every scroll event, on the app's hottest
path.

---

## 4. The virtualizer, precisely

Nothing here is bespoke: it is the documented window-scroll recipe plus the
options this version ships for chat lists.

`useWindowVirtualizer` is the same virtualizer with window plumbing:
`getScrollElement → window`, `observeWindowRect/Offset`, `windowScroll`, and
`initialOffset: () => window.scrollY`.

**`scrollMargin` is the only structural change.** Measurements start at
`paddingStart + scrollMargin`, and `getTotalSize()` already subtracts it — so
the container keeps `height: getTotalSize()` and each row renders at
`v.start - scrollMargin`, exactly as the docs' window example does. Forget the
subtraction and every row is displaced by the banner's height.

**Bottom anchoring moves into the library.** The copy of `@tanstack/virtual-core`
that pnpm resolves for `@tanstack/react-virtual` (3.17.7) has chat options the
current code predates:

| Option                 | What it does                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchorTo: "end"`      | While at the end, a row measurement adjusts scroll by the _total size_ delta; when the row set's edge keys change it re-anchors to the row under the current offset — which is what keeps the view still when older items sync in. |
| `followOnAppend: true` | Count grew, last key changed, and `isAtEnd(scrollEndThreshold)` → `scrollToEnd()`. Also covers the first load (count 0 → N).                                                                                                       |
| `scrollEndThreshold`   | How close to the end counts as at the end. Default **1px**.                                                                                                                                                                        |

Set `scrollEndThreshold` to 120 — the number the current `atBottomRef` probe
uses (`timeline.tsx:98`) — for two reasons. It preserves today's "close enough
to the newest" behaviour, and it is required on iOS: `getMaxScrollOffset()` for
a window is `scrollHeight - innerHeight`, but the real maximum of `scrollY` is
`scrollHeight - clientHeight`, and on iOS Safari `innerHeight` tracks the
_visual_ viewport while `clientHeight` is the layout viewport. The two disagree
by up to the URL bar's height exactly while the bar is expanded, so a 1px
threshold would report "not at the end" while sitting at the true bottom, and
new dumps would silently stop following.

`scrollToEnd()` on the last index returns `getMaxScrollOffset()` — the
_document_ maximum — so it clears the composer's flow height with no extra
arithmetic, and an over-scroll on iOS clamps to the true bottom.

**Why this matters more on a window scroller than it did in a box:** the current
re-pin loop writes `scrollTop` on every measurement pass. Pointed at the window
that is a `window.scrollTo` mid-gesture, which is precisely what fights momentum
scrolling and the URL-bar animation. virtual-core defers its adjustments while a
touch is in progress and flushes 150ms after `touchend` (`_iosTouching` /
`_iosDeferredAdjustment`). Hand-rolling that a second time is not worth it.

**The initial pin** relies on `scrollToEnd()` landing on estimates and
`anchorTo: "end"` holding the position as real measurements arrive. Measured:
it converges — the archive opens exactly at `scrollHeight - innerHeight` every
run, with no re-pin loop. The plan's fallback was not needed.

**`useFlushSync: false`.** `anchorTo: "end"` corrects the scroll offset from
inside `measureElement`, which runs as a ref callback during React's commit,
and the React wrapper then asks for a synchronous flush — which React refuses,
with a console error, once per dump (a dump is what mounts a row while you are
at the end). Measured: 21 errors over 20 dumps on this branch, 0 on master,
stack `commitAttachRef → measureElement → resizeItem → notify → flushSync`.
The wrapper's own opt-out is the fix. What it costs is the synchronous
re-render for a measurement, and `overscan: 10` is ~1000px of rows either side —
nothing can scroll into view within a frame of not being rendered.

---

## 5. Side effects checked

| Area                                    | Today                                                | After                                                                                                                    | Action                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Desktop sidebar                         | `fixed inset-y-0 h-svh` (`ui/sidebar.tsx:231`)       | unchanged — already viewport-anchored                                                                                    | none                                                                                                                               |
| Sidebar gap spacer                      | stretches to the row's height                        | stretches to the document's height; transparent                                                                          | none                                                                                                                               |
| Drawer / item sheet / search dialog     | Radix's scroll lock is a no-op (body never scrolled) | locks the document at its current offset                                                                                 | none — measured: `body[data-scroll-locked]{overflow:hidden;position:relative}` keeps `scrollY` across open→close                   |
| Route navigation                        | resets a window scroll that was always 0             | resets the archive to the top on every item open and close                                                               | §3.6 — `resetScroll: false`. This one was a real regression, not a risk                                                            |
| Scrollbar compensation                  | gap is 0, nothing compensated                        | on classic-scrollbar platforms the lock adds `margin-right` to `body`, shifting sticky/fixed chrome ~15px                | none — accepted (§7). Not `scrollbar-gutter: stable` either: it turns the compensation into a real shift instead of cancelling one |
| Focus restore when the sheet closes     | at worst scrolls the box                             | Radix focuses with `preventScroll`, so no document jump                                                                  | none — measured: offset identical before open and after close, mouse and touch                                                     |
| Viewport resize                         | box height changed, pin loop re-ran                  | the end of the document moves; the library's anchoring lands 26–180px short                                              | §3.4 — re-pin once the page is quiet, cancelled by the reader's own gesture                                                        |
| Overscroll / pull-to-refresh            | impossible (`overscroll-contain` on the box)         | native: rubber-band on iOS, pull-to-refresh on Android Chrome                                                            | none — the box's `overscroll-contain` goes with the box and gets no replacement (§7)                                               |
| Reload                                  | box starts at 0, effect pins to the bottom           | browser may restore a document offset first                                                                              | §3.5                                                                                                                               |
| iOS keyboard                            | absolute composer in an `h-dvh` column               | sticky composer; `interactive-widget=resizes-content` (`index.html`) covers Chrome, iOS resizes only the visual viewport | on-device check (§6.3); `visualViewport` offset only if it actually hides the composer                                             |
| `--timeline-inset-top`                  | padding in the scroll box                            | same padding, now inside the measured `scrollMargin`                                                                     | none                                                                                                                               |
| `pb-36` runway                          | clears the floating composer                         | the composer occupies real flow space                                                                                    | delete                                                                                                                             |
| `atBottomRef` + `onScroll` + pin effect | hand-rolled                                          | `anchorTo` / `followOnAppend` / `scrollEndThreshold`                                                                     | delete                                                                                                                             |
| Sonner toasts, drop overlay             | `fixed`                                              | unchanged                                                                                                                | none                                                                                                                               |

---

## 6. Verification

1. **CI** — `pnpm lint`, then `pnpm turbo run typecheck test build`: clean,
   11/11. Neither can see any of this; they only confirm nothing else broke.
2. **Headless browser against the local dev stack** — the real check, 40 seeded
   notes, measured after ingestion stopped rewriting card heights. All 29
   assertions pass; the numbers below are one run at 1280×900 unless stated.

   | Check                                       | Result                                              |
   | ------------------------------------------- | --------------------------------------------------- |
   | the document is the scroller                | doc 4195 > viewport 900, no scrolling ancestor      |
   | opens at the newest item                    | `scrollY` 3295 + 900 = 4195, exactly the end        |
   | last card rests above the composer          | card bottom 768 = composer top 768                  |
   | composer / header positioning               | both computed `sticky`                              |
   | top of the archive clears the controls      | first row at 56, buttons end at 48 (INSET_PLAN §5)  |
   | banner on screen at 3 offsets               | top 0, 0, 0                                         |
   | banner accounted for in `scrollMargin`      | list at 85 in the document, `offsetTop` says 56     |
   | rows still cover the viewport with a banner | rendered span −990…1980 for a 900px viewport        |
   | dump while at the end                       | follows; the new card is on screen                  |
   | dump while scrolled up                      | view unmoved (±6px of ingestion re-measuring)       |
   | item overlay open → close                   | 1828 → 1828 → 1828                                  |
   | filter change                               | lands at the end of the filtered set                |
   | sidebar collapsed / re-expanded             | still at the end; first row still clears the toggle |
   | resize 1280×900 → 768×1024                  | at the end after the re-pin (~450ms)                |
   | resize 768×1024 → 390×844                   | at the end; last card above the composer            |
   | height-only 844 → 700 → 844                 | at the end throughout — the URL-bar case            |
   | horizontal overflow at 768 / 390            | none                                                |
   | console errors                              | 0 (was 21 per 20 dumps before `useFlushSync`)       |

   And on a touch context (390×844, `hasTouch` — the tap-to-open path in
   `lib/touch.ts`): tapping a card opens the overlay with the page unmoved
   (1064 → 1064 → 1064), and tapping the composer leaves it fully on screen.

3. **On device (yours — nothing here can run mobile Safari):** iOS Safari's URL
   bar collapses while scrolling down and the composer stays put; the keyboard
   opens with the composer above it; Android Chrome collapses its toolbar.
   Pull-to-refresh is live by design (§7.2) — worth a look at whether it fires
   by accident at the top of the archive, but it is not a bug if it does.

---

## 7. Decisions taken (2026-08-14)

1. **The offline / sync banner is sticky** (§3.2) — visible at every scroll
   offset, as it is today.
2. **Nothing blocks pull-to-refresh.** No `overscroll-behavior` rule: the
   document scrolls the way the platform scrolls it, which is the point of the
   whole change. A pull at the top of the archive reloads on Android Chrome.
3. **No scrollbar-width compensation** when a dialog opens on Windows/Linux.
   The shift is the browser's default behaviour for a locked page; leave it.
4. **Library conventions over hand-rolled machinery.** This is an ordinary chat
   list: the documented `useWindowVirtualizer` + `scrollMargin` pattern and the
   library's own end-anchoring. Three deviations survived contact with a
   browser, each because something was measured to be wrong without it:
   `scrollMargin` is measured against the document and re-measured (the banner
   moves it), `useFlushSync: false` (§4), and the resize re-pin (§3.4).

---

## 8. Explicitly not doing

- **Sticky day separators.** A real feature, still a different conversation
  (INSET_PLAN §6 said the same).
- **Router scroll restoration**, or restoring a per-filter scroll position.
  Chat semantics: every view opens at its newest row.
- **A keyboard-aware composer** driven by `visualViewport`. Only if §6.3 shows
  the on-screen keyboard covering it on iOS — and then it is its own change.
- **Touching the item-detail Sheet.** It is a fixed overlay above the page; the
  page scrolling underneath it changes nothing about it.
- **Replacing the shadcn sidebar** or its floating variant. It is already
  viewport-anchored and does not care what scrolls.
- **`content-visibility` / dropping the virtualizer.** The whole archive is in
  memory; virtualization is still what keeps the DOM small (PLAN §10).
