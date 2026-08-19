import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Local edit, on top of the palette one described in ui/button.tsx (re-apply
// on a re-pull): the base sets the mono family.
//
// A chip in this app is an instrument reading, not a sentence. Most of them
// count: a status chip walks a message through its parts, an upload badge
// counts to a hundred, a menu tallies whatever the archive holds. In a
// proportional face every one of those ticks is a different width, because the
// digits are, so the chip re-measures, and a chip that re-measures moves the
// row it sits in and every row under it. The composer already hit this from
// the other side and solved it by deleting the caption (see the note above the
// tile constant there); the chips can't, because the number is the point.
// Monospaced digits make the width a function of how many characters there are
// rather than which ones, so a chip is only ever as wide as its longest state.
//
// It is applied to the primitive rather than to the call sites because there
// is no chip in the app that wants the other answer, and the next one added
// should not have to know this. The rest of the family (counts, timers,
// timecodes, byte sizes, timestamps) carries the family utility at the call
// site, since those are bare elements and not this component.
//
// Names in prose, never class names: Tailwind scans this file as raw text, and
// a utility spelled out in a comment compiles into the bundle as a real rule.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 font-mono text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary-hover",
        destructive:
          "bg-destructive-soft text-destructive focus-visible:ring-destructive [a]:hover:bg-destructive-soft-hover",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
