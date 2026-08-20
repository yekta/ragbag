import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderIcon } from "lucide-react";

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
// The outline variant came out of that carrying an edge colour and no width.
// Preflight zeroes the width and nothing put it back, so it drew no edge at
// all in either theme and leaned on its shadow to be seen, which on a white
// card is very nearly nothing. The width is back.
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
//
// --- the press state ---
//
// Every variant's pointer state is repeated below as a press state, on the
// same token. A phone has no pointer, so a fill that only exists under one is
// a control that never acknowledges a tap: the finger goes down, the finger
// comes up, and nothing in between said the button heard it. Repeating the
// rung under the press pseudo-class is the whole of the fix, and it costs a
// pointer nothing, where a press already implies a hover and lands on the
// same fill it was already showing.
//
// The same rung, not a deeper one. A press is not a third rest state to
// design, and a fill that darkened under the finger would be a value change
// arriving at the one moment the finger is on top of it.

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        // The ink itself as a fill, and the background as the ink. For the one
        // action on a screen that has no competition and needs no colour to
        // say so: the way in. The brand fill says "this is a Ragbag thing" on
        // a card that is already nothing but the mark and the name, and a
        // saturated purple is the loudest object in a light theme.
        //
        // Its hover is the one rung in index.css that travels toward the
        // canvas rather than away from it, because this fill is the canvas
        // inverted; the argument is written there.
        foreground:
          "bg-foreground text-background hover:bg-foreground-hover active:bg-foreground-hover",
        // Its hover fill is a rung off its own rest fill rather than the muted
        // fill the generator reached for. That token is a fill, not a rung: it
        // sits a hair *under* the canvas in the light theme and well *over* it
        // in the dark one, so a single class meant a darkening too small to see
        // in light and, in dark, a lift that landed on --border and swallowed
        // this variant's edge. Of the two rungs in index.css this variant takes
        // --background-hover, the one that stops short of --border, because it
        // has an edge to lose; the edgeless variants below take --hover, which
        // spends that clearance. The open state takes the same fill as the
        // hover: reading as filled is the point of it, and the muted fill it
        // used to take was invisible in light for the same reason.
        outline:
          "border border-border bg-background shadow-xs hover:bg-background-hover hover:text-foreground active:bg-background-hover active:text-foreground aria-expanded:bg-background-hover aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover active:bg-secondary-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-hover hover:text-foreground active:bg-hover active:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
        destructive:
          "bg-destructive-soft text-destructive hover:bg-destructive-soft-hover active:bg-destructive-soft-hover focus-visible:border-destructive focus-visible:ring-destructive",
        link: "text-primary underline-offset-4 hover:underline active:underline",
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

// --- the pending state ---
//
// An action that leaves the app (signing in, signing out) or takes a network
// round trip has to say so on the button that started it, or the only feedback
// a press gets is that nothing happened, and the second press is the reflex.
//
// Two rules make it worth having here rather than at each call site. It must
// not move anything: a spinner that replaces a label re-measures the button,
// and a row of them re-flows. And it must cover whatever the button holds,
// which is text as often as it is an icon and a label.
//
// So the content is hidden in place. `visibility` rather than a colour or an
// opacity, because it is the one of the three that inherits into text nodes:
// `text-transparent` would have to be undone on the spinner (which then needs
// each variant's own ink back), and `opacity` cannot reach a bare string at
// all. The wrapper it hangs on is `display: contents`, so it is not a box:
// every child stays a direct flex item of the button, and the gap, the padding
// and the icon rules see exactly the markup they saw before. It is there only
// while the button is busy, so an idle button is the same tree it always was:
// the one thing a wrapper does change is what counts as a *direct* child, and
// there are call sites that size their icon that way (ui/input-group.tsx).
//
// The spinner is centred with auto margins against `inset-0` rather than a
// translate, so nothing it does can compose with the rotation animating on it,
// and it carries no size class of its own: that leaves it to the button's own
// `[&_svg]` rules, which is how it comes out at 12px in an `xs` and 16px in a
// default without being told.
//
// Not `disabled`: a disabled button drops out of the tab order under the
// cursor and fades to half strength, taking the spinner with it. It is
// `aria-disabled` and inert to clicks instead, so focus stays where it was and
// what you see is a control that is busy rather than one that is gone.
function Button({
  className,
  variant = "default",
  size = "default",
  pending = false,
  children,
  onClick,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Working: hide the label, spin in its place, and swallow further presses. */
    pending?: boolean;
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      onClick={pending ? undefined : onClick}
      className={cn(buttonVariants({ variant, size, className }), pending && "pointer-events-none")}
      {...props}
    >
      {pending ? <span className="contents invisible">{children}</span> : children}
      {pending && <LoaderIcon className="absolute inset-0 m-auto animate-spin" strokeWidth={1.6} />}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
