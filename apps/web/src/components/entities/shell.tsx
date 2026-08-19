import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon, iconNamed } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { useEntityTypes } from "@/lib/entity-types";
import type { EntityFields } from "@/lib/types";

// What every entity card is made of. One shell so the strip on a message
// reads as one thing rather than as six differently-shaped boxes, and so a
// new kind is a file that fills in slots rather than a new layout.
//
// Two surfaces, and the rule is where the card is rather than what it holds:
// a row *in* a timeline is a surface of its own (no border, the same fill a
// message has), and a card *inside* a message is a chip on top of one. Both
// keep the card fill; the nested one is told apart by its border alone, which
// is enough, and tinting it as well would have made a message's findings read
// as inset wells rather than as cards sitting on it. Which is why this is a
// context rather than a prop: the six cards forward nothing, and the list that
// draws them says once, for all of them, where they are.

type Surface = "timeline" | "nested";

const SurfaceContext = createContext<Surface>("nested");

/** Wraps a list of cards that ARE the timeline, rather than sitting in one. */
export function TimelineEntities({ children }: { children: ReactNode }) {
  return <SurfaceContext.Provider value="timeline">{children}</SurfaceContext.Provider>;
}

/**
 * How many messages the thing on a card was seen in. A context for the same
 * reason the surface is one: the cards forward nothing, and `EntityCard` is the
 * one place that sees both the count and every shell that could draw it.
 */
export const MentionsContext = createContext(0);

export type EntityCardProps = {
  entity: EntityFields;
  /** Opens the entity's own page. Absent where there is nowhere to go. */
  onOpen?: () => void;
  /**
   * How many messages it was seen in, where that is worth saying. The things
   * list passes it; a message's strip does not (its entities do not carry their
   * mentions), nor does the entity page (which lists them in full below).
   */
  mentions?: number;
};

/** Read a string out of an entity's per-kind `data` without trusting it. */
export function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function num(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function EntityShell({
  kind,
  title,
  subtitle,
  actions,
  media,
  onOpen,
}: {
  kind: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A preview image, for the kinds that have one. */
  media?: ReactNode;
  onOpen?: () => void;
}) {
  // A type carries its icon in Postgres, so it is looked up per render rather
  // than baked into a map at module scope.
  const icon = iconNamed(useEntityTypes().icon(kind));
  const timeline = useContext(SurfaceContext) === "timeline";
  // One mention is every thing in the list, so saying it says nothing.
  const mentions = useContext(MentionsContext);
  const footnote = mentions > 1 && (
    <span className="ml-0.5 text-[11px] text-muted-foreground">seen in {mentions} messages</span>
  );
  const surface = timeline ? "rounded-lg bg-card p-3.5" : "rounded-lg border bg-card p-3";
  const hover = onOpen ? `cursor-pointer ${timeline ? "hover:bg-panel" : "hover:bg-accent"}` : "";
  return (
    <div
      className={`flex gap-3 transition ${surface} ${hover}`}
      onClick={
        onOpen
          ? (e) => {
              if (e.target instanceof Element && e.target.closest("a,button")) return;
              onOpen();
            }
          : undefined
      }
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon name={icon} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        {subtitle && (
          <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{subtitle}</div>
        )}
        {/* The count rides the action row rather than a line of its own: that
            row is the one part of a card every kind has, whatever its subtitle
            holds, and a line under the card was a caption floating between two
            of them, belonging to the one below as much as the one above. */}
        {(actions || footnote) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {actions}
            {footnote}
          </div>
        )}
      </div>
      {media}
    </div>
  );
}

/** Copy, with the one beat of feedback that says it worked. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      <Icon name={copied ? "check" : "copy"} className="size-3" />
      {copied ? "Copied" : label}
    </Button>
  );
}

/** An action that leaves the app: maps, a carrier's tracking page, a mailto. */
export function ExternalAction({
  href,
  children,
  icon = "external",
}: {
  href: string;
  children: ReactNode;
  icon?: "external" | "mail" | "phone" | "package";
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      nativeButton={false}
      render={
        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} />
      }
    >
      <Icon name={icon} className="size-3" />
      {children}
    </Button>
  );
}
