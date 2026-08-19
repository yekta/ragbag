import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The app's headings, defined once.
//
// They live here because one 11px uppercase caption had been copied into five
// files and was doing the job of every heading there is: a drawer's own name,
// the sections inside it and the small label over a group of rows were all the
// same size, and that size was smaller than the rows underneath them. In
// settings, "Addresses" (a row) was set larger than "Look for" (its section)
// and larger again than "Settings" (the surface), so the hierarchy ran
// backwards and nothing on the screen looked like a title.
//
// The scale, and the whole of it:
//
//   20 / 600  the name of one item        message-detail's own h1
//   18 / 600  the name of a surface       the settings drawer's DrawerTitle
//   16 / 600  a section inside a surface  SectionHeading
//   14 / 500  a row's title
//   13 / 400  a note under a heading, or a row's second line
//   12 / 600  the label over a group      GroupLabel
//   11        readings: chips, counts, timestamps, byte sizes
//
// Two of those steps have one call site each, so they are spelled where they
// are used rather than wrapped: a component with a single user is a name to go
// and look up, not a rule anyone can follow.
//
// Sentence case throughout. Uppercase is a way of making small text look
// deliberate, and it is paid for in word shapes, which is what a reader reads
// by; it is also indiscriminate, which is how an attachment's filename and a
// carrier spelled FedEx both ended up shouting. Size, weight and colour carry
// the hierarchy instead, and they cost the reader nothing.

/**
 * A section inside a surface: "Look for", "Storage", "Tags", "Summary".
 *
 * The optional action rides the heading's own line, hard right, because a
 * section's one button ("Add") belongs to the section rather than to the list
 * under it.
 */
export function SectionHeading({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-1.5 flex items-center gap-2", className)}>
      {/* min-w-0 because one of these is an attachment's filename with a
          truncating span inside it, and a flex item defaults to min-content
          width, which is the one thing truncation cannot survive. */}
      <h2 className="min-w-0 text-base font-semibold">{children}</h2>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/**
 * The label over a group of rows: "Things", "Messages", "Things found in
 * the message".
 *
 * Not a section heading. It names a bucket rather than a part of a document,
 * and it appears inside surfaces (a timeline card, a search palette) where
 * 16px would outweigh the very rows it is introducing.
 *
 * No margin of its own: every call site spaces it differently, and the search
 * palette's pads on three sides.
 *
 * The sidebar's group labels are the one place this is not used. They come
 * from a vendored primitive (ui/sidebar.tsx) that already lands on 12px muted,
 * so those two call sites add the weight and nothing else.
 *
 * One call site runs 500 rather than 600: a message card's strip label carries
 * a sparkles mark, and a label with an icon in it already reads as a label
 * without the weight doing it a second time.
 */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-semibold text-muted-foreground", className)}>{children}</p>;
}
