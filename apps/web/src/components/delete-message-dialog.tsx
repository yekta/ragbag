import type { ReactElement } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Deleting syncs, so the confirmation says so. Shared by the timeline card and
// the message detail header: one wording, one dialog.
//
// Two ways to open it, because the card's delete now lives in a menu and a menu
// item cannot be a dialog trigger: the menu unmounts its items the moment one
// is clicked, and takes the trigger with it. So a caller either hands over a
// trigger element and lets the dialog own its state (the panel header, whose
// button is always on screen), or holds the state itself and passes it in (the
// card, components/message-card.tsx). Passing neither `open` nor a trigger
// would be a dialog nothing can open, which is a call site's mistake rather
// than a state worth typing around.

export function DeleteMessageDialog({
  children,
  open,
  onOpenChange,
  onConfirm,
}: {
  /**
   * The trigger. Base UI renders it in place of its own button via `render`,
   * merging trigger props into it, so this must be a single element that
   * forwards props, not arbitrary nodes.
   */
  children?: ReactElement;
  /** Controlled instead: for callers whose trigger does not survive the click. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger render={children} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this message?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears from all your devices, with everything attached to it. This can&rsquo;t be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
