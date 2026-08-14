# Overflow plan — every container gets a decision

Status: proposed (2026-08-14). Trigger: the detail sheet on a phone grew a
horizontal scrollbar and pushed text off-screen when an item's extracted text
contained a systemd coredump path (`core.gamescope-wl.1000.65a51f…`).

The rule this plan is built on: **overflow is never left to chance and never
hidden.** For every container that holds variable-length content, someone
decides how that content is presented — it wraps, it truncates to one line with
the full value reachable, or it becomes a real horizontal scroller with proper
affordances. Clipping (`overflow-x: clip/hidden`) is not one of those choices:
it makes content unreachable while pretending the layout is fine.

---

## 1. Root cause

1. **`whitespace-pre-wrap` with no break rule** — `apps/web/src/components/item-detail.tsx:423`.
   `pre-wrap` wraps at _break opportunities_ only; a 60-character token with no
   space or hyphen has none, so the paragraph renders at its full intrinsic
   width. `item-card.tsx` had already learned this (`break-words` at :129, :188,
   :421); the detail sheet never got it. The knowledge lived in individual class
   strings instead of in a default.
2. **No decision at the container level** — `SheetContent` has `overflow-y-auto`
   (`item-detail.tsx:89`). CSS computes the other axis from `visible` to `auto`
   when one axis is `auto`, so the sheet _accidentally_ became a horizontal
   scroller. Nobody chose that; it fell out of a class written for the Y axis.
3. **No test that would notice.** The web app has no browser test; every package
   test is a unit test, and overflow is invisible to `tsc` and `oxlint`.

---

## 2. Three presentation modes — every text container is exactly one

| Mode     | Behaviour                                                                                                                       | Use for                                                                                                    | Failure it prevents                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Flow** | wraps; breaks mid-token when a token cannot fit on its own line                                                                 | long-form user/network text: item text, extracted prose, AI summaries, error messages in a panel with room | the reported bug                              |
| **Line** | one line, truncated, **full value reachable another way** (`title`, the detail sheet, or wrapping to 2 lines instead)           | chrome and labels: file names, site names, account name, sidebar tag rows, chips                           | a label shoving a row sideways                |
| **Rail** | deliberate `overflow-x: auto` on a container that owns the scroll, with `overscroll-behavior-x: contain` and a visible edge cue | content whose meaning depends on preserved line structure — in this app, exactly one place (§4.3)          | mangling preformatted text to force it to fit |

Flow is the default. Line and Rail are opt-in and must be justified at the call
site. Nothing is clipped.

The invariant the test enforces (§6): **no element scrolls horizontally unless it
is a declared Rail, and the page itself never scrolls horizontally at all.**

**All three modes are pure CSS.** Nothing here measures text, watches a resize,
counts characters to place an ellipsis, or decides at runtime what fits — the
browser already does all of that, correctly, at every width, before first paint.
The only JavaScript this plan adds is the test in §6 and (if kept) the class
swap behind the §4.3 toggle.

---

## 3. Phase 1 — make Flow the default

In `apps/web/src/index.css`, `@layer base`:

```css
html {
  /* Flow is the default presentation for text. Inherited, so it also reaches
     sonner toasts and Radix portals, which our class strings never touch.
     A word only breaks when it cannot fit on a line of its own — normal prose
     is unaffected. */
  overflow-wrap: break-word;
}
```

and one named utility for text that sits inside a flex/grid parent:

```css
@utility user-text {
  white-space: pre-wrap;
  /* `anywhere`, not `break-word`: this also shrinks the element's min-content
     width, which is what stops a long token from blowing out a flex parent. */
  overflow-wrap: anywhere;
}
```

Not doing a global `* { min-width: 0 }`: it silently resizes inputs, `w-fit`
chips and the sidebar's icon-collapse, and it would mask the bug class we want
the test to catch. `min-w-0` goes on the specific flex children in §4.

---

## 4. Phase 2 — the decision, container by container

All paths `apps/web/src`.

### 4.1 Flow

| Container                                                       | Content                                                      | Why Flow                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item-detail.tsx:423` extracted content                         | page/PDF text — **the reported bug**                         | it is a reader view; nobody side-scrolls prose. Fidelity escape hatches already exist (Open original, Download). Default wrap, with §4.3 as the opt-out                         |
| `item-detail.tsx:283` item text / comment                       | the user's own words                                         | already Flow in the card (`item-card.tsx:421`); the two views should not disagree                                                                                               |
| `item-detail.tsx:227` `<h1>`                                    | title, falls back to the raw `url` when ingestion found none | a page heading wraps to 2–3 lines rather than being cut; break-anywhere for the URL case                                                                                        |
| `item-detail.tsx:335` AI summary                                | generated prose, can echo a URL or path                      | reading material                                                                                                                                                                |
| `item-detail.tsx:372` ingestion error, in the destructive Alert | server error string with paths/URLs                          | the whole point is reading it; the panel is full-width and has room                                                                                                             |
| `item-detail.tsx:399-404` "no summary" explanation              | same                                                         | needs `min-w-0` — it is a flex child                                                                                                                                            |
| `app.tsx:283` sync banner, `describeRejection(conn.reason)`     | verbatim server string                                       | diagnostic; the banner is full-width and already `flex-wrap`                                                                                                                    |
| `sign-in.tsx:60` auth error                                     | error message                                                | full-width, nothing to compete with                                                                                                                                             |
| `sidebar.tsx:427` upload failure reason                         | why uploads are dying                                        | **change from `truncate` to `line-clamp-2`**: it is currently one truncated line whose full text lives only in a `title` — invisible on touch, which is where uploads fail most |

### 4.2 Line

| Container                                                                         | Content                                                                                    | Reachability of the full value                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item-detail.tsx:204`, `item-card.tsx:339` file names                             | user file names, up to 200+ chars                                                          | **middle-truncate**, not `truncate` — cutting the tail hides the extension, which is the informative part. Small helper: `very-long-report-…-final.pdf`                                                                                        |
| `item-detail.tsx:229-240` site name + host                                        | metadata under the title                                                                   | needs `min-w-0` + `truncate`; the full URL is one tap away via the heading link                                                                                                                                                                |
| `item-card.tsx:214` site/host in the link card                                    | same                                                                                       | already `truncate` — verify                                                                                                                                                                                                                    |
| `item-card.tsx:216,220` link title / description                                  | external metadata                                                                          | already `line-clamp-2` — the right call for a card                                                                                                                                                                                             |
| tag chips: `item-card.tsx` `TagChips`, `tag-editor.tsx:36`, `item-detail.tsx:354` | user tag names, 64 chars allowed (`packages/contracts/src/mutators.ts:92`)                 | `ui/badge.tsx:8` is `whitespace-nowrap shrink-0 overflow-hidden`, so a 64-char tag overflows a 320px card. Add a `TagBadge` with `max-w-[min(12rem,100%)] truncate` + `title`; the full name is visible in the sidebar list and the tag editor |
| `sidebar.tsx` tag rows                                                            | same                                                                                       | `SidebarMenuButton` already truncates its last span — verify with a 64-char tag                                                                                                                                                                |
| `composer.tsx:609-612` attachment name                                            | file name                                                                                  | already `truncate` in `max-w-40`; switch to middle-truncate for the extension                                                                                                                                                                  |
| `item-detail.tsx:105-172` detail header                                           | kind, timestamp, 4 actions in one non-wrapping flex — the tightest row in the app at 320px | actions `shrink-0`, meta group `min-w-0` and truncating; the timestamp is duplicated nowhere else, so it truncates last                                                                                                                        |

### 4.3 Rail — the one place it is right

`item-detail.tsx:418-429`, extracted content, **when the text is preformatted**.
A log dump (which is exactly what triggered this) or an ASCII table loses its
meaning when wrapped — the screenshot's `journalctl` output is aligned by
indentation. Forcing it to wrap is as wrong as letting it escape.

So: default the block to Flow, and give the section a **Wrap / No wrap toggle**
(the GitHub diff-view affordance). No wrap turns the block into a real Rail:

```
white-space: pre; overflow-x: auto; overscroll-behavior-x: contain;
```

`overscroll-behavior-x: contain` matters — it stops a horizontal swipe inside
the block from chaining to the sheet or triggering browser back-navigation. The
toggle is remembered per device in the view store, like the theme and sidebar
state.

This is the honest version of "let it scroll": a container that _chose_ to be a
scroller, with the axis conflict handled, rather than a sheet that became one by
accident. Everything else in the app wraps or truncates.

The toggle is a class swap and nothing more — no measuring, no script deciding
what fits. If you would rather not add the state at all, the fallback is: this
block is Flow, full stop, and preformatted content soft-wraps. Say the word and
§4.3 disappears.

### 4.4 What changes on the sheet itself

`item-detail.tsx:89`: `overflow-y-auto` stays, and gets **no** `overflow-x`
counterpart. The sheet is a vertical scroller; if it ever scrolls sideways again
that is a bug in one of its children, and §6 fails the build and names the
child. Adding `clip` there would have converted a loud bug into a silent one.

---

## 5. Phase 3 — primitives

1. `user-text` (§3) replaces every hand-written `whitespace-pre-wrap
break-words` pair. After this, `whitespace-pre-wrap` should not appear in any
   component — enforced in §7.
2. `TagBadge` — `Badge` plus `max-w-[min(12rem,100%)] truncate` + `title`.
3. **File-name truncation that keeps the extension — in CSS, not in script.**
   Split the name at the final `.` (a semantic split, not a width calculation)
   and let `text-overflow` do the work:

   ```jsx
   <span className="flex min-w-0" title={name}>
     <span className="truncate">{stem}</span>
     <span className="shrink-0">{ext}</span>
   </span>
   ```

   The browser decides where the ellipsis lands, at every container width, with
   no resize listener and no character counting.

4. `Linkified` (`item-card.tsx:32`) moves from `break-all` to the `anywhere`
   semantics of `user-text`, so URLs break at sensible points rather than
   strictly per character.

---

## 6. Phase 4 — the regression test

**An overflow gym + a DOM scan.** No backend, no server fixtures.

1. **Dev-only route** `src/dev/overflow-gym.tsx`, mounted only under
   `import.meta.env.DEV` at `/dev/overflow`. It mounts the real `ZeroProvider`
   with `kvStore: "mem"` and an unreachable cache URL — the app is local-first
   and renders fine with sync down — seeds hostile items through the real
   mutators, and renders the real `Timeline`, `Sidebar`, detail sheet and
   composer. Real components, or the test proves nothing.
2. **Hostile fixtures**: a 600-char unbroken token (the coredump path); a
   2,000-char URL with no title; extracted text mixing a 300-char base64 blob, a
   400-char CJK run and indentation-aligned log lines; an error string full of
   paths; six 64-char tags on one item; a 200-char file name; RTL and
   emoji-with-combining-marks; a single 100,000-char line (the `text` maximum).
3. **Playwright scan** `apps/web/tests/overflow.spec.ts` — for each viewport in
   {320, 390, 768, 1280} × {light, dark} × surfaces {timeline, detail sheet,
   search overlay, sidebar, composer with attachments, sync banner, toast}:

   ```js
   const bad = await page.evaluate(() => {
     const out = [];
     const root = document.scrollingElement;
     if (root.scrollWidth > root.clientWidth + 1)
       out.push({ sel: ":root", by: root.scrollWidth - root.clientWidth });
     for (const el of document.querySelectorAll("*")) {
       // A Rail is a container that declared itself a scroller. Anything else
       // that scrolls sideways is a bug, including a clipped one.
       if (el.dataset.rail !== undefined) continue;
       const ox = getComputedStyle(el).overflowX;
       if (ox === "clip" || ox === "hidden") {
         /* fall through: clipping is not an excuse */
       } else if (ox === "auto" || ox === "scroll") {
         out.push({ sel: path(el), why: "undeclared scroller" });
         continue;
       }
       if (el.scrollWidth > el.clientWidth + 1)
         out.push({ sel: path(el), by: el.scrollWidth - el.clientWidth });
     }
     return out;
   });
   expect(bad).toEqual([]);
   ```

   Note the two-sided check: an element that overflows is a failure _and_ an
   element that quietly became a scroller is a failure. Clipping does not buy an
   exemption — `scrollWidth > clientWidth` still fails on a clipped element.
   Only `data-rail` (the §4.3 block, and it must also carry
   `overscroll-behavior-x: contain`) is exempt.

4. Wire as `pnpm --filter web test` → `turbo run test`. Adds `@playwright/test`
   to `apps/web`; the Chromium build is already in this machine's cache.

---

## 7. Phase 5 — keep it decided

- **Lint guard** in the root `lint` script: fail on `whitespace-pre-wrap`
  outside `index.css` (someone bypassed `user-text`), and on any new
  `overflow-x-clip` / `overflow-x-hidden` in `apps/web/src` — if a container
  needs one of those, it needs a decision from §2 instead.
- **CLAUDE.md**: the §2 table as the house rule, so later code inherits it.
- **`data-rail`** is the only exemption, and it requires a comment saying why
  this content cannot wrap.

---

## 8. Order and size

| Step                     | Effort  | Value                                                            |
| ------------------------ | ------- | ---------------------------------------------------------------- |
| §3 Flow default          | ~10 min | fixes the reported bug and every toast/banner/alert at once      |
| §4.1–4.2 + §5 primitives | ~1h     | the per-container decisions; 20-odd call sites                   |
| §4.3 wrap toggle         | ~45 min | the one container that genuinely needs a scroller, done properly |
| §6 gym + scan            | ~2h     | what makes "anywhere" true tomorrow                              |
| §7 guards                | ~20 min | stops the class of bug returning by hand                         |

§3 and §4.1–4.2 are shippable alone. Recommended: those first, then §4.3, then
§6 before the next UI feature lands.

---

## 9. Verification

- Reproduce first: seed the exact coredump text, screenshot at 390×844 dark,
  confirm the horizontal scrollbar — then confirm it is gone.
- Playwright scan green across every viewport × theme × surface.
- Manual pass at 320px: the scan proves nothing overflows, not that the result
  reads well — e.g. a header that technically fits but wraps to four lines.
- Rail check on touch: swipe the no-wrap block horizontally and confirm it does
  not drag the sheet or trigger back-navigation.
