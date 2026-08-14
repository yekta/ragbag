# Inset plan — floating chrome owns a scroll runway at both ends

Status: implemented (2026-08-14), measured in a headless browser at 430×932 —
numbers below are observed, not predicted. Trigger: on a phone, scrolling the timeline to
the very top leaves the first card tucked under the floating menu and search
buttons. The controls themselves are fine — they're supposed to float. What is
wrong is that the stream has nowhere to come to rest underneath them.

The rule this plan is built on: **anything that floats over the timeline owns a
matching inset in the timeline's scroll box.** A floating control is allowed to
have content pass behind it mid-scroll; it is not allowed to sit on top of
content at rest. The bottom end already obeys this (`pb-36` clears the
composer). The top end was never given the same treatment.

---

## 1. Root cause

The timeline's scroll container has a bottom inset and no top inset.

`apps/web/src/components/timeline.tsx:92`

```
min-h-0 flex-1 overflow-y-auto overscroll-contain pb-36
```

`pb-36` (144px) exists and is commented — "clears the floating composer so the
newest card isn't hidden behind it". Nothing does the same job for the floating
controls at the other end, so at `scrollTop: 0` the first row is flush with the
top edge of the column, which is exactly where the buttons are.

### The geometry, exactly

The controls are anchored to a zero-height `relative z-10` div
(`apps/web/src/app.tsx:369`) that sits directly above the Timeline in the flex
column — so its top edge _is_ the top edge of the scroll viewport (below the
sync banner, when one is showing).

| Element                   | Source                                | Occupies (from column top)      |
| ------------------------- | ------------------------------------- | ------------------------------- |
| Floating menu / search    | `top-3` + `size="icon"` → `size-9`    | **12px → 48px** (+ `shadow-md`) |
| Row 0 — day badge wrapper | `timeline.tsx:135` `py-3`             | 0px → 47px                      |
| …the "Today" pill itself  | `badge.tsx` `px-2 py-0.5 text-[11px]` | 12px → 35px                     |
| Row 1 — first item card   | after the day row                     | **47px →**                      |

Two consequences, both visible in the report:

1. The day pill lands **dead centre in the button band** (12–35px inside
   12–48px). It only looks like a deliberate header because it is the first
   day; it is an accident of scroll position.
2. The first card's top edge starts at 47px, **1px above where the buttons
   end** — so its top corners and shadow are underneath them. That is the
   "cutting some part of the message".

Row 0 is _always_ a day badge — `useRows` seeds `lastDay = ""` and pushes a day
row before the first item (`timeline.tsx:33-38`) — so this is the resting state
of every filter, every tag, every session. Not an edge case.

### Why it was missed

The inset is only observable at `scrollTop: 0`, and the timeline is
bottom-anchored (`timeline.tsx:78-82` re-pins to the newest item). You have to
deliberately scroll the whole archive to the top to see it, which no one does
while building a chat view that opens at the bottom.

---

## 2. The change

### 2.1 One variable for the runway — `apps/web/src/index.css`

Next to `--composer-inset` in `:root`:

```css
/* The timeline's top runway, the twin of --composer-inset at the other end.
   The floating menu/search controls sit `top-3` and are `size-9`, so their
   band ends 3rem down; the runway clears that band plus the same 0.75rem gap
   the controls keep from the edge. Defined here because two things depend on
   the same number — change the controls' offset or size and this follows. */
--timeline-inset-top: calc(0.75rem + 2.25rem + 0.75rem); /* 3.75rem = 60px */
```

The arithmetic stays visible on purpose: `offset + control + gap`. A bare
`3.75rem` would be a magic number that nobody could re-derive after the buttons
change size.

### 2.2 Spend it — `apps/web/src/components/timeline.tsx:88-92`

```diff
       <div
         ref={scrollRef}
-        // pb-36 clears the floating composer so the newest card isn't hidden
-        // behind it when scrolled to the bottom.
-        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-36"
+        // Both ends are inset for the chrome that floats over them: the
+        // controls at the top, the composer at the bottom. Content may pass
+        // behind them while scrolling; it may never come to rest under them.
+        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--timeline-inset-top) pb-36"
```

`pt-(--x)` is the same shorthand the composer already uses for its own inset
(`composer.tsx:337`, `pb-(--composer-inset)`).

That is the whole fix: one variable, one class.

### 2.3 Resting layout after the change

Measured at `scrollTop: 0`, mobile viewport, offsets from the top of the scroll
column:

| Element             | Before       | After     |
| ------------------- | ------------ | --------- |
| Buttons             | 12 → 48px    | 12 → 48px |
| "Today" pill        | 12 → 35px 💥 | 72 → 95px |
| First card top edge | 47px 💥      | 107px     |

The pill clears the buttons by 24px, the card by 59px.

---

## 3. Why 60px, and not just enough to clear

The smaller reading of the bug — "add ~14px so the card's corners stop being
clipped, and leave the pill sitting between the two buttons" — is rejected. It
preserves the thing that made this look broken in the first place: a day
separator wedged into the control row, aligned with it by coincidence rather
than by design. The runway is sized so the stream _starts below the chrome_,
which is the same standard `pb-36` already holds the composer to (composer band
≈ 130px, runway 144px — the band plus a gap).

If the value wants tuning later, it is one number in one place.

---

## 4. Scope: the desktop cases

| State                      | Floating control               | With a flat runway                    |
| -------------------------- | ------------------------------ | ------------------------------------- |
| Mobile                     | menu + search, always          | correct — this is the reported bug    |
| Desktop, sidebar collapsed | sidebar toggle, `left-3 top-3` | correct — same band, same fix         |
| Desktop, sidebar expanded  | none                           | 60px of unused runway at the very top |

The third row is the only cost, and it is 44px of whitespace in a scroll
position that is rare on desktop and harmless when reached. Making the runway
conditional is possible — `ShellBody` already computes `isMobile` and `open`
and could set `--timeline-inset-top` inline on `SidebarInset`, guaranteeing the
runway and the buttons never disagree — but it trades a one-line CSS fix for a
prop, an inline style and a fallback value. `pb-36` sets the precedent here: a
flat constant that does not shrink when the composer happens to be short.

**Recommendation: ship the flat runway.** Revisit only if the desktop gap
actually reads as wrong.

---

## 5. Side effects checked

- **Virtualizer measurement** — unaffected. `measureElement` reports item
  _heights_; positions come from cumulative sizes plus `translateY(v.start)`
  inside the inner container (`timeline.tsx:123-132`), which lives inside the
  padding box. Padding shifts every row uniformly, exactly as `pb-36` already
  does.
- **Range calculation** — react-virtual maps `scrollTop` to content
  coordinates with `scrollMargin: 0`, so it will believe content starts 60px
  earlier than it renders. `overscan: 10` (`timeline.tsx:67`) is ≥ 460px of
  rows, so the skew is invisible. Setting `scrollMargin: 60` would be
  _technically_ more correct; it is not needed, and adding it means the number
  lives in two places. Noted, deliberately skipped.
- **Bottom anchoring** — `el.scrollTop = el.scrollHeight` (`timeline.tsx:81`)
  clamps to max; `scrollHeight` grows by 60px along with the max. No change.
- **`atBottomRef` threshold** — measured from the bottom
  (`timeline.tsx:96`). No change.
- **Empty state** — `h-full` inside a box that is now 60px shorter
  (`timeline.tsx:100`). It currently centres 72px above true centre because of
  `pb-36`; afterwards, 42px above. Slightly better, no action.
- **Sync banner** — the anchor div and the Timeline are siblings below the
  banner, so both shift down together. The relationship holds in every
  banner state.

---

## 6. Verification

1. **Automated:** `pnpm lint` and `pnpm turbo run typecheck test build` — clean,
   11/11 tasks. Neither can see this bug: there is no browser test for the web
   app (OVERFLOW_PLAN.md §1.3 says the same thing about the same gap), so they
   only confirm nothing else broke.
2. **Headless browser against the local dev stack**, which is the real check.
   Dev sign-in, 24 dumped notes, scroller pinned to `scrollTop: 0`, then the
   bounding boxes of the controls, the day pill and the first card compared.
   Setting `padding-top: 0` on the scroller with the same content reproduces the
   reported bug exactly — that is the "before" column in §2.3.

| State                       | Result                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Mobile 430×932              | ✓ pill +24px, card +59px clear of the buttons                                        |
| Mobile + offline banner     | ✓ same, and the runway starts below the banner                                       |
| Desktop 1280×900, collapsed | ✓ same clearance against the sidebar toggle                                          |
| Desktop 1280×900, expanded  | ✓ no controls; the runway reads as breathing room above the day pill, not dead space |

The last row settles §4: the flat runway does not look like a mistake in the
one state where it buys nothing.

---

## 7. Explicitly not doing

- **Touching the floating controls.** They were reported as fine. No change to
  position, size, or the fact that content passes behind them mid-scroll.
- **A top scrim/fade.** The bottom got a solid strip (`composer.tsx:348`)
  because the composer is a wide card that content disappears under. Two small
  round buttons at the edges do not need one, and a strip at the top would
  read as a fake toolbar.
- **Sticky day separators.** A real feature, and a different conversation.
- **`env(safe-area-inset-top)`.** There is no web app manifest, so the app runs
  in Safari, where the viewport already starts below the status bar and the top
  inset is 0. If it is ever installed standalone, the _controls'_ `top-3` needs
  the `max(…, env(…))` treatment `--composer-inset` already has at the bottom,
  and the runway follows from it automatically.
- **Moving `pb-36` into `--timeline-inset-bottom`** for symmetry. Tempting
  while in here; it is a rename with no behaviour change and belongs in its own
  commit.
