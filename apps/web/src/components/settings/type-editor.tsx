import { mutators, queries } from "@ragbag/contracts";
import { FIELD_TYPES, hasBehaviour, humanize, newId, slugFromLabel } from "@ragbag/shared";
import type { FieldType } from "@ragbag/shared";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { toast } from "sonner";
import { Icon, TYPE_ICONS } from "@/components/icon";
import { DeleteTypeDialog } from "@/components/settings/delete-type-dialog";
import { SectionHeading } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { runMutation } from "@/lib/mutate";
import type { TypeRow } from "@/lib/types";

// One kind of thing, as a form: what it is called, what to look for, and the
// details ragbag should fill in when it finds one.
//
// Editing is safe by construction: the version trigger bumps, the next ingest
// under a newer version replaces `data` rather than merging into it, and a value
// whose field is gone still shows at the end of Details under a humanized label.
//
// The kinds ragbag understands itself (link, tracking, address, phone, email,
// invoice, iban) show their details read-only: the link fetcher writes
// `site_name` and friends directly, so a user deleting those fields would
// produce values with no labels. Everything a person reads is still theirs,
// which is what makes renaming "Phone Numbers" to "Telefon Numaraları" a user
// action rather than a release.

/** What a field looks like when its type owns it: readable, not editable. */
const READ_ONLY = "border-transparent bg-muted";

/** What one row of the field table holds while it is being edited. */
type DraftField = {
  /** Local only: React keys, and what the move buttons reorder. */
  uid: string;
  name: string;
  label: string;
  type: FieldType;
  values: string;
  required: boolean;
  description: string;
  /** In the dedupe key. Its rank is its place among the ticked rows. */
  key: boolean;
};

type Draft = {
  label: string;
  sidebarTitle: string;
  slug: string;
  icon: string;
  hint: string;
  examples: string;
  titleTemplate: string;
  sidebar: boolean;
  fields: DraftField[];
};

function emptyField(): DraftField {
  return {
    uid: newId(),
    name: "",
    label: "",
    type: "text",
    values: "",
    required: false,
    description: "",
    key: false,
  };
}

function draftFrom(type: TypeRow | null): Draft {
  if (!type) {
    return {
      label: "",
      sidebarTitle: "",
      slug: "",
      icon: "sparkles",
      hint: "",
      examples: "",
      titleTemplate: "",
      sidebar: true,
      fields: [emptyField()],
    };
  }
  return {
    label: type.label,
    sidebarTitle: type.sidebarTitle,
    slug: type.slug,
    icon: type.icon,
    hint: type.hint,
    examples: type.examples.join(", "),
    titleTemplate: type.titleTemplate ?? "",
    sidebar: type.sidebar,
    fields: [...type.fields]
      .toSorted((a, b) => a.position - b.position)
      .map((field) => ({
        uid: field.id,
        name: field.name,
        label: field.label,
        type: field.type as FieldType,
        values: (field.values ?? []).join(", "),
        required: field.required,
        description: field.description ?? "",
        key: field.keyRank !== undefined && field.keyRank !== null,
      })),
  };
}

/** "a, b , ,c" to ["a", "b", "c"]: the shape every list input here takes. */
function commaList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "Postal Code" to `postal_code`, for the name a field was not given. */
function nameFromLabel(label: string): string {
  return slugFromLabel(label).replace(/-/g, "_").slice(0, 40);
}

export function TypeEditor({
  typeId,
  onDone,
}: {
  /** Null for a new type: the same form, with nothing filled in. */
  typeId: string | null;
  onDone: () => void;
}) {
  const zero = useZero();
  const [rows] = useQuery(queries.entityTypes());
  const type = typeId ? (rows.find((row) => row.id === typeId) ?? null) : null;
  // Keyed on the row so a late-arriving query fills the form once, and typing
  // into it is never interrupted by a re-sync of the same row.
  return <Form key={type?.id ?? "new"} zero={zero} type={type} onDone={onDone} />;
}

function Form({
  zero,
  type,
  onDone,
}: {
  zero: ReturnType<typeof useZero>;
  type: TypeRow | null;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(type));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A kind ragbag understands itself. Its details are code's, not the user's,
  // so they are shown rather than offered.
  const owned = type ? hasBehaviour(type.kind) : false;
  const patch = (over: Partial<Draft>) => setDraft((current) => ({ ...current, ...over }));

  const patchField = (uid: string, over: Partial<DraftField>) =>
    patch({
      fields: draft.fields.map((field) => (field.uid === uid ? { ...field, ...over } : field)),
    });

  const move = (index: number, by: number) => {
    const next = [...draft.fields];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patch({ fields: next });
  };

  const save = async () => {
    const label = draft.label.trim();
    const sidebarTitle = draft.sidebarTitle.trim() || label;
    if (!label || !draft.hint.trim()) {
      toast.error("Give it a name and say what to look for");
      return;
    }
    // A key field's rank is its place among the ticked ones, which is why the
    // table has a tick and a reorder rather than a number to get wrong.
    let rank = 0;
    const fields = draft.fields
      .filter((field) => field.label.trim() || field.name.trim())
      .map((field) => ({
        name: field.name.trim() || nameFromLabel(field.label),
        label: field.label.trim() || humanize(field.name),
        type: field.type,
        values: field.type === "enum" ? commaList(field.values) : undefined,
        required: field.required,
        description: field.description.trim() || undefined,
        keyRank: field.key ? (rank += 1) : undefined,
      }));

    setSaving(true);
    try {
      if (!type) {
        await runMutation(
          zero.mutate(
            mutators.entityType.create({
              id: newId(),
              label,
              sidebarTitle,
              slug: draft.slug.trim() || undefined,
              icon: draft.icon,
              hint: draft.hint.trim(),
              examples: commaList(draft.examples),
              titleTemplate: draft.titleTemplate.trim() || null,
              fields,
            }),
          ),
        );
      } else {
        await runMutation(
          zero.mutate(
            mutators.entityType.update({
              id: type.id,
              label,
              sidebarTitle,
              slug: draft.slug.trim() || slugFromLabel(sidebarTitle),
              icon: draft.icon,
              hint: draft.hint.trim(),
              examples: commaList(draft.examples),
              titleTemplate: draft.titleTemplate.trim() || null,
              sidebar: draft.sidebar,
            }),
          ),
        );
        // One submit, one mutation for the whole table: add, edit, remove and
        // reorder arrive together, or none of them do.
        if (!owned) {
          await runMutation(zero.mutate(mutators.entityType.setFields({ id: type.id, fields })));
        }
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" title="Back" onClick={onDone}>
          <Icon name="x" className="size-4" />
        </Button>
        <h2 className="text-base font-semibold">
          {type ? type.sidebarTitle : "Something new to look for"}
        </h2>
        <Button
          className="ml-auto"
          size="sm"
          disabled={saving}
          onClick={() => {
            void save();
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Name" hint="One of them: Book">
          <Input
            value={draft.label}
            placeholder="Book"
            onChange={(e) => {
              const label = e.target.value;
              // Derived until it is touched: a new type gets its title and its
              // URL for free, and either can be typed over.
              patch({
                label,
                ...(type
                  ? {}
                  : { sidebarTitle: pluralize(label), slug: slugFromLabel(pluralize(label)) }),
              });
            }}
          />
        </Labelled>
        <Labelled label="Sidebar title" hint="All of them: Books">
          <Input
            value={draft.sidebarTitle}
            placeholder="Books"
            onChange={(e) => {
              const next = e.target.value;
              patch({ sidebarTitle: next, ...(type ? {} : { slug: slugFromLabel(next) }) });
            }}
          />
        </Labelled>
        <Labelled label="Link" hint={`ragbag.app/${draft.slug || "books"}`}>
          <Input
            value={draft.slug}
            placeholder="books"
            onChange={(e) => patch({ slug: e.target.value })}
          />
        </Labelled>
        <Labelled label="Name each one by" hint="Which detail: {title}">
          <Input
            value={draft.titleTemplate}
            placeholder="{title}"
            onChange={(e) => patch({ titleTemplate: e.target.value })}
          />
        </Labelled>
      </div>

      <Grouped label="Icon">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_ICONS.map((name) => (
            <Button
              key={name}
              variant={draft.icon === name ? "secondary" : "ghost"}
              size="icon-sm"
              title={name}
              className={draft.icon === name ? "ring-1 ring-primary" : "text-muted-foreground"}
              onClick={() => patch({ icon: name })}
            >
              <Icon name={name} className="size-4" />
            </Button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Checkbox
              checked={draft.sidebar}
              onCheckedChange={(checked) => patch({ sidebar: checked === true })}
            />
            Show in the sidebar
          </label>
        </div>
      </Grouped>

      <Labelled label="What to look for">
        <Textarea
          value={draft.hint}
          rows={2}
          placeholder="A book someone recommended, with its author."
          onChange={(e) => patch({ hint: e.target.value })}
        />
      </Labelled>

      <Labelled label="Examples" hint="Optional, comma separated">
        <Input
          value={draft.examples}
          placeholder="Dune, The Left Hand of Darkness"
          onChange={(e) => patch({ examples: e.target.value })}
        />
      </Labelled>

      <div>
        <SectionHeading
          className="mb-1"
          action={
            !owned && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => patch({ fields: [...draft.fields, emptyField()] })}
              >
                <Icon name="plus" className="size-3" /> Add
              </Button>
            )
          }
        >
          Details
        </SectionHeading>
        <p className="mb-3 text-[13px] text-muted-foreground">
          {owned
            ? "This one is built in, so its details are fixed."
            : "What to fill in for each one. Tick the details that tell two apart."}
        </p>
        <ul className="flex flex-col gap-2">
          {draft.fields.map((field, index) => (
            <li key={field.uid} className="rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                {/* readOnly rather than disabled on the text inputs: a disabled
                    input is drawn at half strength, which made a fixed type's
                    real details look like empty placeholders. */}
                <Input
                  className={`h-8 flex-1 ${owned ? READ_ONLY : ""}`}
                  value={field.label}
                  readOnly={owned}
                  placeholder="Author"
                  onChange={(e) => {
                    const label = e.target.value;
                    patchField(field.uid, {
                      label,
                      // The name is the key this is stored under and the
                      // spelling the model answers with. Derived while it is
                      // untouched, and left alone once a field exists under it.
                      ...(field.name && type ? {} : { name: nameFromLabel(label) }),
                    });
                  }}
                />
                <select
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50"
                  value={field.type}
                  disabled={owned}
                  aria-label="Kind of detail"
                  onChange={(e) => patchField(field.uid, { type: e.target.value as FieldType })}
                >
                  {FIELD_TYPES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {!owned && (
                  <span className="flex items-center">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <Icon name="up" className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Move down"
                      disabled={index === draft.fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <Icon name="down" className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      title="Remove"
                      onClick={() =>
                        patch({ fields: draft.fields.filter((f) => f.uid !== field.uid) })
                      }
                    >
                      <Icon name="trash" className="size-3" />
                    </Button>
                  </span>
                )}
              </div>

              {field.type === "enum" && (
                <Input
                  className={`mt-2 h-8 ${owned ? READ_ONLY : ""}`}
                  value={field.values}
                  readOnly={owned}
                  placeholder="hardback, paperback, ebook"
                  aria-label="Choices"
                  onChange={(e) => patchField(field.uid, { values: e.target.value })}
                />
              )}

              <Input
                className={`mt-2 h-8 ${owned ? READ_ONLY : ""}`}
                value={field.description}
                readOnly={owned}
                placeholder="What goes here. Optional"
                aria-label="What goes here"
                onChange={(e) => patchField(field.uid, { description: e.target.value })}
              />

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                <code className="rounded-sm bg-muted px-1 py-0.5 text-[11px]">
                  {field.name || nameFromLabel(field.label) || "field_name"}
                </code>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    checked={field.required}
                    disabled={owned}
                    onCheckedChange={(checked) =>
                      patchField(field.uid, { required: checked === true })
                    }
                  />
                  Always needed
                </label>
                {/* Hidden for the kinds whose dedupe rule is code's: a tick here
                    would be read by nothing (plan §10.3). */}
                {!owned && (
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={field.key}
                      onCheckedChange={(checked) =>
                        patchField(field.uid, { key: checked === true })
                      }
                    />
                    Tells two apart
                  </label>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {type && (
        <div className="border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive-soft"
            onClick={() => setDeleting(true)}
          >
            <Icon name="trash" className="size-3.5" /> Delete this type
          </Button>
          {deleting && (
            <DeleteTypeDialog type={type} onClose={() => setDeleting(false)} onDeleted={onDone} />
          )}
        </div>
      )}
    </div>
  );
}

/** The laziest plural that is right most of the time; it is editable anyway. */
function pluralize(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (/[sx]$/i.test(trimmed)) return `${trimmed}es`;
  if (/[^aeiou]y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

function Head({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline gap-2">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </span>
  );
}

/** One field, one control: the caption is the control's own label. */
function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <Head label={label} hint={hint} />
      {children}
    </label>
  );
}

/**
 * The same caption over a group of controls rather than over one.
 *
 * Not a `<label>`: a label owns exactly one control, and the icon row holds
 * sixteen buttons and a checkbox with a label of its own.
 */
function Grouped({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Head label={label} hint={hint} />
      {children}
    </div>
  );
}
