import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

// Local edit (re-apply on a re-pull): stock shadcn ends this class list with
// `md:text-sm`, and no field in the app may be under 16px. Safari on iOS zooms
// the page in when you focus a field whose text is smaller than that, and it
// does not zoom back out when you leave. `md` is a viewport width rather than a
// device, so a phone held in landscape clears it and gets the zoom anyway; the
// only version of this rule that holds everywhere is 16px at every width.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
