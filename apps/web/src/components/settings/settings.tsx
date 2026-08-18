import { mutators, queries } from "@ragbag/contracts";
import { newId, partitionTypes, type TypeChoice } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon, iconNamed } from "@/components/icon";
import { TypeEditor } from "@/components/settings/type-editor";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { signOut } from "@/lib/auth-client";
import { formatBytes } from "@/lib/format";
import { loadIdentity } from "@/lib/identity";
import { clearMediaCache, storageUsage, type StorageUsage } from "@/lib/media";
import { useViewStore } from "@/lib/store";
import type { Theme } from "@/lib/theme";

// Route overlay (/settings): what ragbag looks for, what this device is
// holding, how it looks, and who is signed in.
//
// The types half is ordinary mutations over synced rows, so a change reaches
// the sidebar, the cards and the next ingestion job by the same path any other
// write does. The counts are free: every entity is already on this device.

export function Settings() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Opens closed, one frame, for the reason spelled out in message-detail.tsx:
  // Base UI plays no entrance for a popup that was mounted already open.
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useLayoutEffect(() => {
    opened.current = true;
    setOpen(true);
  }, []);

  /** Null on the list; a type's id, or null-for-new, in the editor. */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

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
        <DrawerTitle className="sr-only">Settings</DrawerTitle>
        <DrawerDescription className="sr-only">
          What ragbag looks for, storage, appearance and your account.
        </DrawerDescription>

        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <span className="text-sm font-medium">{editing ? "Edit" : "Settings"}</span>
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
            <TypeEditor typeId={editing.id} onDone={() => setEditing(null)} />
          ) : (
            <div className="space-y-7">
              <TypesSection onEdit={(id) => setEditing({ id })} />
              <StorageSection />
              <AppearanceSection />
              <AccountSection />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

// --- what to look for ---

function TypesSection({ onEdit }: { onEdit: (id: string | null) => void }) {
  const zero = useZero();
  const [rows] = useQuery(queries.entityTypes());
  const [entities] = useQuery(queries.entities());

  const counts = useMemo(() => {
    // Messages are counted per kind rather than per thing: two links in one
    // message is one message.
    const seen = new Map<string, { things: number; messages: Set<string> }>();
    for (const entity of entities) {
      if (entity.mentions.length === 0) continue;
      const tally = seen.get(entity.kind) ?? { things: 0, messages: new Set<string>() };
      tally.things += 1;
      for (const mention of entity.mentions) tally.messages.add(mention.messageId);
      seen.set(entity.kind, tally);
    }
    return seen;
  }, [entities]);

  const { on, off } = useMemo(() => partitionTypes(rows), [rows]);

  const setOn = async (choice: TypeChoice, wanted: boolean) => {
    try {
      await zero.mutate(
        choice.id
          ? mutators.entityType.setEnabled({ id: choice.id, enabled: wanted })
          : // Nothing to update: this one has never been turned on here.
            mutators.entityType.install({ id: newId(), kind: choice.kind }),
      ).client;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work");
    }
  };

  return (
    <section>
      <SectionTitle>Looking for</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {on.map((choice) => (
          <ChoiceRow
            key={choice.kind}
            choice={choice}
            count={counts.get(choice.kind)}
            action="off"
            onToggle={() => void setOn(choice, false)}
            onEdit={() => onEdit(choice.id!)}
          />
        ))}
        {on.length === 0 && (
          <li className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
            Nothing yet. Turn something on below.
          </li>
        )}
      </ul>

      <div className="mt-5">
        <SectionTitle>Not looking for</SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {off.map((choice) => (
            <ChoiceRow
              key={choice.kind}
              choice={choice}
              count={counts.get(choice.kind)}
              action="on"
              onToggle={() => void setOn(choice, true)}
              onEdit={choice.id ? () => onEdit(choice.id!) : undefined}
            />
          ))}
          {off.length === 0 && (
            <li className="text-[13px] text-muted-foreground">
              You are looking for everything ragbag knows.
            </li>
          )}
        </ul>
      </div>

      <Button variant="outline" size="sm" className="mt-3" onClick={() => onEdit(null)}>
        <Icon name="plus" className="size-3.5" /> New type
      </Button>
    </section>
  );
}

function ChoiceRow({
  choice,
  count,
  action,
  onToggle,
  onEdit,
}: {
  choice: TypeChoice;
  count: { things: number; messages: Set<string> } | undefined;
  action: "on" | "off";
  onToggle: () => void;
  /** Absent for one of ours with no row yet: there is nothing to edit. */
  onEdit?: () => void;
}) {
  const found = count?.things ?? 0;
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-panel p-2.5" title={choice.hint}>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ${
          action === "on" ? "opacity-60" : ""
        }`}
      >
        <Icon name={iconNamed(choice.icon)} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{choice.sidebarTitle}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {found > 0
            ? `${found} in ${count!.messages.size} message${count!.messages.size === 1 ? "" : "s"}`
            : "none yet"}
        </span>
      </span>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title="Edit"
          onClick={onEdit}
        >
          <Icon name="edit" className="size-4" />
        </Button>
      )}
      <Button
        variant={action === "on" ? "default" : "outline"}
        size="sm"
        className="shrink-0"
        onClick={onToggle}
      >
        {action === "on" ? "On" : "Off"}
      </Button>
    </li>
  );
}

// --- storage ---

function StorageSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let live = true;
    void storageUsage().then((next) => {
      if (live) setUsage(next);
    });
    return () => {
      live = false;
    };
  }, [clearing]);

  const clear = async () => {
    setClearing(true);
    await clearMediaCache();
    setClearing(false);
    toast.success("Cached pictures cleared");
  };

  return (
    <section>
      <SectionTitle>Storage</SectionTitle>
      <div className="rounded-lg border bg-panel p-3">
        <p className="text-sm">
          {usage ? formatBytes(usage.usage) : "…"} used
          {usage && usage.quota > 0 && (
            <span className="text-muted-foreground"> of {formatBytes(usage.quota)}</span>
          )}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {usage && !usage.persisted
            ? "Your browser may clear this if it runs out of space."
            : "Your whole ragbag is on this device, so search works offline."}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={clearing} onClick={() => void clear()}>
            <Icon name="trash" className="size-3.5" /> Clear cached pictures
          </Button>
          <span className="text-[13px] text-muted-foreground">They come back as you browse.</span>
        </div>
      </div>
      {/* A platform limit, not a bug: saying it is the only fix there is. */}
      <p className="mt-2 text-[13px] text-muted-foreground">
        On iPhone and iPad, add ragbag to your home screen so Safari keeps it.
      </p>
    </section>
  );
}

// --- appearance ---

const THEMES: { value: Theme; label: string; icon: "sun" | "moon" | "monitor" }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

function AppearanceSection() {
  const { theme, setTheme } = useViewStore();
  return (
    <section>
      <SectionTitle>Appearance</SectionTitle>
      <div className="flex gap-1.5">
        {THEMES.map((option) => (
          <Button
            key={option.value}
            variant={theme === option.value ? "secondary" : "outline"}
            size="sm"
            className={theme === option.value ? "ring-1 ring-primary" : ""}
            onClick={() => setTheme(option.value)}
          >
            <Icon name={option.icon} className="size-3.5" />
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

// --- account ---

function AccountSection() {
  const identity = loadIdentity();
  return (
    <section>
      <SectionTitle>Account</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm">{identity?.email ?? "Signed in"}</p>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          <Icon name="logout" className="size-3.5" /> Sign out
        </Button>
      </div>
    </section>
  );
}
