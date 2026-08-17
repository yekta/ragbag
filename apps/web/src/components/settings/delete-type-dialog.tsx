import { mutators } from "@ragbag/contracts";
import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
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
import type { TypeRow } from "@/lib/types";

// Getting rid of a type is three different intentions wearing one word, so the
// dialog offers all three in the order a person usually wants them (plan §9.2):
//
//   1. stop extracting        the type leaves the prompt and the rail, nothing
//                             it found is touched. The usual answer.
//   2. delete it, keep them   the things stay, drawn by the generic card under
//                             a humanized version of their own kind, and stop
//                             being browsable as a group
//   3. delete it and them     needs the count said out loud and typed back
//
// Only the third is irreversible, and it is the only one that asks for typing.

export function DeleteTypeDialog({
  type,
  count,
  onClose,
}: {
  type: TypeRow;
  /** How many things of this kind the archive holds, said out loud in (3). */
  count: number;
  onClose: () => void;
}) {
  const zero = useZero();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const typedIt = confirmation.trim().toLowerCase() === type.plural.trim().toLowerCase();

  const run = async (what: "disable" | "keep" | "purge") => {
    setBusy(true);
    try {
      if (what === "disable") {
        await zero.mutate(mutators.entityType.setEnabled({ id: type.id, enabled: false })).client;
        toast.success(`${type.plural} will not be extracted from new dumps`);
      } else {
        await zero.mutate(
          mutators.entityType.remove({ id: type.id, deleteEntities: what === "purge" }),
        ).client;
        toast.success(
          what === "purge"
            ? `${type.plural} and ${count} thing${count === 1 ? "" : "s"} deleted`
            : `${type.plural} deleted. What it found is still in your archive`,
        );
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not remove ${type.plural}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {type.plural}?</AlertDialogTitle>
          <AlertDialogDescription>
            {count > 0
              ? `Your archive holds ${count} of them. Pick what happens to them.`
              : "Nothing of this kind has been found yet."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 text-left">
          <Choice
            title="Stop extracting them"
            body={`New dumps are not read for ${type.plural.toLowerCase()}. Everything already found stays exactly as it is, and you can turn this back on whenever.`}
            action="Stop extracting"
            variant="default"
            disabled={busy || !type.enabled}
            onPick={() => void run("disable")}
          />
          <Choice
            title={count > 0 ? "Delete the type, keep the things" : "Delete the type"}
            body={
              count > 0
                ? `The ${count} you already have stay in your archive and in search, under a plain card. They stop being a group you can browse, and the /${type.slug} view goes away.`
                : `Nothing of this kind has been found, so nothing is lost. The /${type.slug} view goes away.`
            }
            action="Delete the type"
            variant={count > 0 ? "outline" : "default"}
            disabled={busy}
            onPick={() => void run("keep")}
          />
          {/* Only worth offering when there is something to lose: at zero it is
              the option above, dressed as a warning. */}
          {count > 0 && (
            <div className="rounded-lg border border-destructive/40 p-3">
              <p className="text-sm font-medium">Delete the type and its things</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {count} thing{count === 1 ? "" : "s"} and every mention of them, gone for good. This
                cannot be undone.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-48"
                  value={confirmation}
                  placeholder={`Type ${type.plural}`}
                  aria-label={`Type ${type.plural} to confirm`}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy || !typedIt}
                  onClick={() => void run("purge")}
                >
                  <Icon name="trash" className="size-3.5" /> Delete everything
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Choice({
  title,
  body,
  action,
  variant,
  disabled,
  onPick,
}: {
  title: string;
  body: string;
  action: string;
  variant: "default" | "outline";
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{body}</p>
      <Button className="mt-2" variant={variant} size="sm" disabled={disabled} onClick={onPick}>
        {action}
      </Button>
    </div>
  );
}
