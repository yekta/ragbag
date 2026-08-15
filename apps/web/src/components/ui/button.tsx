import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Local edit, applied across every file in this directory (re-apply on a
// re-pull): the generated components lean on alpha modifiers — `ring-ring/50`,
// `bg-primary/90`, `dark:bg-destructive/60`, `bg-input/30`, `bg-black/50` — all
// of which composite differently depending on what happens to be behind them.
// They now point at opaque tokens (`-hover`, `-soft`, `panel`, `overlay`); see
// the header of index.css for why. The destructive variant also drops
// `text-white` + `dark:bg-destructive/60` in favour of `text-destructive-
// foreground`, which is near-white in light mode and near-black in dark — the
// contrast trick shadcn was using the 60% fill for, done with a real token.
//
// Motion was retimed at the same time (sheet / dialog / alert-dialog /
// sidebar): the generated Sheet ran 500ms in, 300ms out on `ease-in-out`, and
// the sidebar rail on `ease-linear`. Everything now uses `--ease-enter` /
// `--ease-exit` from index.css, with exits shorter than entrances.
//
// The `before:` strip in the base is the hit area, not the button: every size
// here tops out at 40px, and 44 is the floor every touch platform asks for
// (iOS 44pt, WCAG 2.5.5). `size-full` + `min-*-11` means it is
// `max(the button, 44px)` — a text button keeps its own bounds, an icon button
// grows symmetrically around itself — so nothing moves on screen.
//
// Same rule as the `after:` strip in ui/sidebar.tsx: an expanded hit area may
// tile the gap to its neighbour but must never cross into what the neighbour
// shows. Every cluster in this app was measured against that (the bleed is
// `(44 - button) / 2 - gap`, and it has to stay inside the neighbour's icon
// padding); the one that failed — the tag chips in tag-editor.tsx, where a
// wrapped row sits 6px away — clamps itself down. A call site that must not
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
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
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
