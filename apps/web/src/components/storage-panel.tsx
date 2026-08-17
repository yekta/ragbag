import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format";
import { clearMediaCache, storageUsage, type StorageUsage } from "@/lib/media";

// What this device is actually holding, in real numbers (plan §6.5).
//
// The caps in the media worker are ceilings on entry counts, derived from the
// typical size of each variant; `navigator.storage.estimate()` is the only
// thing that knows what they came to, so it is what gets shown rather than the
// arithmetic. Clearing drops cached pictures only: the archive itself (every
// message, summary, entity, tag, filename and transcript) is what search runs
// against and is never touched here.

export function StoragePanel() {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void storageUsage().then((u) => {
      if (live) setUsage(u);
    });
    return () => {
      live = false;
    };
  }, [open, clearing]);

  const clear = async () => {
    setClearing(true);
    await clearMediaCache();
    setClearing(false);
    toast.success("Cached pictures cleared", {
      description: "They come back as you browse. Nothing in your archive was touched.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="mb-1.5 justify-start px-0 text-xs font-normal text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Icon name="inbox" className="size-3" />
        Storage
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Storage on this device</DialogTitle>
          <DialogDescription>
            Your archive is kept in full and never evicted: every message, summary, entity, tag and
            transcript, which is what search runs against. Pictures are cached on top of it and come
            back on their own.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Used</dt>
          <dd className="tabular-nums">
            {usage ? formatBytes(usage.usage) : "…"}
            {usage && usage.quota > 0 && (
              <span className="text-muted-foreground"> of {formatBytes(usage.quota)}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Durable</dt>
          <dd>
            {usage?.persisted
              ? "yes, the browser has agreed not to evict it"
              : "not granted; the browser may evict under storage pressure"}
          </dd>
        </dl>

        {/* A platform limit, not a bug: documenting it is the fix. */}
        <p className="text-xs text-muted-foreground">
          On iOS and macOS Safari, a site that has not been added to the home screen loses all its
          storage after seven days without a visit. Adding ragbag to the home screen exempts it.
        </p>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Close</DialogClose>
          <Button variant="outline" size="sm" disabled={clearing} onClick={() => void clear()}>
            <Icon name="trash" className="size-3.5" />
            Clear cached pictures
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
