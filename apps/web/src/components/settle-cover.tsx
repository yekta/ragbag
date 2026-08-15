import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { BUDGET, useHeld } from "@/lib/settle";

// The canvas the app settles behind (lib/settle.ts).
//
// A cover over a *mounted* shell, not a screen shown instead of one: the
// timeline lays out, measures its rows and anchors itself to the newest item
// while nobody is looking, so the first frame the user sees is the finished
// one. It earns its keep at scale — on a 400-row archive the newest card spends
// ~500ms sixty thousand pixels from where it belongs, and none of that is seen.
//
// Deliberately not `opacity` on the shell itself: an ancestor with
// `opacity < 1` becomes the containing block for `position: fixed` descendants,
// which would move the composer and the sidebar for the length of the fade.
//
// It carries no loader of its own except on the boot screen, where there is no
// shell behind it to carry one: one loader position per screen, and no handoff
// between two of them.

/** Keep in step with `duration-150` below, plus a frame of slack. */
const FADE_MS = 200;

export function SettleCover({
  show,
  /** Boot screen only: the wait is an unbounded network round trip. */
  loader = false,
  /**
   * Arrive by fading rather than by cutting.
   *
   * Only ever set once something real is already on screen — the handover from
   * the sync loader to the finished archive, which is a transition between two
   * correct states and should read as one. On the boot path this must stay off:
   * fading in from transparent there would show a frame of the half-built shell
   * the cover exists to hide.
   */
  fadeIn = false,
}: {
  show: boolean;
  loader?: boolean;
  fadeIn?: boolean;
}) {
  // Stay mounted through the fade-out, then get out of the way entirely.
  const [mounted, setMounted] = useState(show);
  // Opacity is applied one frame after mounting when fading in, because a
  // transition needs a previous value to move away from.
  const [opaque, setOpaque] = useState(show && !fadeIn);

  useEffect(() => {
    if (show) {
      setMounted(true);
      if (fadeIn) {
        const frame = requestAnimationFrame(() => setOpaque(true));
        return () => cancelAnimationFrame(frame);
      }
      setOpaque(true);
      return;
    }
    setOpaque(false);
    // A timer rather than `transitionend`: reduced motion collapses the
    // transition and may not fire one at all.
    const timer = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [show, fadeIn]);

  const slow = useHeld(show && loader, BUDGET.bootLoader);

  if (!mounted) return null;

  return (
    <div
      // The acceptance harness (scripts/settle-proof.mjs) needs to know when
      // the app is covered; so does anyone debugging a stuck boot.
      data-settle-cover={show ? "up" : "lifting"}
      aria-hidden
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background transition-opacity duration-150 ease-exit ${
        opaque ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {slow && (
        <Icon
          name="spinner"
          className="size-6 animate-spin text-muted-foreground [animation-duration:2s]"
        />
      )}
    </div>
  );
}
