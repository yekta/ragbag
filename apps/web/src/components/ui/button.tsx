import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Local edit, applied across every file in this directory (re-apply on a
// re-pull): the generated components lean on alpha modifiers: a ring token at
// half strength, an input fill at 30%, a destructive tint at 10%, a black wash
// at 10%, each paired with a dark-only twin, because an alpha composites
// differently depending on what happens to be behind it. They now point at
// opaque tokens (the -hover, -soft, panel and overlay families) that re-declare
// themselves for the dark theme, so one class name is correct either way and
// the theme prefix is gone from the app entirely. Rule 2 in index.css has the
// full argument.
//
// Note that this comment names none of those classes literally, and neither
// should the next one: Tailwind scans this file as raw text, so a class spelled
// out in prose is compiled into the bundle as a real rule. Four dead utilities
// and three theme-prefixed ones were shipped that way before anyone noticed.
//
// Motion was retimed at the same time (dialog / alert-dialog / sidebar, which
// ran on `ease-linear`): those use `--ease-enter` / `--ease-exit` from
// index.css, with exits shorter than entrances. Sheet is the exception: it
// was retimed too, the drawer stopped reading as motion, and it is back on
// stock shadcn's 500/300 `ease-in-out`. See the note in ui/sheet.tsx.
//
// The `before:` strip in the base is the hit area, not the button: every size
// here tops out at 40px, and 44 is the floor every touch platform asks for
// (iOS 44pt, WCAG 2.5.5). `size-full` + `min-*-11` means it is
// `max(the button, 44px)` (a text button keeps its own bounds, an icon button
// grows symmetrically around itself), so nothing moves on screen.
//
// Same rule as the `after:` strip in ui/sidebar.tsx: an expanded hit area may
// tile the gap to its neighbour but must never cross into what the neighbour
// shows. Every cluster in this app was measured against that (the bleed is
// `(44 - button) / 2 - gap`, and it has to stay inside the neighbour's icon
// padding); the one that failed (the tag chips in tag-editor.tsx, where a
// wrapped row sits 6px away) clamps itself down. A call site that must not
// expand at all passes `before:hidden`.
//
// `relative` is here for that strip. Call sites that position the button
// themselves pass `absolute`, which twMerge resolves in favour of the call
// site; either way the button is the pseudo's containing block.

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive-soft text-destructive hover:bg-destructive-soft-hover focus-visible:border-destructive focus-visible:ring-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
