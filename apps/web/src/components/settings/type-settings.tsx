import { mutators, queries } from "@ragbag/contracts";
import { CATALOG, hasBehaviour, newId } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon, iconNamed } from "@/components/icon";
import { DeleteTypeDialog } from "@/components/settings/delete-type-dialog";
import { TypeEditor } from "@/components/settings/type-editor";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import type { TypeRow } from "@/lib/types";

// Route overlay (/settings/types): the kinds of thing this archive keeps.
//
// A type is a row the user owns, so this screen is ordinary mutations over
// synced rows: no settings API, no reload, and every change reaches the rail,
// the cards and the next ingestion job by the same path any other write does.
//
// The counts are free. Every entity is already on this device, so "142 things,
// seen in 89 messages" is a `filter` rather than a query.

/** What one row of the list says about a kind, counted locally. */
type Counts = { things: number; messages: number };

export function TypeSettings() {
  const zero = useZero();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [types] = useQuery(queries.entityTypes());
  const [entities] = useQuery(queries.entities());

  // Opens closed, one frame, for the reason spelled out in message-detail.tsx:
  // Base UI plays no entrance for a popup that was mounted already open.
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useLayoutEffect(() => {
    opened.current = true;
    setOpen(true);
  }, []);

  /** Which screen: the list, one type's form, or a new type's. */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => {
    // Messages are counted per kind rather than per thing: two links in one
    // message is one message, which is what "seen in 89 messages" means.
    const seen = new Map<string, { things: number; messages: Set<string> }>();
    for (const entity of entities) {
      if (entity.mentions.length === 0) continue;
      const current = seen.get(entity.kind) ?? { things: 0, messages: new Set<string>() };
      current.things += 1;
      for (const mention of entity.mentions) current.messages.add(mention.messageId);
      seen.set(entity.kind, current);
    }
    return new Map<string, Counts>(
      [...seen].map(([kind, tally]) => [
        kind,
        { things: tally.things, messages: tally.messages.size },
      ]),
    );
  }, [entities]);

  // What the catalog still has to offer, which is also how a deleted type comes
  // back: nothing else ever resurrects one (plan §10.4).
  const installable = useMemo(
    () => CATALOG.filter((def) => !types.some((type) => type.kind === def.kind)),
    [types],
  );

  const editingType = editing?.id ? (types.find((type) => type.id === editing.id) ?? null) : null;
  const deletingType = deleting ? types.find((type) => type.id === deleting) : undefined;

  const install = async (kind: string) => {
    try {
      await zero.mutate(mutators.entityType.install({ id: newId(), kind })).client;
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that type");
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && setOpen(false)}
      onOpenChangeComplete={(nowOpen) => {
        // `view: undefined` rather than `{}`: naming the param is what drops the
        // segment, the same reason main.tsx's redirect names it.
        if (!nowOpen && opened.current) {
          void navigate({ to: "/{-$view}", params: { view: undefined }, resetScroll: false });
        }
      }}
      showSwipeHandle={isMobile}
      swipeDirection={isMobile ? "down" : "right"}
    >
      <DrawerContent
        className={
          "data-[swipe-axis=x]:md:[--drawer-content-width:min(42rem,calc(100vw-1rem))] " +
          "md:[--drawer-inset:0.5rem] md:[--drawer-bleed-background:transparent] " +
          "md:rounded-xl md:border"
        }
      >
        <DrawerTitle className="sr-only">Kinds of thing</DrawerTitle>
        <DrawerDescription className="sr-only">
          The kinds of thing ragbag pulls out of what you dump, and what each one is made of.
        </DrawerDescription>

        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <span className="text-sm font-medium">Kinds of thing</span>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Close (Esc)"
            className="ml-auto text-muted-foreground"
            onClick={() => setOpen(false)}
          >
            <Icon name="x" className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 scroll-fade-b overflow-x-hidden overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {editing ? (
            <TypeEditor type={editingType} onDone={() => setEditing(null)} />
          ) : (
            <div className="space-y-5">
              <p className="text-[13px] text-muted-foreground">
                Every dump is read for these. Each one costs a little of every message you send, so
                keep the ones you look for and drop the ones you do not.
              </p>

              <ul className="flex flex-col gap-1.5">
                {types.map((type) => (
                  <TypeRowItem
                    key={type.id}
                    type={type}
                    counts={counts.get(type.kind)}
                    onEdit={() => setEditing({ id: type.id })}
                    onDelete={() => setDeleting(type.id)}
                  />
                ))}
                {types.length === 0 && (
                  <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No kinds of thing. Nothing will be pulled out of what you dump until you add
                    one.
                  </li>
                )}
              </ul>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={installable.length === 0}
                  onClick={() => setAdding((was) => !was)}
                >
                  <Icon name="plus" className="size-3.5" />
                  {installable.length === 0
                    ? "You have all of ours"
                    : `Add one of ours (${installable.length})`}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing({ id: null })}>
                  <Icon name="sparkles" className="size-3.5" /> Make your own
                </Button>
              </div>

              {adding && (
                <ul className="flex flex-col gap-1.5">
                  {installable.map((def) => (
                    <li key={def.kind}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg border bg-panel p-3 text-left transition hover:bg-accent"
                        onClick={() => void install(def.kind)}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon name={iconNamed(def.icon)} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{def.plural}</span>
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {def.promptHint}
                          </span>
                        </span>
                        <Icon name="plus" className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </DrawerContent>

      {deletingType && (
        <DeleteTypeDialog
          type={deletingType}
          count={counts.get(deletingType.kind)?.things ?? 0}
          onClose={() => setDeleting(null)}
        />
      )}
    </Drawer>
  );
}

function Tag({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
      title={title}
    >
      {children}
    </span>
  );
}

function TypeRowItem({
  type,
  counts,
  onEdit,
  onDelete,
}: {
  type: TypeRow;
  counts: Counts | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const zero = useZero();
  const found = counts?.things ?? 0;

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-panel p-3">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ${
          type.enabled ? "" : "opacity-50"
        }`}
      >
        <Icon name={iconNamed(type.icon)} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{type.plural}</span>
          {/* Two different facts, one slot: whether code understands this kind
              itself (which is why its fields are read-only), and otherwise
              whether it is one of ours or one you made. */}
          {hasBehaviour(type.kind) ? (
            <Tag title="ragbag finds these itself, and knows when two of them are the same one">
              built in
            </Tag>
          ) : (
            type.origin === "user" && <Tag title="A type you made">yours</Tag>
          )}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {found === 0
            ? "nothing found yet"
            : `${found} thing${found === 1 ? "" : "s"}, seen in ${counts!.messages} message${
                counts!.messages === 1 ? "" : "s"
              }`}
          {type.enabled ? "" : " · not being extracted"}
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title={type.enabled ? "Stop extracting these" : "Extract these again"}
        onClick={() =>
          void zero.mutate(mutators.entityType.setEnabled({ id: type.id, enabled: !type.enabled }))
        }
      >
        <Icon name={type.enabled ? "check" : "dismiss"} className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title="Edit"
        onClick={onEdit}
      >
        <Icon name="edit" className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title="Remove"
        onClick={onDelete}
      >
        <Icon name="trash" className="size-4" />
      </Button>
    </li>
  );
}
