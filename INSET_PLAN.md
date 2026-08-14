# Inset plan — floating chrome owns a padding in the scroll box

Status: implemented (2026-08-14), measured in a headless browser.

Trigger: on a phone, scrolling the timeline to the very top leaves the first
card tucked under the floating menu and search buttons. The controls are fine —
they're supposed to float. The stream just has nowhere to come to rest
underneath them.

The rule: **anything that floats over the timeline is paid for with padding in
the timeline's scroll box, sized from the floating thing itself.** Content may
pass behind it while scrolling; it may never come to rest under it.

---

## 1. Root cause

The scroll container has a bottom padding and no top padding —
`apps/web/src/components/timeline.tsx:92`:

```
min-h-0 flex-1 overflow-y-auto overscroll-contain pb-36
```

`pb-36` is there, and commented, for the floating composer. Nothing does the
same job for the floating controls, so at `scrollTop: 0` the timeline's first
row starts at y=0 — which is inside the band the buttons occupy.

The controls are anchored to a zero-height `relative z-10` div
(`apps/web/src/app.tsx:369`) sitting directly above the Timeline in the flex
column, so its top edge _is_ the top of the scroll viewport (below the sync
banner, when one is showing). `top-3` + `size="icon"` → `size-9` puts them at
**12px → 48px**.

Measured at the top of the archive, before the fix: the first card's top edge
sat at 47px — 1px above where the buttons end, so its top corners and shadow
were underneath them. That is the reported clipping.

### Why it was missed

The timeline is bottom-anchored (`timeline.tsx:78-82` re-pins to the newest
item), so this is only visible if you deliberately scroll the whole archive to
the top — which nobody does while building a chat view that opens at the bottom.

---

## 2. The change

### 2.1 The number — `apps/web/src/index.css`

Next to `--composer-inset` in `:root`:

```css
--timeline-inset-top: calc(0.75rem + 2.25rem + 0.5rem); /* 3.5rem = 56px */
```

`offset + control + clearance`, and nothing else. The arithmetic stays visible
so the number can be re-derived when the controls change; it is defined next to
the composer's inset because both ends of the scroll box are the same idea.

Explicitly _not_ part of this number: what the first row happens to contain.
The day chip that shows up there at the top of the archive brings its own
`py-3`, which is the chip's business — the padding is sized so that whatever
lands first, card or chip, lands below the buttons.

### 2.2 Spend it — `apps/web/src/components/timeline.tsx:92`

```diff
-        // pb-36 clears the floating composer so the newest card isn't hidden
-        // behind it when scrolled to the bottom.
-        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-36"
+        // Both ends are inset for the chrome that floats over them: the menu
+        // and search controls at the top, the composer at the bottom. Content
+        // may pass behind them while scrolling; it may never come to rest
+        // under them.
+        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-(--timeline-inset-top) pb-36"
```

`pt-(--x)` is the shorthand the composer already uses for its own inset
(`composer.tsx:337`, `pb-(--composer-inset)`).

That is the whole fix: one variable, one class.

---

## 3. Scope: the desktop cases

| State                      | Floating control               | With a flat padding                |
| -------------------------- | ------------------------------ | ---------------------------------- |
| Mobile                     | menu + search, always          | correct — this is the reported bug |
| Desktop, sidebar collapsed | sidebar toggle, `left-3 top-3` | correct — same band, same fix      |
| Desktop, sidebar expanded  | none                           | 56px bought for nothing            |

The third row is the only cost. Making the padding conditional is possible —
`ShellBody` already computes `isMobile` and `open` and could set the variable
inline on `SidebarInset` — but it trades a one-line CSS fix for a prop, an
inline style and a fallback. `pb-36` sets the precedent: a flat constant that
does not shrink when the composer happens to be short. Verified visually (§5):
with no control floating, the padding reads as ordinary breathing room, not
dead space.

---

## 4. Side effects checked

- **Virtualizer measurement** — unaffected. `measureElement` reports item
  _heights_; positions come from cumulative sizes plus `translateY(v.start)`
  inside the inner container (`timeline.tsx:123-132`), which lives inside the
  padding box. Padding shifts every row uniformly, exactly as `pb-36` does.
- **Range calculation** — react-virtual maps `scrollTop` to content coordinates
  with `scrollMargin: 0`, so it believes content starts 56px earlier than it
  renders. `overscan: 10` (`timeline.tsx:67`) is ≥ 460px of rows, so the skew is
  invisible. `scrollMargin: 56` would be _technically_ more correct; it would
  also put the number in two places. Deliberately skipped.
- **Bottom anchoring** — `el.scrollTop = el.scrollHeight` (`timeline.tsx:81`)
  clamps to max, and `scrollHeight` grows with the padding. No change.
- **`atBottomRef` threshold** — measured from the bottom (`timeline.tsx:96`).
  No change.
- **Empty state** — `h-full` in a box that is now 56px shorter
  (`timeline.tsx:100`). It already centres 72px high because of `pb-36`;
  afterwards, 44px high. Slightly better, no action.
- **Sync banner** — the anchor div and the Timeline are siblings below the
  banner, so both shift down together.

---

## 5. Verification

1. **Automated:** `pnpm lint` and `pnpm turbo run typecheck test build` — clean,
   11/11. Neither can see this bug: there is no browser test for the web app
   (OVERFLOW_PLAN.md §1.3 says the same about the same gap), so they only
   confirm nothing else broke.
2. **Headless browser against the local dev stack**, which is the real check:
   dev sign-in, notes dumped until the timeline overflows, scroller pinned at
   `scrollTop: 0`, then the bounding boxes of the controls and the first rows
   compared. Forcing `padding-top: 0` on the same content reproduces the
   reported bug exactly.

Measured at the top of the archive, offsets from the top of the scroll column:

| Element              | Before    | After    |
| -------------------- | --------- | -------- |
| Buttons              | 12 → 48   | 12 → 48  |
| First row (day chip) | 0 → 47 💥 | 56 → 103 |
| First card top edge  | 47 💥     | 103      |

| State                       | Result                                                 |
| --------------------------- | ------------------------------------------------------ |
| Mobile 430×932              | ✓ first row starts 8px below the buttons               |
| Mobile + offline banner     | ✓ same, and the padding starts below the banner        |
| Desktop 1280×900, collapsed | ✓ same clearance against the sidebar toggle            |
| Desktop 1280×900, expanded  | ✓ no controls; reads as breathing room, not dead space |

---

## 6. Explicitly not doing

- **Touching the floating controls.** They were reported as fine — no change to
  position, size, or the fact that content passes behind them mid-scroll.
- **Touching the day chip's own `py-3`.** If the gap above the first chip ever
  reads as too large, that 12px is the lever — but it is the chip's spacing, not
  the timeline's padding, and it is a separate decision.
- **A top scrim/fade.** The bottom got a solid strip (`composer.tsx:348`)
  because the composer is a wide card that content disappears under. Two small
  round buttons at the edges do not need one, and a strip at the top would read
  as a fake toolbar.
- **Sticky day separators.** A real feature, and a different conversation.
- **`env(safe-area-inset-top)`.** There is no web app manifest, so the app runs
  in Safari, where the viewport already starts below the status bar and the top
  inset is 0. If it is ever installed standalone, the _controls'_ `top-3` needs
  the `max(…, env(…))` treatment `--composer-inset` already has at the bottom,
  and this padding follows from it.
- **Moving `pb-36` into `--timeline-inset-bottom`** for symmetry. Tempting while
  in here; it is a rename with no behaviour change and belongs in its own commit.
