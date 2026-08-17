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

// Deleting syncs, so the confirmation says so. Shared by the timeline card's
// hover action and the message detail header: one wording, one dialog.

export function DeleteMessageDialog({
  children,
  onConfirm,
}: {
  /**
   * The trigger. Base UI renders it in place of its own button via `render`,
   * merging trigger props into it, so this must be a single element that
   * forwards props, not arbitrary nodes.
   */
  children: ReactElement;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={children} />
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
