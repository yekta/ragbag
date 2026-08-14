# shadcn/ui adoption plan — `apps/web`

> **Shipped 2026-08-13.** All five phases are done and verified; `PLAN.md` §10 carries the
> as-built summary. Kept as the reference for the palette values (§3), the vendored-file edits
> that must survive a future `shadcn add` (§5), and the traps that shaped the implementation (§7).
> Two things changed during implementation, both noted inline below: `ItemCard` borrows the card
> tokens on its `<article>` rather than wrapping in `<Card>` (which has no `asChild`), and
> `ui/command.tsx` needed a small `commandProps` passthrough that wasn't foreseen.

Companion to `PLAN.md` §10. Three deliverables in one migration:

1. **shadcn/ui** as the primitive layer (Radix + vendored components).
2. **kebab-case file naming** throughout (`item-detail.tsx`, not `ItemDetail.tsx`).
3. **A muted-mint theme** built on shadcn's token model, light + dark.

Plus one behavioural change the theme work forces anyway: **the sidebar floats only at
`md`+ — on mobile it's a flush, full-height drawer.**

---

## 0. Where we start

|            |                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Stack      | React 19.2, Vite 8.2, Tailwind **v4.3** (`@tailwindcss/vite`), TanStack Router, zustand                                    |
| Styling    | `index.css` is literally one line: `@import "tailwindcss";` — no theme layer, no tokens                                    |
| Colours    | Hardcoded Tailwind palette classes everywhere: `neutral-*` chrome, `amber/emerald/rose/sky/violet/red/slate` for semantics |
| Icons      | `components/Icon.tsx` — a name-keyed lucide registry (`strokeWidth={1.6}`) + `KIND_ICON`                                   |
| Components | 9 files, all PascalCase, ~2 700 lines total, zero external UI deps                                                         |
| Imports    | Relative with explicit `.js` extensions; no path alias                                                                     |
| Dark mode  | Does not exist                                                                                                             |

Nothing outside `apps/web/src` imports these components (grep-verified), so the rename blast
radius is contained to this app.

**Files in play**

```
apps/web/src/App.tsx                     290   shell, sync banner, floating controls
apps/web/src/main.tsx                     43   router
apps/web/src/index.css                     1   ← becomes the theme
apps/web/src/components/Composer.tsx     434   dump box, drag/drop, type menu
apps/web/src/components/ItemCard.tsx     375   card + StatusChip/TagChips/TodoBody/…/KindDot
apps/web/src/components/ItemDetail.tsx   383   right-side overlay
apps/web/src/components/SearchOverlay.tsx 154  ⌘K palette (hand-rolled)
apps/web/src/components/Sidebar.tsx      236   rail
apps/web/src/components/Timeline.tsx     134   virtualized list
apps/web/src/components/TagEditor.tsx     77
apps/web/src/components/SignIn.tsx        67
apps/web/src/components/Icon.tsx          90
```

---

## 1. Decisions (and what they cost)

**Vendored, not wrapped.** shadcn components land in `src/components/ui/` and we own them. Two
files get deliberate local edits (`sidebar.tsx` — see §5); those edits must be re-applied by hand
if that component is ever re-pulled. Everything else stays upgrade-clean.

**Adopt `@/` path aliases.** shadcn's generated code imports `@/lib/utils` and `@/components/ui/*`
extensionless. Fighting that means patching every `shadcn add`. Since the kebab rename touches
every import line anyway, convert app code to `@/` at the same time and drop the `.js` suffixes.
One convention, one pass.

**Timeline keeps its own scroller.** `@tanstack/react-virtual` needs a real scroll element via
`getScrollElement`. Do **not** wrap it in shadcn's `ScrollArea` — the Radix viewport is a nested
div and the virtualizer would measure the wrong box. This is the single highest-risk regression
in the migration; it's avoided by simply not touching `timeline.tsx`'s scroll container.

**`SearchOverlay` becomes `CommandDialog`.** cmdk already does arrow-key navigation, selection
state, filtering and focus trapping — that's ~60 lines of hand-rolled logic deleted. We keep our
own ranking by rendering pre-sorted results with `shouldFilter={false}`.

**Kind colours become tokens, not palette classes.** `KindDot`'s `amber/emerald/rose/sky/violet/
red/slate` map and the violet AI-summary treatment are hardcoded Tailwind. Under a mint theme they
read as noise. They become `--kind-*` / `--ai` CSS variables, muted and hue-harmonised (§3).

**`Icon.tsx` survives.** shadcn blocks import lucide directly, and that's fine — but `KIND_ICON`
needs string keys mapping `ItemKind → icon`, and the shared `strokeWidth={1.6}` has one home.
`ui/` files import lucide directly; app files keep using `<Icon name="…">`.

---

## 2. Phase 0 — foundation

**0.1 Path alias.** `apps/web/tsconfig.json`:

```jsonc
"compilerOptions": {
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
}
```

`apps/web/vite.config.ts`:

```ts
resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }
```

**0.2 Deps** (all web-only → straight into `apps/web/package.json`, not the workspace catalog;
the catalog is for versions shared across packages, and `lucide-react` already sets this precedent):

```
class-variance-authority  clsx  tailwind-merge  tw-animate-css  cmdk
@radix-ui/react-slot  -dialog  -dropdown-menu  -tooltip  -separator
@radix-ui/react-toggle-group  -checkbox  -alert-dialog
sonner            # optional, §4.2
```

**0.3 `components.json`** at `apps/web/`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

`"config": ""` is required for Tailwind v4 (no JS config file). `baseColor` only seeds the initial
token values — Phase 1 overwrites them wholesale, so the choice is irrelevant.

**0.4 `src/lib/utils.ts`** — the standard `cn()`. Note it lands beside our existing kebab-case
`lib/` files, so no naming conflict.

**0.5 Pull the components:**

```
pnpm --filter web dlx shadcn@latest add \
  button card input textarea badge separator tooltip skeleton \
  sheet dialog dropdown-menu alert-dialog command sidebar \
  checkbox toggle-group alert sonner
```

`sidebar` transitively pulls `button separator sheet tooltip input skeleton` — listing them is
harmless. Run `pnpm lint:fix` afterwards: generated files are not prettier-formatted to our
`printWidth: 100`, and the repo's `lint` script gates on `prettier --check`.

**Exit criteria:** `pnpm typecheck && pnpm lint && pnpm --filter web build` all green with the app
still on its old styling. No visual change yet.

---

## 3. Phase 1 — the muted-mint theme

Hue anchor **168–174°** in OKLCH (mint/sea-green). Everything carries the hue — surfaces, ink,
borders, rings, shadows, overlays — but the chroma budget is split so only `primary`, `ring`,
`accent` and the kind tokens show colour; the rest reads as "not quite grey" (§3.1).

Every value was computed OKLCH → sRGB and checked for gamut + WCAG contrast. **All text pairs pass
AA; focus rings pass 3:1.**

### 3.1 `src/index.css`

**The shipped token set lives in `apps/web/src/index.css` — read it there, not here.** The full
block was inlined in this section while the migration was in flight; it has since been revised
(2026-08-13, after a first pass read too green) and duplicating it invites drift.

The shape is the standard shadcn v4 layout: `@import "tailwindcss"` + `tw-animate-css`, a
`@custom-variant dark`, `:root` / `.dark` token blocks, an `@theme inline` mapping every token to a
`--color-*` utility, and a small `@layer base`. Ours on top of the shadcn set: `--panel`,
`--warning`, `--success`, the `-hover` and `-soft` variants, seven `--kind-*` (+ `-soft`), `--ai`,
`--overlay` + its `--opacity-overlay*` strengths, and a re-tinted shadow scale including `--shadow-float`.

**Two rules hold the palette together.**

_1. The chroma budget is lopsided_ — this is what makes it read as _subtle_ mint:

| group          | tokens                                                                     | chroma             |
| -------------- | -------------------------------------------------------------------------- | ------------------ |
| surfaces       | background, card, popover, panel, sidebar, muted, secondary, border, input | **0.0015 – 0.009** |
| ink            | foreground, muted-foreground, secondary-foreground                         | **0.006 – 0.012**  |
| highlight      | accent, sidebar-accent                                                     | 0.018 – 0.024      |
| working colour | primary, ring, destructive, warning, success, `--kind-*`, `--ai`           | 0.03 – 0.18        |

At those surface values a light canvas is `#f8fbfa` against a neutral `#fafafa`, and a dark canvas
`#121514` against `#141414` — a max channel delta of ~2/255. The tint is present when you look for
it and invisible when you don't, while `primary` (`#2d6956`), the active nav row and the kind
tokens stay unmistakably mint. Raising surface chroma back toward 0.015+ is what made the first
pass look like a green app.

_2. Every colour is an opaque token — including borders and shadows._ No `bg-muted/40`, no
`border: white/10%`, no `dark:bg-destructive/60`. An alpha colour composites against whatever is
behind it, so one class lands three different ways on the canvas, on a card, and inside the detail
sheet. The replacements:

| was                                                    | now                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `bg-muted/40` inset blocks                             | `--panel` (solid, one step off card)                           |
| `bg-kind-*/12`, `bg-ai/8`, `bg-ai/12`                  | `--kind-*-soft`, `--ai-soft` (8 solid fills)                   |
| `bg-destructive/10`, `/20`                             | `--destructive-soft`                                           |
| `bg-primary/90`, `bg-secondary/80,/90`                 | `--primary-hover`, `--secondary-hover`                         |
| `bg-destructive/90`                                    | `--destructive-hover`                                          |
| dark `border: oklch(1 0 0 / 10%)`                      | solid `oklch(0.305 0.008 174)` — mint-hued                     |
| dark `input: oklch(1 0 0 / 15%)`                       | solid `oklch(0.345 0.009 174)`                                 |
| `ring-ring/50`, `ring-destructive/20,40`               | solid `ring-ring` / `ring-destructive`                         |
| `bg-input/30`, `bg-input/50`                           | `--panel`, `--accent`                                          |
| `bg-black/50` (Radix overlays)                         | `--overlay` (mint-hued)                                        |
| `text-white` on destructive + `dark:bg-destructive/60` | `--destructive-foreground` (near-white light, near-black dark) |

That last row is worth calling out: shadcn dims the destructive fill to 60% in dark mode purely to
keep white text legible on it. Instead, dark `--destructive` stays light enough to read as _text_
on the canvas (5.10:1 on a card) and takes **dark** ink as a fill — one token pair, no alpha, and
the contrast caveat from the first pass is gone.

**Shadows carry the hue too.** Tailwind's `--shadow-*` scale is overridden in `@theme inline` to
`rgb(var(--shadow-tint) / var(--shadow-aN))`, with the tint at `57 84 75` (a dark mint) in light
and `0 6 4` in dark, plus four strengths the dark theme re-tunes. `inline` is load-bearing: it
emits the `var()` references into the utilities so `.dark` can re-point them at runtime.

`shadow-float` is a `--shadow-float` **theme key**, not a `@utility`. A custom utility writing
`box-shadow:` directly would clobber any `ring-*` on the same element, since Tailwind composes ring
and shadow into a single `box-shadow` — which would have silently killed the composer's drag-hover
ring.

**The two exceptions**, both physically translucent: `--overlay` (you must see the page through it)
and the shadow scale (an opaque shadow is a solid block). Both are mint-tinted; the shadow scale
bakes its alpha into the token, while the overlay keeps an opaque colour and names its strengths as
`--opacity-overlay` / `--opacity-overlay-strong` in the `@theme` block. Tailwind resolves those as
named opacity modifiers, so call sites read `bg-overlay/overlay` (dialogs, sheets) and
`bg-overlay/overlay-strong` (the full-screen drop target) — never a loose `/65`. One overlay colour
serves both themes and carries no ink tokens of its own, because everything shown over it (dialog,
sheet, the drop card) brings its own surface.

`color-scheme: light` / `dark` in `@layer base` matters more than it looks: it fixes native
scrollbars, `<input>` chrome and the PDF `<iframe>` in `item-detail` so they don't stay white in
dark mode.

### 3.2 Verified numbers

Light / dark, recomputed after the 2026-08-13 desaturation:

| pair                                 | ratio                     |
| ------------------------------------ | ------------------------- |
| foreground / background              | 15.50 / 15.27             |
| foreground / card                    | 16.04 / 13.89             |
| muted-foreground / card              | 5.79 / 6.59               |
| primary-foreground / primary         | 6.19 / 9.23               |
| accent-foreground / accent           | 11.21 / 10.33             |
| foreground / sidebar-accent (active) | 13.94 / —                 |
| ring / background                    | 3.98 / 6.59               |
| every `--kind-*` on card             | 4.59 – 5.37 / 7.01 – 8.76 |
| warning-foreground / warning         | 7.67 / 9.13               |

One caveat carried forward: **dark `--destructive` (`#e7645a`) is tuned to read as _text_ on the
dark canvas, not as a button fill under white text (3.29:1).** shadcn's own `button.tsx` handles
this with `dark:bg-destructive/60 text-white`; keep that variant as generated and don't hand-roll
`bg-destructive text-white` in dark mode.

### 3.3 Dark mode wiring

- `lib/store.ts` gains `theme: "light" | "dark" | "system"`, persisted to
  `localStorage["ragbag:theme"]` — the same deliberate exception already granted to
  `sidebarCollapsed` (a device preference, per `PLAN.md` §10).
- A tiny inline script in `index.html` sets `document.documentElement.classList` **before** first
  paint (avoids the white flash); the store re-applies on change and subscribes to
  `matchMedia("(prefers-color-scheme: dark)")` while on `"system"`.
- Toggle: a `DropdownMenu` (Light / Dark / System) in the sidebar footer next to sign-out.
- Add `<meta name="theme-color">` for both schemes so mobile browser chrome matches.

### 3.4 Palette sweep

Mechanical, but do it per-file with eyes on — several `neutral-900`s are _fills_ and several are
_text_, and they diverge:

| current                                              | becomes                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `bg-neutral-50` (canvas)                             | `bg-background`                                           |
| `bg-white` (cards, popovers, drawers)                | `bg-card` / `bg-popover` / `bg-sidebar`                   |
| `border-neutral-200`, `border-neutral-200/90`        | `border-border`                                           |
| `text-neutral-900`                                   | `text-foreground`                                         |
| `text-neutral-700/600`                               | `text-foreground` or `text-muted-foreground` (judgement)  |
| `text-neutral-500/400`                               | `text-muted-foreground`                                   |
| `bg-neutral-900 text-white` (active nav, send, save) | `bg-primary text-primary-foreground`                      |
| `hover:bg-neutral-100`                               | `hover:bg-accent hover:text-accent-foreground`            |
| `bg-neutral-100` chips                               | `bg-secondary text-secondary-foreground`                  |
| `bg-neutral-900/30` overlays                         | `bg-overlay` (Radix overlays own this once on shadcn)     |
| amber sync banner                                    | `warning` tokens via `<Alert>`                            |
| emerald sync dot / todo check                        | `success` tokens                                          |
| `red-*` failures/delete                              | `destructive`                                             |
| `KindDot` map, `sky` links, `violet` AI              | `--kind-*` / `--ai`                                       |
| `shadow-[0_8px_30px_rgb(0_0_0/0.10)]`                | `--shadow-float` theme key (defined once, not in 3 files) |

### 3.5 Motion (revised 2026-08-13)

The generated components ship timings that read as sluggish, and the reason isn't only duration:

| surface                                     | shadcn default                                 | now                                 |
| ------------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| Sheet content (detail panel, mobile drawer) | **500ms in / 300ms out, `ease-in-out`**        | 200 in / 150 out, enter/exit curves |
| Sheet overlay                               | unset → 150ms default, desynced from the panel | matched to the panel exactly        |
| Dialog / AlertDialog                        | 200ms, no easing specified                     | 150 in / 100 out, enter/exit curves |
| Sidebar rail + gap                          | 200ms **`ease-linear`**                        | 200ms, enter curve                  |

Two tokens in `index.css` carry it:

```
--ease-enter: cubic-bezier(0.32, 0.72, 0, 1);   /* decelerate hard */
--ease-exit:  cubic-bezier(0.4, 0, 1, 1);       /* accelerate away */
```

`ease-in-out` is the actual culprit on the drawer: it's symmetric, so the panel barely moves for the
first ~100ms of a 500ms slide. An arriving panel should cover most of the distance immediately and
settle; a leaving one should accelerate out and take _less_ time than it took to arrive.

Two details worth keeping:

- **`transition-none` on the animated panels.** These animate via keyframes, but `duration-*` and
  `ease-*` also set `transition-duration` / `transition-timing-function`, and CSS's default
  `transition-property` is `all` — so every colour and shadow on the panel silently gained a 200ms
  transition. tw-animate-css reads `--tw-duration`, which `transition-property: none` doesn't touch,
  so the keyframe animation is unaffected (verified from computed styles).
- **`shadow-float` must be a `--shadow-*` theme key, not a `@utility`.** A utility writing
  `box-shadow:` directly clobbers any `ring-*` on the same element, since Tailwind composes ring and
  shadow into one `box-shadow` — that would have silently killed the composer's drag-hover ring.

`prefers-reduced-motion: reduce` collapses everything to 1ms (not 0 — some state changes wait on
`animationend`).

**The item-detail sheet had no exit animation at all.** Closing navigated to `/`, which unmounts the
component before Radix can play the exit — the panel vanished in a single frame (measured: 23ms)
while the mobile drawer, being state-driven, slid out properly over ~240ms. It now holds local
`open` state and defers the route change by `SHEET_EXIT_MS`; during that window it paints the last
known item, because deleting from the sheet drops the row from the store and would otherwise flash
the loading spinner on the way out.

Measured on the production bundle (dev numbers are inflated by StrictMode's double render): mobile
drawer click → fully settled in **217–265ms**, of which 24–51ms is React mounting the portal.

### 3.6 Canvas strip behind the composer (added 2026-08-13, made solid 2026-08-14)

A `pointer-events-none absolute inset-x-0 bottom-0 bg-background` div **inside the composer's own
wrapper** in `composer.tsx`. Positioning it against `SidebarInset` instead makes it a fraction of
the _page_ and washes out half the timeline; it belongs to the composer.

Its height is `calc(var(--composer-inset) + 1rem)` — the gap between the card and the bottom of the
column, plus 1rem that tucks in behind the card. Sized off the gap rather than the card because the
card grows with its content (the textarea autosizes to 200px) while the gap is fixed; a percentage
height would drift with the draft. `--composer-inset` is declared once in `index.css` and feeds both
the wrapper's `pb-(--composer-inset)` and this height, so the two can't disagree.

`inset-x-0` resolves against the wrapper's padding box, so the strip is full-bleed and covers the
safe-area strip. The card wrapper gets `relative` so it keeps painting above it — both live in the
same stacking context, and an unpositioned block falls behind a positioned sibling.

Solid `--background`, not a gradient. The first version was a `fade-to-canvas` `@utility` ramping
from the canvas colour to 75% of it, which meant a translucent stop — a third exception to §3.2's
"every colour is an opaque token", for a ramp that read as haze over the bottom of the timeline. A
flat fill has no visible top edge to hide anyway: in the middle it sits behind the composer card
(what the `+ 1rem` on the height buys), and either side of the card it's background over background,
because the timeline column (`max-w-3xl px-4`) is inset further than the composer card
(`max-w-3xl` inside the wrapper's `px-3`/`md:px-4`), so no scrolling card ever reaches that band.

### 3.7 Radius ladder and nesting (added 2026-08-14)

All seven rungs are declared in `@theme inline`, derived from `--radius` (0.75rem):

| utility       | value | typical use                                    |
| ------------- | ----- | ---------------------------------------------- |
| `rounded-xs`  | 4px   | checkbox, favicon, `kbd`                       |
| `rounded-sm`  | 6px   | todo checkbox, attachment thumbnail            |
| `rounded-md`  | 8px   | buttons, inputs, icon tiles, menu rows         |
| `rounded-lg`  | 12px  | blocks nested inside a card                    |
| `rounded-xl`  | 16px  | top-level blocks on a flat panel (item detail) |
| `rounded-2xl` | 20px  | floating cards, dialogs, the sidebar           |
| `rounded-3xl` | 24px  | the composer                                   |

Declaring all seven is the point. An undeclared rung doesn't disappear — it falls back to
Tailwind's stock value, and stock `2xl` is `1rem`, the same 16px our `xl` resolves to. With `xs`,
`2xl` and `3xl` left out, `ItemCard` (`rounded-2xl`) and every block inside it (`rounded-xl`) drew
identical corners, so the inner curves bulged past the outer ones instead of nesting inside them.

Nesting rule:

1. **Concentric.** A child flush against its parent's padding is `parent radius − padding`, snapped
   to the nearest rung.
2. **Isolated.** Once the padding reaches the parent's radius the two curves no longer interact;
   size the child by its own scale, but never rounder than its parent.
3. **Pills are exempt.** `rounded-full` badges, chips, avatars and icon buttons sit outside the
   ladder and never step down.

The item card's cascade is `20 → 12 → 8 → 4`: card, then the address/link/image/file block, then
the icon tile or thumbnail inside it, then the favicon. Strict rule 1 would put the blocks at
20 − 14 (`p-3.5`) = 6px, which reads as a slab under an 80px photo; 12px is the deliberate
deviation — two rungs down, unmistakably nested, still generous. The composer follows rule 1
exactly: 24 → 12 (`px-3`) → 6 (`p-1.5`).

Item detail is the exception that proves the rule: its `Sheet` is a full-height edge panel with no
radius, so the blocks inside it are top-level surfaces, not nested ones, and stay at `rounded-xl`.

`rounded-[2px]` on the tooltip arrow is the only literal radius left in the app — it's a rotated
decorative square, not a surface. `grep -rn 'rounded-\[' apps/web/src` should return that one line
and nothing else.

---

## 4. Phase 2 — rename + primitive adoption

Rename and rewrite each file in one commit per file, so a bad diff is easy to isolate.

### 4.1 Rename map

| from                               | to                                  |
| ---------------------------------- | ----------------------------------- |
| `src/App.tsx`                      | `src/app.tsx`                       |
| `src/components/Composer.tsx`      | `src/components/composer.tsx`       |
| `src/components/Icon.tsx`          | `src/components/icon.tsx`           |
| `src/components/ItemCard.tsx`      | `src/components/item-card.tsx`      |
| `src/components/ItemDetail.tsx`    | `src/components/item-detail.tsx`    |
| `src/components/SearchOverlay.tsx` | `src/components/search-overlay.tsx` |
| `src/components/Sidebar.tsx`       | `src/components/sidebar.tsx`        |
| `src/components/SignIn.tsx`        | `src/components/sign-in.tsx`        |
| `src/components/TagEditor.tsx`     | `src/components/tag-editor.tsx`     |
| `src/components/Timeline.tsx`      | `src/components/timeline.tsx`       |
| `src/main.tsx`, all of `src/lib/*` | unchanged (already kebab)           |

Exported **component identifiers stay PascalCase** (`export function ItemDetail`) — the convention
is about filenames. Directory rule: `components/ui/*` = vendored shadcn primitives,
`components/*` = ours. That's what disambiguates our `components/sidebar.tsx` (the ragbag rail)
from `components/ui/sidebar.tsx` (the shadcn primitive it's built on).

Five of these are **case-only renames** (`App`, `Composer`, `Icon`, `Sidebar`, `Timeline`). On this
Linux box `git mv` is fine, but do them via a temp name (`git mv Sidebar.tsx _s.tsx && git mv
_s.tsx sidebar.tsx`) so the history is unambiguous for anyone on a case-insensitive filesystem.

Same pass: imports become `@/components/item-card` etc. — no `../`, no `.js`.

### 4.2 Per-file adoption

**`app.tsx`** — the biggest structural change.

- Shell becomes `SidebarProvider` → `<AppSidebar/>` → `SidebarInset` (see §5). The hand-rolled
  desktop rail wrapper, mobile drawer, and overlay all delete.
- `SyncBanner` → `<Alert>`; the signed-out variant uses `warning` tokens, offline uses `muted`.
- The `floatingButton` class constant → `<Button variant="outline" size="icon" className="rounded-full shadow-md">`; the mobile hamburger → `<SidebarTrigger>`.
- Keep: the identity gate, `QueueWiring`, the ⌘\ / Esc effect (relocated, see §5).

**`composer.tsx`**

- Card shell → `Card` (or keep the bare div; the composer's rounded-3xl is intentional and
  `Card`'s `rounded-xl` would flatten it — prefer `bg-card border-border shadow-lg` on the existing div).
- `Textarea` for the draft (keep the autosize effect and `≥16px` font-size — it's what stops iOS focus-zoom).
- The hand-rolled capture-type menu (`typeMenuOpen` + a `fixed inset-0` click-catcher) → `DropdownMenu` with `DropdownMenuRadioGroup`. Deletes the click-away hack and gets real focus management.
- Attachment chips → `Badge variant="secondary"` + a `Button size="icon"` remove.
- `rejected` inline error → `sonner` toast (optional; it's the one place a toast beats inline text, since the composer clears on send).
- `DropOverlay` keeps its bespoke full-viewport treatment — **do not** make it a Radix dialog; it must stay `pointer-events-none` or window-level drop handlers break.

**`item-card.tsx`**

- `article` → `Card` + `CardContent`.
- `StatusChip`, `TagChips` → `Badge` (`destructive` / `warning` / `secondary` variants).
- Hover action row → `Button variant="ghost" size="icon"` inside the existing floating pill; wrap each in `Tooltip` and drop the `title=` attributes.
- `window.confirm("Delete this item?")` → `AlertDialog` (also in `item-detail.tsx`). Two call sites, same dialog — worth a shared `delete-item-dialog.tsx`.
- `TodoBody` checkbox → shadcn `Checkbox` restyled to `--kind-todo`/`success`, or keep the custom button (it's already accessible with `role="checkbox"`/`aria-checked`). Prefer the shadcn `Checkbox` for consistent focus rings.
- `KindDot` → `--kind-*` tokens: `bg-kind-note/12 text-kind-note` etc.
- `Linkified`'s `text-sky-700` → `text-kind-link`.

**`item-detail.tsx`**

- The bespoke `Overlay` (fixed + overlay + right panel) → `Sheet side="right"` with
  `className="w-full gap-0 p-0 sm:max-w-2xl"`. Gets focus trap, scroll lock, Esc, and animation for
  free — delete the local Esc `useEffect`.
- Keep the sticky header inside `SheetContent`; the title needs a `SheetTitle` (visually hidden if
  we keep the custom header) or Radix logs an a11y warning.
- Kind reclassifier → `ToggleGroup type="single"`.
- Edit textarea → `Textarea` + `Button` / `Button variant="ghost"`.
- Loading blocks → `Skeleton`.
- AI summary section → `--ai` tokens (`bg-ai/8`, `text-ai`).
- Ingestion-failed block → `Alert variant="destructive"`.
- Section headings → a small local `SectionLabel` (keep; it's 4 lines).
- **Keep** the `pb-[env(safe-area-inset-bottom)]` — `SheetContent` doesn't add it.

**`search-overlay.tsx`** → `CommandDialog`.

- `open={searchOpen} onOpenChange={setSearchOpen}`, `shouldFilter={false}` (our minisearch ranking wins), `CommandInput` / `CommandList` / `CommandEmpty` / `CommandItem`.
- Deletes: `selected` state, the Arrow/Enter key handler, `requestAnimationFrame` focus, the outside-click div. Keeps: the ⌘K global listener and `useSearchResults`.
- Footer line stays as a plain `div` under `CommandList`.

**`sidebar.tsx`** — see §5.

**`tag-editor.tsx`** — `Badge` for each tag, `Input` for the draft. The `<datalist>` suggestion
mechanism works but is unstyleable; a `Command`-in-`Popover` combobox is the shadcn-native
replacement. Ship the `Input` version in this migration, note the combobox as follow-up.

**`sign-in.tsx`** — `Card`/`CardHeader`/`CardContent` + `Button` (`default` for Google, `outline`
for dev sign-in).

**`timeline.tsx`** — colour sweep only. Day separators → `Badge variant="secondary"`. **Scroll
container untouched.**

**`icon.tsx`** — unchanged apart from the filename.

---

## 5. Phase 3 — the sidebar: floating on desktop, flush on mobile

The current implementation renders the rail card twice and keeps the floating-card inset _in both
places_ — `PLAN.md` §10 explicitly documents the mobile drawer as "keeping the floating-card
inset". **That is the behaviour being changed.**

shadcn's `Sidebar` happens to encode exactly the desired split by construction:

- `variant="floating"` applies `p-2` + `rounded-lg border shadow` **only in the `md`+ branch**;
- below `md` (`useIsMobile`, 768px) it renders a `Sheet` — full-height, flush to the edge, no
  inset, no rounding, regardless of variant.

So: `<Sidebar variant="floating" collapsible="offcanvas">` and the requirement is met by the
primitive, not by a media-query hack of ours. The `md` breakpoint also matches the existing
`md:hidden` / `md:block` split exactly, so nothing shifts.

**Wiring**

- `SidebarProvider` in **controlled** mode: `open={!sidebarCollapsed}`,
  `onOpenChange={(o) => setSidebarCollapsed(!o)}` → zustand + `localStorage`, preserving the
  documented device-preference behaviour.
- **Vendored edit 1:** `sidebar.tsx` writes a `sidebar_state` cookie on every toggle. Delete that —
  localStorage via zustand is the single source of truth and two persistence layers will disagree.
- **Vendored edit 2:** `SIDEBAR_KEYBOARD_SHORTCUT = "b"` → `"\\"`, keeping ⌘\. Then delete the ⌘\
  half of the `app.tsx` key handler (the Esc half is handled by `Sheet`).
- Drop `sidebarOpen` from the zustand store — the provider owns mobile open state and exposes
  `setOpenMobile()` via `useSidebar()`. `setViewFilter`/`setTagFilter`/`setSearchOpen` currently
  close the drawer as a side effect; that moves into the components, which call `setOpenMobile(false)`
  on pick. (Keeping the store pure of `sidebarOpen` is the point — it was always ephemeral.)
- `--sidebar-width: 18rem` (= the current `w-72`); `--sidebar-width-mobile: 19rem`.
- **Carry over the safe-area insets.** The current mobile drawer uses
  `py-[max(0.75rem,env(safe-area-inset-top))]` / `pl-[…-left]`; `SheetContent` has none. Add them
  to `SidebarHeader`/`SidebarFooter` or this regresses on notched phones — it's called out in
  `PLAN.md` §10 acceptance.
- The floating reopen button when collapsed: either keep the custom one (`SidebarTrigger` in
  `SidebarInset`) or use `SidebarRail`. Keep the custom button — the rail's hit-strip is a
  different interaction than the plan documents.

**Body mapping**
`SidebarHeader` (logo + trigger) → search button → `SidebarGroup`/`SidebarMenu`/`SidebarMenuButton
isActive` + `SidebarMenuBadge` for counts → scrolling tags `SidebarGroup` → `SidebarFooter`
(upload queue, name, `SyncDot`, theme toggle, sign-out). `SidebarMenuBadge` replaces the
`ml-auto text-xs opacity-60` counts; `SidebarMenuSkeleton` covers the pre-sync state.

---

## 6. Phase 4 — cleanup & verification

- `grep -rnE "\b(neutral|slate|amber|emerald|rose|sky|violet|red)-[0-9]" apps/web/src` must return
  **only** `components/ui/*` (and ideally nothing) — that's the objective "theme is complete" check.
- `pnpm lint && pnpm typecheck && pnpm --filter web build`.
- Visual pass at **375 / 768 / 1280**, light **and** dark, via local headless Playwright against
  `pnpm dev` (the t3 preview browser is the user's machine, not this environment):
  - no horizontal scroll at 375;
  - **sidebar is flush and full-height at 375, floating card at 1280** ← the headline change;
  - composer usable with the on-screen keyboard up;
  - collapse state survives reload;
  - virtualized timeline still scrolls/anchors to newest (the ScrollArea trap);
  - PDF iframe + image lightbox legible in dark mode.
- Contrast spot-check: `--ring` on both canvases, destructive button in dark mode.
- Update `PLAN.md` §10 — the "Shell layout" bullet's mobile clause ("keeping the floating-card
  inset") is now wrong, and an "as built" note should record the shadcn adoption, the token set,
  dark mode, and the two vendored-file edits so they survive future `shadcn add` runs.

---

## 7. Risks

| risk                                                                | mitigation                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ScrollArea` breaks the virtualizer                                 | don't use it in `timeline.tsx`; verify scroll-to-bottom anchoring                                        |
| Radix `Sheet` regresses safe-area insets on notched phones          | explicitly re-add `env(safe-area-inset-*)` padding in `SidebarHeader`/`SidebarFooter` and `SheetContent` |
| Two vendored edits to `ui/sidebar.tsx` lost on re-add               | recorded here + in `PLAN.md` §10 "as built"                                                              |
| Cookie vs localStorage double-persistence of collapse state         | delete the cookie write during Phase 3                                                                   |
| Case-only renames confusing on case-insensitive filesystems         | two-step `git mv` through a temp name                                                                    |
| Composer drop overlay swallowing drag events if made a Radix dialog | keep it a plain `pointer-events-none` div                                                                |
| shadcn `add` output failing `prettier --check` in `pnpm lint`       | run `pnpm lint:fix` right after every `shadcn add`                                                       |
| Dark destructive fill under white text (3.29:1)                     | keep shadcn's `dark:bg-destructive/60` button variant as generated                                       |

## 8. Sequencing

Phase 0 (foundation, no visual change) → Phase 1 (theme; app still on old class names, so it will
look _slightly_ off mid-flight — acceptable, it's one commit) → Phase 2 file-by-file (rename +
primitives + sweep, one commit each; `sidebar.tsx` last) → Phase 3 (sidebar restructure) → Phase 4
(verify + `PLAN.md`).

Phases 0–1 are ~half a day; Phase 2 is the bulk; Phase 3 is small but is where the mobile
behaviour change lands.
