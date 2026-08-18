import type { MutatorResult } from "@rocicorp/zero";
import { toast } from "sonner";

// Running a mutation and finding out whether it worked.
//
// Zero does NOT reject when a mutator throws: `.client` and `.server` both
// *resolve*, with `{type: "error"}` carrying the message, and the failure is
// otherwise only a line in the console. So `await zero.mutate(...).client`
// inside a try/catch looks like error handling and is not: the catch never
// runs, the optimistic write is rolled back, and a form that closes itself on
// success closes on failure too, silently, taking what was typed with it.
//
// This is that await, with the error turned back into a throw so an ordinary
// try/catch means what it reads as.

/** Zero's prefix on a zod failure; the message after it is the one we wrote. */
const VALIDATION_PREFIX = /^Validation failed for mutator [\w.]+:\s*/;

export async function runMutation(result: MutatorResult): Promise<void> {
  const outcome = await result.client;
  if (outcome.type === "error") {
    throw new Error(clean(outcome.error.message));
  }
  // The authoritative run can still refuse what the optimistic one accepted: a
  // server on an older build, a name someone else took first, a row that moved
  // under it. The write is rolled back when that happens, and by then the
  // caller has closed its form and moved on, so this failure has nowhere to be
  // thrown. A toast is the only place left to say it.
  void result.server.then((settled) => {
    if (settled.type === "error") toast.error(clean(settled.error.message));
  });
}

function clean(message: string): string {
  return message.replace(VALIDATION_PREFIX, "");
}
