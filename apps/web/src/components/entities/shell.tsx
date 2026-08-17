import { useState, type ReactNode } from "react";
import { Icon, iconNamed } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { useEntityTypes } from "@/lib/entity-types";
import type { EntityFields } from "@/lib/types";

// What every entity card is made of. One shell so the strip on a message
// reads as one thing rather than as six differently-shaped boxes, and so a
// new kind is a file that fills in slots rather than a new layout.

export type EntityCardProps = {
  entity: EntityFields;
  /** Opens the entity's own page. Absent where there is nowhere to go. */
  onOpen?: () => void;
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
  // Declared kinds carry their icon in Postgres, so it is looked up per render
  // rather than baked into a map at module scope.
  const icon = iconNamed(useEntityTypes().icon(kind));
  return (
    <div
      className={`flex gap-3 rounded-lg border bg-panel p-3 transition ${onOpen ? "cursor-pointer hover:bg-accent" : ""}`}
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
        {actions && <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>}
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
