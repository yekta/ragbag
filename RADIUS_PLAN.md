# Border radius plan — a real ladder, and concentric nesting

Status: **implemented 2026-08-14**. The durable version of the rule lives in
SHADCN_PLAN.md §3.7 and in the comment above the radius block in `index.css`;
this file is the reasoning and the site-by-site record.

Verified in the running app (headless Chromium, local stack): card 20px, the
address/link/image/file blocks inside it 12px, icon tiles and the link
thumbnail 8px, favicon 4px, composer 24px → chip 12px → thumbnail 6px, search
dialog 20px → result row 12px. Both variants in step 8.3 were screenshotted;
12px blocks won, so the plan's deviation stands.

## 1. The bug

`apps/web/src/index.css` declares only four radius tokens:

```css
@theme inline {
  --radius-sm: calc(var(--radius) - 4px);  /*  8px */
  --radius-md: calc(var(--radius) - 2px);  /* 10px */
  --radius-lg: var(--radius);              /* 12px */
  --radius-xl: calc(var(--radius) + 4px);  /* 16px */
}
```

`--radius-xs`, `--radius-2xl` and `--radius-3xl` are never declared, so those
utilities silently fall back to Tailwind's stock values. Resolved, today's
ladder is:

| utility | resolved | source |
| --- | --- | --- |
| `rounded-xs` | 2px | Tailwind default |
| `rounded-sm` | 8px | ours |
| `rounded-md` | 10px | ours |
| `rounded-lg` | 12px | ours |
| `rounded-xl` | **16px** | ours |
| `rounded-2xl` | **16px** | Tailwind default (1rem) |
| `rounded-3xl` | 24px | Tailwind default |

`rounded-xl` and `rounded-2xl` are the same number. That is exactly the reported
symptom: the item card is `rounded-2xl` (item-card.tsx:359) and every body
inside it — photo, link preview, address block, file row — is `rounded-xl`
(:182, :207, :309, :315, :327). Same 16px on the outside and on the inside, so
the inner corners bulge past the outer curve instead of nesting inside it.

The same collision appears in the search palette: the dialog is `rounded-2xl`
(search-overlay.tsx:78) and each result row is `rounded-xl`
(search-overlay.tsx:28) — 16px inside 16px.

There is a second, milder problem: `md` (10px) and `lg` (12px) are 2px apart, so
"one step down" is invisible in the middle of the scale, and `xs` (2px) to `sm`
(8px) is a 6px jump. The scale has no usable rungs where nesting needs them.

## 2. The rule

Two surfaces nest correctly when their curves stay concentric: an inner corner
offset by *d* from the parent's inner edge should be `parent − d`. Applied
literally on every element that gets brittle, so:

- **R1 — concentric.** A child that sits flush against the parent's padding uses
  `parent radius − padding`, snapped to the nearest rung of the ladder.
- **R2 — isolated.** When the padding is greater than or equal to the parent's
  radius, concentricity no longer binds; size the child by its own scale, but
  never rounder than the parent.
- **R3 — pills are exempt.** `rounded-full` badges, chips, avatars and icon
  buttons are not part of the ladder and never step down.

R1 and R2 give a legible cascade for the app's chat surface: **20 → 12 → 8 → 4**,
i.e. card → body block → icon tile / thumbnail → favicon.

Note the deliberate deviation: the item card is `p-3.5` (14px), so strict R1
would put its body blocks at 20 − 14 = 6px, which reads as a slab under an 80px
photo. The plan uses 12px there — two rungs down, unmistakably nested, still
generous. Step 8 below screenshots both so the call is made on pixels, not prose.

## 3. Step 1 — declare the whole ladder

`apps/web/src/index.css`, in `@theme inline`, with a comment documenting the
rule above:

```css
--radius-xs:  calc(var(--radius) - 8px);  /*  4px */
--radius-sm:  calc(var(--radius) - 6px);  /*  6px */
--radius-md:  calc(var(--radius) - 4px);  /*  8px */
--radius-lg:  var(--radius);              /* 12px */
--radius-xl:  calc(var(--radius) + 4px);  /* 16px */
--radius-2xl: calc(var(--radius) + 8px);  /* 20px */
--radius-3xl: calc(var(--radius) + 12px); /* 24px */
```

Result: `4 / 6 / 8 / 12 / 16 / 20 / 24` — no duplicates, no silent fallbacks, and
each rung is at least 2px and at most 4px from its neighbour.

Two knock-on changes are intentional and app-wide:

- `sm` 8 → 6 and `md` 10 → 8. Buttons, inputs, textareas, dropdown and command
  items get very slightly tighter. This is what makes "one step down" visible in
  the middle of the scale.
- `2xl` 16 → 20. The item card, the floating sidebar
  (ui/sidebar.tsx:246), the drop overlay (composer.tsx:666) and the search dialog
  all grow 4px rounder — the app's "big floating card" language, now distinct
  from `xl`.

If the tighter `md` reads badly on buttons, the fallback is `6 / 10 / 12 / 16 /
20 / 24` (keep `md` at 10 and drop `sm` to 6); everything else in this plan holds.

## 4. Step 2 — the item card cascade

`apps/web/src/components/item-card.tsx`. Card stays `rounded-2xl` (:359) and
picks up 20px from step 1.

| line | element | now | → | why |
| --- | --- | --- | --- | --- |
| 182 | `AddressBody` block | `rounded-xl` | `rounded-lg` | flush in card `p-3.5` |
| 207 | `LinkBody` block | `rounded-xl` | `rounded-lg` | same |
| 309 | image | `rounded-xl` | `rounded-lg` | same |
| 315 | image skeleton | `rounded-xl` | `rounded-lg` | must match the image it replaces |
| 327 | `FileBody` row | `rounded-xl` | `rounded-lg` | same |
| 183 | address icon tile | `rounded-lg` | `rounded-md` | depth 2, inside a 12px block |
| 330 | file icon tile | `rounded-lg` | `rounded-md` | depth 2 |
| 230 | link thumbnail | `rounded-lg` | `rounded-md` | depth 2 |
| 212 | favicon | `rounded-sm` | `rounded-xs` | depth 3, 14px square |
| 116 | todo checkbox | `rounded-[6px]` | `rounded-sm` | the literal now *is* a rung |
| 463 | `KindDot` | `rounded-md` | no change | standalone 24px tile |
| 56, 277, 370 | pills | `rounded-full` | no change | R3 |

Line 114's comment ("`--radius` is 0.75rem … `rounded-md` off that turns a 20px
box into a circle") describes the old scale and goes away with the literal.

## 5. Step 3 — composer

`apps/web/src/components/composer.tsx`. Card is `rounded-3xl` (24px, :379) with
`px-3 pt-3` around the attachment strip.

| line | element | now | → | why |
| --- | --- | --- | --- | --- |
| 574 | attachment chip | `rounded-xl` | `rounded-lg` | 24 − 12 = 12, exact R1 |
| 578 | chip thumbnail | `rounded-lg` | `rounded-sm` | 12 − 6 (`p-1.5`) = 6, exact R1 |
| 666 | drop overlay card | `rounded-2xl` | no change | standalone; gains 20px |
| 402 | textarea | `rounded-none` | no change | fills the card |

## 6. Step 4 — search palette

`apps/web/src/components/search-overlay.tsx`: dialog `rounded-2xl` (:78) becomes
20px; `CommandList` is `p-2`, so the result row at :28 goes `rounded-xl` →
`rounded-lg` (20 − 8 = 12, exact R1). This kills the second instance of the
reported bug.

## 7. Step 5 — primitives that disagree with the card language

| file:line | element | now | → | why |
| --- | --- | --- | --- | --- |
| ui/card.tsx:10 | `Card` | `rounded-xl` | `rounded-2xl` | it is a floating card; should match `ItemCard` |
| sign-in.tsx:24 | logo tile in that card | `rounded-2xl` | `rounded-xl` | currently the tile is as round as its own container |
| ui/dialog.tsx:56 | dialog content | `rounded-lg` | `rounded-2xl` | 12px modals against 20px cards read as a different app |
| ui/alert-dialog.tsx:51 | alert content | `rounded-lg` | `rounded-2xl` | same |
| ui/checkbox.tsx:14 | box | `rounded-[4px]` | `rounded-xs` | the literal now *is* a rung |
| sidebar.tsx:200 | ⌘K kbd chip | `rounded` (4px) | `rounded-xs` | bare `rounded` bypasses the ladder |
| ui/tooltip.tsx:47 | arrow | `rounded-[2px]` | no change | rotated decorative square, not a surface |

Reviewed and deliberately unchanged:

- **item-detail.tsx** — the `Sheet` is a full-height edge panel with no radius of
  its own, so its hero blocks (:181, :193, :201, :220, :274, :329, :421) are
  top-level surfaces, not nested ones. `rounded-xl` stays correct there.
- **ui/sidebar.tsx** menu buttons (`rounded-md`) — dense nav rows under R2; the
  floating sidebar's padding (`p-2`) is below its radius, but at 8px inside 20px
  they already read as nested.
- **ui/dropdown-menu, command, toggle, badge, alert** — either pills (R3) or
  dense rows sized by their own scale (R2).

## 8. Step 6 — verify

1. `pnpm -C apps/web build` (or `tsc --noEmit`) — class-only edits, so this is a
   smoke test, not the real check.
2. Local headless Playwright (the t3 preview browser is the user's machine, not
   this environment): screenshot the timeline with one card of every kind
   (note, todo, address, link, image, pdf, file), the composer with two
   attachments, the search palette with results, the item detail sheet, and the
   sign-in screen — light and dark.
3. Take the timeline shot twice — body blocks at `rounded-lg` (12px, the plan)
   and at `rounded-md` (8px, strict R1) — and pick from the pixels.
4. Guard greps, expected to be empty afterwards apart from the tooltip arrow:
   - `grep -rn 'rounded-\[' apps/web/src`
   - `grep -rn 'rounded[" ]' apps/web/src` (bare `rounded`)

## 9. Step 7 — write the rule down

Add the ladder and R1/R2/R3 to `SHADCN_PLAN.md` next to the colour-token rules,
and a short comment above the `@theme inline` radius block in `index.css`. The
scale drifted precisely because three of its seven rungs were never declared;
the comment is what stops the next `rounded-2xl` from being a coin flip.

## 10. Order of work

Steps 3 → 4 → 5 → 6 → 7 (tokens first, so every later edit is judged against the
fixed ladder), then 8, then 9. Each step is independently revertable; step 3
alone already removes the `xl`/`2xl` collision.
