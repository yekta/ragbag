"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

// Two standing local edits, the same ones every file in this directory carries
// (re-apply on a re-pull); ui/button.tsx has the long version.
//
// Re-tokenised: the generated component styles the off track as `bg-input/30`
// over a `dark:bg-input/80` twin, the ring as `ring-ring/50`, and the knob as
// `bg-background` with two `dark:` overrides. All of them are opaque tokens
// here, so one class name is correct in both themes. The knob is the only
// place that needed a new one: see `--switch-thumb` in index.css.
//
// The 1px of padding is what centres the knob. A 16px knob in a 36x20 track
// with a 1px transparent border is already 2px off the top and the bottom, but
// it rests 1px from either end, and the generated checked transform carried
// that 1px through to the far side. One more pixel inside the border makes the
// content box 32x16: the knob fills it exactly across, rests 2px in, and
// travels its own width to land 2px from the far end. Four equal gaps, in both
// states.
//
// The `before:` strip is the hit area, not the switch. A 36x20 control is well
// under the 44px every touch platform asks for, so the pseudo grows it to 44
// square around its own centre without moving anything on screen. It bleeds
// 4px either side, which stays inside the 12px gap to whatever sits next to it
// in a row.

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-px shadow-xs transition-[background-color,box-shadow] outline-none before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring data-checked:bg-primary data-unchecked:bg-input data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full ring-0 transition-transform data-checked:translate-x-full data-checked:bg-primary-foreground data-unchecked:translate-x-0 data-unchecked:bg-switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
