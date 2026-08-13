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

Hue anchor **168–174°** in OKLCH (mint/sea-green), chroma held low (0.01–0.09) so it reads as a
tinted neutral rather than a green app. Chrome is mint-tinted grey; only `primary`, `ring` and
`accent` carry visible colour.

Every value below was computed OKLCH → sRGB and checked for gamut + WCAG contrast (script kept at
the bottom of this section). **All text pairs pass AA; focus rings pass 3:1.**

### 3.1 `src/index.css` (replaces the one-line file)

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.75rem; /* the app's language is already rounded-2xl cards */

  --background: oklch(0.985 0.007 168); /* #f6fcf9 */
  --foreground: oklch(0.245 0.021 172); /* #16241f */
  --card: oklch(0.996 0.003 168); /* #fcfefd */
  --card-foreground: oklch(0.245 0.021 172);
  --popover: oklch(0.996 0.003 168);
  --popover-foreground: oklch(0.245 0.021 172);

  --primary: oklch(0.475 0.07 170); /* #2d6956  deep muted mint */
  --primary-foreground: oklch(0.985 0.012 168);
  --secondary: oklch(0.945 0.016 168);
  --secondary-foreground: oklch(0.305 0.024 172);
  --muted: oklch(0.958 0.012 168);
  --muted-foreground: oklch(0.505 0.022 172); /* #586963 */
  --accent: oklch(0.915 0.032 170); /* #cfeae0 */
  --accent-foreground: oklch(0.295 0.032 172);

  --destructive: oklch(0.545 0.18 27);
  --destructive-foreground: oklch(0.985 0.012 168);
  --warning: oklch(0.955 0.035 92); /* surface */
  --warning-foreground: oklch(0.415 0.075 78);
  --success: oklch(0.95 0.035 160);
  --success-foreground: oklch(0.505 0.09 158);

  --border: oklch(0.9 0.014 168);
  --input: oklch(0.9 0.014 168);
  --ring: oklch(0.58 0.06 170); /* 3.99:1 on background */

  --sidebar: oklch(0.998 0.002 168);
  --sidebar-foreground: oklch(0.245 0.021 172);
  --sidebar-primary: oklch(0.475 0.07 170);
  --sidebar-primary-foreground: oklch(0.985 0.012 168);
  --sidebar-accent: oklch(0.945 0.02 170);
  --sidebar-accent-foreground: oklch(0.295 0.03 172);
  --sidebar-border: oklch(0.905 0.014 168);
  --sidebar-ring: oklch(0.58 0.06 170);

  /* item kinds — muted, mint-harmonised; used as text + `/12` fills */
  --kind-note: oklch(0.56 0.085 95);
  --kind-todo: oklch(0.535 0.085 160);
  --kind-address: oklch(0.56 0.095 20);
  --kind-link: oklch(0.545 0.08 235);
  --kind-image: oklch(0.555 0.085 300);
  --kind-pdf: oklch(0.545 0.115 30);
  --kind-file: oklch(0.52 0.03 200);
  --ai: oklch(0.545 0.085 285);

  --chart-1: oklch(0.615 0.09 168);
  --chart-2: oklch(0.575 0.075 212);
  --chart-3: oklch(0.65 0.075 132);
  --chart-4: oklch(0.66 0.09 84);
  --chart-5: oklch(0.56 0.08 296);
}

.dark {
  --background: oklch(0.19 0.014 174); /* #0d1613 */
  --foreground: oklch(0.935 0.011 168);
  --card: oklch(0.228 0.017 174); /* #141f1c */
  --card-foreground: oklch(0.935 0.011 168);
  --popover: oklch(0.228 0.017 174);
  --popover-foreground: oklch(0.935 0.011 168);

  --primary: oklch(0.78 0.09 168); /* #7bcaac */
  --primary-foreground: oklch(0.205 0.03 172);
  --secondary: oklch(0.278 0.019 174);
  --secondary-foreground: oklch(0.935 0.011 168);
  --muted: oklch(0.278 0.019 174);
  --muted-foreground: oklch(0.712 0.021 168);
  --accent: oklch(0.318 0.028 172);
  --accent-foreground: oklch(0.935 0.011 168);

  --destructive: oklch(0.665 0.165 27);
  --destructive-foreground: oklch(0.205 0.03 172);
  --warning: oklch(0.29 0.045 80);
  --warning-foreground: oklch(0.855 0.085 92);
  --success: oklch(0.29 0.045 160);
  --success-foreground: oklch(0.81 0.095 158);

  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.68 0.06 170); /* 6.57:1 on background */

  --sidebar: oklch(0.228 0.017 174);
  --sidebar-foreground: oklch(0.935 0.011 168);
  --sidebar-primary: oklch(0.78 0.09 168);
  --sidebar-primary-foreground: oklch(0.205 0.03 172);
  --sidebar-accent: oklch(0.318 0.028 172);
  --sidebar-accent-foreground: oklch(0.935 0.011 168);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.68 0.06 170);

  --kind-note: oklch(0.79 0.09 95);
  --kind-todo: oklch(0.78 0.09 160);
  --kind-address: oklch(0.76 0.095 20);
  --kind-link: oklch(0.76 0.08 235);
  --kind-image: oklch(0.77 0.085 300);
  --kind-pdf: oklch(0.74 0.11 30);
  --kind-file: oklch(0.76 0.03 200);
  --ai: oklch(0.765 0.085 285);

  --chart-1: oklch(0.72 0.09 168);
  --chart-2: oklch(0.7 0.08 212);
  --chart-3: oklch(0.75 0.075 132);
  --chart-4: oklch(0.76 0.09 84);
  --chart-5: oklch(0.68 0.08 296);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-kind-note: var(--kind-note);
  --color-kind-todo: var(--kind-todo);
  --color-kind-address: var(--kind-address);
  --color-kind-link: var(--kind-link);
  --color-kind-image: var(--kind-image);
  --color-kind-pdf: var(--kind-pdf);
  --color-kind-file: var(--kind-file);
  --color-ai: var(--ai);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
}

@layer base {
  :root {
    color-scheme: light;
  }
  .dark {
    color-scheme: dark;
  }
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

`color-scheme` matters more than it looks: it fixes native scrollbars, `<input>` chrome and the
PDF `<iframe>` in `item-detail` so they don't stay white in dark mode.

### 3.2 Verified numbers

| pair                                   | ratio                     |
| -------------------------------------- | ------------------------- |
| foreground / background (light / dark) | 15.47 / 15.27             |
| muted-foreground / card                | 5.74 / 6.67               |
| primary-foreground / primary           | 6.19 / 9.23               |
| accent-foreground / accent             | 10.77 / 10.46             |
| ring / background                      | 3.99 / 6.57               |
| every `--kind-*` on card               | 4.59 – 5.37 / 7.01 – 8.76 |
| warning-foreground / warning           | 7.67 / 9.13               |

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

| current                                              | becomes                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `bg-neutral-50` (canvas)                             | `bg-background`                                             |
| `bg-white` (cards, popovers, drawers)                | `bg-card` / `bg-popover` / `bg-sidebar`                     |
| `border-neutral-200`, `border-neutral-200/90`        | `border-border`                                             |
| `text-neutral-900`                                   | `text-foreground`                                           |
| `text-neutral-700/600`                               | `text-foreground` or `text-muted-foreground` (judgement)    |
| `text-neutral-500/400`                               | `text-muted-foreground`                                     |
| `bg-neutral-900 text-white` (active nav, send, save) | `bg-primary text-primary-foreground`                        |
| `hover:bg-neutral-100`                               | `hover:bg-accent hover:text-accent-foreground`              |
| `bg-neutral-100` chips                               | `bg-secondary text-secondary-foreground`                    |
| `bg-neutral-900/30` scrims                           | `bg-foreground/20` (Radix overlays own this once on shadcn) |
| amber sync banner                                    | `warning` tokens via `<Alert>`                              |
| emerald sync dot / todo check                        | `success` tokens                                            |
| `red-*` failures/delete                              | `destructive`                                               |
| `KindDot` map, `sky` links, `violet` AI              | `--kind-*` / `--ai`                                         |
| `shadow-[0_8px_30px_rgb(0_0_0/0.10)]`                | `shadow-lg` (or keep — but define it once, not in 3 files)  |

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
  desktop rail wrapper, mobile drawer, and scrim all delete.
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

- The bespoke `Overlay` (fixed + scrim + right panel) → `Sheet side="right"` with
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
