import { CopyButton, EntityShell, type EntityCardProps } from "./shell.js";
import { useEntityTypes } from "@/lib/entity-types";

// The card for a kind the deployment declared in Postgres. One component for
// all of them, because a declared type has no behaviour of its own: what it has
// is fields, and this draws them.
//
// Field order and labels come from `entity_type_fields`, so "Brand Name" and
// "Postal Code" are the type's copy rather than a jsonb key with its underscores
// showing. The key field leads (it is the title, via the type's
// `title_template`), and the rest read as a compact definition list.

/** How many fields fit on a card before the entity's own page is the place. */
const MAX_ROWS = 4;

export function DeclaredEntityCard({ entity, onOpen }: EntityCardProps) {
  const types = useEntityTypes();
  const data = entity.data as Record<string, unknown>;
  const entries = types.fieldEntries(entity.kind, data);
  const title = entity.generatedTitle ?? types.title(entity.kind, entity.value, data);
  // Whatever the title already says does not need saying twice underneath it.
  const rows = entries.filter((entry) => entry.value !== title).slice(0, MAX_ROWS);

  return (
    <EntityShell
      kind={entity.kind}
      title={title}
      onOpen={onOpen}
      subtitle={
        <>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wide">
            {types.label(entity.kind)}
          </span>
          {rows.length > 0 && (
            <span className="mt-1 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5">
              {rows.map((entry) => (
                <span key={entry.name} className="contents">
                  <span className="text-muted-foreground/70">{entry.label}</span>
                  <span className="min-w-0 truncate">{entry.value}</span>
                </span>
              ))}
            </span>
          )}
        </>
      }
      actions={<CopyButton value={entity.value} />}
    />
  );
}
