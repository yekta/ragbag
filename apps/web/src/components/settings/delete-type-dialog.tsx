import { mutators, queries } from "@ragbag/contracts";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { runMutation } from "@/lib/mutate";
import type { TypeRow } from "@/lib/types";

// Deleting a type is two different intentions, and only one of them loses
// anything (plan §9.2). Turning it off is a third, and it is the switch on the
// settings list rather than a choice in here.
//
//   delete it            what it found stays, under a plain card, and stops
//                        being something you can browse as a group
//   delete it and them   the things go too, which is why it asks you to type

export function DeleteTypeDialog({
  type,
  onClose,
  onDeleted,
}: {
  type: TypeRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const zero = useZero();
  const [entities] = useQuery(queries.entities());
  const [confirmation, setConfirmation] = useState("");
  // Which of the two is running, not merely that one is: they are two buttons,
  // and a spinner belongs on the one that was pressed.
  const [busy, setBusy] = useState<false | "keep" | "all">(false);

  const count = useMemo(
    () => entities.filter((e) => e.kind === type.kind && e.mentions.length > 0).length,
    [entities, type.kind],
  );
  const typedIt = confirmation.trim().toLowerCase() === type.sidebarTitle.trim().toLowerCase();

  const run = async (deleteEntities: boolean) => {
    setBusy(deleteEntities ? "all" : "keep");
    try {
      await runMutation(zero.mutate(mutators.entityType.remove({ id: type.id, deleteEntities })));
      toast.success(`${type.sidebarTitle} deleted`);
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete this");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {type.sidebarTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 0
              ? "Nothing of this kind has been found yet."
              : count === 1
                ? "You have one. Keep it, or delete it too."
                : `You have ${count}. Keep them, or delete them too.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 text-left">
          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">
              {count === 0
                ? "Delete it"
                : count === 1
                  ? "Keep the one you have"
                  : `Keep the ${count} you have`}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {count > 0
                ? "It stays in your archive and in search, just not as a group."
                : "It goes back to the list of things you are not looking for."}
            </p>
            <Button
              className="mt-2"
              variant={count > 0 ? "outline" : "default"}
              size="sm"
              pending={busy === "keep"}
              disabled={busy === "all"}
              onClick={() => void run(false)}
            >
              Delete
            </Button>
          </div>

          {count > 0 && (
            <div className="rounded-lg border border-destructive/40 p-3">
              <p className="text-sm font-medium">
                {count === 1 ? "Delete it too" : "Delete them too"}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {count === 1 ? "Gone for good." : `All ${count} gone for good.`} Type{" "}
                {type.sidebarTitle} to confirm.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-44"
                  value={confirmation}
                  placeholder={type.sidebarTitle}
                  aria-label={`Type ${type.sidebarTitle} to confirm`}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  pending={busy === "all"}
                  disabled={busy === "keep" || !typedIt}
                  onClick={() => void run(true)}
                >
                  <Icon name="trash" className="size-3.5" /> Delete everything
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy !== false} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
