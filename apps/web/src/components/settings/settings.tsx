import { mutators, queries } from "@ragbag/contracts";
import { newId, typeChoices, type TypeChoice } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon, iconNamed } from "@/components/icon";
import { TypeEditor } from "@/components/settings/type-editor";
import { SectionHeading } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { signOut } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";
import { formatBytes } from "@/lib/format";
import { loadIdentity } from "@/lib/identity";
import { clearMediaCache, storageUsage, type StorageUsage } from "@/lib/media";
import { useViewStore } from "@/lib/store";
import type { Theme } from "@/lib/theme";

// Route overlay (/settings): what Ragbag looks for, what this device is
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
        <DrawerDescription className="sr-only">
          Things to look for, storage, appearance and your account.
        </DrawerDescription>

        {/* The drawer's name, as the heading it is: the largest thing on the
            surface, which is what lets the sections under it read as sections
            and their rows as rows. It is the DrawerTitle itself rather than a
            span next to a screen-reader-only copy of the same word, so there
            is exactly one of it in the accessibility tree. It says "Settings"
            in the editor too, because that is still where you are; the editor
            carries its own heading. */}
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-5 py-3">
          <DrawerTitle className="text-lg font-semibold tracking-tight">Settings</DrawerTitle>
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

        {/* Bottom padding is the safe area plus 2rem, added rather than maxed:
            the extra is room to breathe under the last section, and the phone's
            home indicator should not be allowed to eat it. */}
        <div className="min-h-0 flex-1 scroll-fade-b overflow-x-hidden overflow-y-auto px-5 py-5 pb-[calc(2rem+max(1.25rem,env(safe-area-inset-bottom)))]">
          {editing ? (
            <TypeEditor typeId={editing.id} onDone={() => setEditing(null)} />
          ) : (
            <div className="space-y-8">
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

/**
 * A section of this drawer: its name, the one line under it, and the thing
 * itself.
 *
 * The spacing lives here rather than at four call sites because it is a rhythm
 * and not a decoration. A heading sat 6px off its own content, which is closer
 * than the words of the heading are to each other, so "Storage" read as part of
 * the box under it instead of as its name. The three steps are: heading to its
 * note, 4px, because they are one thought; the pair to what they introduce,
 * 12px; and section to section, 32px, from the stack above.
 */
function Section({
  title,
  note,
  children,
}: {
  title: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeading className={note ? "mb-1" : "mb-3"}>{title}</SectionHeading>
      {note && <p className="mb-3 text-[13px] text-muted-foreground">{note}</p>}
      {children}
    </section>
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

  const choices = useMemo(() => typeChoices(rows), [rows]);

  const setOn = async (choice: TypeChoice, wanted: boolean) => {
    try {
      await runMutation(
        zero.mutate(
          choice.id
            ? mutators.entityType.setEnabled({ id: choice.id, enabled: wanted })
            : // Nothing to update: this one has never been turned on here.
              mutators.entityType.install({ id: newId(), kind: choice.kind }),
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work");
    }
  };

  // One list, not two. A second heading ("Don't look for") turned a switch into
  // a place, so turning something off made its row leave the screen and reappear
  // further down, and the reader had to find it again to change their mind. The
  // switch says the same thing without moving anything.
  return (
    <Section
      title="Things to look for"
      note="These get pulled out of your messages. Turn any off, or add your own."
    >
      {/* The icon is pulled 2px left of where the flexbox puts it: a glyph that
          is mostly air on its outer edge sits optically right of a cap-height
          letter given the same gap, and the eye reads the difference as the
          icon crowding the word. */}
      <Button variant="outline" className="px-3.5" onClick={() => onEdit(null)}>
        <Icon name="plus" className="-ml-0.5 size-4" /> Add
      </Button>
      <ul className="mt-3 flex flex-col gap-1.5">
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.kind}
            choice={choice}
            count={counts.get(choice.kind)}
            onToggle={(wanted) => void setOn(choice, wanted)}
            onEdit={choice.id ? () => onEdit(choice.id!) : undefined}
          />
        ))}
      </ul>
    </Section>
  );
}

function ChoiceRow({
  choice,
  count,
  onToggle,
  onEdit,
}: {
  choice: TypeChoice;
  count: { things: number; messages: Set<string> } | undefined;
  onToggle: (wanted: boolean) => void;
  /** Absent for one of ours with no row yet: there is nothing to edit. */
  onEdit?: () => void;
}) {
  const found = count?.things ?? 0;
  return (
    <li className="flex items-center gap-3 rounded-lg border p-2.5" title={choice.hint}>
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ${
          choice.enabled ? "" : "opacity-60"
        }`}
      >
        <Icon name={iconNamed(choice.icon)} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{choice.sidebarTitle}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {found > 0
            ? `${found} in ${count!.messages.size} message${count!.messages.size === 1 ? "" : "s"}`
            : "None yet"}
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
      <Switch
        checked={choice.enabled}
        onCheckedChange={onToggle}
        aria-label={`Look for ${choice.sidebarTitle}`}
        className="ml-1 shrink-0"
      />
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
    <Section title="Storage">
      <div className="rounded-lg border p-3.5">
        <p className="text-sm">
          {usage ? formatBytes(usage.usage) : "…"} used
          {usage && usage.quota > 0 && (
            <span className="text-muted-foreground"> of {formatBytes(usage.quota)}</span>
          )}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {usage && !usage.persisted
            ? "Your browser may clear this if it runs out of space."
            : "Your whole archive is on this device, so search works offline."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={clearing} onClick={() => void clear()}>
            <Icon name="trash" className="size-3.5" /> Clear cached pictures
          </Button>
          <span className="text-[13px] text-muted-foreground">They come back as you browse.</span>
        </div>
      </div>
      {/* A platform limit, not a bug: saying it is the only fix there is. */}
      <p className="mt-2.5 text-[13px] text-muted-foreground">
        On iPhone and iPad, add Ragbag to your home screen so Safari keeps it.
      </p>
    </Section>
  );
}

// --- appearance ---

const THEMES: { value: Theme; label: string; icon: "sun" | "moon" | "monitor" }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

/**
 * The selected button keeps the outline variant rather than switching to
 * secondary. These are inline-flex at auto width, so a border adds to the used
 * width whatever box-sizing says, and a variant that drops the border made the
 * selected button 2px narrower than its neighbours: every switch slid the row.
 * The border stays, turns transparent, and bg-background paints under it (the
 * default clip is the border box), so the fill still runs to the ring and the
 * geometry cannot move. Same trick as ui/badge.tsx and ui/switch.tsx.
 *
 * The ring is then the only thing that marks the selection, which is nothing at
 * all to a screen reader, hence aria-pressed. Nothing in buttonVariants styles
 * it, so it stays silent to the eye.
 */
function AppearanceSection() {
  const { theme, setTheme } = useViewStore();
  return (
    <Section title="Appearance">
      <div className="flex gap-1.5">
        {THEMES.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            size="sm"
            aria-pressed={theme === option.value}
            className={theme === option.value ? "border-transparent ring-1 ring-primary" : ""}
            onClick={() => setTheme(option.value)}
          >
            <Icon name={option.icon} className="size-3.5" />
            {option.label}
          </Button>
        ))}
      </div>
    </Section>
  );
}

// --- account ---

function AccountSection() {
  const identity = loadIdentity();
  return (
    <Section title="Account">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm">{identity?.email ?? "Signed in"}</p>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          <Icon name="logout" className="size-3.5" /> Sign out
        </Button>
      </div>
    </Section>
  );
}
